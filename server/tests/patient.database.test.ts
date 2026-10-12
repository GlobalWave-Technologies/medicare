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
import type { StaffRole } from '../src/generated/prisma/client.js'

const db = testDatabase()
const env = isolatedTestEnvironment()
const base = '/api/v1/patients'
type Credentials = { staffId: string; cookie: string; csrf: string; sessionId: string }
const actors = new Map<StaffRole, Credentials>()
let passwordHash: string
let app: ReturnType<typeof createApp>
let logs = ''

const input = () => ({ firstName: 'Synthetic', middleName: 'Ama', lastName: `Patient-${randomUUID()}`,
  dateOfBirth: '1990-02-28', phone: '+233241234567' })
function actor(role: StaffRole = 'ADMIN') { return actors.get(role)! }
async function newActor(role: StaffRole): Promise<Credentials> {
  const user = await db.staffUser.create({ data: { firstName: 'Synthetic', lastName: 'PatientTests',
    email: `${randomUUID()}@example.test`, role, status: 'ACTIVE', passwordHash, passwordChangedAt: new Date() } })
  const result = await db.$transaction((tx) => createSession(tx, user.id))
  return { staffId: user.id, cookie: `medicare_session=${result.token}`, csrf: result.session.csrfToken, sessionId: result.session.id }
}
function send(method: 'post' | 'patch' | 'delete', path: string, body?: object, credentials = actor()) {
  const call = request(app)[method](path).set('Cookie', credentials.cookie).set('Origin', env.CLIENT_ORIGIN).set('X-CSRF-Token', credentials.csrf)
  return body ? call.send(body) : call
}
function read(path: string, credentials = actor()) { return request(app).get(path).set('Cookie', credentials.cookie) }
async function seed(overrides: Partial<{ firstName: string; middleName: string | null; lastName: string; dateOfBirth: Date | null; phone: string | null; archivedAt: Date | null; createdAt: Date }> = {}) {
  const data = input()
  return db.patient.create({ data: { ...data, dateOfBirth: new Date(`${data.dateOfBirth}T00:00:00Z`), ...overrides, createdById: actor().staffId } })
}
function assertDto(value: object) {
  expect(Object.keys(value).sort()).toEqual(['id', 'patientNumber', 'firstName', 'middleName', 'lastName',
    'dateOfBirth', 'phone', 'archivedAt', 'createdAt', 'updatedAt'].sort())
}
async function audit(response: request.Response, action: string, patientId: string, actorId = actor().staffId) {
  const events = await db.auditEvent.findMany({ where: { requestId: response.headers['x-request-id'] } })
  expect(events).toHaveLength(1)
  expect(events[0]).toMatchObject({ action, entityType: 'PATIENT', entityId: patientId, actorId,
    metadata: action === 'PATIENT_UPDATED' ? { source: 'API', changedFields: ['demographics'] } : { source: 'API' } })
  expect(events[0]!.ipAddress).not.toBeNull()
}

beforeAll(async () => {
  passwordHash = await hashPassword('Synthetic patient-test passphrase')
  for (const role of ['ADMIN', 'RECORDS_OFFICER', 'DOCTOR_IN_CHARGE'] as const) actors.set(role, await newActor(role))
  await db.$executeRawUnsafe(`CREATE FUNCTION test_reject_patient_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW."requestId" = 'fail-patient-audit' THEN RAISE EXCEPTION 'private patient SQL details'; END IF; RETURN NEW; END $$`)
  await db.$executeRawUnsafe(`CREATE TRIGGER test_patient_audit_failure BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION test_reject_patient_audit()`)
})
beforeEach(() => {
  logs = ''
  app = createApp({ env, prisma: db, checkDatabase: async () => { await db.$queryRaw`SELECT 1` },
    logger: createLogger('info', new Writable({ write(chunk: Buffer, _encoding, callback) { logs += chunk.toString(); callback() } })) })
})
afterAll(disconnectDatabase)

