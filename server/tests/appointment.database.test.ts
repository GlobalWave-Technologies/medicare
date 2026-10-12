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

const db = testDatabase(), env = isolatedTestEnvironment(), base = '/api/v1/appointments'
type Actor = { id: string; cookie: string; csrf: string; sessionId: string }
const actors = new Map<StaffRole, Actor>()
let hash: string, logs = ''
let app: ReturnType<typeof createApp>
let slot = 0
const actor = (role: StaffRole = 'ADMIN') => actors.get(role)!
async function newActor(role: StaffRole = 'DOCTOR_IN_CHARGE'): Promise<Actor> {
  const user = await db.staffUser.create({ data: { firstName: 'Synthetic', lastName: 'Scheduling', email: `${randomUUID()}@example.test`,
    role, status: 'ACTIVE', passwordHash: hash, passwordChangedAt: new Date() } })
  const session = await db.$transaction((tx) => createSession(tx, user.id))
  return { id: user.id, cookie: `medicare_session=${session.token}`, csrf: session.session.csrfToken, sessionId: session.session.id }
}
async function patient() {
  return db.patient.create({ data: { firstName: 'Synthetic', middleName: 'Middle', lastName: `Appointment-${randomUUID()}`, createdById: actor().id } })
}
function times(offset = 86400000 + ++slot * 3600000) {
  const start = Date.now() + offset
  return { scheduledStart: new Date(start).toISOString(), scheduledEnd: new Date(start + 1800000).toISOString() }
}
async function input() {
  return { patientId: (await patient()).id, clinicianId: actor('DOCTOR_IN_CHARGE').id, ...times(), type: 'CONSULTATION' as const,
    reason: 'Sensitive reason', notes: 'Sensitive appointment notes' }
}
async function seed(overrides: Partial<Prisma.AppointmentUncheckedCreateInput> = {}) {
  const body = await input()
  return db.appointment.create({ data: { ...body, createdById: actor().id, ...overrides } })
}
function send(method: 'post' | 'patch' | 'delete', path: string, body?: object, who = actor()) {
  const call = request(app)[method](path).set('Cookie', who.cookie).set('Origin', env.CLIENT_ORIGIN).set('X-CSRF-Token', who.csrf)
  return body ? call.send(body) : call
}
const read = (path: string, who = actor()) => request(app).get(path).set('Cookie', who.cookie)
function dto(value: Record<string, unknown>) {
  expect(Object.keys(value).sort()).toEqual(['id', 'reference', 'patient', 'clinician', 'scheduledStart', 'scheduledEnd', 'type', 'status',
    'reason', 'notes', 'cancelledAt', 'cancellationReason', 'createdAt', 'updatedAt'].sort())
  expect(Object.keys(value.patient as object).sort()).toEqual(['id', 'patientNumber', 'firstName', 'middleName', 'lastName'].sort())
  if (value.clinician) expect(Object.keys(value.clinician as object).sort()).toEqual(['id', 'staffNumber', 'firstName', 'lastName'].sort())
}
async function audited(response: request.Response, action: string, id: string, who = actor()) {
  const events = await db.auditEvent.findMany({ where: { requestId: response.headers['x-request-id'] } })
  expect(events).toHaveLength(1)
  expect(events[0]).toMatchObject({ action, actorId: who.id, entityId: id, entityType: 'APPOINTMENT' })
  expect(events[0]!.ipAddress).not.toBeNull()
  expect(JSON.stringify(events[0]!.metadata)).not.toMatch(/Sensitive|Synthetic|Appointment-/)
}

beforeAll(async () => {
  hash = await hashPassword('Synthetic appointment test passphrase')
  for (const role of ['ADMIN', 'RECORDS_OFFICER', 'DOCTOR_IN_CHARGE'] as const) actors.set(role, await newActor(role))
  await db.$executeRawUnsafe(`CREATE FUNCTION test_reject_appointment_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW."requestId" = 'fail-appointment-audit' THEN RAISE EXCEPTION 'private appointment SQL'; END IF; RETURN NEW; END $$`)
  await db.$executeRawUnsafe(`CREATE TRIGGER test_appointment_audit_failure BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION test_reject_appointment_audit()`)
})
beforeEach(() => {
  logs = ''
  app = createApp({ env, prisma: db, checkDatabase: async () => {}, logger: createLogger('info', new Writable({
    write(chunk: Buffer, _encoding, callback) { logs += chunk.toString(); callback() },
  })) })
})
afterAll(disconnectDatabase)

