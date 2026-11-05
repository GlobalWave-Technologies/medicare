import { randomUUID } from 'node:crypto'
import { Writable } from 'node:stream'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app.js'
import { disconnectDatabase } from '../src/database/prisma.js'
import { createLogger } from '../src/shared/logger/logger.js'
import { hashPassword } from '../src/shared/security/password.js'
import { createSession } from '../src/modules/auth/session.service.js'
import { isolatedTestEnvironment, testDatabase } from './helpers/database.js'
import type { StaffRole, Prisma, AppointmentStatus } from '../src/generated/prisma/client.js'
const db = testDatabase(), env = isolatedTestEnvironment(), base = '/api/v1/encounters'
type Actor = { id: string; cookie: string; csrf: string; sessionId: string }
const actors = new Map<StaffRole, Actor>()
let hash: string, logs = '', slot = 0
let app: ReturnType<typeof createApp>
const actor = (role: StaffRole = 'DOCTOR_IN_CHARGE') => actors.get(role)!
async function newActor(role: StaffRole = 'DOCTOR_IN_CHARGE'): Promise<Actor> {
  const user = await db.staffUser.create({ data: { firstName: 'Synthetic', lastName: 'Clinical', email: `${randomUUID()}@example.test`,
    role, status: 'ACTIVE', passwordHash: hash, passwordChangedAt: new Date() } })
  const session = await db.$transaction((tx) => createSession(tx, user.id))
  return { id: user.id, cookie: `medicare_session=${session.token}`, csrf: session.session.csrfToken, sessionId: session.session.id }
}
async function patient() {
  return db.patient.create({ data: { firstName: 'Synthetic', lastName: `Clinical-${randomUUID()}`, phone: '+233241234567', createdById: actor('ADMIN').id } })
}
async function input() {
  return { patientId: (await patient()).id, occurredAt: new Date(Date.now() - 60000).toISOString(),
    clinicalNotes: 'Private clinical narrative', historySummary: 'Private history', treatmentPlan: 'Private plan',
    complaints: [{ description: 'Private complaint' }], diagnoses: [{ description: 'Private diagnosis', code: 'Local-1', notes: 'Private diagnostic notes' }] }
}
function send(method: 'post' | 'patch' | 'delete', path: string, body?: object, who = actor()) {
  const call = request(app)[method](path).set('Cookie', who.cookie).set('Origin', env.CLIENT_ORIGIN).set('X-CSRF-Token', who.csrf)
  return body ? call.send(body) : call
}
const read = (path: string, who = actor()) => request(app).get(path).set('Cookie', who.cookie)
async function seed(who = actor(), overrides: Partial<Prisma.EncounterUncheckedCreateInput> = {}) {
  const body = await input()
  return db.encounter.create({ data: { patientId: body.patientId, clinicianId: who.id, createdById: who.id,
    occurredAt: body.occurredAt, clinicalNotes: body.clinicalNotes, ...overrides,
    complaints: { create: body.complaints }, diagnoses: { create: body.diagnoses } } })
}
async function reviewed(who = actor()) {
  const value = await seed(who)
  return db.encounter.update({ where: { id: value.id }, data: { status: 'REVIEWED', reviewedAt: new Date() } })
}
async function appointment(patientId: string, who = actor(), status: AppointmentStatus = 'CHECKED_IN') {
  const start = Date.now() - (++slot * 3600000)
  return db.appointment.create({ data: { patientId, clinicianId: who.id, type: 'CONSULTATION', status, createdById: actor('ADMIN').id,
    scheduledStart: new Date(start), scheduledEnd: new Date(start + 1800000),
    ...(status === 'CANCELLED' ? { cancelledAt: new Date(), cancelledById: actor('ADMIN').id } : {}) } })
}
function dto(value: Record<string, unknown>, detail: boolean) {
  const keys = ['id', 'reference', 'status', 'occurredAt', 'reviewedAt', 'createdAt', 'patient', 'clinician', 'author', 'appointment', 'diagnoses']
  if (detail) keys.push('roomLabel', 'historySummary', 'clinicalNotes', 'treatmentPlan', 'followUpAt', 'updatedAt', 'voidedAt', 'voidReason', 'complaints', 'amendments')
  expect(Object.keys(value).sort()).toEqual(keys.sort())
  expect(Object.keys(value.patient as object).sort()).toEqual(['id', 'patientNumber', 'firstName', 'middleName', 'lastName'].sort())
  expect(Object.keys(value.author as object).sort()).toEqual(['id', 'staffNumber', 'firstName', 'lastName'].sort())
  if (value.clinician) expect(Object.keys(value.clinician as object).sort()).toEqual(['id', 'staffNumber', 'firstName', 'lastName'].sort())
}
async function audited(response: request.Response, action: string, id: string, who = actor()) {
  const events = await db.auditEvent.findMany({ where: { requestId: response.headers['x-request-id'] } })
  expect(events).toHaveLength(1)
  expect(events[0]).toMatchObject({ action, actorId: who.id, entityId: id })
  expect(events[0]!.ipAddress).not.toBeNull()
  expect(JSON.stringify(events[0]!.metadata)).not.toMatch(/Private|Synthetic|Correction/)
}
beforeAll(async () => {
  hash = await hashPassword('Synthetic clinical test passphrase')
  for (const role of ['ADMIN', 'RECORDS_OFFICER', 'DOCTOR_IN_CHARGE'] as const) actors.set(role, await newActor(role))
  await db.$executeRawUnsafe(`CREATE FUNCTION test_reject_clinical_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW."requestId" = 'fail-clinical-audit' THEN RAISE EXCEPTION 'private clinical SQL'; END IF; RETURN NEW; END $$`)
  await db.$executeRawUnsafe(`CREATE TRIGGER test_clinical_audit_failure BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION test_reject_clinical_audit()`)
})
beforeEach(() => {
  logs = ''
  app = createApp({ env, prisma: db, checkDatabase: async () => {}, logger: createLogger('info', new Writable({
    write(chunk: Buffer, _encoding, callback) { logs += chunk.toString(); callback() },
  })) })
})
afterAll(disconnectDatabase)
describe('clinical authorization', () => {
  const id = randomUUID()
  const routes = [['get', base], ['get', `${base}/${id}`], ['post', base], ['patch', `${base}/${id}`],
    ['post', `${base}/${id}/finalize`], ['post', `${base}/${id}/amend`], ['get', `/api/v1/patients/${id}/encounters`]] as const
  it.each(routes)('rejects anonymous %s %s', async (method, path) => expect((await request(app)[method](path)).status).toBe(401))
  for (const role of ['ADMIN', 'RECORDS_OFFICER'] as const) {
    it.each(routes)(`denies ${role} %s %s`, async (method, path) => {
      const response = method === 'get' ? await read(path, actor(role)) : await send(method, path, { role: 'DOCTOR_IN_CHARGE' }, actor(role))
      expect(response.status).toBe(403)
      expect(response.body.error.code).toBe('FORBIDDEN')
    })
  }
  it('allows broad doctor reads but only original-author mutations', async () => {
    const who = await newActor(), value = await seed()
    expect((await read(`${base}/${value.id}`, who)).status).toBe(200)
    expect((await read(`${base}?patientId=${value.patientId}`, who)).body.data.items).toHaveLength(1)
    expect((await read(`/api/v1/patients/${value.patientId}/encounters`, who)).status).toBe(200)
    for (const operation of ['update', 'finalize', 'amend']) {
      const path = `${base}/${value.id}${operation === 'update' ? '' : `/${operation}`}`
      const response = await send(operation === 'update' ? 'patch' : 'post', path, operation === 'update' ? { clinicalNotes: 'change' }
        : operation === 'amend' ? { reason: 'Correction', content: 'Correction text' } : {}, who)
      expect(response.body.error.code).toBe('ENCOUNTER_AUTHOR_REQUIRED')
    }
  })
  it.each(['SUSPENDED', 'DISABLED', 'PENDING', 'revoked', 'roleChanged'] as const)('rejects %s clinical access', async (kind) => {
    const who = await newActor(), value = await reviewed(who)
    if (kind === 'revoked') await db.staffSession.update({ where: { id: who.sessionId }, data: { revokedAt: new Date() } })
    else await db.staffUser.update({ where: { id: who.id }, data: kind === 'roleChanged' ? { role: 'ADMIN' } : { status: kind } })
    const expected = kind === 'roleChanged' ? 403 : 401
    expect((await read(base, who)).status).toBe(expected)
    expect((await send('post', base, await input(), who)).status).toBe(expected)
    expect((await send('post', `${base}/${value.id}/amend`, { reason: 'Correction', content: 'Text' }, who)).status).toBe(expected)
    expect((await read(`${base}/${value.id}`)).body.data.encounter.clinician.id).toBe(who.id)
  })
})
describe('clinical creation and appointment links', () => {
  it('creates an authored draft with structured children, generated reference and atomic audit', async () => {
    const body = await input(), response = await send('post', base, body)
    expect(response.status).toBe(201)
    const value = response.body.data.encounter
    dto(value, true)
    expect(value).toMatchObject({ status: 'DRAFT', reviewedAt: null, appointment: null, clinician: { id: actor().id }, author: { id: actor().id } })
    expect(value.reference).toMatch(/^MR-[0-9A-F-]{36}$/)
    expect(value.complaints[0].description).toBe(body.complaints[0]!.description)
    expect(value.diagnoses[0]).toMatchObject(body.diagnoses[0]!)
    await audited(response, 'MEDICAL_RECORD_CREATED', value.id)
    expect((await db.encounter.findUniqueOrThrow({ where: { id: value.id } })).createdById).toBe(actor().id)
  })
  it('supports walk-ins with server time and empty optional arrays', async () => {
    const before = Date.now(), response = await send('post', base, { patientId: (await patient()).id, complaints: [], diagnoses: [] })
    expect(response.status).toBe(201)
    expect(Date.parse(response.body.data.encounter.occurredAt)).toBeGreaterThanOrEqual(before)
    expect(response.body.data.encounter).toMatchObject({ appointment: null, complaints: [], diagnoses: [], clinicalNotes: null })
  })
  it.each(['clinicianId', 'createdById', 'receivedById', 'reference', 'recordReference', 'author', 'status', 'reviewedAt', 'finalizedAt', 'createdAt', 'updatedAt', 'voidedAt', 'amendments', 'patient'])(
    'rejects injected creation field %s', async (field) => expect((await send('post', base, { ...await input(), [field]: 'injected' })).status).toBe(400))
  it.each(['missing', 'archived'])('rejects %s patient', async (kind) => {
    const body = await input()
    if (kind === 'missing') body.patientId = randomUUID()
    else await db.patient.update({ where: { id: body.patientId }, data: { archivedAt: new Date() } })
    expect((await send('post', base, body)).body.error.code).toBe(kind === 'missing' ? 'PATIENT_NOT_FOUND' : 'PATIENT_ARCHIVED')
  })
  it.each(['noZone', 'future', 'followUpBefore', 'invalidDate'])('rejects invalid encounter time %s', async (kind) => {
    const body = await input()
    const extra = kind === 'noZone' ? { occurredAt: '2020-01-01T10:00:00' } : kind === 'future' ? { occurredAt: new Date(Date.now() + 3600000).toISOString() }
      : kind === 'followUpBefore' ? { followUpAt: '1990-01-01T00:00:00Z' } : { occurredAt: '2026-02-30T00:00:00Z' }
    expect((await send('post', base, { ...body, ...extra })).status).toBe(400)
  })
  it('normalizes timezone offsets and permits transparent late entry', async () => {
    const response = await send('post', base, { ...await input(), occurredAt: '2020-01-01T10:00:00+02:00' })
    expect(response.status).toBe(201)
    expect(response.body.data.encounter.occurredAt).toBe('2020-01-01T08:00:00.000Z')
    expect(Date.parse(response.body.data.encounter.createdAt)).toBeGreaterThan(Date.parse(response.body.data.encounter.occurredAt))
  })
  it.each(['CHECKED_IN', 'COMPLETED', 'SCHEDULED', 'CONFIRMED', 'NO_SHOW', 'CANCELLED'] as const)('enforces linking state %s', async (status) => {
    const body = await input(), linked = await appointment(body.patientId, actor(), status)
    const response = await send('post', base, { ...body, appointmentId: linked.id })
    expect(response.status).toBe(['CHECKED_IN', 'COMPLETED'].includes(status) ? 201 : 409)
  })
  it.each(['missing', 'wrongPatient', 'otherDoctor'])('rejects %s appointment link', async (kind) => {
    const body = await input(), linked = await appointment(kind === 'wrongPatient' ? (await patient()).id : body.patientId, kind === 'otherDoctor' ? await newActor() : actor())
    const response = await send('post', base, { ...body, appointmentId: kind === 'missing' ? randomUUID() : linked.id })
    expect(response.body.error.code).toBe(kind === 'missing' ? 'APPOINTMENT_NOT_FOUND' : 'APPOINTMENT_NOT_ELIGIBLE_FOR_ENCOUNTER')
  })
  it('permits only one encounter for concurrent attempts against an appointment', async () => {
    const body = await input(), linked = await appointment(body.patientId)
    const responses = await Promise.all([send('post', base, { ...body, appointmentId: linked.id }), send('post', base, { ...body, appointmentId: linked.id })])
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409])
    expect(responses.find((r) => r.status === 409)!.body.error.code).toBe('APPOINTMENT_ALREADY_HAS_ENCOUNTER')
    expect(await db.encounter.count({ where: { appointmentId: linked.id } })).toBe(1)
    await expect(db.encounter.create({ data: { patientId: body.patientId, appointmentId: linked.id, clinicianId: actor().id, createdById: actor().id } })).rejects.toMatchObject({ code: 'P2002' })
  })
  it('keeps concurrent walk-in references unique', async () => {
    const body = await input(), responses = await Promise.all(Array.from({ length: 5 }, () => send('post', base, body)))
    expect(responses.map((r) => r.status)).toEqual(Array(5).fill(201))
    expect(new Set(responses.map((r) => r.body.data.encounter.reference)).size).toBe(5)
  })
})
describe('draft editing and finalization', () => {
  it('atomically replaces supplied draft children and preserves omitted fields', async () => {
    const value = await seed()
    const response = await send('patch', `${base}/${value.id}`, { complaints: [{ description: 'Changed complaint' }], diagnoses: [{ description: 'Changed finding' }], historySummary: 'History' })
    expect(response.status).toBe(200)
    expect(response.body.data.encounter).toMatchObject({ clinicalNotes: value.clinicalNotes, historySummary: 'History' })
    expect(response.body.data.encounter.complaints).toHaveLength(1)
    expect(response.body.data.encounter.complaints[0].description).toBe('Changed complaint')
    expect(response.body.data.encounter.diagnoses[0].description).toBe('Changed finding')
    await audited(response, 'MEDICAL_RECORD_UPDATED', value.id)
    const cleared = await send('patch', `${base}/${value.id}`, { complaints: [], diagnoses: [], clinicalNotes: null })
    expect(cleared.status).toBe(200)
    expect(cleared.body.data.encounter).toMatchObject({ complaints: [], diagnoses: [], clinicalNotes: null })
  })
  it('keeps complaints and diagnoses in entered order through create, replacement and finalization', async () => {
    const body = await input()
    const complaints = ['Zeta listed first', 'Alpha listed second', 'Middle listed third', 'Omega listed fourth', 'Beta listed fifth'].map((description) => ({ description }))
    const diagnoses = ['Principal finding', 'Secondary finding', 'Additional finding', 'Incidental finding'].map((description, index) => ({ description, code: `ORD-${index}` }))
    const names = (items: Array<{ description: string }>) => items.map((item) => item.description)
    const created = await send('post', base, { ...body, complaints, diagnoses })
    expect(created.status).toBe(201)
    const id = created.body.data.encounter.id
    expect(names(created.body.data.encounter.complaints)).toEqual(names(complaints))
    expect(names(created.body.data.encounter.diagnoses)).toEqual(names(diagnoses))
    const reordered = [...diagnoses].reverse()
    const updated = await send('patch', `${base}/${id}`, { diagnoses: reordered })
    expect(names(updated.body.data.encounter.diagnoses)).toEqual(names(reordered))
    expect((await send('post', `${base}/${id}/finalize`, {})).status).toBe(200)
    const detail = (await read(`${base}/${id}`)).body.data.encounter
    expect(names(detail.complaints)).toEqual(names(complaints))
    expect(names(detail.diagnoses)).toEqual(names(reordered))
    const summary = (await read(`${base}?patientId=${body.patientId}`)).body.data.items[0]
    expect(names(summary.diagnoses)).toEqual(names(reordered))
  })
  it.each(['patientId', 'clinicianId', 'createdById', 'receivedById', 'appointmentId', 'reference', 'status', 'reviewedAt', 'createdAt', 'updatedAt', 'id', 'amendments'])(
    'rejects protected draft field %s', async (field) => {
      const value = await seed()
      expect((await send('patch', `${base}/${value.id}`, { [field]: randomUUID() })).status).toBe(400)
      expect(await db.encounter.findUniqueOrThrow({ where: { id: value.id } })).toEqual(value)
    })
  it('rejects empty PATCH and duplicate normalized complaints without altering draft', async () => {
    const value = await seed()
    expect((await send('patch', `${base}/${value.id}`, {})).status).toBe(400)
    expect((await send('patch', `${base}/${value.id}`, { complaints: [{ description: 'Same' }, { description: ' Same ' }] })).status).toBe(400)
    expect(await db.encounterComplaint.count({ where: { encounterId: value.id } })).toBe(1)
  })
  it('finalizes as REVIEWED with signing time and leaves appointment status explicit', async () => {
    const body = await input(), linked = await appointment(body.patientId)
    const created = await send('post', base, { ...body, appointmentId: linked.id }), id = created.body.data.encounter.id
    const before = Date.now(), response = await send('post', `${base}/${id}/finalize`, {})
    expect(response.status).toBe(200)
    expect(response.body.data.encounter.status).toBe('REVIEWED')
    expect(Date.parse(response.body.data.encounter.reviewedAt)).toBeGreaterThanOrEqual(before)
    await audited(response, 'MEDICAL_RECORD_FINALIZED', id)
    expect((await db.appointment.findUniqueOrThrow({ where: { id: linked.id } })).status).toBe('CHECKED_IN')
    expect((await send('post', `${base}/${id}/finalize`, {})).body.error.code).toBe('ENCOUNTER_FINALIZED')
  })
  it.each(['clinicalNotes', 'historySummary', 'treatmentPlan', 'complaints', 'diagnoses'])('accepts %s as minimum clinical content', async (field) => {
    const content = field === 'complaints' || field === 'diagnoses' ? [{ description: 'Clinical content' }] : 'Clinical content'
    const created = await send('post', base, { patientId: (await patient()).id, [field]: content })
    expect((await send('post', `${base}/${created.body.data.encounter.id}/finalize`, {})).status).toBe(200)
  })
  it('rejects empty or not-yet-occurred finalization', async () => {
    const empty = await send('post', base, { patientId: (await patient()).id, roomLabel: 'Room 1' })
    expect((await send('post', `${base}/${empty.body.data.encounter.id}/finalize`, {})).body.error.code).toBe('EMPTY_CLINICAL_RECORD')
    const future = await seed(actor(), { occurredAt: new Date(Date.now() + 30000) })
    expect((await send('post', `${base}/${future.id}/finalize`, {})).body.error.code).toBe('INVALID_ENCOUNTER_TIME')
  })
  it.each([{ clinicalNotes: 'rewrite' }, { complaints: [] }, { diagnoses: [] }])('rejects finalized content replacement %j', async (body) => {
    const value = await reviewed()
    expect((await send('patch', `${base}/${value.id}`, body)).body.error.code).toBe('ENCOUNTER_FINALIZED')
  })
  it('keeps archived history readable but blocks draft activity without reactivation', async () => {
    const value = await seed()
    await db.patient.update({ where: { id: value.patientId }, data: { archivedAt: new Date() } })
    expect((await send('patch', `${base}/${value.id}`, { clinicalNotes: 'change' })).body.error.code).toBe('PATIENT_ARCHIVED')
    expect((await send('post', `${base}/${value.id}/finalize`, {})).body.error.code).toBe('PATIENT_ARCHIVED')
    expect((await read(`${base}/${value.id}`)).status).toBe(200)
    expect((await read(`/api/v1/patients/${value.patientId}/encounters`)).status).toBe(200)
    expect((await db.patient.findUniqueOrThrow({ where: { id: value.patientId } })).archivedAt).not.toBeNull()
  })
  it('serializes concurrent finalization and protects the reviewed snapshot', async () => {
    const value = await seed()
    const responses = await Promise.all([send('post', `${base}/${value.id}/finalize`, {}), send('post', `${base}/${value.id}/finalize`, {})])
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409])
    expect(await db.auditEvent.count({ where: { entityId: value.id, action: 'MEDICAL_RECORD_FINALIZED' } })).toBe(1)
  })
})
describe('amendments and database history integrity', () => {
  it('appends visible authored corrections while leaving original encounter unchanged', async () => {
    const value = await reviewed()
    const first = await send('post', `${base}/${value.id}/amend`, { reason: 'Correction reason', content: 'Correction one' })
    expect(first.status).toBe(201)
    await audited(first, 'MEDICAL_RECORD_AMENDED', value.id)
    expect(first.body.data.encounter.amendments[0]).toMatchObject({ reason: 'Correction reason', content: 'Correction one', author: { id: actor().id } })
    const second = await send('post', `${base}/${value.id}/amend`, { reason: 'Further correction', content: 'Correction two' })
    expect(second.body.data.encounter.amendments).toHaveLength(2)
    expect(second.body.data.encounter.amendments[0]).toEqual(first.body.data.encounter.amendments[0])
    expect(await db.encounter.findUniqueOrThrow({ where: { id: value.id } })).toEqual(value)
    expect((await read(`${base}/${value.id}`)).body.data.encounter.amendments).toHaveLength(2)
  })
  it('allows the original active doctor to correct archived history', async () => {
    const value = await reviewed()
    await db.patient.update({ where: { id: value.patientId }, data: { archivedAt: new Date() } })
    expect((await send('post', `${base}/${value.id}/amend`, { reason: 'Correction', content: 'Historical correction' })).status).toBe(201)
  })
  it('rejects a resent identical amendment, including concurrent resends, without a second permanent entry', async () => {
    const value = await reviewed(), body = { reason: 'Correction reason', content: 'Resent correction' }
    expect((await send('post', `${base}/${value.id}/amend`, body)).status).toBe(201)
    const repeat = await send('post', `${base}/${value.id}/amend`, body)
    expect(repeat.status).toBe(409)
    expect(repeat.body.error.code).toBe('DUPLICATE_AMENDMENT')
    expect(await db.encounterAmendment.count({ where: { encounterId: value.id } })).toBe(1)
    const concurrent = await Promise.all([1, 2].map(() => send('post', `${base}/${value.id}/amend`, { reason: 'Second reason', content: 'Concurrent correction' })))
    expect(concurrent.map((response) => response.status).sort()).toEqual([201, 409])
    expect((await send('post', `${base}/${value.id}/amend`, { ...body, content: 'Different correction' })).status).toBe(201)
    expect(await db.encounterAmendment.count({ where: { encounterId: value.id } })).toBe(3)
    expect(await db.auditEvent.count({ where: { entityId: value.id, action: 'MEDICAL_RECORD_AMENDED' } })).toBe(3)
  })
  it('rejects draft amendments and another doctor amending finalized content', async () => {
    const draft = await seed(), final = await reviewed(), body = { reason: 'Correction', content: 'Content' }
    expect((await send('post', `${base}/${draft.id}/amend`, body)).body.error.code).toBe('ENCOUNTER_NOT_FINALIZED')
    expect((await send('post', `${base}/${final.id}/amend`, body, await newActor())).body.error.code).toBe('ENCOUNTER_AUTHOR_REQUIRED')
  })
  it.each([{}, { reason: 'Reason' }, { content: 'Content' }, { reason: ' ', content: 'Content' }, { reason: 'Reason', content: ' ' },
    { reason: 'Reason', content: 'Content', authorId: randomUUID() }, { reason: 'Reason', content: 'Content', createdAt: '2020-01-01' }])(
    'rejects invalid or forged amendment %j', async (body) => {
      const value = await reviewed()
      expect((await send('post', `${base}/${value.id}/amend`, body)).status).toBe(400)
      expect(await db.encounterAmendment.count({ where: { encounterId: value.id } })).toBe(0)
    })
  it.each(['parentUpdate', 'parentDelete', 'complaintInsert', 'complaintUpdate', 'complaintDelete', 'diagnosisInsert', 'diagnosisUpdate', 'diagnosisDelete'] as const)(
    'database blocks finalized %s', async (operation) => {
      const value = await reviewed()
      const complaint = await db.encounterComplaint.findFirstOrThrow({ where: { encounterId: value.id } })
      const diagnosis = await db.diagnosis.findFirstOrThrow({ where: { encounterId: value.id } })
      const operations = {
        parentUpdate: () => db.encounter.update({ where: { id: value.id }, data: { clinicalNotes: 'rewrite' } }),
        parentDelete: () => db.encounter.delete({ where: { id: value.id } }),
        complaintInsert: () => db.encounterComplaint.create({ data: { encounterId: value.id, description: 'rewrite' } }),
        complaintUpdate: () => db.encounterComplaint.update({ where: { id: complaint.id }, data: { description: 'rewrite' } }),
        complaintDelete: () => db.encounterComplaint.delete({ where: { id: complaint.id } }),
        diagnosisInsert: () => db.diagnosis.create({ data: { encounterId: value.id, description: 'rewrite' } }),
        diagnosisUpdate: () => db.diagnosis.update({ where: { id: diagnosis.id }, data: { notes: 'rewrite' } }),
        diagnosisDelete: () => db.diagnosis.delete({ where: { id: diagnosis.id } }),
      }
      await expect(operations[operation]()).rejects.toThrow()
      expect(await db.encounter.findUniqueOrThrow({ where: { id: value.id } })).toEqual(value)
    })
  it('database rejects amendment edits/deletion and invalid parent/author', async () => {
    const value = await reviewed(), draft = await seed(), data = { encounterId: value.id, authorId: actor().id, reason: 'Correction', content: 'Content' }
    const amendment = await db.encounterAmendment.create({ data })
    await expect(db.encounterAmendment.update({ where: { id: amendment.id }, data: { content: 'rewrite' } })).rejects.toThrow()
    await expect(db.encounterAmendment.delete({ where: { id: amendment.id } })).rejects.toThrow()
    await expect(db.encounterAmendment.create({ data: { ...data, encounterId: draft.id } })).rejects.toThrow()
    await expect(db.encounterAmendment.create({ data: { ...data, authorId: (await newActor()).id } })).rejects.toThrow()
    expect(await db.encounterAmendment.findUniqueOrThrow({ where: { id: amendment.id } })).toEqual(amendment)
  })
  it.each(['Encounter', 'EncounterComplaint', 'Diagnosis', 'EncounterAmendment'])('blocks TRUNCATE of %s in the guarded disposable database', async (table) => {
    await expect(db.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE`)).rejects.toThrow()
    expect(await db.encounter.count()).toBeGreaterThan(0)
  })
  it('does not expose encounter or amendment delete/edit routes', async () => {
    const value = await reviewed(), amendmentId = randomUUID()
    expect((await send('delete', `${base}/${value.id}`)).status).toBe(404)
    expect((await send('patch', `${base}/${value.id}/amendments/${amendmentId}`, { content: 'change' })).status).toBe(404)
    expect((await send('delete', `${base}/${value.id}/amendments/${amendmentId}`)).status).toBe(404)
  })
})
describe('clinical history, DTO and privacy', () => {
  it('paginates deterministically with small summary DTOs and a single history audit', async () => {
    const p = await patient(), ids = [randomUUID(), randomUUID(), randomUUID()].sort()
    const occurredAt = new Date('2020-01-01'), createdAt = new Date('2021-01-01')
    for (const id of ids) await seed(actor(), { id, patientId: p.id, occurredAt, createdAt })
    const response = await read(`/api/v1/patients/${p.id}/encounters?page=2&limit=2`)
    expect(response.status).toBe(200)
    expect(response.body.data.pagination).toEqual({ page: 2, limit: 2, total: 3, totalPages: 2 })
    expect(response.body.data.items.map((v: { id: string }) => v.id)).toEqual([ids[2]])
    dto(response.body.data.items[0], false)
    expect(response.body.data.items[0].diagnoses[0]).not.toHaveProperty('notes')
    await audited(response, 'MEDICAL_HISTORY_VIEWED', p.id)
    expect((await read(`/api/v1/patients/${p.id}/encounters?page=9`)).body.data.items).toEqual([])
  })
  it.each(['patientId', 'clinicianId', 'appointmentId', 'status', 'dateRange', 'reference'] as const)('supports %s filter', async (filter) => {
    const who = await newActor(), p = await patient(), linked = await appointment(p.id, who)
    const value = await seed(who, { patientId: p.id, appointmentId: linked.id })
    const query = new URLSearchParams({ patientId: p.id })
    if (filter === 'clinicianId') query.set('clinicianId', who.id)
    if (filter === 'appointmentId') query.set('appointmentId', linked.id)
    if (filter === 'status') query.set('status', 'DRAFT')
    if (filter === 'dateRange') { query.set('dateFrom', value.occurredAt.toISOString()); query.set('dateTo', value.occurredAt.toISOString()) }
    if (filter === 'reference') query.set('search', value.reference.toLowerCase())
    const response = await read(`${base}?${query}`)
    expect(response.body.data.items.map((v: { id: string }) => v.id)).toEqual([value.id])
    expect(await db.auditEvent.count({ where: { requestId: response.headers['x-request-id'] } })).toBe(0)
  })
  it.each(['limit=101', 'page=0', 'status=FINALIZED', 'patientId=x', 'clinicianId=x', 'appointmentId=x', 'dateFrom=2020-01-01',
    'dateFrom=2021-01-01T00:00:00Z&dateTo=2020-01-01T00:00:00Z', 'clinicalNotes=Private', 'where[status]=DRAFT'])(
    'rejects unsafe query %s', async (query) => expect((await read(`${base}?${query}`)).status).toBe(400))
  it.each(['%', '_', 'Private clinical narrative'])('does not broaden reference search or search notes: %s', async (search) => {
    const value = await seed()
    expect((await read(`${base}?patientId=${value.patientId}&search=${encodeURIComponent(search)}`)).body.data.items).toEqual([])
  })
  it('handles invalid/missing resources and prevents history scope injection', async () => {
    expect((await read(`${base}/not-uuid`)).status).toBe(400)
    expect((await read(`${base}/${randomUUID()}`)).body.error.code).toBe('ENCOUNTER_NOT_FOUND')
    expect((await read(`/api/v1/patients/${randomUUID()}/encounters`)).body.error.code).toBe('PATIENT_NOT_FOUND')
    const p = await patient()
    expect((await read(`/api/v1/patients/${p.id}/encounters?patientId=${randomUUID()}`)).status).toBe(400)
    expect((await read(`/api/v1/patients/${p.id}/encounters`)).body.data.pagination.totalPages).toBe(0)
  })
  it('detail is audited without exposing secrets or unrelated demographics', async () => {
    const value = await reviewed(), response = await read(`${base}/${value.id}`)
    expect(response.status).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    dto(response.body.data.encounter, true)
    expect(response.body.data.encounter.complaints).toHaveLength(1)
    expect(response.body.data.encounter.diagnoses).toHaveLength(1)
    await audited(response, 'MEDICAL_RECORD_VIEWED', value.id)
    expect(JSON.stringify(response.body)).not.toMatch(/passwordHash|csrfToken|@example.test|233241234567|auditEvents/)
    expect((await read(`/api/v1/patients/${value.patientId}`, actor('ADMIN'))).body.data.patient).not.toHaveProperty('encounters')
  })
})
describe('clinical CSRF, rollback and logging', () => {
  it.each(['create', 'update', 'finalize', 'amend'] as const)('requires CSRF and Origin for %s', async (operation) => {
    const value = await seed(), who = actor(), path = operation === 'create' ? base : `${base}/${value.id}${operation === 'update' ? '' : `/${operation}`}`
    const method = operation === 'update' ? 'patch' : 'post'
    for (const token of [undefined, 'bad', actor('ADMIN').csrf]) {
      const call = request(app)[method](path).set('Cookie', who.cookie).set('Origin', env.CLIENT_ORIGIN)
      if (token) call.set('X-CSRF-Token', token)
      expect((await call.send({})).body.error.code).toBe('CSRF_INVALID')
    }
    expect((await request(app)[method](path).set('Cookie', who.cookie).set('X-CSRF-Token', who.csrf).send({})).body.error.code).toBe('ORIGIN_NOT_ALLOWED')
  })
  it.each(['create', 'update', 'finalize', 'amend', 'view', 'history'] as const)('rolls back and fails disclosure when %s audit fails', async (operation) => {
    const value = operation === 'amend' ? await reviewed() : await seed(), body = await input()
    const path = operation === 'create' ? base : operation === 'history' ? `/api/v1/patients/${value.patientId}/encounters`
      : `${base}/${value.id}${operation === 'finalize' || operation === 'amend' ? `/${operation}` : ''}`
    const beforeChildren = await db.encounterComplaint.findMany({ where: { encounterId: value.id } })
    const call = operation === 'view' || operation === 'history' ? read(path) : send(operation === 'update' ? 'patch' : 'post', path,
      operation === 'create' ? body : operation === 'update' ? { clinicalNotes: 'Failed change', complaints: [], diagnoses: [] }
        : operation === 'amend' ? { reason: 'Correction', content: 'Failed amendment' } : {})
    const response = await call.set('X-Request-Id', 'fail-clinical-audit')
    expect(response.status).toBe(500)
    expect(response.body).not.toHaveProperty('data')
    expect(response.body.error).toEqual({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', requestId: 'fail-clinical-audit' })
    expect(await db.encounter.findUniqueOrThrow({ where: { id: value.id } })).toEqual(value)
    expect(await db.encounterComplaint.findMany({ where: { encounterId: value.id } })).toEqual(beforeChildren)
    expect(await db.diagnosis.count({ where: { encounterId: value.id } })).toBe(1)
    expect(await db.encounterAmendment.count({ where: { encounterId: value.id } })).toBe(0)
    expect(await db.encounter.count({ where: { patientId: body.patientId } })).toBe(0)
    expect(await db.auditEvent.count({ where: { requestId: 'fail-clinical-audit' } })).toBe(0)
  })
  it('keeps clinical bodies, children, amendments and search out of logs and audits', async () => {
    const created = await send('post', base, await input()), id = created.body.data.encounter.id
    await send('post', `${base}/${id}/finalize`, {})
    await send('post', `${base}/${id}/amend`, { reason: 'Private correction reason', content: 'Private amendment content' })
    await read(`${base}/${id}`)
    await read(`${base}?search=PrivateSearch`)
    const events = await db.auditEvent.findMany({ where: { entityId: id } })
    expect(logs + JSON.stringify(events)).not.toMatch(/Private|Local-1/)
    const spy = vi.spyOn(db, '$transaction').mockRejectedValueOnce(new Error('private Prisma SQL'))
    try {
      const response = await read(base).set('X-Request-Id', 'clinical-safe-error')
      expect(response.status).toBe(500)
      expect(response.body.error.requestId).toBe('clinical-safe-error')
      expect(JSON.stringify(response.body) + logs).not.toContain('private Prisma SQL')
    } finally { spy.mockRestore() }
  })
  it.each(['archived', 'revoked', 'roleChanged'] as const)('rechecks %s after a queued clinical transaction', async (kind) => {
    const who = await newActor(), body = await input()
    let release!: () => void, ready!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve }), locked = new Promise<void>((resolve) => { ready = resolve })
    const blocker = db.$transaction(async (tx) => {
      if (kind === 'archived') await tx.$executeRaw`SELECT pg_advisory_xact_lock(1296385106, 2)`
      else await tx.$executeRaw`SELECT pg_advisory_xact_lock(1296385106, 1)`
      ready(); await gate
      if (kind === 'archived') await tx.patient.update({ where: { id: body.patientId }, data: { archivedAt: new Date() } })
      if (kind === 'revoked') await tx.staffSession.update({ where: { id: who.sessionId }, data: { revokedAt: new Date() } })
      if (kind === 'roleChanged') await tx.staffUser.update({ where: { id: who.id }, data: { role: 'ADMIN' } })
    })
    await locked
    const pending = send('post', base, body, who).then((response) => response)
    try {
      const deadline = Date.now() + 2000
      let waiting = false
      while (!waiting && Date.now() < deadline) {
        const rows = await db.$queryRaw<Array<{ waiting: boolean }>>`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event = 'advisory') AS waiting`
        waiting = rows[0]!.waiting
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 20))
      }
      expect(waiting).toBe(true)
    } finally { release() }
    await blocker
    expect((await pending).body.error.code).toBe({ archived: 'PATIENT_ARCHIVED', revoked: 'AUTHENTICATION_REQUIRED', roleChanged: 'FORBIDDEN' }[kind])
    expect(await db.encounter.count({ where: { patientId: body.patientId } })).toBe(0)
  })
})