describe('patient authorization', () => {
  const id = randomUUID()
  it.each([['get', base], ['get', `${base}/${id}`], ['post', base], ['patch', `${base}/${id}`],
    ['post', `${base}/${id}/archive`], ['post', `${base}/${id}/reactivate`]] as const)('requires authentication: %s %s', async (method, path) => {
    const response = await request(app)[method](path)
    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('AUTHENTICATION_REQUIRED')
  })
  it.each(['ADMIN', 'RECORDS_OFFICER', 'DOCTOR_IN_CHARGE'] as const)('allows %s demographic list/detail reads without CSRF', async (role) => {
    const patient = await seed()
    const list = await read(`${base}?search=${patient.patientNumber}`, actor(role))
    expect(list.status).toBe(200)
    expect(list.body.data.items).toHaveLength(1)
    assertDto(list.body.data.items[0])
    const detail = await read(`${base}/${patient.id}`, actor(role))
    expect(detail.status).toBe(200)
    assertDto(detail.body.data.patient)
    await audit(detail, 'PATIENT_VIEWED', patient.id, actor(role).staffId)
  })
  it.each(['ADMIN', 'RECORDS_OFFICER'] as const)('allows %s registration/update/archive/reactivation', async (role) => {
    const credentials = actor(role)
    const created = await send('post', base, input(), credentials)
    expect(created.status).toBe(201)
    const id = created.body.data.patient.id
    expect((await db.patient.findUniqueOrThrow({ where: { id } })).createdById).toBe(credentials.staffId)
    await audit(created, 'PATIENT_CREATED', id, credentials.staffId)
    const updated = await send('patch', `${base}/${id}`, { firstName: 'Updated' }, credentials)
    expect(updated.status).toBe(200)
    await audit(updated, 'PATIENT_UPDATED', id, credentials.staffId)
    const archived = await send('post', `${base}/${id}/archive`, undefined, credentials)
    expect(archived.status).toBe(200)
    expect(archived.body.data.patient.archivedAt).not.toBeNull()
    await audit(archived, 'PATIENT_ARCHIVED', id, credentials.staffId)
    const restored = await send('post', `${base}/${id}/reactivate`, {}, credentials)
    expect(restored.status).toBe(200)
    expect(restored.body.data.patient).toMatchObject({ id, archivedAt: null })
    await audit(restored, 'PATIENT_REACTIVATED', id, credentials.staffId)
  })
  it.each(['create', 'update', 'archive', 'reactivate'] as const)('denies doctor %s even with client-supplied administrative claims', async (operation) => {
    const patient = await seed()
    const path = operation === 'create' ? base : `${base}/${patient.id}${operation === 'update' ? '' : `/${operation}`}`
    const response = await send(operation === 'update' ? 'patch' : 'post', `${path}?role=ADMIN`,
      { ...input(), role: 'ADMIN', permission: 'PATIENT_CREATE' }, actor('DOCTOR_IN_CHARGE')).set('X-Role', 'ADMIN')
    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('FORBIDDEN')
  })
  it.each(['SUSPENDED', 'DISABLED', 'PENDING', 'revoked'] as const)('rejects %s staff/session access', async (state) => {
    const credentials = await newActor('RECORDS_OFFICER')
    if (state === 'revoked') await db.staffSession.update({ where: { id: credentials.sessionId }, data: { revokedAt: new Date() } })
    else await db.staffUser.update({ where: { id: credentials.staffId }, data: { status: state } })
    expect((await read(base, credentials)).status).toBe(401)
    expect((await send('post', base, input(), credentials)).status).toBe(401)
  })
  it('uses the current role rather than old middleware/client claims', async () => {
    const credentials = await newActor('ADMIN')
    await db.staffUser.update({ where: { id: credentials.staffId }, data: { role: 'DOCTOR_IN_CHARGE' } })
    expect((await send('post', base, input(), credentials)).body.error.code).toBe('FORBIDDEN')
  })
})