describe('appointment authorization and visibility', () => {
  const id = randomUUID()
  it.each([['get', base], ['get', `${base}/${id}`], ['post', base], ['patch', `${base}/${id}`], ['patch', `${base}/${id}/status`], ['post', `${base}/${id}/cancel`]] as const)(
    'requires authentication %s %s', async (method, path) => expect((await request(app)[method](path)).status).toBe(401))
  it.each(['ADMIN', 'RECORDS_OFFICER'] as const)('%s can create/update/cancel and read', async (role) => {
    const who = actor(role), body = await input()
    const created = await send('post', base, body, who)
    expect(created.status).toBe(201)
    const value = created.body.data.appointment
    dto(value)
    expect(value.status).toBe('SCHEDULED')
    expect(value.reference).toMatch(/^AP-[0-9A-F-]{36}$/)
    expect((await db.appointment.findUniqueOrThrow({ where: { id: value.id } })).createdById).toBe(who.id)
    await audited(created, 'APPOINTMENT_CREATED', value.id, who)
    expect((await read(`${base}?patientId=${body.patientId}`, who)).body.data.items).toHaveLength(1)
    const detail = await read(`${base}/${value.id}`, who)
    expect(detail.status).toBe(200)
    await audited(detail, 'APPOINTMENT_VIEWED', value.id, who)
    const updated = await send('patch', `${base}/${value.id}`, { notes: 'Changed', ...times() }, who)
    expect(updated.status).toBe(200)
    await audited(updated, 'APPOINTMENT_UPDATED', value.id, who)
    const cancelled = await send('post', `${base}/${value.id}/cancel`, { reason: '  No longer needed  ' }, who)
    expect(cancelled.status).toBe(200)
    expect(cancelled.body.data.appointment.cancellationReason).toBe('No longer needed')
    await audited(cancelled, 'APPOINTMENT_CANCELLED', value.id, who)
  })
  it.each(['create', 'update', 'cancel'])('doctor cannot %s with spoofed claims', async (operation) => {
    const value = await seed()
    const path = operation === 'create' ? base : `${base}/${value.id}${operation === 'cancel' ? '/cancel' : ''}`
    const response = await send(operation === 'update' ? 'patch' : 'post', `${path}?role=ADMIN`, { role: 'ADMIN' }, actor('DOCTOR_IN_CHARGE')).set('X-Role', 'ADMIN')
    expect(response.status).toBe(403)
  })
  it('enforces own assignment on list/detail/status, including hostile clinician filters', async () => {
    const doctor = actor('DOCTOR_IN_CHARGE'), other = await newActor()
    const own = await seed(), foreign = await seed({ clinicianId: other.id })
    expect((await read(`${base}?patientId=${own.patientId}`, doctor)).body.data.items.map((v: { id: string }) => v.id)).toEqual([own.id])
    expect((await read(`${base}?clinicianId=${other.id}`, doctor)).body.data.items).toEqual([])
    expect((await read(`${base}?patientId=${foreign.patientId}`, doctor)).body.data.items).toEqual([])
    expect((await read(`${base}/${foreign.id}`, doctor)).status).toBe(404)
    expect((await send('patch', `${base}/${foreign.id}/status`, { status: 'CONFIRMED' }, doctor)).status).toBe(404)
    expect((await read(`${base}/${own.id}`, doctor)).status).toBe(200)
    const status = await send('patch', `${base}/${own.id}/status`, { status: 'CONFIRMED' }, doctor)
    expect(status.status).toBe(200)
    await audited(status, 'APPOINTMENT_STATUS_CHANGED', own.id, doctor)
  })
  it.each(['SUSPENDED', 'DISABLED', 'PENDING', 'revoked', 'expired'] as const)('rejects %s sessions', async (state) => {
    const who = await newActor('ADMIN')
    if (state === 'revoked') await db.staffSession.update({ where: { id: who.sessionId }, data: { revokedAt: new Date() } })
    else if (state === 'expired') await db.staffSession.update({ where: { id: who.sessionId }, data: { expiresAt: new Date(Date.now() - 1000), createdAt: new Date(Date.now() - 60000) } })
    else await db.staffUser.update({ where: { id: who.id }, data: { status: state } })
    expect((await read(base, who)).status).toBe(401)
    expect((await send('post', base, await input(), who)).status).toBe(401)
  })
})

