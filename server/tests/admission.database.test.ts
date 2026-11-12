import { randomUUID } from 'node:crypto'
import { Writable } from 'node:stream'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { disconnectDatabase } from '../src/database/prisma.js'
import { createLogger } from '../src/shared/logger/logger.js'
import { hashPassword } from '../src/shared/security/password.js'
import { createSession } from '../src/modules/auth/session.service.js'
import { isolatedTestEnvironment, testDatabase } from './helpers/database.js'
import type { StaffRole } from '../src/generated/prisma/client.js'

// Phase 19A admissions: admit (with room), change room, discharge, re-admit, and the database
// rules that keep stays, rooms and clinical history consistent even when the API is bypassed.
const db = testDatabase(), env = isolatedTestEnvironment(), base = '/api/v1/admissions'
// A medicine from the seeded catalog, as Medical Officers prescribe it.
const catalogId = async (name: string) => (await db.medication.findFirstOrThrow({ where: { name } })).id
type Actor = { id: string; cookie: string; csrf: string; sessionId: string }
const actors = new Map<StaffRole, Actor>()
const actor = (role: StaffRole = 'DOCTOR_IN_CHARGE') => actors.get(role)!
let hash: string, logs = '', app: ReturnType<typeof createApp>
async function newActor(role: StaffRole = 'DOCTOR_IN_CHARGE'): Promise<Actor> {
  const user = await db.staffUser.create({ data: { firstName: 'Synthetic', lastName: 'Admissions', email: `${randomUUID()}@example.test`,
    role, status: 'ACTIVE', passwordHash: hash, passwordChangedAt: new Date() } })
  const session = await db.$transaction((tx) => createSession(tx, user.id))
  return { id: user.id, cookie: `medicare_session=${session.token}`, csrf: session.session.csrfToken, sessionId: session.session.id }
}
function send(method: 'post' | 'patch' | 'delete', path: string, body: object = {}, who = actor(), key?: string) {
  const call = request(app)[method](path).set('Cookie', who.cookie).set('Origin', env.CLIENT_ORIGIN).set('X-CSRF-Token', who.csrf)
  if (key) call.set('Idempotency-Key', key)
  return call.send(body)
}
const read = (path: string, who = actor()) => request(app).get(path).set('Cookie', who.cookie)
async function patient(lastName = `Stay-${randomUUID()}`) {
  return db.patient.create({ data: { firstName: 'Synthetic', lastName, createdById: actor('RECORDS_OFFICER').id } })
}
const admit = async (patientId: string, roomNumber = 'Ward A - Bed 6', who = actor(), extra: object = {}) => send('post', base, { patientId, roomNumber, ...extra }, who)
async function admitted(roomNumber = 'Ward A - Bed 6', admittedAt = new Date(Date.now() - 3 * 3600000)) {
  const person = await patient(), response = await admit(person.id, roomNumber, actor(), { admittedAt: admittedAt.toISOString() })
  expect(response.status).toBe(201)
  return { patient: person, admission: response.body.data.admission as { id: string; admissionNumber: string; admittedAt: string } }
}
async function draft(admissionId: string, who = actor()) {
  const response = await send('post', '/api/v1/encounters', { admissionId, clinicalNotes: 'Private ward round notes' }, who)
  expect(response.status).toBe(201)
  return response.body.data.encounter as { id: string }
}
async function audited(response: request.Response, action: string, entityId: string, who = actor()) {
  const events = await db.auditEvent.findMany({ where: { requestId: response.headers['x-request-id'] } })
  expect(events.map((event) => [event.action, event.entityType, event.entityId, event.actorId, event.metadata]))
    .toEqual([[action, 'ADMISSION', entityId, who.id, { source: 'API' }]])
}
const summaryKeys = ['id', 'admissionNumber', 'status', 'roomNumber', 'admittedAt', 'dischargedAt', 'patient', 'admittedBy', 'dischargedBy']
const detailKeys = [...summaryKeys, 'createdAt', 'updatedAt', 'rooms']
// Direct database writes used by the integrity tests.
async function seedStay(patientId: string, admittedAt: Date, room = 'Room 1') {
  return db.admission.create({ data: { patientId, roomNumber: room, admittedAt, admittedById: actor().id,
    rooms: { create: { roomNumber: room, assignedAt: admittedAt, assignedById: actor().id } } } })
}
async function closeStay(admissionId: string, at: Date, notes: string | null = null) {
  await db.$transaction([
    db.admissionRoomHistory.updateMany({ where: { admissionId, endedAt: null }, data: { endedAt: at } }),
    db.admission.update({ where: { id: admissionId }, data: { status: 'DISCHARGED', dischargedAt: at, dischargedById: actor().id, dischargeNotes: notes } }),
  ])
}

beforeAll(async () => {
  hash = await hashPassword('Synthetic admissions test passphrase')
  for (const role of ['ADMIN', 'RECORDS_OFFICER', 'DOCTOR_IN_CHARGE'] as const) actors.set(role, await newActor(role))
  await db.$executeRawUnsafe(`CREATE FUNCTION test_reject_admission_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW."requestId" = 'fail-admission-audit' THEN RAISE EXCEPTION 'private admission SQL'; END IF; RETURN NEW; END $$`)
  await db.$executeRawUnsafe('CREATE TRIGGER test_admission_audit_failure BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION test_reject_admission_audit()')
})
beforeEach(() => {
  logs = ''
  app = createApp({ env, prisma: db, checkDatabase: async () => {}, logger: createLogger('info', new Writable({
    write(chunk: Buffer, _encoding, callback) { logs += chunk.toString(); callback() },
  })) })
})
afterAll(disconnectDatabase)