describe('patient registration and conservative duplicates', () => {
  it('normalizes demographics and returns only the explicit date-only DTO', async () => {
    const response = await send('post', base, { ...input(), firstName: '  Ési  Ama ', middleName: ' 李 ', lastName: ' O’Neill ', phone: '00233 (24) 123-4567' })
    expect(response.status).toBe(201)
    const patient = response.body.data.patient
    assertDto(patient)
    expect(patient).toMatchObject({ firstName: 'Ési  Ama', middleName: '李', lastName: 'O’Neill', dateOfBirth: '1990-02-28', phone: '+233241234567', archivedAt: null })
    expect(patient.patientNumber).toMatch(/^PT-[0-9A-F-]{36}$/)
    expect(patient.patientNumber.slice(3)).not.toBe(patient.id.toUpperCase())
    expect(response.headers['cache-control']).toBe('no-store')
  })
  it('normalizes omitted/empty optional values to null without fabricating age', async () => {
    const response = await send('post', base, { firstName: 'Synthetic', lastName: randomUUID(), middleName: ' ', dateOfBirth: '', phone: '' })
    expect(response.status).toBe(201)
    expect(response.body.data.patient).toMatchObject({ middleName: null, dateOfBirth: null, phone: null })
    expect(response.body.data.patient).not.toHaveProperty('age')
  })
  it.each(['patientNumber', 'createdBy', 'createdById', 'id', 'createdAt', 'updatedAt', 'archivedAt', 'encounters', 'email', 'age', 'bloodGroup'])('rejects injected create field %s', async (field) => {
    const response = await send('post', base, { ...input(), [field]: 'injected' })
    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('VALIDATION_ERROR')
  })
  it.each([{ dateOfBirth: '2026-02-30' }, { dateOfBirth: '2999-01-01' }, { phone: 'wrong' }, { firstName: '' }, { phone: { set: 'injected' } }])('rejects invalid patient data %j', async (extra) => {
    expect((await send('post', base, { ...input(), ...extra })).status).toBe(400)
  })
  it('generates unique patient numbers under concurrent registration', async () => {
    const responses = await Promise.all(Array.from({ length: 8 }, () => send('post', base, input())))
    expect(responses.every((response) => response.status === 201)).toBe(true)
    expect(new Set(responses.map((response) => response.body.data.patient.patientNumber)).size).toBe(8)
  })
  it('serializes competing probable duplicates and discloses no other patient details', async () => {
    const data = input()
    const responses = await Promise.all([send('post', base, data), send('post', base,
      { ...data, firstName: data.firstName.toUpperCase(), phone: '+233 (24) 123 4567' })])
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409])
    const failure = responses.find((response) => response.status === 409)!
    const patient = responses.find((response) => response.status === 201)!.body.data.patient
    expect(failure.body.error.code).toBe('POSSIBLE_DUPLICATE_PATIENT')
    for (const value of [patient.id, patient.patientNumber, data.firstName, data.lastName, data.phone, data.dateOfBirth]) {
      expect(failure.text).not.toContain(value)
    }
    expect(await db.patient.count({ where: { lastName: data.lastName } })).toBe(1)
  })
  it.each(['phone-only', 'name-dob-only', 'different-middle', 'missing-dob', 'missing-phone'] as const)('allows legitimate shared/insufficient identifiers: %s', async (scenario) => {
    const data = input()
    expect((await send('post', base, data)).status).toBe(201)
    const other = { ...data,
      ...(scenario === 'phone-only' ? { lastName: randomUUID() } : {}),
      ...(scenario === 'name-dob-only' ? { phone: '+442079460958' } : {}),
      ...(scenario === 'different-middle' ? { middleName: 'Different' } : {}),
      ...(scenario === 'missing-dob' ? { dateOfBirth: null } : {}),
      ...(scenario === 'missing-phone' ? { phone: null } : {}),
    }
    expect((await send('post', base, other)).status).toBe(201)
  })
  it('includes archived patients in duplicate checks', async () => {
    const data = input()
    const response = await send('post', base, data)
    await send('post', `${base}/${response.body.data.patient.id}/archive`)
    expect((await send('post', base, data)).body.error.code).toBe('POSSIBLE_DUPLICATE_PATIENT')
  })
  it('treats SQL wildcard characters literally in duplicate comparisons', async () => {
    const data = input()
    expect((await send('post', base, { ...data, firstName: 'A_B%' })).status).toBe(201)
    expect((await send('post', base, { ...data, firstName: 'AXBextra' })).status).toBe(201)
    expect((await send('post', base, { ...data, firstName: 'a_b%' })).status).toBe(409)
  })
})