describe('appointment registration and scheduling', () => {
  it.each(['reference', 'appointmentReference', 'id', 'createdById', 'status', 'cancelledAt', 'cancelledById', 'cancellationReason', 'createdAt', 'updatedAt', 'patient', 'clinician', 'encounter'])(
    'rejects injected creation field %s', async (key) => expect((await send('post', base, { ...await input(), [key]: 'injected' })).status).toBe(400))
  it.each(['missingPatient', 'archivedPatient', 'missingClinician', 'inactiveClinician', 'adminClinician', 'recordsClinician'] as const)(
    'rejects invalid assignment %s', async (kind) => {
      const body = await input()
      const errors = { missingPatient: 'PATIENT_NOT_FOUND', archivedPatient: 'PATIENT_ARCHIVED', missingClinician: 'CLINICIAN_NOT_FOUND',
        inactiveClinician: 'CLINICIAN_NOT_ACTIVE', adminClinician: 'INVALID_CLINICIAN_ROLE', recordsClinician: 'INVALID_CLINICIAN_ROLE' }
      if (kind === 'missingPatient') body.patientId = randomUUID()
      if (kind === 'archivedPatient') await db.patient.update({ where: { id: body.patientId }, data: { archivedAt: new Date() } })
      if (kind === 'missingClinician') body.clinicianId = randomUUID()
      if (kind === 'inactiveClinician') {
        const clinician = await newActor()
        await db.staffUser.update({ where: { id: clinician.id }, data: { status: 'SUSPENDED' } })
        body.clinicianId = clinician.id
      }
      if (kind === 'adminClinician') body.clinicianId = actor().id
      if (kind === 'recordsClinician') body.clinicianId = actor('RECORDS_OFFICER').id
      expect((await send('post', base, body)).body.error.code).toBe(errors[kind])
    })
  it.each(['zero', 'reverse', 'tooShort', 'tooLong', 'past', 'noZone'] as const)('rejects invalid schedule %s', async (kind) => {
    const body = await input(), start = Date.parse(body.scheduledStart)
    if (kind === 'zero') body.scheduledEnd = body.scheduledStart
    if (kind === 'reverse') body.scheduledEnd = new Date(start - 1000).toISOString()
    if (kind === 'tooShort') body.scheduledEnd = new Date(start + 60000).toISOString()
    if (kind === 'tooLong') body.scheduledEnd = new Date(start + 13 * 3600000).toISOString()
    if (kind === 'past') Object.assign(body, times(-3600000))
    if (kind === 'noZone') body.scheduledStart = body.scheduledStart.replace('Z', '')
    const response = await send('post', base, body)
    expect(response.body.error.code).toBe(kind === 'past' ? 'APPOINTMENT_IN_PAST' : kind === 'noZone' ? 'VALIDATION_ERROR' : 'INVALID_APPOINTMENT_TIME')
  })
  it('normalizes offsets to UTC with optional fields cleared', async () => {
    const body = await input()
    const start = new Date(Date.parse(body.scheduledStart) + 2 * 3600000).toISOString().replace('Z', '+02:00')
    const response = await send('post', base, { ...body, scheduledStart: start, notes: ' ', reason: null })
    expect(response.status).toBe(201)
    expect(response.body.data.appointment).toMatchObject({ scheduledStart: body.scheduledStart, notes: null, reason: null })
  })
  it('generates unique references for simultaneous distinct bookings', async () => {
    const bodies = await Promise.all(Array.from({ length: 6 }, input))
    const responses = await Promise.all(bodies.map((body) => send('post', base, body)))
    expect(responses.map((r) => r.status)).toEqual(Array(6).fill(201))
    expect(new Set(responses.map((r) => r.body.data.appointment.reference)).size).toBe(6)
  })
  it.each(['clinician', 'patient'] as const)('database rejects concurrent overlapping %s bookings', async (kind) => {
    const a = await input(), b = await input()
    Object.assign(b, { scheduledStart: a.scheduledStart, scheduledEnd: a.scheduledEnd })
    if (kind === 'patient') { b.patientId = a.patientId; b.clinicianId = (await newActor()).id }
    const responses = await Promise.all([send('post', base, a), send('post', base, b)])
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409])
    const rejected = responses.find((r) => r.status === 409)!
    expect(rejected.body.error.code).toBe('APPOINTMENT_CONFLICT')
    expect(JSON.stringify(rejected.body)).not.toMatch(/constraint|gist|Synthetic|Sensitive|23P01/)
    expect(await db.auditEvent.count({ where: { requestId: rejected.headers['x-request-id'] } })).toBe(0)
  })
  it('permits adjacent intervals for both the same patient and doctor', async () => {
    const body = await input()
    expect((await send('post', base, body)).status).toBe(201)
    expect((await send('post', base, { ...body, scheduledStart: body.scheduledEnd,
      scheduledEnd: new Date(Date.parse(body.scheduledEnd) + 1800000).toISOString() })).status).toBe(201)
  })
  it.each(['SCHEDULED', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'NO_SHOW', 'CANCELLED'] as const)(
    '%s blocking policy applies to direct database writes', async (status) => {
      const existing = await seed({ status, ...(status === 'CANCELLED' ? { cancelledAt: new Date(), cancelledById: actor().id } : {}) })
      const body = { patientId: existing.patientId, clinicianId: existing.clinicianId!, type: existing.type,
        scheduledStart: existing.scheduledStart.toISOString(), scheduledEnd: existing.scheduledEnd.toISOString() }
      const response = await send('post', base, body)
      expect(response.status).toBe(['SCHEDULED', 'CONFIRMED', 'CHECKED_IN'].includes(status) ? 409 : 201)
    })
  it('enforces the exclusion constraint outside the API', async () => {
    const value = await seed()
    await expect(db.appointment.create({ data: { patientId: value.patientId, clinicianId: value.clinicianId,
      type: value.type, scheduledStart: value.scheduledStart, scheduledEnd: value.scheduledEnd, createdById: actor().id } })).rejects.toThrow()
  })
})