describe('admission authorization', () => {
  const id = randomUUID()
  const routes = [['get', base], ['get', `${base}/${id}`], ['post', base], ['post', `${base}/${id}/room`], ['post', `${base}/${id}/discharge`]] as const
  it.each(routes)('rejects anonymous %s %s', async (method, path) => expect((await request(app)[method](path)).status).toBe(401))
  it.each(['ADMIN', 'RECORDS_OFFICER', 'DOCTOR_IN_CHARGE'] as const)('lets %s admit, list, view and change rooms', async (role) => {
    const person = await patient(), who = actor(role)
    const created = await admit(person.id, 'Room 4', who)
    expect(created.status).toBe(201)
    await audited(created, 'PATIENT_ADMITTED', created.body.data.admission.id, who)
    expect((await read(`${base}?patientId=${person.id}`, who)).body.data.items).toHaveLength(1)
    expect((await read(`${base}/${created.body.data.admission.id}`, who)).status).toBe(200)
    expect((await send('post', `${base}/${created.body.data.admission.id}/room`, { roomNumber: 'Room 5' }, who)).status).toBe(200)
  })
  it.each(['ADMIN', 'RECORDS_OFFICER'] as const)('denies %s discharge, even with forged claims, and changes nothing', async (role) => {
    const { admission } = await admitted()
    const response = await send('post', `${base}/${admission.id}/discharge?role=DOCTOR_IN_CHARGE`, { role: 'DOCTOR_IN_CHARGE' }, actor(role)).set('X-Role', 'DOCTOR_IN_CHARGE')
    expect([response.status, response.body.error.code]).toEqual([403, 'FORBIDDEN'])
    expect((await db.admission.findUniqueOrThrow({ where: { id: admission.id } })).status).toBe('ADMITTED')
  })
  it.each(['admit', 'room', 'discharge'] as const)('requires CSRF and a trusted Origin to %s', async (operation) => {
    const { admission } = await admitted(), person = await patient()
    const path = operation === 'admit' ? base : `${base}/${admission.id}/${operation}`
    const body = operation === 'admit' ? { patientId: person.id, roomNumber: 'Room 9' } : operation === 'room' ? { roomNumber: 'Room 9' } : {}
    for (const token of [undefined, 'bad', actor('ADMIN').csrf]) {
      const call = request(app).post(path).set('Cookie', actor().cookie).set('Origin', env.CLIENT_ORIGIN)
      if (token) call.set('X-CSRF-Token', token)
      expect((await call.send(body)).body.error.code).toBe('CSRF_INVALID')
    }
    expect((await request(app).post(path).set('Cookie', actor().cookie).set('X-CSRF-Token', actor().csrf).send(body)).body.error.code).toBe('ORIGIN_NOT_ALLOWED')
    expect(await db.admission.count({ where: { patientId: person.id } })).toBe(0)
    expect((await db.admission.findUniqueOrThrow({ where: { id: admission.id } })).status).toBe('ADMITTED')
  })
  it.each(['SUSPENDED', 'DISABLED', 'revoked'] as const)('rejects a %s session', async (state) => {
    const who = await newActor('RECORDS_OFFICER'), person = await patient()
    if (state === 'revoked') await db.staffSession.update({ where: { id: who.sessionId }, data: { revokedAt: new Date() } })
    else await db.staffUser.update({ where: { id: who.id }, data: { status: state } })
    expect((await read(base, who)).status).toBe(401)
    expect((await admit(person.id, 'Room 1', who)).status).toBe(401)
    expect(await db.admission.count({ where: { patientId: person.id } })).toBe(0)
  })
  it('rechecks the role after waiting on the authorization lock', async () => {
    const who = await newActor('DOCTOR_IN_CHARGE'), { admission } = await admitted()
    let release!: () => void, ready!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve }), locked = new Promise<void>((resolve) => { ready = resolve })
    const blocker = db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(1296385106, 1)`
      ready(); await gate
      await tx.staffUser.update({ where: { id: who.id }, data: { role: 'RECORDS_OFFICER' } })
    })
    await locked
    const pending = send('post', `${base}/${admission.id}/discharge`, {}, who).then((response) => response)
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
    expect((await pending).body.error.code).toBe('FORBIDDEN')
    expect((await db.admission.findUniqueOrThrow({ where: { id: admission.id } })).status).toBe('ADMITTED')
  })
})

describe('admitting a patient', () => {
  it('admits with the room, a sequential number, the first room assignment and an audit, defaulting the time to now', async () => {
    const person = await patient(), before = Date.now()
    const response = await admit(person.id, '  Ward A - Bed 6  ', actor('RECORDS_OFFICER'))
    expect(response.status).toBe(201)
    expect(response.headers['cache-control']).toBe('no-store')
    const value = response.body.data.admission
    expect(Object.keys(value).sort()).toEqual(detailKeys.sort())
    expect(value).toMatchObject({ status: 'ADMITTED', roomNumber: 'Ward A - Bed 6', dischargedAt: null, dischargedBy: null,
      patient: { id: person.id, patientNumber: person.patientNumber }, admittedBy: { id: actor('RECORDS_OFFICER').id } })
    expect(value.admissionNumber).toMatch(/^AD-\d{6,}$/)
    expect(Date.parse(value.admittedAt)).toBeGreaterThanOrEqual(before)
    expect(value.rooms).toEqual([{ id: expect.any(String), roomNumber: 'Ward A - Bed 6', note: null, assignedAt: value.admittedAt, endedAt: null,
      assignedBy: expect.objectContaining({ id: actor('RECORDS_OFFICER').id }) }])
    expect(value).not.toHaveProperty('dischargeNotes')
    await audited(response, 'PATIENT_ADMITTED', value.id, actor('RECORDS_OFFICER'))
    const next = (await admit((await patient()).id)).body.data.admission
    expect(Number(next.admissionNumber.slice(3))).toBeGreaterThan(Number(value.admissionNumber.slice(3)))
  })
  it('records a stated earlier admission time, but refuses a future one', async () => {
    const person = await patient(), earlier = '2026-11-01T08:30:00+01:00'
    expect((await admit(person.id, 'Room 2', actor(), { admittedAt: new Date(Date.now() + 3600000).toISOString() })).body.error.code).toBe('INVALID_ADMISSION_TIME')
    const response = await admit(person.id, 'Room 2', actor(), { admittedAt: earlier })
    expect(response.body.data.admission.admittedAt).toBe('2026-11-01T07:30:00.000Z')
  })
  it('refuses a second admission while admitted, with the exact message, and returns nothing new', async () => {
    const { patient: person, admission } = await admitted()
    const response = await admit(person.id, 'Room 3')
    expect(response.status).toBe(409)
    expect(response.body.error).toMatchObject({ code: 'PATIENT_ALREADY_ADMITTED', message: 'This patient is already admitted.' })
    expect(await db.admission.count({ where: { patientId: person.id } })).toBe(1)
    // The current admission is found from the patient record to open it instead.
    expect((await read(`/api/v1/patients/${person.id}`)).body.data.patient.currentAdmission.id).toBe(admission.id)
  })
  it('admits exactly once under concurrent attempts for one patient', async () => {
    const person = await patient()
    const responses = await Promise.all(Array.from({ length: 6 }, (_, index) => admit(person.id, `Room ${index}`)))
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409, 409, 409, 409, 409])
    expect(await db.admission.count({ where: { patientId: person.id } })).toBe(1)
    expect(await db.admissionRoomHistory.count({ where: { admission: { patientId: person.id } } })).toBe(1)
  })
  it.each(['missing', 'archived'] as const)('refuses a %s patient', async (kind) => {
    const person = await patient()
    if (kind === 'archived') await db.patient.update({ where: { id: person.id }, data: { archivedAt: new Date() } })
    const response = await admit(kind === 'missing' ? randomUUID() : person.id)
    expect([response.status, response.body.error.code]).toEqual(kind === 'missing' ? [404, 'PATIENT_NOT_FOUND'] : [409, 'PATIENT_ARCHIVED'])
  })
  it.each([{ roomNumber: '' }, { roomNumber: '   ' }, { roomNumber: 'x'.repeat(101) }, { roomNumber: 'Room\u0000 1' }, { roomNumber: 'Room\n1' }, {},
    { roomNumber: 'Room 1', admittedAt: '2026-11-01T08:00:00' }, { roomNumber: 'Room 1', admittedAt: 'yesterday' }])('rejects invalid input %j', async (body) => {
    const person = await patient()
    expect((await send('post', base, { patientId: person.id, ...body })).status).toBe(400)
    expect(await db.admission.count({ where: { patientId: person.id } })).toBe(0)
  })
  it.each(['id', 'admissionNumber', 'status', 'admittedById', 'dischargedAt', 'dischargedById', 'dischargeNotes', 'rooms', 'createdAt'])('rejects injected field %s', async (field) => {
    const person = await patient()
    expect((await send('post', base, { patientId: person.id, roomNumber: 'Room 1', [field]: 'injected' })).status).toBe(400)
  })
})

describe('changing room', () => {
  it('records the transfer, closes the previous room and keeps the full room history', async () => {
    const { admission } = await admitted('Room 2')
    const first = await send('post', `${base}/${admission.id}/room`, { roomNumber: 'Room 5', note: '  Isolation bed available  ' }, actor('RECORDS_OFFICER'))
    expect(first.status).toBe(200)
    await audited(first, 'ADMISSION_ROOM_CHANGED', admission.id, actor('RECORDS_OFFICER'))
    const second = await send('post', `${base}/${admission.id}/room`, { roomNumber: 'Private Room 1' }, actor('ADMIN'))
    const value = second.body.data.admission
    expect(value.roomNumber).toBe('Private Room 1')
    expect(value.rooms.map((room: { roomNumber: string }) => room.roomNumber)).toEqual(['Room 2', 'Room 5', 'Private Room 1'])
    expect(value.rooms.map((room: { note: string | null }) => room.note)).toEqual([null, 'Isolation bed available', null])
    expect(value.rooms[0].endedAt).toBe(value.rooms[1].assignedAt)
    expect(value.rooms[1].endedAt).toBe(value.rooms[2].assignedAt)
    expect(value.rooms[2].endedAt).toBeNull()
    expect(value.rooms.map((room: { assignedBy: { id: string } }) => room.assignedBy.id)).toEqual([actor().id, actor('RECORDS_OFFICER').id, actor('ADMIN').id])
    expect((await read(`/api/v1/patients/${value.patient.id}`)).body.data.patient.currentAdmission.roomNumber).toBe('Private Room 1')
  })
  it('refuses the same room, an unknown admission and a discharged admission', async () => {
    const { admission } = await admitted('Room 7')
    expect((await send('post', `${base}/${admission.id}/room`, { roomNumber: 'Room 7' })).body.error.code).toBe('ROOM_UNCHANGED')
    expect((await send('post', `${base}/${randomUUID()}/room`, { roomNumber: 'Room 8' })).body.error.code).toBe('ADMISSION_NOT_FOUND')
    expect((await send('post', `${base}/${admission.id}/discharge`, {})).status).toBe(200)
    expect((await send('post', `${base}/${admission.id}/room`, { roomNumber: 'Room 8' })).body.error.code).toBe('ADMISSION_DISCHARGED')
    expect(await db.admissionRoomHistory.count({ where: { admissionId: admission.id } })).toBe(1)
  })
  it.each([{ roomNumber: '' }, { roomNumber: 'Room 2', note: 'x'.repeat(501) }, { roomNumber: 'Room 2', assignedAt: new Date().toISOString() }, { roomNumber: 'Room 2', status: 'DISCHARGED' }])(
    'rejects invalid transfer %j', async (body) => {
      const { admission } = await admitted()
      expect((await send('post', `${base}/${admission.id}/room`, body)).status).toBe(400)
    })
})

describe('discharge', () => {
  it('closes the stay atomically and keeps the patient, records, diagnoses and medications', async () => {
    const { patient: person, admission } = await admitted('Room 4')
    const created = await send('post', '/api/v1/encounters', { admissionId: admission.id, clinicalNotes: 'Private notes',
      diagnoses: [{ description: 'Private diagnosis' }], medications: [{ medicationId: await catalogId('Liver salt'), dose: '5 ml', route: 'Oral', frequency: 'Once daily' }] })
    expect((await send('post', `/api/v1/encounters/${created.body.data.encounter.id}/finalize`, {})).status).toBe(200)
    const before = Date.now()
    const response = await send('post', `${base}/${admission.id}/discharge`, { dischargeNotes: '  Private discharge summary\nFollow up in clinic.  ' })
    expect(response.status).toBe(200)
    const value = response.body.data.admission
    expect(value).toMatchObject({ status: 'DISCHARGED', dischargedBy: { id: actor().id }, dischargeNotes: 'Private discharge summary\nFollow up in clinic.' })
    expect(Date.parse(value.dischargedAt)).toBeGreaterThanOrEqual(before)
    expect(value.rooms.at(-1).endedAt).toBe(value.dischargedAt)
    await audited(response, 'PATIENT_DISCHARGED', admission.id)
    const stored = await db.patient.findUniqueOrThrow({ where: { id: person.id } })
    expect(stored.archivedAt).toBeNull()
    expect(await db.encounter.count({ where: { admissionId: admission.id } })).toBe(1)
    expect(await db.diagnosis.count({ where: { encounter: { admissionId: admission.id } } })).toBe(1)
    expect(await db.medicationOrder.count({ where: { encounter: { admissionId: admission.id } } })).toBe(1)
    expect((await read(`/api/v1/patients/${person.id}`)).body.data.patient.currentAdmission).toBeNull()
    expect((await read(`/api/v1/patients/${person.id}/encounters`)).body.data.items).toHaveLength(1)
    const current = (await read(`${base}?status=ADMITTED&patientId=${person.id}`)).body.data.items
    const past = (await read(`${base}?status=DISCHARGED&patientId=${person.id}`)).body.data.items
    expect([current.length, past.map((item: { id: string }) => item.id)]).toEqual([0, [admission.id]])
  })
  it('refuses while a clinical record is unfinished, with the exact message, and never discards the draft', async () => {
    const { admission } = await admitted(), record = await draft(admission.id)
    const response = await send('post', `${base}/${admission.id}/discharge`, { dischargeNotes: 'Private summary' })
    expect(response.status).toBe(409)
    expect(response.body.error).toMatchObject({ code: 'ADMISSION_HAS_DRAFT_RECORDS', message: 'This admission has an unfinished clinical record.' })
    expect((await db.encounter.findUniqueOrThrow({ where: { id: record.id } })).status).toBe('DRAFT')
    expect((await db.admission.findUniqueOrThrow({ where: { id: admission.id } })).status).toBe('ADMITTED')
    expect((await send('post', `/api/v1/encounters/${record.id}/finalize`, {})).status).toBe(200)
    expect((await send('post', `${base}/${admission.id}/discharge`, {})).status).toBe(200)
  })
  it('refuses an already discharged or unknown admission, and discharges once under concurrent attempts', async () => {
    const { admission } = await admitted()
    const responses = await Promise.all([1, 2, 3].map(() => send('post', `${base}/${admission.id}/discharge`, {})))
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409, 409])
    expect(responses.filter((response) => response.status === 409).every((response) => response.body.error.code === 'ADMISSION_ALREADY_DISCHARGED')).toBe(true)
    expect(await db.auditEvent.count({ where: { entityId: admission.id, action: 'PATIENT_DISCHARGED' } })).toBe(1)
    expect((await send('post', `${base}/${randomUUID()}/discharge`, {})).body.error.code).toBe('ADMISSION_NOT_FOUND')
  })
  it('accepts a stated discharge time but refuses one before admission, before the last room change or in the future', async () => {
    const admittedAt = new Date(Date.now() - 5 * 3600000), { admission } = await admitted('Room 1', admittedAt)
    for (const at of [new Date(admittedAt.getTime() - 60000), admittedAt, new Date(Date.now() + 3600000)]) {
      expect((await send('post', `${base}/${admission.id}/discharge`, { dischargedAt: at.toISOString() })).body.error.code).toBe('INVALID_DISCHARGE_TIME')
    }
    expect((await send('post', `${base}/${admission.id}/room`, { roomNumber: 'Room 2' })).status).toBe(200)
    expect((await send('post', `${base}/${admission.id}/discharge`, { dischargedAt: new Date(Date.now() - 3600000).toISOString() })).body.error.code).toBe('INVALID_DISCHARGE_TIME')
    const at = new Date().toISOString()
    expect((await send('post', `${base}/${admission.id}/discharge`, { dischargedAt: at })).body.data.admission.dischargedAt).toBe(at)
  })
  it.each([{ dischargeNotes: 'x'.repeat(5001) }, { dischargeNotes: 'Notes\u0000' }, { dischargedAt: 'today' }, { status: 'ADMITTED' }, { dischargedById: randomUUID() }])(
    'rejects invalid discharge input %j', async (body) => {
      const { admission } = await admitted()
      expect((await send('post', `${base}/${admission.id}/discharge`, body)).status).toBe(400)
      expect((await db.admission.findUniqueOrThrow({ where: { id: admission.id } })).status).toBe('ADMITTED')
    })
})

describe('re-admission and admission history', () => {
  it('re-admits the same patient as a new stay, audited as a re-admission, keeping earlier history', async () => {
    const { patient: person, admission: first } = await admitted('Room 2', new Date(Date.now() - 48 * 3600000))
    expect((await send('post', `${base}/${first.id}/discharge`, { dischargedAt: new Date(Date.now() - 24 * 3600000).toISOString() })).status).toBe(200)
    expect((await admit(person.id, 'Room 9', actor(), { admittedAt: new Date(Date.now() - 30 * 3600000).toISOString() })).body.error.code).toBe('ADMISSION_OVERLAPS_PREVIOUS')
    const again = await admit(person.id, 'Private Room 3')
    expect(again.status).toBe(201)
    await audited(again, 'PATIENT_READMITTED', again.body.data.admission.id)
    expect(again.body.data.admission.admissionNumber).not.toBe(first.admissionNumber)
    const history = (await read(`${base}?patientId=${person.id}`)).body.data.items
    expect(history.map((item: { id: string; status: string }) => [item.id, item.status])).toEqual([[again.body.data.admission.id, 'ADMITTED'], [first.id, 'DISCHARGED']])
  })
  it('lists current and past stays separately, searches by patient, number and room, and paginates', async () => {
    const tag = `Search${randomUUID().slice(0, 8)}`
    const one = await admit((await patient(tag)).id, `Ward ${tag}`), two = await admit((await patient(`${tag}B`)).id, 'Room 1')
    expect((await send('post', `${base}/${two.body.data.admission.id}/discharge`, {})).status).toBe(200)
    const currentIds = (await read(`${base}?status=ADMITTED&search=${tag}`)).body.data.items.map((item: { id: string }) => item.id)
    const pastIds = (await read(`${base}?status=DISCHARGED&search=${tag}`)).body.data.items.map((item: { id: string }) => item.id)
    expect([currentIds, pastIds]).toEqual([[one.body.data.admission.id], [two.body.data.admission.id]])
    expect((await read(`${base}?search=${one.body.data.admission.admissionNumber}`)).body.data.items.map((item: { id: string }) => item.id)).toEqual([one.body.data.admission.id])
    expect((await read(`${base}?search=ward%20${tag.toLowerCase()}`)).body.data.items).toHaveLength(1)
    // A full name, or a name with part of the room, finds the stay: every word must match somewhere.
    expect((await read(`${base}?status=ADMITTED&search=${encodeURIComponent(`synthetic ${tag}`)}`)).body.data.items.map((item: { id: string }) => item.id)).toEqual([one.body.data.admission.id])
    expect((await read(`${base}?search=${encodeURIComponent(`${tag} room`)}`)).body.data.items.map((item: { id: string }) => item.id)).toEqual([two.body.data.admission.id])
    const page = (await read(`${base}?search=${tag}&limit=1&page=2`)).body.data
    expect(page.pagination).toEqual({ page: 2, limit: 1, total: 2, totalPages: 2 })
    expect(Object.keys(page.items[0]).sort()).toEqual(summaryKeys.sort())
    for (const query of ['limit=101', 'page=0', 'status=ACTIVE', 'patientId=x', 'dischargeNotes=x', 'where[status]=ADMITTED']) {
      expect([query, (await read(`${base}?${query}`)).status]).toEqual([query, 400])
    }
    expect((await read(`${base}?search=%25`)).body.data.items).toEqual([])
  })
  it('shows the discharge note only to clinical readers, and audits every detail view', async () => {
    const { admission } = await admitted()
    await send('post', `${base}/${admission.id}/discharge`, { dischargeNotes: 'Private discharge summary' })
    for (const role of ['ADMIN', 'RECORDS_OFFICER', 'DOCTOR_IN_CHARGE'] as const) {
      const response = await read(`${base}/${admission.id}`, actor(role))
      expect(response.status).toBe(200)
      expect(Object.keys(response.body.data.admission).sort()).toEqual((role === 'DOCTOR_IN_CHARGE' ? [...detailKeys, 'dischargeNotes'] : detailKeys).sort())
      expect(JSON.stringify(response.body).includes('Private discharge summary')).toBe(role === 'DOCTOR_IN_CHARGE')
      await audited(response, 'ADMISSION_VIEWED', admission.id, actor(role))
    }
    expect((await read(`${base}/${randomUUID()}`)).body.error.code).toBe('ADMISSION_NOT_FOUND')
    expect((await read(`${base}/not-a-uuid`)).status).toBe(400)
    const list = (await read(`${base}?patientId=${(await db.admission.findUniqueOrThrow({ where: { id: admission.id } })).patientId}`)).body
    expect(JSON.stringify(list)).not.toContain('Private discharge summary')
  })
  it('does not expose delete or edit routes for stays or room history', async () => {
    const { admission } = await admitted()
    expect((await send('delete', `${base}/${admission.id}`)).status).toBe(404)
    expect((await send('patch', `${base}/${admission.id}`, { roomNumber: 'Room 2' })).status).toBe(404)
    expect((await send('post', `${base}/${admission.id}/reopen`)).status).toBe(404)
  })
})

describe('database integrity of stays', () => {
  it('allows one current stay per patient and never overlapping stays, even without the API', async () => {
    const person = await patient(), start = new Date('2026-06-01T08:00:00Z')
    const first = await seedStay(person.id, start)
    await expect(seedStay(person.id, new Date('2026-06-03T08:00:00Z'))).rejects.toThrow()
    await closeStay(first.id, new Date('2026-06-05T08:00:00Z'))
    await expect(seedStay(person.id, new Date('2026-06-04T08:00:00Z'))).rejects.toThrow()
    const second = await seedStay(person.id, new Date('2026-06-05T08:00:00Z'))
    expect(second.admissionNumber).toMatch(/^AD-\d{6,}$/)
  })
  it('keeps discharge facts consistent and a discharged stay permanent', async () => {
    const person = await patient(), stay = await seedStay(person.id, new Date('2026-07-01T08:00:00Z'))
    await expect(db.admission.update({ where: { id: stay.id }, data: { dischargeNotes: 'Private early note' } })).rejects.toThrow()
    await expect(closeStay(stay.id, new Date('2026-07-01T08:00:00Z'))).rejects.toThrow()
    await expect(db.$transaction([db.admissionRoomHistory.updateMany({ where: { admissionId: stay.id }, data: { endedAt: new Date('2026-07-02T08:00:00Z') } }),
      db.admission.update({ where: { id: stay.id }, data: { status: 'DISCHARGED' } })])).rejects.toThrow()
    await closeStay(stay.id, new Date('2026-07-02T08:00:00Z'), 'Private discharge summary')
    const discharged = await db.admission.findUniqueOrThrow({ where: { id: stay.id }, include: { rooms: true } })
    for (const data of [{ dischargeNotes: 'Private rewrite' }, { status: 'ADMITTED' as const, dischargedAt: null, dischargedById: null, dischargeNotes: null },
      { roomNumber: 'Room 99' }, { dischargedAt: new Date('2026-07-03T08:00:00Z') }]) {
      await expect(db.admission.update({ where: { id: stay.id }, data })).rejects.toThrow()
    }
    await expect(db.admission.delete({ where: { id: stay.id } })).rejects.toThrow()
    await expect(db.admissionRoomHistory.create({ data: { admissionId: stay.id, roomNumber: 'Room 99', assignedAt: new Date(), assignedById: actor().id } })).rejects.toThrow()
    expect(await db.admission.findUniqueOrThrow({ where: { id: stay.id }, include: { rooms: true } })).toEqual(discharged)
  })
  it('keeps admission identity immutable and new stays admitted', async () => {
    const person = await patient(), other = await patient(), stay = await seedStay(person.id, new Date('2026-08-01T08:00:00Z'))
    for (const data of [{ patientId: other.id }, { admittedAt: new Date('2026-08-02T08:00:00Z') }, { admittedById: actor('ADMIN').id }, { admissionNumber: 'AD-999999' }]) {
      await expect(db.admission.update({ where: { id: stay.id }, data })).rejects.toThrow()
    }
    await expect(db.admission.create({ data: { patientId: other.id, roomNumber: 'Room 1', admittedAt: new Date('2026-08-01T08:00:00Z'), admittedById: actor().id,
      status: 'DISCHARGED', dischargedAt: new Date('2026-08-02T08:00:00Z'), dischargedById: actor().id } })).rejects.toThrow()
    await expect(db.admission.create({ data: { patientId: other.id, roomNumber: 'Room 1', admittedAt: new Date(), admittedById: actor().id, admissionNumber: 'ADM-1',
      rooms: { create: { roomNumber: 'Room 1', assignedAt: new Date(), assignedById: actor().id } } } })).rejects.toThrow()
    await expect(db.admission.create({ data: { patientId: other.id, roomNumber: ' Room 1', admittedAt: new Date(), admittedById: actor().id,
      rooms: { create: { roomNumber: ' Room 1', assignedAt: new Date(), assignedById: actor().id } } } })).rejects.toThrow()
  })
  it('refuses an archived patient and archiving an admitted patient', async () => {
    const archived = await patient(), current = await patient()
    await db.patient.update({ where: { id: archived.id }, data: { archivedAt: new Date() } })
    await expect(seedStay(archived.id, new Date('2026-09-01T08:00:00Z'))).rejects.toThrow()
    await seedStay(current.id, new Date('2026-09-01T08:00:00Z'))
    await expect(db.patient.update({ where: { id: current.id }, data: { archivedAt: new Date() } })).rejects.toThrow()
  })
  it('keeps room history append-only and consistent with the current room at commit', async () => {
    const person = await patient(), stay = await seedStay(person.id, new Date('2026-10-01T08:00:00Z'), 'Room 1')
    const room = await db.admissionRoomHistory.findFirstOrThrow({ where: { admissionId: stay.id } })
    for (const data of [{ roomNumber: 'Room 2' }, { note: 'Private rewrite' }, { assignedAt: new Date() }, { assignedById: actor('ADMIN').id }]) {
      await expect(db.admissionRoomHistory.update({ where: { id: room.id }, data })).rejects.toThrow()
    }
    await expect(db.admissionRoomHistory.delete({ where: { id: room.id } })).rejects.toThrow()
    // A second open room, a room change without its history, and a stay without a room all fail.
    await expect(db.admissionRoomHistory.create({ data: { admissionId: stay.id, roomNumber: 'Room 2', assignedAt: new Date(), assignedById: actor().id } })).rejects.toThrow()
    await expect(db.admission.update({ where: { id: stay.id }, data: { roomNumber: 'Room 2' } })).rejects.toThrow()
    await expect(db.admission.create({ data: { patientId: (await patient()).id, roomNumber: 'Room 3', admittedAt: new Date(), admittedById: actor().id } })).rejects.toThrow()
    // A proper transfer in one transaction is accepted.
    const at = new Date('2026-10-02T08:00:00Z')
    await db.$transaction([
      db.admissionRoomHistory.updateMany({ where: { admissionId: stay.id, endedAt: null }, data: { endedAt: at } }),
      db.admissionRoomHistory.create({ data: { admissionId: stay.id, roomNumber: 'Room 2', assignedAt: at, assignedById: actor().id } }),
      db.admission.update({ where: { id: stay.id }, data: { roomNumber: 'Room 2' } }),
    ])
    await expect(db.admissionRoomHistory.update({ where: { id: room.id }, data: { endedAt: new Date('2026-10-03T08:00:00Z') } })).rejects.toThrow()
    expect((await db.admissionRoomHistory.findMany({ where: { admissionId: stay.id }, orderBy: { assignedAt: 'asc' } })).map((value) => value.roomNumber)).toEqual(['Room 1', 'Room 2'])
  })
  it('refuses a discharge with an unfinished clinical record even without the API', async () => {
    const person = await patient(), stay = await seedStay(person.id, new Date(Date.now() - 3600000))
    await db.encounter.create({ data: { patientId: person.id, admissionId: stay.id, clinicianId: actor().id, createdById: actor().id, clinicalNotes: 'Private draft' } })
    await expect(closeStay(stay.id, new Date())).rejects.toThrow()
    expect((await db.admission.findUniqueOrThrow({ where: { id: stay.id } })).status).toBe('ADMITTED')
  })
  it.each(['Admission', 'AdmissionRoomHistory'])('blocks TRUNCATE of %s', async (table) => {
    await expect(db.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE`)).rejects.toThrow()
    expect(await db.admission.count()).toBeGreaterThan(0)
  })
})