describe('patient list and detail', () => {
  it('paginates with stable ordering and total pages, including an empty page', async () => {
    const tag = `Paging-${randomUUID()}`
    const createdAt = new Date('2020-01-01T00:00:00Z')
    const rows = await Promise.all(Array.from({ length: 3 }, () => seed({ lastName: tag, createdAt })))
    const expected = rows.map((row) => row.id).sort()
    const first = await read(`${base}?search=${tag}&limit=2`)
    expect(first.body.data.pagination).toEqual({ page: 1, limit: 2, total: 3, totalPages: 2 })
    expect(first.body.data.items.map((row: { id: string }) => row.id)).toEqual(expected.slice(0, 2))
    const second = await read(`${base}?search=${tag}&limit=2&page=2`)
    expect(second.body.data.items.map((row: { id: string }) => row.id)).toEqual(expected.slice(2))
    expect((await read(`${base}?search=${tag}&page=3&limit=2`)).body.data.items).toEqual([])
    const empty = await read(`${base}?search=${randomUUID()}`)
    expect(empty.body.data.pagination).toEqual({ page: 1, limit: 20, total: 0, totalPages: 0 })
  })
  it.each(['patientNumber', 'firstName', 'middleName', 'lastName', 'phone'] as const)('searches %s case-insensitively or with normalized phone formatting', async (field) => {
    const tag = `Search-${randomUUID()}`
    const patient = await seed({ firstName: tag, middleName: tag, lastName: tag, phone: '+447700900123' })
    const value = field === 'phone' ? '+44 7700 900123' : patient[field]!.toLowerCase()
    const response = await read(`${base}?search=${encodeURIComponent(value)}`)
    expect(response.status).toBe(200)
    expect(response.body.data.items.some((item: { id: string }) => item.id === patient.id)).toBe(true)
  })
  it.each(['%', '_', '\\', "' OR 1=1 --"])('does not interpret search as SQL/pattern: %s', async (value) => {
    const response = await read(`${base}?search=${encodeURIComponent(value)}`)
    expect(response.status).toBe(200)
    for (const item of response.body.data.items) {
      expect([item.firstName, item.middleName ?? '', item.lastName, item.patientNumber].some((field: string) => field.includes(value))).toBe(true)
    }
  })
  it('excludes archived patients by default and supports archived=true/all', async () => {
    const tag = `ArchiveFilter-${randomUUID()}`
    const active = await seed({ lastName: tag })
    const archived = await seed({ lastName: tag, archivedAt: new Date() })
    expect((await read(`${base}?search=${tag}`)).body.data.items.map((item: { id: string }) => item.id)).toEqual([active.id])
    expect((await read(`${base}?search=${tag}&archived=true`)).body.data.items.map((item: { id: string }) => item.id)).toEqual([archived.id])
    expect((await read(`${base}?search=${tag}&archived=all`)).body.data.items).toHaveLength(2)
    expect((await read(`${base}/${archived.id}`)).status).toBe(200)
  })
  it.each(['limit=101', 'page=0', 'page=1&page=2', 'archived=yes', 'sort=phone', 'email=private@example.test', 'search[x]=injected'])('rejects unvalidated list input: %s', async (query) => {
    expect((await read(`${base}?${query}`)).status).toBe(400)
  })
  it('audits detail views but never emits per-result list audits or copies search terms', async () => {
    const patient = await seed()
    const response = await read(`${base}?search=${patient.patientNumber}`).set('X-Request-Id', 'patient-list-no-audit')
    expect(response.status).toBe(200)
    expect(await db.auditEvent.count({ where: { requestId: 'patient-list-no-audit' } })).toBe(0)
    expect(logs).not.toContain(patient.patientNumber)
  })
  it('distinguishes a missing patient from invalid UUID without exposing DB details', async () => {
    expect((await read(`${base}/invalid-uuid`)).status).toBe(400)
    const response = await read(`${base}/${randomUUID()}`)
    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('PATIENT_NOT_FOUND')
  })
})