describe('appointment listing and detail', () => {
  it('paginates with deterministic ties and bounded fields', async () => {
    const start = times(), clinician = await newActor()
    const ids = [randomUUID(), randomUUID(), randomUUID()].sort()
    for (const id of ids) await seed({ id, ...start, clinicianId: clinician.id, status: 'COMPLETED' })
    const response = await read(`${base}?clinicianId=${clinician.id}&page=2&limit=2`)
    expect(response.status).toBe(200)
    expect(response.body.data.pagination).toEqual({ page: 2, limit: 2, total: 3, totalPages: 2 })
    expect(response.body.data.items.map((v: { id: string }) => v.id)).toEqual([ids[2]])
    dto(response.body.data.items[0])
    const empty = await read(`${base}?clinicianId=${clinician.id}&page=5&limit=2`)
    expect(empty.body.data.items).toEqual([])
    expect(await db.auditEvent.count({ where: { requestId: response.headers['x-request-id'] } })).toBe(0)
  })
  it.each(['status', 'type', 'patientId', 'clinicianId', 'dateRange', 'reference', 'patientNumber', 'firstName', 'middleName', 'lastName'] as const)(
    'supports filter/search %s', async (filter) => {
      const clinician = await newActor(), p = await patient()
      const value = await seed({ clinicianId: clinician.id, patientId: p.id, type: 'FOLLOW_UP', status: 'CONFIRMED' })
      const query = new URLSearchParams({ clinicianId: clinician.id })
      if (filter === 'status') query.set('status', 'CONFIRMED')
      if (filter === 'type') query.set('type', 'FOLLOW_UP')
      if (filter === 'patientId') query.set('patientId', p.id)
      if (filter === 'dateRange') { query.set('dateFrom', value.scheduledStart.toISOString()); query.set('dateTo', value.scheduledStart.toISOString()) }
      if (filter === 'reference') query.set('search', value.reference.toLowerCase())
      if (['patientNumber', 'firstName', 'middleName', 'lastName'].includes(filter)) query.set('search', p[filter as 'patientNumber' | 'firstName' | 'middleName' | 'lastName']!)
      expect((await read(`${base}?${query}`)).body.data.items.map((v: { id: string }) => v.id)).toEqual([value.id])
    })
  it.each(['limit=101', 'page=0', 'status=ACTIVE', 'type=x', 'sort=notes', 'clinicianId=x', 'patientId=x', 'dateFrom=2030-01-01',
    'dateFrom=2031-01-01T00:00:00Z&dateTo=2030-01-01T00:00:00Z', 'where[status]=SCHEDULED'])(
    'rejects unsafe query %s', async (query) => expect((await read(`${base}?${query}`)).status).toBe(400))
  it.each(['%', '_', '\\'])('treats %s literally in search', async (literal) => {
    const clinician = await newActor(), p = await patient()
    await db.patient.update({ where: { id: p.id }, data: { firstName: `Literal${literal}Name` } })
    const value = await seed({ patientId: p.id, clinicianId: clinician.id })
    await seed({ clinicianId: clinician.id })
    expect((await read(`${base}?clinicianId=${clinician.id}&search=${encodeURIComponent(literal)}`)).body.data.items.map((v: { id: string }) => v.id)).toEqual([value.id])
  })
  it.each(['bad-id', randomUUID()])('rejects invalid or missing detail %s', async (id) => {
    const response = await read(`${base}/${id}`)
    expect(response.status).toBe(id === 'bad-id' ? 400 : 404)
    expect(response.body.error.requestId).toBe(response.headers['x-request-id'])
  })
  it('keeps archived/inactive/legacy unassigned records readable without encounters', async () => {
    const clinician = await newActor(), value = await seed({ clinicianId: clinician.id })
    await db.patient.update({ where: { id: value.patientId }, data: { archivedAt: new Date() } })
    await db.staffUser.update({ where: { id: clinician.id }, data: { status: 'DISABLED' } })
    await db.encounter.create({ data: { patientId: value.patientId, appointmentId: value.id, createdById: actor().id, clinicalNotes: 'Secret clinical content' } })
    const response = await read(`${base}/${value.id}`)
    expect(response.status).toBe(200)
    dto(response.body.data.appointment)
    expect(JSON.stringify(response.body)).not.toContain('Secret clinical content')
    const legacy = await seed({ clinicianId: null })
    expect((await read(`${base}/${legacy.id}`)).body.data.appointment.clinician).toBeNull()
  })
})

