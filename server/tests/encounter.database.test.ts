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
import type { StaffRole, Prisma } from '../src/generated/prisma/client.js'
const db = testDatabase(), env = isolatedTestEnvironment(), base = '/api/v1/encounters'
type Actor = { id: string; cookie: string; csrf: string; sessionId: string }
const actors = new Map<StaffRole, Actor>()
let hash: string, logs = ''
let app: ReturnType<typeof createApp>
const actor = (role: StaffRole = 'DOCTOR_IN_CHARGE') => actors.get(role)!
// Orders name entries of the seeded catalog; the order keeps the catalog name as "medicine".
const catalog = new Map<string, string>()
const medicine = (name: string) => catalog.get(name)!
const nameOf = (id: string) => [...catalog].find(([, value]) => value === id)![0]
async function newActor(role: StaffRole = 'DOCTOR_IN_CHARGE'): Promise<Actor> {
  const user = await db.staffUser.create({ data: { firstName: 'Synthetic', lastName: 'Clinical', email: `${randomUUID()}@example.test`,
    role, status: 'ACTIVE', passwordHash: hash, passwordChangedAt: new Date() } })
  const session = await db.$transaction((tx) => createSession(tx, user.id))
  return { id: user.id, cookie: `medicare_session=${session.token}`, csrf: session.session.csrfToken, sessionId: session.session.id }
}
async function patient() {
  return db.patient.create({ data: { firstName: 'Synthetic', lastName: `Clinical-${randomUUID()}`, phone: '+233241234567', createdById: actor('ADMIN').id } })
}
// Every new clinical record belongs to a current admission; the patient comes from it.
const patientOf = new Map<string, string>()
async function admitted(room = 'Ward A - Bed 6') {
  const person = await patient(), admittedAt = new Date(Date.now() - 2 * 3600000)
  const admission = await db.admission.create({ data: { patientId: person.id, roomNumber: room, admittedAt, admittedById: actor('ADMIN').id,
    rooms: { create: { roomNumber: room, assignedAt: admittedAt, assignedById: actor('ADMIN').id } } } })
  patientOf.set(admission.id, person.id)
  return admission
}
async function discharge(admissionId: string, who = actor()) {
  const at = new Date()
  await db.$transaction([
    db.admissionRoomHistory.updateMany({ where: { admissionId, endedAt: null }, data: { endedAt: at } }),
    db.admission.update({ where: { id: admissionId }, data: { status: 'DISCHARGED', dischargedAt: at, dischargedById: who.id } }),
  ])
}
async function input() {
  return { admissionId: (await admitted()).id, occurredAt: new Date(Date.now() - 60000).toISOString(),
    clinicalNotes: 'Private clinical narrative', historySummary: 'Private history', treatmentPlan: 'Private plan',
    complaints: [{ description: 'Private complaint' }], diagnoses: [{ description: 'Private diagnosis', code: 'Local-1', notes: 'Private diagnostic notes' }],
    medications: [{ medicationId: medicine('Paracetamol'), strength: '500 mg', dose: '1 tablet', route: 'Oral', frequency: 'Twice daily', duration: '5 days',
      notes: 'Private medication notes' }] }
}
function send(method: 'post' | 'patch' | 'delete', path: string, body?: object, who = actor()) {
  const call = request(app)[method](path).set('Cookie', who.cookie).set('Origin', env.CLIENT_ORIGIN).set('X-CSRF-Token', who.csrf)
  return body ? call.send(body) : call
}
const read = (path: string, who = actor()) => request(app).get(path).set('Cookie', who.cookie)
// Seeds a record directly. By default it is a draft on a current admission; legacy = true makes a
// record from before admissions existed (no admission), as kept in upgraded databases.
async function seed(who = actor(), overrides: Partial<Prisma.EncounterUncheckedCreateInput> = {}, legacy = false) {
  const body = await input(), patientId = legacy ? (await patient()).id : patientOf.get(body.admissionId)!
  return db.encounter.create({ data: { patientId, admissionId: legacy ? null : body.admissionId, clinicianId: who.id, createdById: who.id,
    occurredAt: body.occurredAt, clinicalNotes: body.clinicalNotes, ...overrides,
    complaints: { create: body.complaints }, diagnoses: { create: body.diagnoses },
    medications: { create: body.medications.map((order) => ({ ...order, medicine: nameOf(order.medicationId) })) } } })
}
async function reviewed(who = actor(), legacy = false) {
  const value = await seed(who, {}, legacy)
  return db.encounter.update({ where: { id: value.id }, data: { status: 'REVIEWED', reviewedAt: new Date() } })
}
function dto(value: Record<string, unknown>, detail: boolean) {
  const keys = ['id', 'reference', 'status', 'occurredAt', 'reviewedAt', 'createdAt', 'patient', 'clinician', 'author', 'admission', 'appointment', 'diagnoses']
  if (detail) keys.push('roomLabel', 'historySummary', 'clinicalNotes', 'treatmentPlan', 'followUpAt', 'updatedAt', 'voidedAt', 'voidReason', 'complaints', 'medications', 'amendments')
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
  expect(JSON.stringify(events[0]!.metadata)).not.toMatch(/Private|Synthetic|Correction|mg|Oral/)
  return events[0]!
}
// Waits until another request in this database is blocked on a lock (advisory or row).
async function waitForLock() {
  const deadline = Date.now() + 2000
  let waiting = false
  while (!waiting && Date.now() < deadline) {
    const rows = await db.$queryRaw<Array<{ waiting: boolean }>>`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock') AS waiting`
    waiting = rows[0]!.waiting
    if (!waiting) await new Promise((resolve) => setTimeout(resolve, 20))
  }
  expect(waiting).toBe(true)
}
beforeAll(async () => {
  hash = await hashPassword('Synthetic clinical test passphrase')
  for (const role of ['ADMIN', 'RECORDS_OFFICER', 'DOCTOR_IN_CHARGE'] as const) actors.set(role, await newActor(role))
  for (const entry of await db.medication.findMany()) catalog.set(entry.name, entry.id)
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
    ['post', `${base}/${id}/finalize`], ['post', `${base}/${id}/amend`], ['get', `/api/v1/patients/${id}/encounters`], ['get', `/api/v1/patients/${id}/medications`]] as const
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
    expect((await read(`/api/v1/patients/${value.patientId}/medications`, who)).status).toBe(200)
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
describe('clinical creation on a current admission', () => {
  it('creates an authored draft on the admission with structured children, generated reference and atomic audit', async () => {
    const body = await input(), response = await send('post', base, body)
    expect(response.status).toBe(201)
    const value = response.body.data.encounter
    dto(value, true)
    const admission = await db.admission.findUniqueOrThrow({ where: { id: body.admissionId } })
    expect(value).toMatchObject({ status: 'DRAFT', reviewedAt: null, appointment: null, clinician: { id: actor().id }, author: { id: actor().id },
      admission: { id: admission.id, admissionNumber: admission.admissionNumber }, patient: { id: patientOf.get(body.admissionId) } })
    expect(value.reference).toMatch(/^MR-[0-9A-F-]{36}$/)
    expect(value.complaints[0].description).toBe(body.complaints[0]!.description)
    expect(value.diagnoses[0]).toMatchObject(body.diagnoses[0]!)
    expect(value.medications).toHaveLength(1)
    expect(value.medications[0]).toMatchObject({ ...body.medications[0]!, medicine: 'Paracetamol' })
    expect(Object.keys(value.medications[0]).sort()).toEqual(['id', 'medicationId', 'medicine', 'strength', 'dose', 'route', 'frequency', 'duration', 'notes', 'createdAt'].sort())
    const event = await audited(response, 'MEDICAL_RECORD_CREATED', value.id)
    expect(event.metadata).toEqual({ source: 'API', changedFields: ['medications'] })
    expect((await db.encounter.findUniqueOrThrow({ where: { id: value.id } })).createdById).toBe(actor().id)
  })
  it('records the admission room by default; a stated or cleared room is kept', async () => {
    const { admissionId } = await input(), room = (await db.admission.findUniqueOrThrow({ where: { id: admissionId } })).roomNumber
    const defaulted = await send('post', base, { admissionId, complaints: [], diagnoses: [], medications: [] })
    expect(defaulted.status).toBe(201)
    expect(defaulted.body.data.encounter).toMatchObject({ roomLabel: room, appointment: null, complaints: [], diagnoses: [], medications: [], clinicalNotes: null })
    expect((await audited(defaulted, 'MEDICAL_RECORD_CREATED', defaulted.body.data.encounter.id)).metadata).toEqual({ source: 'API' })
    expect((await send('post', base, { admissionId, roomLabel: 'Treatment room 2' })).body.data.encounter.roomLabel).toBe('Treatment room 2')
    expect((await send('post', base, { admissionId, roomLabel: null })).body.data.encounter.roomLabel).toBeNull()
  })
  it('uses server time when no encounter time is given', async () => {
    const before = Date.now(), response = await send('post', base, { admissionId: (await admitted()).id })
    expect(Date.parse(response.body.data.encounter.occurredAt)).toBeGreaterThanOrEqual(before)
  })
  it.each(['patientId', 'appointmentId', 'clinicianId', 'createdById', 'receivedById', 'reference', 'recordReference', 'author', 'status', 'reviewedAt', 'finalizedAt', 'createdAt', 'updatedAt', 'voidedAt', 'amendments', 'patient', 'admission'])(
    'rejects injected creation field %s', async (field) => expect((await send('post', base, { ...await input(), [field]: 'injected' })).status).toBe(400))
  it('requires an admission: a record without one is refused', async () => {
    const response = await send('post', base, { clinicalNotes: 'Private walk-in narrative' })
    expect(response.status).toBe(400)
    expect(await db.encounter.count({ where: { clinicalNotes: 'Private walk-in narrative' } })).toBe(0)
  })
  it.each(['missing', 'discharged'] as const)('rejects a %s admission without writing', async (kind) => {
    const body = await input()
    if (kind === 'missing') body.admissionId = randomUUID()
    else await discharge(body.admissionId)
    const response = await send('post', base, body)
    expect([response.status, response.body.error.code]).toEqual(kind === 'missing' ? [404, 'ADMISSION_NOT_FOUND'] : [409, 'ADMISSION_NOT_CURRENT'])
    expect(await db.encounter.count({ where: { admissionId: body.admissionId } })).toBe(0)
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
  it('allows several records on one admission and keeps concurrent references unique', async () => {
    const body = await input(), responses = await Promise.all(Array.from({ length: 5 }, () => send('post', base, body)))
    expect(responses.map((r) => r.status)).toEqual(Array(5).fill(201))
    expect(new Set(responses.map((r) => r.body.data.encounter.reference)).size).toBe(5)
    expect(await db.encounter.count({ where: { admissionId: body.admissionId } })).toBe(5)
  })
  it('an open draft blocks discharge; a record queued behind a discharge is refused', async () => {
    // Record first: the open draft blocks the discharge (API check and trigger).
    const first = await input(), created = await send('post', base, first)
    expect(created.status).toBe(201)
    const refused = await send('post', `/api/v1/admissions/${first.admissionId}/discharge`, {})
    expect([refused.status, refused.body.error.code]).toEqual([409, 'ADMISSION_HAS_DRAFT_RECORDS'])
    // Discharge first: a record queued on the admission row then finds it discharged.
    const second = await input()
    let release!: () => void, ready!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve }), locked = new Promise<void>((resolve) => { ready = resolve })
    const blocker = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Admission" WHERE id = ${second.admissionId}::uuid FOR UPDATE`
      ready(); await gate
      const at = new Date()
      await tx.admissionRoomHistory.updateMany({ where: { admissionId: second.admissionId, endedAt: null }, data: { endedAt: at } })
      await tx.admission.update({ where: { id: second.admissionId }, data: { status: 'DISCHARGED', dischargedAt: at, dischargedById: actor().id } })
    })
    await locked
    const pending = send('post', base, second).then((response) => response)
    try { await waitForLock() } finally { release() }
    await blocker
    expect((await pending).body.error.code).toBe('ADMISSION_NOT_CURRENT')
    expect(await db.encounter.count({ where: { admissionId: second.admissionId } })).toBe(0)
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
  it('replaces medication orders as a set while the record is a draft, auditing the medication change', async () => {
    const value = await seed()
    const orders = [{ medicationId: medicine('Ibuprofen'), strength: '400 mg', dose: '1 tablet', route: 'Oral', frequency: 'Once daily', duration: '7 days' },
      { medicationId: medicine('ORS'), dose: '1 sachet', route: 'Oral', frequency: 'After each loose stool' }]
    const response = await send('patch', `${base}/${value.id}`, { medications: orders })
    expect(response.status).toBe(200)
    expect(response.body.data.encounter.medications.map((item: { medicine: string }) => item.medicine)).toEqual(['Ibuprofen', 'ORS'])
    expect(response.body.data.encounter.medications[1]).toMatchObject({ medicationId: medicine('ORS'), strength: null, duration: null, notes: null })
    expect((await audited(response, 'MEDICAL_RECORD_UPDATED', value.id)).metadata).toEqual({ source: 'API', changedFields: ['clinicalRecord', 'medications'] })
    const notes = await send('patch', `${base}/${value.id}`, { clinicalNotes: 'Private revised notes' })
    expect(notes.body.data.encounter.medications).toHaveLength(2)
    expect((await audited(notes, 'MEDICAL_RECORD_UPDATED', value.id)).metadata).toEqual({ source: 'API', changedFields: ['clinicalRecord'] })
    expect((await send('patch', `${base}/${value.id}`, { medications: [] })).body.data.encounter.medications).toEqual([])
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
    const summary = (await read(`${base}?patientId=${patientOf.get(body.admissionId)}`)).body.data.items[0]
    expect(names(summary.diagnoses)).toEqual(names(reordered))
  })
  it.each(['patientId', 'clinicianId', 'createdById', 'receivedById', 'appointmentId', 'admissionId', 'reference', 'status', 'reviewedAt', 'createdAt', 'updatedAt', 'id', 'amendments'])(
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
  it('finalizes as REVIEWED with signing time and leaves the admission unchanged', async () => {
    const body = await input()
    const created = await send('post', base, body), id = created.body.data.encounter.id
    const before = Date.now(), response = await send('post', `${base}/${id}/finalize`, {})
    expect(response.status).toBe(200)
    expect(response.body.data.encounter.status).toBe('REVIEWED')
    expect(Date.parse(response.body.data.encounter.reviewedAt)).toBeGreaterThanOrEqual(before)
    expect(response.body.data.encounter.medications).toHaveLength(1)
    await audited(response, 'MEDICAL_RECORD_FINALIZED', id)
    expect((await db.admission.findUniqueOrThrow({ where: { id: body.admissionId } })).status).toBe('ADMITTED')
    expect((await send('post', `${base}/${id}/finalize`, {})).body.error.code).toBe('ENCOUNTER_FINALIZED')
  })
  it.each(['clinicalNotes', 'historySummary', 'treatmentPlan', 'complaints', 'diagnoses', 'medications'])('accepts %s as minimum clinical content', async (field) => {
    const content = field === 'medications' ? [{ medicationId: medicine('Paracetamol'), dose: '1 tablet', route: 'Oral', frequency: 'Stat' }]
      : field === 'complaints' || field === 'diagnoses' ? [{ description: 'Clinical content' }] : 'Clinical content'
    const created = await send('post', base, { admissionId: (await admitted()).id, [field]: content })
    expect((await send('post', `${base}/${created.body.data.encounter.id}/finalize`, {})).status).toBe(200)
  })
  it('rejects empty or not-yet-occurred finalization', async () => {
    const empty = await send('post', base, { admissionId: (await admitted()).id, roomLabel: 'Room 1' })
    expect((await send('post', `${base}/${empty.body.data.encounter.id}/finalize`, {})).body.error.code).toBe('EMPTY_CLINICAL_RECORD')
    const future = await seed(actor(), { occurredAt: new Date(Date.now() + 30000) })
    expect((await send('post', `${base}/${future.id}/finalize`, {})).body.error.code).toBe('INVALID_ENCOUNTER_TIME')
  })
  it.each([{ clinicalNotes: 'rewrite' }, { complaints: [] }, { diagnoses: [] }, { medications: [] }])('rejects finalized content replacement %j', async (body) => {
    const value = await reviewed()
    expect((await send('patch', `${base}/${value.id}`, body)).body.error.code).toBe('ENCOUNTER_FINALIZED')
  })
  it('keeps archived history readable but blocks draft activity without reactivation', async () => {
    // A record from before admissions existed: its patient can be archived while it is a draft.
    const value = await seed(actor(), {}, true)
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
    const value = await reviewed(actor(), true)
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
  it.each(['parentUpdate', 'parentDelete', 'complaintInsert', 'complaintUpdate', 'complaintDelete', 'diagnosisInsert', 'diagnosisUpdate', 'diagnosisDelete',
    'medicationInsert', 'medicationUpdate', 'medicationDelete'] as const)(
    'database blocks finalized %s', async (operation) => {
      const value = await reviewed()
      const complaint = await db.encounterComplaint.findFirstOrThrow({ where: { encounterId: value.id } })
      const diagnosis = await db.diagnosis.findFirstOrThrow({ where: { encounterId: value.id } })
      const medication = await db.medicationOrder.findFirstOrThrow({ where: { encounterId: value.id } })
      const operations = {
        parentUpdate: () => db.encounter.update({ where: { id: value.id }, data: { clinicalNotes: 'rewrite' } }),
        parentDelete: () => db.encounter.delete({ where: { id: value.id } }),
        complaintInsert: () => db.encounterComplaint.create({ data: { encounterId: value.id, description: 'rewrite' } }),
        complaintUpdate: () => db.encounterComplaint.update({ where: { id: complaint.id }, data: { description: 'rewrite' } }),
        complaintDelete: () => db.encounterComplaint.delete({ where: { id: complaint.id } }),
        diagnosisInsert: () => db.diagnosis.create({ data: { encounterId: value.id, description: 'rewrite' } }),
        diagnosisUpdate: () => db.diagnosis.update({ where: { id: diagnosis.id }, data: { notes: 'rewrite' } }),
        diagnosisDelete: () => db.diagnosis.delete({ where: { id: diagnosis.id } }),
        medicationInsert: () => db.medicationOrder.create({ data: { encounterId: value.id, medicationId: medicine('Paracetamol'), medicine: 'Paracetamol' } }),
        medicationUpdate: () => db.medicationOrder.update({ where: { id: medication.id }, data: { dose: 'rewrite' } }),
        medicationDelete: () => db.medicationOrder.delete({ where: { id: medication.id } }),
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
  it.each(['Encounter', 'EncounterComplaint', 'Diagnosis', 'MedicationOrder', 'EncounterAmendment'])('blocks TRUNCATE of %s in the guarded disposable database', async (table) => {
    await expect(db.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE`)).rejects.toThrow()
    expect(await db.encounter.count()).toBeGreaterThan(0)
  })
  it('database keeps a record on its own patient\'s admission and never moves it', async () => {
    const value = await seed(), other = await admitted()
    await expect(db.encounter.create({ data: { patientId: (await patient()).id, admissionId: value.admissionId, createdById: actor().id } })).rejects.toMatchObject({ code: 'P2003' })
    await expect(db.encounter.update({ where: { id: value.id }, data: { admissionId: other.id, patientId: patientOf.get(other.id) } })).rejects.toThrow()
    await expect(db.encounter.update({ where: { id: value.id }, data: { admissionId: null } })).rejects.toThrow()
    expect((await db.encounter.findUniqueOrThrow({ where: { id: value.id } })).admissionId).toBe(value.admissionId)
  })
  it('database refuses a new record on a discharged admission even without the API', async () => {
    const admission = await admitted()
    await discharge(admission.id)
    await expect(db.encounter.create({ data: { patientId: patientOf.get(admission.id)!, admissionId: admission.id, createdById: actor().id } })).rejects.toThrow()
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
    for (const id of ids) await seed(actor(), { id, patientId: p.id, occurredAt, createdAt }, true)
    const response = await read(`/api/v1/patients/${p.id}/encounters?page=2&limit=2`)
    expect(response.status).toBe(200)
    expect(response.body.data.pagination).toEqual({ page: 2, limit: 2, total: 3, totalPages: 2 })
    expect(response.body.data.items.map((v: { id: string }) => v.id)).toEqual([ids[2]])
    dto(response.body.data.items[0], false)
    expect(response.body.data.items[0].diagnoses[0]).not.toHaveProperty('notes')
    await audited(response, 'MEDICAL_HISTORY_VIEWED', p.id)
    expect((await read(`/api/v1/patients/${p.id}/encounters?page=9`)).body.data.items).toEqual([])
  })
  it.each(['patientId', 'clinicianId', 'admissionId', 'status', 'dateRange', 'reference'] as const)('supports %s filter', async (filter) => {
    const who = await newActor(), value = await seed(who)
    const query = new URLSearchParams({ patientId: value.patientId })
    if (filter === 'clinicianId') query.set('clinicianId', who.id)
    if (filter === 'admissionId') query.set('admissionId', value.admissionId!)
    if (filter === 'status') query.set('status', 'DRAFT')
    if (filter === 'dateRange') { query.set('dateFrom', value.occurredAt.toISOString()); query.set('dateTo', value.occurredAt.toISOString()) }
    if (filter === 'reference') query.set('search', value.reference.toLowerCase())
    const response = await read(`${base}?${query}`)
    expect(response.body.data.items.map((v: { id: string }) => v.id)).toEqual([value.id])
    expect(await db.auditEvent.count({ where: { requestId: response.headers['x-request-id'] } })).toBe(0)
  })
  it('lists one admission\'s records only', async () => {
    const value = await seed(), sibling = await seed()
    const response = await read(`${base}?admissionId=${value.admissionId}`)
    expect(response.body.data.items.map((v: { id: string }) => v.id)).toEqual([value.id])
    expect(response.body.data.items[0].admission.id).toBe(value.admissionId)
    expect(sibling.admissionId).not.toBe(value.admissionId)
  })
  it.each(['limit=101', 'page=0', 'status=FINALIZED', 'patientId=x', 'clinicianId=x', 'admissionId=x', `appointmentId=${randomUUID()}`, 'dateFrom=2020-01-01',
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
    expect(response.body.data.encounter.medications).toHaveLength(1)
    await audited(response, 'MEDICAL_RECORD_VIEWED', value.id)
    expect(JSON.stringify(response.body)).not.toMatch(/passwordHash|csrfToken|@example.test|233241234567|auditEvents/)
    expect((await read(`/api/v1/patients/${value.patientId}`, actor('ADMIN'))).body.data.patient).not.toHaveProperty('encounters')
  })
})
describe('medication history', () => {
  it('lists every order for the patient across records and admissions, newest record first, with one audit', async () => {
    const first = await seed(actor(), { occurredAt: new Date('2025-01-01T08:00:00Z') })
    const p = first.patientId, older = await db.admission.findUniqueOrThrow({ where: { id: first.admissionId! } })
    await db.encounter.update({ where: { id: first.id }, data: { status: 'REVIEWED', reviewedAt: new Date() } })
    await discharge(older.id)
    const at = new Date()
    const readmitted = await db.admission.create({ data: { patientId: p, roomNumber: 'Private Room 3', admittedAt: at, admittedById: actor('ADMIN').id,
      rooms: { create: { roomNumber: 'Private Room 3', assignedAt: at, assignedById: actor('ADMIN').id } } } })
    const created = await send('post', base, { admissionId: readmitted.id, medications: [
      { medicationId: medicine('Multivitamin'), dose: '10 ml', route: 'Oral', frequency: 'Once daily' },
      { medicationId: medicine('Folic acid'), strength: '5 mg', dose: '1 tablet', route: 'Oral', frequency: 'Once daily' }] })
    expect(created.status).toBe(201)
    const response = await read(`/api/v1/patients/${p}/medications`).set('X-Request-Id', 'medication-history')
    expect(response.status).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    const items = response.body.data.items as Array<{ medicine: string; encounter: { id: string; status: string; admission: { admissionNumber: string } } }>
    expect(items.map((item) => item.medicine)).toEqual(['Multivitamin', 'Folic acid', 'Paracetamol'])
    expect(items.map((item) => item.encounter.admission.admissionNumber)).toEqual([readmitted.admissionNumber, readmitted.admissionNumber, older.admissionNumber])
    expect(items.map((item) => item.encounter.status)).toEqual(['DRAFT', 'DRAFT', 'REVIEWED'])
    expect(Object.keys(items[0]!).sort()).toEqual(['id', 'medicationId', 'medicine', 'strength', 'dose', 'route', 'frequency', 'duration', 'notes', 'createdAt', 'encounter'].sort())
    expect(Object.keys(items[0]!.encounter).sort()).toEqual(['id', 'reference', 'status', 'occurredAt', 'reviewedAt', 'clinician', 'admission'].sort())
    expect(Object.keys(items[0]!.encounter.admission).sort()).toEqual(['id', 'admissionNumber', 'status', 'admittedAt', 'dischargedAt'].sort())
    expect(response.body.data.pagination).toEqual({ page: 1, limit: 20, total: 3, totalPages: 1 })
    const events = await db.auditEvent.findMany({ where: { requestId: 'medication-history' } })
    expect(events.map((event) => [event.action, event.entityType, event.entityId, event.metadata])).toEqual([['MEDICAL_HISTORY_VIEWED', 'PATIENT', p, { source: 'API', changedFields: ['medications'] }]])
    expect((await read(`/api/v1/patients/${p}/medications?page=2&limit=2`)).body.data.items.map((item: { medicine: string }) => item.medicine)).toEqual(['Paracetamol'])
    expect(JSON.stringify(response.body)).not.toMatch(/233241234567|passwordHash|@example.test/)
  })
  it('refuses unknown patients and widening queries', async () => {
    expect((await read(`/api/v1/patients/${randomUUID()}/medications`)).body.error.code).toBe('PATIENT_NOT_FOUND')
    const p = (await seed()).patientId
    for (const query of ['limit=101', 'page=0', `patientId=${randomUUID()}`, 'medicine=Private']) {
      expect((await read(`/api/v1/patients/${p}/medications?${query}`)).status).toBe(400)
    }
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
      operation === 'create' ? body : operation === 'update' ? { clinicalNotes: 'Failed change', complaints: [], diagnoses: [], medications: [] }
        : operation === 'amend' ? { reason: 'Correction', content: 'Failed amendment' } : {})
    const response = await call.set('X-Request-Id', 'fail-clinical-audit')
    expect(response.status).toBe(500)
    expect(response.body).not.toHaveProperty('data')
    expect(response.body.error).toEqual({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', requestId: 'fail-clinical-audit' })
    expect(await db.encounter.findUniqueOrThrow({ where: { id: value.id } })).toEqual(value)
    expect(await db.encounterComplaint.findMany({ where: { encounterId: value.id } })).toEqual(beforeChildren)
    expect(await db.diagnosis.count({ where: { encounterId: value.id } })).toBe(1)
    expect(await db.medicationOrder.count({ where: { encounterId: value.id } })).toBe(1)
    expect(await db.encounterAmendment.count({ where: { encounterId: value.id } })).toBe(0)
    expect(await db.encounter.count({ where: { admissionId: body.admissionId } })).toBe(0)
    expect(await db.auditEvent.count({ where: { requestId: 'fail-clinical-audit' } })).toBe(0)
  })
  it('keeps clinical bodies, children, amendments and search out of logs and audits', async () => {
    const created = await send('post', base, await input()), id = created.body.data.encounter.id
    await send('post', `${base}/${id}/finalize`, {})
    await send('post', `${base}/${id}/amend`, { reason: 'Private correction reason', content: 'Private amendment content' })
    await read(`${base}/${id}`)
    await read(`${base}?search=PrivateSearch`)
    const events = await db.auditEvent.findMany({ where: { entityId: id } })
    expect(logs + JSON.stringify(events)).not.toMatch(/Private|Local-1|500 mg|Twice daily/)
    const spy = vi.spyOn(db, '$transaction').mockRejectedValueOnce(new Error('private Prisma SQL'))
    try {
      const response = await read(base).set('X-Request-Id', 'clinical-safe-error')
      expect(response.status).toBe(500)
      expect(response.body.error.requestId).toBe('clinical-safe-error')
      expect(JSON.stringify(response.body) + logs).not.toContain('private Prisma SQL')
    } finally { spy.mockRestore() }
  })
  it.each(['revoked', 'roleChanged'] as const)('rechecks %s after a queued clinical transaction', async (kind) => {
    const who = await newActor(), body = await input()
    let release!: () => void, ready!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve }), locked = new Promise<void>((resolve) => { ready = resolve })
    const blocker = db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(1296385106, 1)`
      ready(); await gate
      if (kind === 'revoked') await tx.staffSession.update({ where: { id: who.sessionId }, data: { revokedAt: new Date() } })
      if (kind === 'roleChanged') await tx.staffUser.update({ where: { id: who.id }, data: { role: 'ADMIN' } })
    })
    await locked
    const pending = send('post', base, body, who).then((response) => response)
    try { await waitForLock() } finally { release() }
    await blocker
    expect((await pending).body.error.code).toBe({ revoked: 'AUTHENTICATION_REQUIRED', roleChanged: 'FORBIDDEN' }[kind])
    expect(await db.encounter.count({ where: { admissionId: body.admissionId } })).toBe(0)
  })
})
