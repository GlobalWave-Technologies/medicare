import { randomUUID } from 'node:crypto'
import { Writable } from 'node:stream'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { disconnectDatabase } from '../src/database/prisma.js'
import { createLogger } from '../src/shared/logger/logger.js'
import { hashPassword } from '../src/shared/security/password.js'
import { createSession } from '../src/modules/auth/session.service.js'
import { pruneExpiredIdempotencyRecords } from '../src/shared/idempotency/idempotency.js'
import { isolatedTestEnvironment, testDatabase } from './helpers/database.js'
import type { StaffRole } from '../src/generated/prisma/client.js'

const db = testDatabase(), env = isolatedTestEnvironment()
const patients = '/api/v1/patients', broadcasts = '/api/v1/notifications/broadcast', encounters = '/api/v1/encounters'
type Actor = { id: string; cookie: string; csrf: string; sessionId: string }
let hash: string, logs = '', slot = 0, app: ReturnType<typeof createApp>
const actors = new Map<StaffRole, Actor>()
const actor = (role: StaffRole = 'ADMIN') => actors.get(role)!
async function newActor(role: StaffRole = 'ADMIN'): Promise<Actor> {
  const user = await db.staffUser.create({ data: { firstName: 'Synthetic', lastName: 'Idempotency', email: `${randomUUID()}@example.test`,
    role, status: 'ACTIVE', passwordHash: hash, passwordChangedAt: new Date() } })
  return session(user.id)
}
async function session(id: string): Promise<Actor> {
  const value = await db.$transaction((tx) => createSession(tx, id))
  return { id, cookie: `medicare_session=${value.token}`, csrf: value.session.csrfToken, sessionId: value.session.id }
}
function post(path: string, body: object, who: Actor, key?: string, csrf: string | null = who.csrf) {
  const call = request(app).post(path).set('Cookie', who.cookie).set('Origin', env.CLIENT_ORIGIN)
  if (csrf !== null) call.set('X-CSRF-Token', csrf)
  if (key !== undefined) call.set('Idempotency-Key', key)
  return call.send(body)
}
const person = (overrides: object = {}) => ({ firstName: 'Synthetic', lastName: `Replay-${randomUUID()}`, ...overrides })
const records = (where: object = {}) => db.idempotencyRecord.findMany({ where })
const audits = (entityId: string) => db.auditEvent.findMany({ where: { entityId } })
async function clinical(overrides: object = {}) {
  const patient = await db.patient.create({ data: { firstName: 'Synthetic', lastName: `Clinical-${randomUUID()}`, createdById: actor().id } })
  return { patientId: patient.id, occurredAt: new Date(Date.now() - 60000).toISOString(), clinicalNotes: 'Private walk-in narrative',
    complaints: [{ description: 'Private complaint one' }, { description: 'Private complaint two' }],
    diagnoses: [{ description: 'Private diagnosis', code: 'Local-9', notes: 'Private diagnostic notes' }], ...overrides }
}
async function checkedIn(patientId: string, who = actor('DOCTOR_IN_CHARGE')) {
  const start = Date.now() - (++slot * 3600000)
  return db.appointment.create({ data: { patientId, clinicianId: who.id, type: 'CONSULTATION', status: 'CHECKED_IN', createdById: actor().id,
    scheduledStart: new Date(start), scheduledEnd: new Date(start + 1800000) } })
}
const notice = (audience: object = { type: 'ALL' }, overrides: object = {}) => ({ title: `Replay notice ${randomUUID()}`, message: 'Private broadcast body for staff', audience, ...overrides })
async function failing(table: string, operation: () => Promise<void>) {
  await db.$executeRaw`INSERT INTO test_idempotency_failure VALUES (${table})`
  try { await operation() } finally { await db.$executeRaw`DELETE FROM test_idempotency_failure WHERE flag = ${table}` }
}