describe('demographic updates and archival history', () => {
  it('updates only supplied fields and supports clearing optional demographics', async () => {
    const patient = await seed()
    const response = await send('patch', `${base}/${patient.id}`, { firstName: 'New Name', middleName: '', phone: null, dateOfBirth: null })
    expect(response.status).toBe(200)
    expect(response.body.data.patient).toMatchObject({ firstName: 'New Name', lastName: patient.lastName, patientNumber: patient.patientNumber,
      middleName: null, dateOfBirth: null, phone: null, createdAt: patient.createdAt.toISOString() })
    const stored = await db.patient.findUniqueOrThrow({ where: { id: patient.id } })
    expect(stored.createdById).toBe(patient.createdById)
    expect(stored.updatedAt.getTime()).toBeGreaterThanOrEqual(patient.updatedAt.getTime())
  })
  it.each(['id', 'patientNumber', 'createdBy', 'createdById', 'createdAt', 'updatedAt', 'archivedAt', 'encounters', 'email'])('rejects PATCH immutable/unmodeled field: %s', async (field) => {
    const patient = await seed()
    expect((await send('patch', `${base}/${patient.id}`, { [field]: 'injected' })).status).toBe(400)
  })
  it.each([{}, { dateOfBirth: '2001-02-29' }, { phone: 'invalid' }, { firstName: { set: 'Injected' } }])('rejects empty/invalid PATCH %j', async (body) => {
    const patient = await seed()
    expect((await send('patch', `${base}/${patient.id}`, body)).status).toBe(400)
  })
  it('rejects DOB after the original registration date with a safe error', async () => {
    const patient = await seed({ createdAt: new Date('2000-01-01T00:00:00Z') })
    const response = await send('patch', `${base}/${patient.id}`, { dateOfBirth: '2000-01-02' })
    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('INVALID_PATIENT_DATA')
  })
  it('checks duplicates using the merged update and excludes the current patient', async () => {
    const original = await seed()
    const other = await seed({ lastName: `${original.lastName}-other` })
    expect((await send('patch', `${base}/${original.id}`, { phone: '+233 24 1234567' })).status).toBe(200)
    expect((await send('patch', `${base}/${other.id}`, { lastName: original.lastName })).body.error.code).toBe('POSSIBLE_DUPLICATE_PATIENT')
  })
  it('preserves both independent concurrent patches', async () => {
    const patient = await seed()
    const responses = await Promise.all([send('patch', `${base}/${patient.id}`, { firstName: 'Concurrent' }),
      send('patch', `${base}/${patient.id}`, { phone: '+12125550123' })])
    expect(responses.map((response) => response.status)).toEqual([200, 200])
    expect(await db.patient.findUniqueOrThrow({ where: { id: patient.id } })).toMatchObject({ firstName: 'Concurrent', phone: '+12125550123' })
  })
  it('archives idempotently without deleting patient, appointment or encounter history', async () => {
    const patient = await seed()
    const appointment = await db.appointment.create({ data: { patientId: patient.id, createdById: actor().staffId,
      type: 'CONSULTATION', scheduledStart: new Date('2030-01-01T10:00:00Z'), scheduledEnd: new Date('2030-01-01T11:00:00Z') } })
    const encounter = await db.encounter.create({ data: { patientId: patient.id, appointmentId: appointment.id, createdById: actor().staffId, clinicalNotes: 'Synthetic clinical content' } })
    const first = await send('post', `${base}/${patient.id}/archive`)
    const second = await send('post', `${base}/${patient.id}/archive`, {})
    expect(first.status).toBe(200)
    expect(second.body.data.patient).toEqual(first.body.data.patient)
    expect(await db.auditEvent.count({ where: { entityId: patient.id, action: 'PATIENT_ARCHIVED' } })).toBe(1)
    expect(await db.appointment.findUnique({ where: { id: appointment.id } })).not.toBeNull()
    expect(await db.encounter.findUnique({ where: { id: encounter.id } })).not.toBeNull()
    const detail = await read(`${base}/${patient.id}`)
    assertDto(detail.body.data.patient)
    expect(detail.text).not.toContain('Synthetic clinical content')
    expect((await send('patch', `${base}/${patient.id}`, { firstName: 'Blocked' })).body.error.code).toBe('PATIENT_ARCHIVED')
    const restored = await send('post', `${base}/${patient.id}/reactivate`)
    const again = await send('post', `${base}/${patient.id}/reactivate`)
    expect(restored.body.data.patient.id).toBe(patient.id)
    expect(again.body.data.patient).toEqual(restored.body.data.patient)
    expect(await db.auditEvent.count({ where: { entityId: patient.id, action: 'PATIENT_REACTIVATED' } })).toBe(1)
  })
  it.each(['update', 'archive', 'reactivate'] as const)('returns PATIENT_NOT_FOUND on missing %s target', async (operation) => {
    const response = await send(operation === 'update' ? 'patch' : 'post', `${base}/${randomUUID()}${operation === 'update' ? '' : `/${operation}`}`,
      operation === 'update' ? { firstName: 'Synthetic' } : {})
    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('PATIENT_NOT_FOUND')
  })
  it('rejects physical deletion and arbitrary command bodies', async () => {
    const patient = await seed()
    expect((await send('delete', `${base}/${patient.id}`)).status).toBe(404)
    expect((await send('post', `${base}/${patient.id}/archive`, { archivedAt: '2000-01-01' })).status).toBe(400)
    expect(await db.patient.findUnique({ where: { id: patient.id } })).not.toBeNull()
  })
})