describe('audit, rollback and privacy', () => {
  it.each(['admit', 'room', 'discharge', 'view'] as const)('rolls back and fails safely when the %s audit fails', async (operation) => {
    const { admission } = await admitted('Room 1'), person = await patient()
    const before = await db.admission.findUniqueOrThrow({ where: { id: admission.id }, include: { rooms: true } })
    const call = operation === 'view' ? read(`${base}/${admission.id}`) : operation === 'admit' ? send('post', base, { patientId: person.id, roomNumber: 'Room 2' })
      : send('post', `${base}/${admission.id}/${operation}`, operation === 'room' ? { roomNumber: 'Room 2' } : { dischargeNotes: 'Private summary' })
    const response = await call.set('X-Request-Id', 'fail-admission-audit')
    expect(response.status).toBe(500)
    expect(response.body.error).toEqual({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', requestId: 'fail-admission-audit' })
    expect(await db.admission.findUniqueOrThrow({ where: { id: admission.id }, include: { rooms: true } })).toEqual(before)
    expect(await db.admission.count({ where: { patientId: person.id } })).toBe(0)
    expect(JSON.stringify(response.body) + logs).not.toContain('private admission SQL')
  })
  it('keeps rooms, notes and names out of audit metadata and logs', async () => {
    const { admission } = await admitted('Private Ward Secret')
    await send('post', `${base}/${admission.id}/room`, { roomNumber: 'Private Room Secret', note: 'Private transfer reason' })
    await send('post', `${base}/${admission.id}/discharge`, { dischargeNotes: 'Private discharge summary' })
    await read(`${base}/${admission.id}`)
    await read(`${base}?search=PrivateSearch`)
    const events = await db.auditEvent.findMany({ where: { entityId: admission.id } })
    expect(events.map((event) => event.action).sort()).toEqual(['ADMISSION_ROOM_CHANGED', 'ADMISSION_VIEWED', 'PATIENT_ADMITTED', 'PATIENT_DISCHARGED'].sort())
    expect(JSON.stringify(events.map((event) => event.metadata))).toBe(JSON.stringify(events.map(() => ({ source: 'API' }))))
    expect(logs).not.toMatch(/Private|Synthetic|Stay-/)
  })
})

describe('full admission, treatment and discharge cycle', () => {
  it('a Medical Officer registers, admits, treats, transfers, discharges and later re-admits without Admin', async () => {
    const mo = await newActor('DOCTOR_IN_CHARGE')
    // Register & admit: the registration and the admission are two requests, one after the other.
    const registered = await send('post', '/api/v1/patients', { firstName: 'Synthetic', lastName: `Cycle-${randomUUID()}` }, mo, `cycle-${randomUUID()}`)
    expect(registered.status).toBe(201)
    const person = registered.body.data.patient
    const stay = (await send('post', base, { patientId: person.id, roomNumber: 'Ward A - Bed 6' }, mo, `cycle-${randomUUID()}`)).body.data.admission
    expect((await read(`/api/v1/patients/${person.id}`, mo)).body.data.patient.currentAdmission).toMatchObject({ id: stay.id, roomNumber: 'Ward A - Bed 6' })
    expect((await read(`${base}?status=ADMITTED&search=${person.patientNumber}`, mo)).body.data.items.map((item: { id: string }) => item.id)).toEqual([stay.id])
    // Medical record: complaint, diagnosis and medication on the current admission, then finalized.
    const record = await send('post', '/api/v1/encounters', { admissionId: stay.id, complaints: [{ description: 'Fever' }],
      diagnoses: [{ description: 'Synthetic diagnosis' }], medications: [{ medicationId: await catalogId('Paracetamol'), strength: '500 mg', dose: '1 tablet', route: 'Oral',
        frequency: 'Three times daily', duration: '5 days' }] }, mo, `cycle-${randomUUID()}`)
    expect(record.status).toBe(201)
    expect(record.body.data.encounter.roomLabel).toBe('Ward A - Bed 6')
    expect((await send('post', `${base}/${stay.id}/room`, { roomNumber: 'Male Ward 2' }, mo)).status).toBe(200)
    expect((await send('post', `${base}/${stay.id}/discharge`, {}, mo)).body.error.code).toBe('ADMISSION_HAS_DRAFT_RECORDS')
    expect((await send('post', `/api/v1/encounters/${record.body.data.encounter.id}/finalize`, {}, mo)).status).toBe(200)
    const discharged = await send('post', `${base}/${stay.id}/discharge`, { dischargeNotes: 'Synthetic discharge summary' }, mo)
    expect(discharged.body.data.admission).toMatchObject({ status: 'DISCHARGED', dischargedBy: { id: mo.id }, dischargeNotes: 'Synthetic discharge summary' })
    expect(discharged.body.data.admission.rooms.map((room: { roomNumber: string }) => room.roomNumber)).toEqual(['Ward A - Bed 6', 'Male Ward 2'])
    // Off the current list, history intact, read-only except amendments.
    expect((await read(`${base}?status=ADMITTED&search=${person.patientNumber}`, mo)).body.data.items).toEqual([])
    expect((await read(`/api/v1/encounters?admissionId=${stay.id}`, mo)).body.data.items).toHaveLength(1)
    expect((await read(`/api/v1/patients/${person.id}/medications`, mo)).body.data.items).toHaveLength(1)
    expect((await send('post', '/api/v1/encounters', { admissionId: stay.id, clinicalNotes: 'Late note' }, mo)).body.error.code).toBe('ADMISSION_NOT_CURRENT')
    expect((await send('post', `/api/v1/encounters/${record.body.data.encounter.id}/amend`, { reason: 'Correction', content: 'Synthetic correction' }, mo)).status).toBe(201)
    // Returning patient: a new stay on the same permanent record.
    const again = await send('post', base, { patientId: person.id, roomNumber: 'Private Room 3' }, mo)
    expect(again.status).toBe(201)
    expect((await read(`${base}?patientId=${person.id}`, mo)).body.data.items).toHaveLength(2)
    const actions = (await db.auditEvent.findMany({ where: { actorId: mo.id }, orderBy: { createdAt: 'asc' } })).map((event) => event.action)
    expect(actions).toEqual(expect.arrayContaining(['PATIENT_CREATED', 'PATIENT_ADMITTED', 'MEDICAL_RECORD_CREATED', 'ADMISSION_ROOM_CHANGED',
      'MEDICAL_RECORD_FINALIZED', 'PATIENT_DISCHARGED', 'MEDICAL_RECORD_AMENDED', 'PATIENT_READMITTED']))
  })
})