beforeAll(async () => {
  hash = await hashPassword('Synthetic idempotency test passphrase')
  for (const role of ['ADMIN', 'RECORDS_OFFICER', 'DOCTOR_IN_CHARGE'] as const) actors.set(role, await newActor(role))
  await db.$executeRawUnsafe('CREATE TABLE test_idempotency_failure (flag text PRIMARY KEY)')
  await db.$executeRawUnsafe(`CREATE FUNCTION test_idempotency_failure_fn() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF EXISTS (SELECT 1 FROM test_idempotency_failure WHERE flag = TG_TABLE_NAME)
      THEN RAISE EXCEPTION 'private idempotency SQL'; END IF; RETURN NEW; END $$`)
  for (const table of ['IdempotencyRecord', 'AuditEvent', 'NotificationRecipient', 'Patient', 'Encounter']) {
    await db.$executeRawUnsafe(`CREATE TRIGGER test_fail_idempotency BEFORE INSERT ON "${table}" FOR EACH ROW EXECUTE FUNCTION test_idempotency_failure_fn()`)
  }
})
beforeEach(() => {
  logs = ''
  app = createApp({ env, prisma: db, checkDatabase: async () => {}, logger: createLogger('info', new Writable({
    write(chunk: Buffer, _encoding, callback) { logs += chunk.toString(); callback() },
  })) })
})
afterAll(disconnectDatabase)

describe('Idempotency-Key validation', () => {
  it('keeps the endpoints working without a key and stores no record', async () => {
    const body = person(), response = await post(patients, body, actor())
    expect(response.status).toBe(201); expect(response.headers['idempotency-replayed']).toBeUndefined()
    expect(await records({ patientId: response.body.data.patient.id })).toHaveLength(0)
  })
  it.each([['empty', ''], ['too short', 'a'.repeat(15)], ['too long', 'a'.repeat(129)], ['spaces', 'not a valid key value'],
    ['two values', `${randomUUID()}, ${randomUUID()}`], ['quoted', `"${randomUUID()}"`], ['non-ASCII', `${randomUUID()}é`]])('rejects a %s key before writing', async (_label, key) => {
    const body = person(), response = await post(patients, body, actor(), key)
    expect(response.status).toBe(400); expect(response.body.error).toMatchObject({ code: 'INVALID_IDEMPOTENCY_KEY' })
    expect(await db.patient.count({ where: { lastName: body.lastName } })).toBe(0)
  })
  it.each([['UUID', randomUUID()], ['16 characters', 'abcdefghijklmnop'], ['128 characters', 'K'.repeat(128)], ['underscore', `key_${randomUUID()}`]])('accepts a %s key', async (_label, key) => {
    expect((await post(patients, person(), actor(), key)).status).toBe(201)
  })
})