describe('patient CSRF, atomicity and privacy', () => {
  it.each(['create', 'update', 'archive', 'reactivate'] as const)('requires session-bound CSRF for %s', async (operation) => {
    const patient = await seed()
    const path = operation === 'create' ? base : `${base}/${patient.id}${operation === 'update' ? '' : `/${operation}`}`
    for (const token of ['', 'invalid', actor('DOCTOR_IN_CHARGE').csrf]) {
      const response = await request(app)[operation === 'update' ? 'patch' : 'post'](path)
        .set('Cookie', actor().cookie).set('Origin', env.CLIENT_ORIGIN).set('X-CSRF-Token', token).send(input())
      expect(response.status).toBe(403)
      expect(response.body.error.code).toBe('CSRF_INVALID')
    }
  })
  it('rejects untrusted origins even with valid cookies and CSRF', async () => {
    const response = await send('post', base, input()).set('Origin', 'https://attacker.example')
    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('ORIGIN_NOT_ALLOWED')
  })
  it.each(['create', 'update', 'archive', 'reactivate', 'view'] as const)('fails closed and rolls back %s when audit insertion fails', async (operation) => {
    const patient = await seed({ archivedAt: operation === 'reactivate' ? new Date() : null })
    const data = input()
    const count = await db.patient.count()
    const response = await (operation === 'view' ? read(`${base}/${patient.id}`)
      : send(operation === 'update' ? 'patch' : 'post', operation === 'create' ? base : `${base}/${patient.id}${operation === 'update' ? '' : `/${operation}`}`,
        operation === 'create' ? data : operation === 'update' ? { firstName: 'RolledBack' } : {})).set('X-Request-Id', 'fail-patient-audit')
    expect(response.status).toBe(500)
    expect(response.body.error).toEqual({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', requestId: 'fail-patient-audit' })
    expect(response.body).not.toHaveProperty('data')
    expect(await db.patient.count()).toBe(count)
    expect(await db.patient.findUniqueOrThrow({ where: { id: patient.id } })).toEqual(patient)
    expect(logs).not.toContain('private patient SQL details')
  })
  it('rechecks the actor after waiting for the patient mutation lock', async () => {
    const credentials = await newActor('RECORDS_OFFICER')
    let unlock: (() => void) | undefined
    let ready: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { unlock = resolve })
    const locked = new Promise<void>((resolve) => { ready = resolve })
    const blocker = db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(1296385106, 2)`
      ready!()
      await gate
      // Deliberate test-only direct write. Production revocation also obtains
      // the exclusive auth lock, which these patient transactions cooperate with.
      await tx.staffSession.update({ where: { id: credentials.sessionId }, data: { revokedAt: new Date() } })
    })
    await locked
    const pending = send('post', base, input(), credentials).then((result) => result)
    try {
      const deadline = Date.now() + 2000
      let waiting = false
      while (!waiting && Date.now() < deadline) {
        const rows = await db.$queryRaw<Array<{ waiting: boolean }>>`SELECT EXISTS
          (SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event = 'advisory') AS waiting`
        waiting = rows[0]!.waiting
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 20))
      }
      expect(waiting).toBe(true)
    } finally { unlock!() }
    await blocker
    expect((await pending).status).toBe(401)
  })
  it('keeps patient bodies, search strings, DOB, phone and clinical data out of logs and audit metadata', async () => {
    const data = { ...input(), firstName: 'PrivatePatientName', phone: '+233209876543' }
    const created = await send('post', base, data).set('X-Request-Id', 'patient-privacy-create')
    expect(created.status).toBe(201)
    await read(`${base}?search=${encodeURIComponent(data.phone)}`)
    await read(`${base}/${created.body.data.patient.id}`)
    const events = await db.auditEvent.findMany({ where: { entityId: created.body.data.patient.id } })
    const serialized = JSON.stringify(events)
    for (const secret of [data.firstName, data.lastName, data.phone, data.dateOfBirth]) {
      expect(logs).not.toContain(secret)
      expect(serialized).not.toContain(secret)
    }
    expect(created.body.data.patient).not.toHaveProperty('createdById')
  })
  it('returns safe malformed JSON and internal errors with request IDs', async () => {
    const malformed = await request(app).post(base).set('Cookie', actor().cookie).set('Origin', env.CLIENT_ORIGIN)
      .set('X-CSRF-Token', actor().csrf).set('Content-Type', 'application/json').send('{')
    expect(malformed.body.error.code).toBe('INVALID_JSON')
    const spy = vi.spyOn(db.patient, 'findMany').mockRejectedValueOnce(new Error('private Prisma SQL stack'))
    try {
      const response = await read(base).set('X-Request-Id', 'patient-error-id')
      expect(response.status).toBe(500)
      expect(response.body.error).toEqual({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', requestId: 'patient-error-id' })
      expect(response.headers['x-request-id']).toBe('patient-error-id')
      expect(response.text).not.toMatch(/Prisma|SQL|stack/)
    } finally { spy.mockRestore() }
  })
})