describe('rescheduling and lifecycle', () => {
  it.each(['patientId', 'reference', 'status', 'createdById', 'cancelledAt', 'cancelledById', 'cancellationReason', 'id', 'createdAt', 'updatedAt', 'encounter'])(
    'protects immutable PATCH field %s', async (key) => {
      const value = await seed()
      expect((await send('patch', `${base}/${value.id}`, { [key]: 'injected' })).status).toBe(400)
      expect(await db.appointment.findUniqueOrThrow({ where: { id: value.id } })).toEqual(value)
    })
  it('rejects empty PATCH and clears optional text without changing identity', async () => {
    const value = await seed()
    expect((await send('patch', `${base}/${value.id}`, {})).status).toBe(400)
    const response = await send('patch', `${base}/${value.id}`, { reason: '', notes: null, clinicianId: (await newActor()).id, type: 'FOLLOW_UP' })
    expect(response.status).toBe(200)
    expect(response.body.data.appointment).toMatchObject({ id: value.id, reference: value.reference, reason: null, notes: null, type: 'FOLLOW_UP' })
    expect((await db.appointment.findUniqueOrThrow({ where: { id: value.id } })).createdById).toBe(value.createdById)
  })
  it.each(['CHECKED_IN', 'COMPLETED', 'NO_SHOW', 'CANCELLED'] as const)('does not rewrite %s appointments', async (status) => {
    const value = await seed({ status, ...(status === 'CANCELLED' ? { cancelledAt: new Date(), cancelledById: actor().id } : {}) })
    expect((await send('patch', `${base}/${value.id}`, { notes: 'change' })).body.error.code).toBe('APPOINTMENT_NOT_EDITABLE')
  })
  it.each(['archived', 'inactive', 'roleChanged'] as const)('rechecks %s assignment on reschedule', async (kind) => {
    const doctor = await newActor(), value = await seed({ clinicianId: doctor.id })
    if (kind === 'archived') await db.patient.update({ where: { id: value.patientId }, data: { archivedAt: new Date() } })
    else await db.staffUser.update({ where: { id: doctor.id }, data: kind === 'inactive' ? { status: 'SUSPENDED' } : { role: 'ADMIN' } })
    const response = await send('patch', `${base}/${value.id}`, times())
    expect(response.body.error.code).toBe(kind === 'archived' ? 'PATIENT_ARCHIVED' : kind === 'inactive' ? 'CLINICIAN_NOT_ACTIVE' : 'INVALID_CLINICIAN_ROLE')
    expect((await read(`${base}/${value.id}`)).status).toBe(200)
    expect((await db.appointment.findUniqueOrThrow({ where: { id: value.id } })).clinicianId).toBe(doctor.id)
  })
  it('rejects overlapping reschedule and serializes concurrent moves', async () => {
    const a = await seed(), b = await seed(), target = times()
    expect((await send('patch', `${base}/${b.id}`, { scheduledStart: a.scheduledStart.toISOString(), scheduledEnd: a.scheduledEnd.toISOString() })).body.error.code).toBe('APPOINTMENT_CONFLICT')
    const responses = await Promise.all([send('patch', `${base}/${a.id}`, target), send('patch', `${base}/${b.id}`, target)])
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409])
  })
  it('preserves separate concurrent PATCH fields', async () => {
    const value = await seed()
    const responses = await Promise.all([send('patch', `${base}/${value.id}`, { notes: 'Notes changed' }), send('patch', `${base}/${value.id}`, { reason: 'Reason changed' })])
    expect(responses.map((r) => r.status)).toEqual([200, 200])
    expect(await db.appointment.findUniqueOrThrow({ where: { id: value.id } })).toMatchObject({ notes: 'Notes changed', reason: 'Reason changed' })
  })
  it.each(['ADMIN', 'RECORDS_OFFICER', 'DOCTOR_IN_CHARGE'] as const)('%s follows the lifecycle without creating an encounter', async (role) => {
    const doctor = role === 'DOCTOR_IN_CHARGE' ? actor(role) : await newActor()
    const value = await seed({ clinicianId: doctor.id, ...times(-60000) })
    for (const status of ['CONFIRMED', 'CHECKED_IN', 'COMPLETED']) {
      const response = await send('patch', `${base}/${value.id}/status`, { status }, actor(role))
      expect(response.status).toBe(200)
      expect(response.body.data.appointment.status).toBe(status)
      await audited(response, 'APPOINTMENT_STATUS_CHANGED', value.id, actor(role))
    }
    expect(await db.encounter.count({ where: { appointmentId: value.id } })).toBe(0)
  })
  it.each([['SCHEDULED', 'COMPLETED'], ['SCHEDULED', 'CHECKED_IN'], ['CONFIRMED', 'CONFIRMED'], ['CHECKED_IN', 'CONFIRMED'],
    ['COMPLETED', 'CONFIRMED'], ['CANCELLED', 'CONFIRMED'], ['NO_SHOW', 'CHECKED_IN']] as const)(
    'rejects %s -> %s', async (from, to) => {
      const value = await seed({ status: from, ...(from === 'CANCELLED' ? { cancelledAt: new Date(), cancelledById: actor().id } : {}) })
      expect((await send('patch', `${base}/${value.id}/status`, { status: to })).body.error.code).toBe('INVALID_APPOINTMENT_STATUS_TRANSITION')
    })
  it.each(['SCHEDULED', 'CONFIRMED'] as const)('permits %s no-show only once the start is reached', async (status) => {
    const future = await seed({ status })
    expect((await send('patch', `${base}/${future.id}/status`, { status: 'NO_SHOW' })).status).toBe(409)
    const past = await seed({ status, clinicianId: (await newActor()).id, ...times(-3600000) })
    expect((await send('patch', `${base}/${past.id}/status`, { status: 'NO_SHOW' })).status).toBe(200)
  })
  it('enforces the 60 minute early check-in window', async () => {
    const early = await seed({ status: 'CONFIRMED' })
    expect((await send('patch', `${base}/${early.id}/status`, { status: 'CHECKED_IN' })).status).toBe(409)
    const near = await seed({ status: 'CONFIRMED', clinicianId: (await newActor()).id, ...times(1800000) })
    expect((await send('patch', `${base}/${near.id}/status`, { status: 'CHECKED_IN' })).status).toBe(200)
  })
  it('status endpoint cannot bypass cancellation permission', async () => {
    const value = await seed()
    expect((await send('patch', `${base}/${value.id}/status`, { status: 'CANCELLED' }, actor('DOCTOR_IN_CHARGE'))).status).toBe(400)
  })
  it('cancellation is idempotent, preserves attribution and releases both slots', async () => {
    const value = await seed(), before = Date.now()
    const first = await send('post', `${base}/${value.id}/cancel`, { reason: 'Original reason' })
    const saved = await db.appointment.findUniqueOrThrow({ where: { id: value.id } })
    expect(saved.cancelledAt!.getTime()).toBeGreaterThanOrEqual(before)
    expect(saved.cancelledById).toBe(actor().id)
    const second = await send('post', `${base}/${value.id}/cancel`, { reason: 'Replacement reason' })
    expect(second.status).toBe(200)
    expect(second.body.data.appointment).toEqual(first.body.data.appointment)
    expect(await db.auditEvent.count({ where: { entityId: value.id, action: 'APPOINTMENT_CANCELLED' } })).toBe(1)
    expect((await send('post', base, { patientId: value.patientId, clinicianId: value.clinicianId, scheduledStart: value.scheduledStart.toISOString(),
      scheduledEnd: value.scheduledEnd.toISOString(), type: value.type })).status).toBe(201)
  })
  it.each(['CHECKED_IN', 'COMPLETED', 'NO_SHOW'] as const)('cannot cancel %s', async (status) => {
    const value = await seed({ status })
    expect((await send('post', `${base}/${value.id}/cancel`, {})).status).toBe(409)
  })
  it('concurrent status commands cannot overwrite a completed transition', async () => {
    const value = await seed()
    const responses = await Promise.all([send('patch', `${base}/${value.id}/status`, { status: 'CONFIRMED' }), send('patch', `${base}/${value.id}/status`, { status: 'CONFIRMED' })])
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409])
    expect(await db.auditEvent.count({ where: { entityId: value.id, action: 'APPOINTMENT_STATUS_CHANGED' } })).toBe(1)
  })
})