describe('patient registration', () => {
  it('replays an identical retry with the same patient, one row and one audit', async () => {
    const key = randomUUID(), body = person({ dateOfBirth: '1990-04-12', phone: '+233241234567' })
    const first = await post(patients, body, actor('RECORDS_OFFICER'), key), again = await post(patients, body, actor('RECORDS_OFFICER'), key)
    expect(first.status).toBe(201); expect(first.headers['idempotency-replayed']).toBeUndefined()
    expect(again.status).toBe(201); expect(again.headers['idempotency-replayed']).toBe('true')
    expect(again.body.data.patient).toEqual(first.body.data.patient)
    expect(await db.patient.count({ where: { lastName: body.lastName } })).toBe(1)
    expect((await audits(first.body.data.patient.id)).map((event) => event.action)).toEqual(['PATIENT_CREATED'])
    expect(await records({ patientId: first.body.data.patient.id })).toHaveLength(1)
  })
  it('treats differently formatted but equivalent input as the same request', async () => {
    const key = randomUUID(), lastName = `Format-${randomUUID()}`
    const first = await post(patients, { firstName: 'Ama', lastName, phone: '+233 24 123 4567', middleName: '' }, actor(), key)
    const again = await post(patients, { phone: '+233241234567', lastName: `  ${lastName} `, firstName: ' Ama' }, actor(), key)
    expect(again.headers['idempotency-replayed']).toBe('true'); expect(again.body.data.patient.id).toBe(first.body.data.patient.id)
  })
  it('refuses the same key with a changed payload without revealing the original', async () => {
    const key = randomUUID(), body = person()
    const first = await post(patients, body, actor(), key), changed = await post(patients, { ...body, firstName: 'Different' }, actor(), key)
    expect(changed.status).toBe(409)
    expect(changed.body.error).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED', message: 'This request key has already been used for a different operation.' })
    expect(JSON.stringify(changed.body)).not.toContain(body.lastName); expect(JSON.stringify(changed.body)).not.toContain(first.body.data.patient.id)
    expect(await db.patient.count({ where: { lastName: body.lastName } })).toBe(1)
  })
  it('keeps the probable-duplicate policy for a new key with the same person', async () => {
    const body = person({ dateOfBirth: '1984-02-02', phone: '+233201112223' })
    expect((await post(patients, body, actor(), randomUUID())).status).toBe(201)
    const duplicate = await post(patients, body, actor(), randomUUID())
    expect(duplicate.status).toBe(409); expect(duplicate.body.error.code).toBe('POSSIBLE_DUPLICATE_PATIENT')
    const sparse = person()
    for (const key of [randomUUID(), randomUUID()]) expect((await post(patients, sparse, actor(), key)).status).toBe(201)
    expect(await db.patient.count({ where: { lastName: sparse.lastName } })).toBe(2)
  })
  it('creates one patient for concurrent same-key requests', async () => {
    const key = randomUUID(), body = person()
    const responses = await Promise.all(Array.from({ length: 6 }, () => post(patients, body, actor(), key)))
    expect(responses.map((response) => response.status)).toEqual(Array(6).fill(201))
    expect(new Set(responses.map((response) => response.body.data.patient.id)).size).toBe(1)
    expect(responses.filter((response) => response.headers['idempotency-replayed'] === 'true')).toHaveLength(5)
    expect(await db.patient.count({ where: { lastName: body.lastName } })).toBe(1)
    expect(await audits(responses[0]!.body.data.patient.id)).toHaveLength(1)
  })
  it('does not consume a key on validation or business-rule failures', async () => {
    const key = randomUUID(), body = person({ dateOfBirth: '1977-07-07', phone: '+233209998887' })
    expect((await post(patients, { ...body, dateOfBirth: '2999-01-01' }, actor(), key)).status).toBe(400)
    expect((await post(patients, body, actor(), randomUUID())).status).toBe(201)
    expect((await post(patients, body, actor(), key)).body.error.code).toBe('POSSIBLE_DUPLICATE_PATIENT')
    expect(await db.idempotencyRecord.count({ where: { principalId: actor().id, patient: { lastName: body.lastName } } })).toBe(1)
  })
})

describe('broadcast creation', () => {
  it('replays one broadcast with one recipient set and one audit', async () => {
    const key = randomUUID(), body = notice(), active = await db.staffUser.count({ where: { status: 'ACTIVE' } })
    const first = await post(broadcasts, body, actor(), key)
    await newActor('RECORDS_OFFICER')
    const again = await post(broadcasts, body, actor(), key)
    expect(first.status).toBe(201); expect(again.status).toBe(201); expect(again.headers['idempotency-replayed']).toBe('true')
    expect(again.body.data).toEqual(first.body.data); expect(first.body.data.recipientCount).toBe(active)
    const stored = await db.notification.findMany({ where: { title: body.title }, include: { recipients: true } })
    expect(stored).toHaveLength(1); expect(stored[0]!.recipients).toHaveLength(active)
    expect((await audits(stored[0]!.id)).map((event) => event.action)).toEqual(['NOTIFICATION_BROADCAST_CREATED'])
  })
  it.each([['audience', { audience: { type: 'ROLE', role: 'RECORDS_OFFICER' } }], ['message', { message: 'A different private body' }], ['title', { title: 'Another title' }]])('refuses the same key with a changed %s', async (_label, change) => {
    const key = randomUUID(), body = notice()
    expect((await post(broadcasts, body, actor(), key)).status).toBe(201)
    const changed = await post(broadcasts, { ...body, ...change }, actor(), key)
    expect(changed.status).toBe(409); expect(changed.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED')
    expect(await db.notification.count({ where: { title: { in: [body.title, 'Another title'] } } })).toBe(1)
  })
  it('creates one broadcast for concurrent same-key requests', async () => {
    const key = randomUUID(), body = notice({ type: 'ROLE', role: 'DOCTOR_IN_CHARGE' })
    const responses = await Promise.all(Array.from({ length: 5 }, () => post(broadcasts, body, actor(), key)))
    expect(responses.map((response) => response.status)).toEqual(Array(5).fill(201))
    const stored = await db.notification.findMany({ where: { title: body.title }, include: { recipients: true } })
    expect(stored).toHaveLength(1); expect(new Set(responses.map((response) => response.body.data.notification.id))).toEqual(new Set([stored[0]!.id]))
    expect(stored[0]!.recipients).toHaveLength(await db.staffUser.count({ where: { status: 'ACTIVE', role: 'DOCTOR_IN_CHARGE' } }))
    expect(await audits(stored[0]!.id)).toHaveLength(1)
  })
  it('still requires the broadcast permission before any replay', async () => {
    const key = randomUUID(), body = notice()
    expect((await post(broadcasts, body, actor(), key)).status).toBe(201)
    for (const role of ['RECORDS_OFFICER', 'DOCTOR_IN_CHARGE'] as const) {
      const denied = await post(broadcasts, body, actor(role), key)
      expect(denied.status).toBe(403); expect(denied.body.error.code).toBe('FORBIDDEN')
    }
  })
})

describe('encounter creation', () => {
  it('replays a walk-in encounter with one record and one clinical audit', async () => {
    const key = randomUUID(), body = await clinical(), doctor = actor('DOCTOR_IN_CHARGE')
    const first = await post(encounters, body, doctor, key), again = await post(encounters, body, doctor, key)
    expect(first.status).toBe(201); expect(again.status).toBe(201); expect(again.headers['idempotency-replayed']).toBe('true')
    expect(again.body.data.encounter.id).toBe(first.body.data.encounter.id)
    expect(again.body.data.encounter.complaints.map((value: { description: string }) => value.description)).toEqual(['Private complaint one', 'Private complaint two'])
    expect(await db.encounter.count({ where: { patientId: body.patientId } })).toBe(1)
    expect((await audits(first.body.data.encounter.id)).map((event) => event.action)).toEqual(['MEDICAL_RECORD_CREATED'])
  })
  it('matches the same instant written with a different offset', async () => {
    const key = randomUUID(), occurredAt = new Date(Date.now() - 7200000), body = await clinical({ occurredAt: occurredAt.toISOString() })
    const first = await post(encounters, body, actor('DOCTOR_IN_CHARGE'), key)
    const local = new Date(occurredAt.getTime() + 3600000).toISOString().replace('Z', '+01:00')
    const again = await post(encounters, { ...body, occurredAt: local }, actor('DOCTOR_IN_CHARGE'), key)
    expect(again.headers['idempotency-replayed']).toBe('true'); expect(again.body.data.encounter.id).toBe(first.body.data.encounter.id)
  })
  it('refuses changed clinical content under the same key', async () => {
    const key = randomUUID(), body = await clinical()
    expect((await post(encounters, body, actor('DOCTOR_IN_CHARGE'), key)).status).toBe(201)
    const changed = await post(encounters, { ...body, complaints: [{ description: 'Private complaint two' }, { description: 'Private complaint one' }] }, actor('DOCTOR_IN_CHARGE'), key)
    expect(changed.status).toBe(409); expect(changed.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED')
    expect(await db.encounter.count({ where: { patientId: body.patientId } })).toBe(1)
  })
  it('creates one encounter for concurrent same-key requests', async () => {
    const key = randomUUID(), body = await clinical()
    const responses = await Promise.all(Array.from({ length: 5 }, () => post(encounters, body, actor('DOCTOR_IN_CHARGE'), key)))
    expect(responses.map((response) => response.status)).toEqual(Array(5).fill(201))
    expect(await db.encounter.count({ where: { patientId: body.patientId } })).toBe(1)
    expect(await audits(responses[0]!.body.data.encounter.id)).toHaveLength(1)
  })
  it('keeps one encounter per appointment while replaying a linked creation', async () => {
    const body = await clinical(), linked = await checkedIn(body.patientId), key = randomUUID()
    const first = await post(encounters, { ...body, appointmentId: linked.id }, actor('DOCTOR_IN_CHARGE'), key)
    const again = await post(encounters, { ...body, appointmentId: linked.id }, actor('DOCTOR_IN_CHARGE'), key)
    expect(first.status).toBe(201); expect(again.body.data.encounter.id).toBe(first.body.data.encounter.id)
    for (const other of [randomUUID(), undefined]) {
      const second = await post(encounters, { ...body, appointmentId: linked.id }, actor('DOCTOR_IN_CHARGE'), other)
      expect(second.status).toBe(409); expect(second.body.error.code).toBe('APPOINTMENT_ALREADY_HAS_ENCOUNTER')
    }
    expect(await db.encounter.count({ where: { appointmentId: linked.id } })).toBe(1)
  })
  it('replays even after the patient is archived, but a new key is refused', async () => {
    const key = randomUUID(), body = await clinical()
    const first = await post(encounters, body, actor('DOCTOR_IN_CHARGE'), key)
    await db.patient.update({ where: { id: body.patientId }, data: { archivedAt: new Date() } })
    expect((await post(encounters, body, actor('DOCTOR_IN_CHARGE'), key)).body.data.encounter.id).toBe(first.body.data.encounter.id)
    expect((await post(encounters, body, actor('DOCTOR_IN_CHARGE'), randomUUID())).body.error.code).toBe('PATIENT_ARCHIVED')
  })
})

describe('principal scope and authentication', () => {
  it('never replays one user’s request for another user with the same raw key', async () => {
    const key = randomUUID(), other = await newActor('ADMIN'), body = person()
    const mine = await post(patients, body, actor(), key), theirs = await post(patients, body, other, key)
    expect(theirs.status).toBe(201); expect(theirs.headers['idempotency-replayed']).toBeUndefined()
    expect(theirs.body.data.patient.id).not.toBe(mine.body.data.patient.id)
    expect((await post(patients, { ...body, firstName: 'Changed' }, other, randomUUID())).status).toBe(201)
    const doctors = [actor('DOCTOR_IN_CHARGE'), await newActor('DOCTOR_IN_CHARGE')], visit = await clinical()
    const created = await Promise.all(doctors.map((doctor) => post(encounters, visit, doctor, key)))
    expect(new Set(created.map((response) => response.body.data.encounter.id)).size).toBe(2)
  })
  it('replays for the same user after signing in again, but not after suspension or revocation', async () => {
    const who = await newActor('ADMIN'), key = randomUUID(), body = person()
    const first = await post(patients, body, who, key)
    const resumed = await session(who.id)
    expect((await post(patients, body, resumed, key)).body.data.patient.id).toBe(first.body.data.patient.id)
    await db.staffSession.update({ where: { id: resumed.sessionId }, data: { revokedAt: new Date() } })
    expect((await post(patients, body, resumed, key)).status).toBe(401)
    await db.staffUser.update({ where: { id: who.id }, data: { status: 'SUSPENDED' } })
    expect((await post(patients, body, who, key)).status).toBe(401)
    expect(await db.patient.count({ where: { lastName: body.lastName } })).toBe(1)
  })
  it('rejects anonymous requests that carry a known key', async () => {
    const key = randomUUID(), body = person()
    await post(patients, body, actor(), key)
    const anonymous = await request(app).post(patients).set('Origin', env.CLIENT_ORIGIN).set('Idempotency-Key', key).send(body)
    expect(anonymous.status).toBe(401); expect(JSON.stringify(anonymous.body)).not.toContain(body.lastName)
  })
})

describe('CSRF', () => {
  it('requires CSRF on every keyed request and lets a deliberate retry proceed', async () => {
    const key = randomUUID(), body = notice()
    for (const csrf of [null, '0'.repeat(64)]) {
      const refused = await post(broadcasts, body, actor(), key, csrf)
      expect(refused.status).toBe(403); expect(refused.body.error.code).toBe('CSRF_INVALID')
    }
    const wrongOrigin = await request(app).post(broadcasts).set('Cookie', actor().cookie).set('Origin', 'https://attacker.example.test')
      .set('X-CSRF-Token', actor().csrf).set('Idempotency-Key', key).send(body)
    expect(wrongOrigin.status).toBe(403)
    expect(await db.notification.count({ where: { title: body.title } })).toBe(0); expect(await records({ principalId: actor().id, notification: { title: body.title } })).toHaveLength(0)
    const accepted = await post(broadcasts, body, actor(), key)
    expect(accepted.status).toBe(201); expect(accepted.headers['idempotency-replayed']).toBeUndefined()
    expect((await post(broadcasts, body, actor(), key, null)).status).toBe(403)
  })
})

describe('transactions', () => {
  it.each([['IdempotencyRecord'], ['AuditEvent'], ['Patient']])('rolls back the patient and record when %s fails, then lets the key succeed once', async (table) => {
    const key = randomUUID(), body = person()
    await failing(table, async () => { expect((await post(patients, body, actor(), key)).status).toBe(500) })
    expect(await db.patient.count({ where: { lastName: body.lastName } })).toBe(0)
    expect(await db.idempotencyRecord.count({ where: { principalId: actor().id, patient: { lastName: body.lastName } } })).toBe(0)
    const retry = await post(patients, body, actor(), key)
    expect(retry.status).toBe(201); expect(retry.headers['idempotency-replayed']).toBeUndefined()
    expect(await audits(retry.body.data.patient.id)).toHaveLength(1)
  })
  it.each([['NotificationRecipient'], ['IdempotencyRecord'], ['AuditEvent']])('rolls back the whole broadcast when %s fails', async (table) => {
    const key = randomUUID(), body = notice(), broadcastAudits = () => db.auditEvent.count({ where: { action: 'NOTIFICATION_BROADCAST_CREATED' } })
    const before = await broadcastAudits()
    await failing(table, async () => { expect((await post(broadcasts, body, actor(), key)).status).toBe(500) })
    expect(await db.notification.count({ where: { title: body.title } })).toBe(0); expect(await broadcastAudits()).toBe(before)
    expect((await post(broadcasts, body, actor(), key)).status).toBe(201)
    expect(await db.notification.count({ where: { title: body.title } })).toBe(1)
  })
  it.each([['IdempotencyRecord'], ['AuditEvent'], ['Encounter']])('rolls back the encounter when %s fails', async (table) => {
    const key = randomUUID(), body = await clinical()
    await failing(table, async () => { expect((await post(encounters, body, actor('DOCTOR_IN_CHARGE'), key)).status).toBe(500) })
    expect(await db.encounter.count({ where: { patientId: body.patientId } })).toBe(0)
    expect((await post(encounters, body, actor('DOCTOR_IN_CHARGE'), key)).status).toBe(201)
  })
})

describe('privacy, logging and storage integrity', () => {
  it('stores only digests and the resource reference, never the key or content', async () => {
    const key = randomUUID(), body = person({ firstName: 'PrivateGiven', dateOfBirth: '1991-03-03', phone: '+233205554443' })
    const created = await post(patients, body, actor(), key)
    const visit = await clinical(), encounter = await post(encounters, visit, actor('DOCTOR_IN_CHARGE'), randomUUID())
    const sent = await post(broadcasts, notice(), actor(), randomUUID())
    const rows = await db.$queryRaw<Array<{ row: string }>>`SELECT row_to_json(r)::text AS row FROM "IdempotencyRecord" r
      WHERE r."patientId" = ${created.body.data.patient.id}::uuid OR r."encounterId" = ${encounter.body.data.encounter.id}::uuid
        OR r."notificationId" = ${sent.body.data.notification.id}::uuid`
    expect(rows).toHaveLength(3)
    const stored = rows.map((value) => value.row).join('\n')
    expect(stored).not.toMatch(new RegExp([key, 'PrivateGiven', body.lastName, '1991-03-03', '233205554443', 'Private', 'broadcast body', 'Replay notice'].join('|')))
    for (const value of rows.map((item) => JSON.parse(item.row) as Record<string, string>)) {
      expect(value.keyHash).toMatch(/^[0-9a-f]{64}$/); expect(value.requestHash).toMatch(/^[0-9a-f]{64}$/)
      expect(Object.keys(value).sort()).toEqual(['createdAt', 'encounterId', 'expiresAt', 'id', 'keyHash', 'notificationId', 'operation', 'patientId', 'principalId', 'requestHash'])
    }
  })
  it('logs replays by operation only, without the key or payload', async () => {
    const key = randomUUID(), body = person({ firstName: 'LoggedGiven' })
    await post(patients, body, actor(), key); await post(patients, body, actor(), key); await post(patients, { ...body, firstName: 'Other' }, actor(), key)
    const visit = await clinical(); await post(encounters, visit, actor('DOCTOR_IN_CHARGE'), key); await post(encounters, visit, actor('DOCTOR_IN_CHARGE'), key)
    expect(logs).toContain('Idempotent request replayed'); expect(logs).toContain('"operation":"PATIENT_CREATE"'); expect(logs).toContain('"operation":"ENCOUNTER_CREATE"')
    expect(logs).not.toMatch(new RegExp([key, 'LoggedGiven', body.lastName, 'Private', 'Idempotency-Key', 'idempotency-key'].join('|')))
  })
  it('rejects edits and mismatched resources at the database', async () => {
    const created = await post(patients, person(), actor(), randomUUID())
    const [stored] = await records({ patientId: created.body.data.patient.id })
    await expect(db.idempotencyRecord.update({ where: { id: stored!.id }, data: { expiresAt: new Date(Date.now() + 864e5 * 30) } })).rejects.toThrow()
    const base = { principalId: actor().id, keyHash: 'a'.repeat(64), requestHash: 'b'.repeat(64), expiresAt: new Date(Date.now() + 3600000) }
    await expect(db.idempotencyRecord.create({ data: { ...base, operation: 'ENCOUNTER_CREATE', patientId: (await db.patient.create({ data: { ...person(), createdById: actor().id } })).id } })).rejects.toThrow()
    await expect(db.idempotencyRecord.create({ data: { ...base, keyHash: 'raw-key-not-a-digest', operation: 'PATIENT_CREATE', patientId: (await db.patient.create({ data: { ...person(), createdById: actor().id } })).id } })).rejects.toThrow()
    await expect(db.idempotencyRecord.create({ data: { ...base, operation: 'PATIENT_CREATE', expiresAt: new Date(Date.now() - 1000), patientId: (await db.patient.create({ data: { ...person(), createdById: actor().id } })).id } })).rejects.toThrow()
  })
})

describe('retention', () => {
  it('stops replaying an expired key, treats the next use as new and prunes only expired records', async () => {
    const key = randomUUID(), body = person()
    const first = await post(patients, body, actor(), key)
    const [stored] = await records({ patientId: first.body.data.patient.id })
    const window = stored!.expiresAt.getTime() - stored!.createdAt.getTime()
    expect(window).toBeGreaterThanOrEqual(24 * 3600000 - 5000); expect(window).toBeLessThanOrEqual(24 * 3600000 + 5000)
    await db.idempotencyRecord.delete({ where: { id: stored!.id } })
    await db.idempotencyRecord.create({ data: { ...stored!, createdAt: new Date(Date.now() - 50 * 3600000), expiresAt: new Date(Date.now() - 26 * 3600000) } })
    const later = await post(patients, body, actor(), key)
    expect(later.status).toBe(201); expect(later.headers['idempotency-replayed']).toBeUndefined()
    expect(later.body.data.patient.id).not.toBe(first.body.data.patient.id)
    expect(await records({ patientId: first.body.data.patient.id })).toHaveLength(0)
    const old = await post(patients, person(), actor(), randomUUID()), [expiring] = await records({ patientId: old.body.data.patient.id })
    await db.idempotencyRecord.delete({ where: { id: expiring!.id } })
    await db.idempotencyRecord.create({ data: { ...expiring!, createdAt: new Date(Date.now() - 49 * 3600000), expiresAt: new Date(Date.now() - 25 * 3600000) } })
    const before = await db.idempotencyRecord.count()
    expect(await pruneExpiredIdempotencyRecords(db)).toBe(1)
    expect(await db.idempotencyRecord.count()).toBe(before - 1)
    expect(await records({ patientId: later.body.data.patient.id })).toHaveLength(1)
  })
})