describe('appointment security, audit and rollback', () => {
  it.each(['archived', 'revoked', 'roleChanged', 'clinicianInactive'] as const)('rechecks %s after a cooperating transaction commits', async (kind) => {
    const who = await newActor('RECORDS_OFFICER'), doctor = await newActor(), body = { ...await input(), clinicianId: doctor.id }
    let release!: () => void, ready!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const locked = new Promise<void>((resolve) => { ready = resolve })
    const blocker = db.$transaction(async (tx) => {
      if (kind === 'archived') await tx.$executeRaw`SELECT pg_advisory_xact_lock(1296385106, 2)`
      else await tx.$executeRaw`SELECT pg_advisory_xact_lock(1296385106, 1)`
      ready()
      await gate
      if (kind === 'archived') await tx.patient.update({ where: { id: body.patientId }, data: { archivedAt: new Date() } })
      if (kind === 'revoked') await tx.staffSession.update({ where: { id: who.sessionId }, data: { revokedAt: new Date() } })
      if (kind === 'roleChanged') await tx.staffUser.update({ where: { id: who.id }, data: { role: 'DOCTOR_IN_CHARGE' } })
      if (kind === 'clinicianInactive') await tx.staffUser.update({ where: { id: doctor.id }, data: { status: 'SUSPENDED' } })
    })
    await locked
    const pending = send('post', base, body, who).then((response) => response)
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
    } finally { release() }
    await blocker
    const response = await pending
    expect(response.body.error.code).toBe({ archived: 'PATIENT_ARCHIVED', revoked: 'AUTHENTICATION_REQUIRED',
      roleChanged: 'FORBIDDEN', clinicianInactive: 'CLINICIAN_NOT_ACTIVE' }[kind])
    expect(await db.appointment.count({ where: { patientId: body.patientId } })).toBe(0)
  })
  it.each(['create', 'update', 'status', 'cancel'] as const)('requires session-bound CSRF and Origin for %s', async (operation) => {
    const value = await seed(), who = actor()
    const path = operation === 'create' ? base : `${base}/${value.id}${operation === 'status' ? '/status' : operation === 'cancel' ? '/cancel' : ''}`
    const method = operation === 'create' || operation === 'cancel' ? 'post' : 'patch'
    const body = operation === 'create' ? await input() : operation === 'status' ? { status: 'CONFIRMED' } : { notes: 'change' }
    for (const token of [undefined, 'bad', actor('RECORDS_OFFICER').csrf]) {
      const call = request(app)[method](path).set('Cookie', who.cookie).set('Origin', env.CLIENT_ORIGIN)
      if (token) call.set('X-CSRF-Token', token)
      expect((await call.send(body)).body.error.code).toBe('CSRF_INVALID')
    }
    expect((await request(app)[method](path).set('Cookie', who.cookie).set('X-CSRF-Token', who.csrf).send(body)).body.error.code).toBe('ORIGIN_NOT_ALLOWED')
  })
  it.each(['create', 'update', 'status', 'cancel', 'view'] as const)('fails closed and rolls back when %s audit fails', async (operation) => {
    const value = await seed(), body = await input()
    const path = operation === 'create' ? base : `${base}/${value.id}${operation === 'status' ? '/status' : operation === 'cancel' ? '/cancel' : ''}`
    const call = operation === 'view' ? read(path) : send(operation === 'create' || operation === 'cancel' ? 'post' : 'patch', path,
      operation === 'create' ? body : operation === 'status' ? { status: 'CONFIRMED' } : operation === 'cancel' ? {} : { notes: 'Failed change' })
    const response = await call.set('X-Request-Id', 'fail-appointment-audit')
    expect(response.status).toBe(500)
    expect(response.body.error).toEqual({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', requestId: 'fail-appointment-audit' })
    expect(response.body.data).toBeUndefined()
    expect(await db.appointment.findUniqueOrThrow({ where: { id: value.id } })).toEqual(value)
    expect(await db.appointment.count({ where: { patientId: body.patientId } })).toBe(0)
  })
  it('omits bodies/search/notes from logs and returns generic database failures', async () => {
    const body = await input(), response = await send('post', base, body).set('X-Request-Id', 'appointment-privacy')
    expect(response.status).toBe(201)
    await read(`${base}?search=PrivateSearchContent`)
    expect(logs).not.toMatch(/Sensitive reason|Sensitive appointment notes|PrivateSearchContent/)
    const spy = vi.spyOn(db, '$transaction').mockRejectedValueOnce(new Error('private database SQL connection string'))
    const failed = await read(base).set('X-Request-Id', 'appointment-error')
    spy.mockRestore()
    expect(failed.status).toBe(500)
    expect(failed.body.error.requestId).toBe('appointment-error')
    expect(JSON.stringify(failed.body) + logs).not.toContain('private database SQL')
  })
  it.each(['update', 'status', 'cancel'] as const)('returns safe 404 for missing %s target', async (operation) => {
    const path = `${base}/${randomUUID()}${operation === 'status' ? '/status' : operation === 'cancel' ? '/cancel' : ''}`
    const response = await send(operation === 'cancel' ? 'post' : 'patch', path, operation === 'status' ? { status: 'CONFIRMED' } : operation === 'cancel' ? {} : { notes: 'change' })
    expect(response.body.error.code).toBe('APPOINTMENT_NOT_FOUND')
  })
  it('does not expose a DELETE endpoint', async () => {
    const value = await seed()
    expect((await send('delete', `${base}/${value.id}`)).status).toBe(404)
    expect(await db.appointment.findUnique({ where: { id: value.id } })).not.toBeNull()
  })
})
