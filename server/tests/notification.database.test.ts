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
import type { StaffRole, StaffStatus, NotificationType } from '../src/generated/prisma/client.js'

const db = testDatabase(), env = isolatedTestEnvironment(), base = '/api/v1/notifications', appointments = '/api/v1/appointments'
type Actor = { id: string; cookie: string; csrf: string; sessionId: string }
const actors = new Map<StaffRole, Actor>()
let hash: string, logs = '', slot = 0
let app: ReturnType<typeof createApp>
const actor = (role: StaffRole = 'ADMIN') => actors.get(role)!
async function newActor(role: StaffRole = 'DOCTOR_IN_CHARGE', status: StaffStatus = 'ACTIVE'): Promise<Actor> {
  const user = await db.staffUser.create({ data: { firstName: 'Synthetic', lastName: 'Notification', email: `${randomUUID()}@example.test`,
    role, status, passwordHash: hash, passwordChangedAt: new Date() } })
  const session = await db.$transaction((tx) => createSession(tx, user.id))
  return { id: user.id, cookie: `medicare_session=${session.token}`, csrf: session.session.csrfToken, sessionId: session.session.id }
}
const read = (path: string, who = actor()) => request(app).get(path).set('Cookie', who.cookie)
function send(path: string, body: object = {}, who = actor(), method: 'post' | 'patch' = 'post') {
  return request(app)[method](path).set('Cookie', who.cookie).set('Origin', env.CLIENT_ORIGIN).set('X-CSRF-Token', who.csrf).send(body)
}
const broadcast = (audience: object = { type: 'ALL' }) => ({ title: 'Synthetic operational notice', message: 'Private notification message', audience })
async function seed(who = actor(), type: NotificationType = 'DIRECT', others: Actor[] = [], createdAt = new Date()) {
  return db.notification.create({ data: { senderId: actor().id, type, targetRole: type === 'BROADCAST' ? 'ADMIN' : null,
    title: 'Synthetic notice', message: 'Private inbox message', createdAt,
    recipients: { create: [who, ...others].map((value) => ({ staffUserId: value.id, createdAt })) } }, include: { recipients: true } })
}
async function appointmentInput(who = actor('DOCTOR_IN_CHARGE')) {
  const patient = await db.patient.create({ data: { firstName: 'PrivatePatient', lastName: randomUUID(), phone: '+233241234567', createdById: actor().id } })
  const start = Date.now() + (++slot * 86400000)
  return { patientId: patient.id, clinicianId: who.id, scheduledStart: new Date(start).toISOString(),
    scheduledEnd: new Date(start + 1800000).toISOString(), type: 'CONSULTATION', reason: 'Private appointment reason', notes: 'Private appointment notes' }
}
async function booked(who = actor('DOCTOR_IN_CHARGE')) {
  const body = await appointmentInput(who), response = await send(appointments, body)
  expect(response.status).toBe(201)
  return { body, id: response.body.data.appointment.id as string }
}
const notices = (appointmentId: string) => db.notification.findMany({ where: { appointmentId }, include: { recipients: true }, orderBy: { createdAt: 'asc' } })
async function failure(flag: string, operation: () => Promise<void>) {
  await db.$executeRaw`INSERT INTO test_notification_failure VALUES (${flag})`
  try { await operation() } finally { await db.$executeRaw`DELETE FROM test_notification_failure WHERE flag = ${flag}` }
}
function dto(value: Record<string, unknown>) {
  expect(Object.keys(value).sort()).toEqual(['id', 'type', 'title', 'message', 'createdAt', 'readAt', 'target'].sort())
  expect(JSON.stringify(value)).not.toMatch(/senderId|staffUserId|recipientId|passwordHash|csrfToken|@example.test/)
}
beforeAll(async () => {
  hash = await hashPassword('Synthetic notification test passphrase')
  for (const role of ['ADMIN', 'RECORDS_OFFICER', 'DOCTOR_IN_CHARGE'] as const) actors.set(role, await newActor(role))
  await db.$executeRawUnsafe('CREATE TABLE test_notification_failure (flag text PRIMARY KEY)')
  await db.$executeRawUnsafe(`CREATE FUNCTION test_notification_failure_fn() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF EXISTS (SELECT 1 FROM test_notification_failure WHERE flag = TG_TABLE_NAME)
      THEN RAISE EXCEPTION 'private notification SQL'; END IF; RETURN NEW; END $$`)
  for (const table of ['Notification', 'NotificationRecipient', 'AuditEvent']) {
    await db.$executeRawUnsafe(`CREATE TRIGGER test_fail_notice BEFORE INSERT OR UPDATE ON "${table}" FOR EACH ROW EXECUTE FUNCTION test_notification_failure_fn()`)
  }
})
beforeEach(() => {
  logs = ''
  app = createApp({ env, prisma: db, checkDatabase: async () => {}, logger: createLogger('info', new Writable({
    write(chunk: Buffer, _encoding, callback) { logs += chunk.toString(); callback() },
  })) })
})
afterAll(disconnectDatabase)

describe('notification ownership and authorization', () => {
  const id = randomUUID()
  it.each([['get', base], ['get', `${base}/unread-count`], ['get', `${base}/${id}`], ['post', `${base}/${id}/read`],
    ['post', `${base}/read-all`], ['post', `${base}/broadcast`]] as const)('requires authentication for %s %s', async (method, path) => {
    expect((await request(app)[method](path)).status).toBe(401)
  })
  it.each(['ADMIN', 'RECORDS_OFFICER', 'DOCTOR_IN_CHARGE'] as const)('%s reads only its inbox and cannot bypass ownership', async (role) => {
    const who = actor(role), other = await newActor(), own = await seed(who), hidden = await seed(other)
    const response = await read(base, who)
    expect(response.status).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.body.data.items.map((v: { id: string }) => v.id)).toContain(own.id)
    expect(response.body.data.items.map((v: { id: string }) => v.id)).not.toContain(hidden.id)
    dto((await read(`${base}/${own.id}`, who)).body.data.notification)
    for (const target of [hidden.id, randomUUID()]) {
      expect((await read(`${base}/${target}`, who)).body.error.code).toBe('NOTIFICATION_NOT_FOUND')
      expect((await send(`${base}/${target}/read`, {}, who)).status).toBe(404)
    }
    expect((await db.notificationRecipient.findFirstOrThrow({ where: { notificationId: hidden.id } })).readAt).toBeNull()
  })
  it.each(['RECORDS_OFFICER', 'DOCTOR_IN_CHARGE'] as const)('denies broadcast to %s', async (role) => {
    expect((await send(`${base}/broadcast`, broadcast(), actor(role))).body.error.code).toBe('FORBIDDEN')
  })
  it.each(['PENDING', 'SUSPENDED', 'DISABLED', 'REVOKED', 'EXPIRED'] as const)('blocks %s sessions without removing stored history', async (state) => {
    const who = await newActor(), notice = await seed(who)
    if (state === 'REVOKED') await db.staffSession.update({ where: { id: who.sessionId }, data: { revokedAt: new Date() } })
    else if (state === 'EXPIRED') await db.staffSession.update({ where: { id: who.sessionId }, data: { expiresAt: new Date(Date.now() - 1) } })
    else await db.staffUser.update({ where: { id: who.id }, data: { status: state } })
    expect((await read(base, who)).status).toBe(401)
    expect((await send(`${base}/${notice.id}/read`, {}, who)).status).toBe(401)
    expect(await db.notificationRecipient.count({ where: { notificationId: notice.id } })).toBe(1)
  })
  it.each(['recipientId', 'staffUserId', 'where', 'orderBy'])('rejects inbox injection %s', async (key) => {
    expect((await read(`${base}?${key}=anything`)).status).toBe(400)
    expect((await read(`${base}/unread-count?${key}=anything`)).status).toBe(400)
    expect((await send(`${base}/read-all`, { [key]: randomUUID() })).status).toBe(400)
  })
  it.each(['invalid', '1234', 'AP-123'])('rejects invalid notification UUID %s', async (value) => {
    expect((await read(`${base}/${value}`)).status).toBe(400)
    expect((await send(`${base}/${value}/read`)).status).toBe(400)
  })
})

describe('inbox queries and read state', () => {
  it('paginates newest first with stable delivery-ID ties and safe DTOs', async () => {
    const who = await newActor(), time = new Date('2020-01-01T00:00:00Z')
    const first = await seed(who, 'DIRECT', [], time), second = await seed(who, 'DIRECT', [], time), newest = await seed(who)
    const expected = [newest.id, ...[first, second].sort((a, b) => a.recipients[0]!.id.localeCompare(b.recipients[0]!.id)).map((v) => v.id)]
    const a = await read(`${base}?limit=2`, who), b = await read(`${base}?limit=2&page=2`, who)
    expect([...a.body.data.items, ...b.body.data.items].map((v: { id: string }) => v.id)).toEqual(expected)
    expect(a.body.data.pagination).toEqual({ page: 1, limit: 2, total: 3, totalPages: 2 })
    a.body.data.items.forEach(dto)
    expect((await read(`${base}?page=3&limit=2`, who)).body.data.items).toEqual([])
  })
  it.each(['read=true', 'read=false', 'type=DIRECT', 'type=BROADCAST', 'read=false&type=BROADCAST'])('filters %s within the current inbox', async (query) => {
    const who = await newActor(), direct = await seed(who), shared = await seed(who, 'BROADCAST')
    await send(`${base}/${direct.id}/read`, {}, who)
    const response = await read(`${base}?${query}`, who)
    expect(response.body.data.items.map((v: { id: string }) => v.id)).toEqual([query === 'read=true' || query === 'type=DIRECT' ? direct.id : shared.id])
  })
  it.each(['limit=101', 'page=0', 'read=1', 'type=SYSTEM', 'read=true&read=false', 'limit[$gt]=0'])('rejects invalid query %s', async (query) => {
    expect((await read(`${base}?${query}`)).status).toBe(400)
  })
  it('counts only own unread deliveries and GET does not mark read or audit', async () => {
    const who = await newActor(), a = await seed(who), b = await seed(who)
    await seed(actor())
    const before = await db.auditEvent.count()
    expect((await read(`${base}/unread-count`, who)).body.data).toEqual({ count: 2 })
    await read(`${base}/${a.id}`, who)
    expect((await db.notificationRecipient.findFirstOrThrow({ where: { notificationId: a.id } })).readAt).toBeNull()
    await send(`${base}/${b.id}/read`, {}, who)
    expect((await read(`${base}/unread-count`, who)).body.data).toEqual({ count: 1 })
    expect(await db.auditEvent.count()).toBe(before)
  })
  it('sets first read time server-side and preserves it through concurrent repeats', async () => {
    const who = await newActor(), notice = await seed(who), before = Date.now()
    const responses = await Promise.all(Array.from({ length: 4 }, () => send(`${base}/${notice.id}/read`, {}, who)))
    expect(responses.map((v) => v.status)).toEqual([200, 200, 200, 200])
    const times = responses.map((v) => v.body.data.notification.readAt as string)
    expect(new Set(times).size).toBe(1)
    expect(Date.parse(times[0]!)).toBeGreaterThanOrEqual(before)
    expect(Date.parse(times[0]!)).toBeLessThanOrEqual(Date.now())
    expect((await send(`${base}/${notice.id}/read`, { readAt: '2020-01-01T00:00:00Z' }, who)).status).toBe(400)
  })
  it('marks all own unread rows once with a common timestamp, leaving others and prior reads unchanged', async () => {
    const who = await newActor(), other = await newActor(), a = await seed(who, 'BROADCAST', [other]), b = await seed(who), c = await seed(who)
    const original = (await send(`${base}/${a.id}/read`, {}, who)).body.data.notification.readAt
    expect((await send(`${base}/read-all`, {}, who)).body.data).toEqual({ updated: 2 })
    const states = await db.notificationRecipient.findMany({ where: { staffUserId: who.id } })
    expect(states.find((v) => v.notificationId === a.id)!.readAt!.toISOString()).toBe(original)
    expect(states.find((v) => v.notificationId === b.id)!.readAt).toEqual(states.find((v) => v.notificationId === c.id)!.readAt)
    expect((await read(`${base}/unread-count`, other)).body.data.count).toBe(1)
    expect((await send(`${base}/read-all`, {}, who)).body.data.updated).toBe(0)
  })
  it('serializes mark-all with single-read without overwriting the first timestamp', async () => {
    const who = await newActor(), a = await seed(who), b = await seed(who)
    const responses = await Promise.all([send(`${base}/${a.id}/read`, {}, who), send(`${base}/read-all`, {}, who)])
    expect(responses.every((r) => r.status === 200)).toBe(true)
    expect((await read(`${base}/${a.id}`, who)).body.data.notification.readAt).toBe(responses[0]!.body.data.notification.readAt)
    expect((await read(`${base}/${b.id}`, who)).body.data.notification.readAt).not.toBeNull()
  })
  it('leaves notifications delivered after read-all unread', async () => {
    const who = await newActor()
    await seed(who)
    await send(`${base}/read-all`, {}, who)
    const next = await seed(who)
    expect((await read(`${base}/${next.id}`, who)).body.data.notification.readAt).toBeNull()
  })
})

describe('broadcast delivery', () => {
  it('creates one shared ALL message, snapshots active recipients, and audits only audience/count', async () => {
    const inactive = []
    for (const status of ['PENDING', 'SUSPENDED', 'DISABLED'] as const) inactive.push(await newActor('RECORDS_OFFICER', status))
    const expected = await db.staffUser.findMany({ where: { status: 'ACTIVE' }, select: { id: true } })
    const before = await db.notification.count(), response = await send(`${base}/broadcast`, broadcast())
    expect(response.status).toBe(201)
    expect(response.body.data.recipientCount).toBe(expected.length)
    expect(await db.notification.count()).toBe(before + 1)
    const value = await db.notification.findUniqueOrThrow({ where: { id: response.body.data.notification.id }, include: { recipients: true } })
    expect(value).toMatchObject({ senderId: actor().id, type: 'BROADCAST', targetRole: null, appointmentId: null })
    expect(value.recipients.map((r) => r.staffUserId).sort()).toEqual(expected.map((r) => r.id).sort())
    expect(value.recipients.every((r) => r.readAt === null)).toBe(true)
    for (const who of inactive) expect(value.recipients.some((r) => r.staffUserId === who.id)).toBe(false)
    const events = await db.auditEvent.findMany({ where: { requestId: response.headers['x-request-id'] } })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ action: 'NOTIFICATION_BROADCAST_CREATED', actorId: actor().id,
      entityId: value.id, metadata: { source: 'API', audience: 'ALL', recipientCount: expected.length } })
    expect(JSON.stringify(events)).not.toContain('Private notification message')
    expect(response.body.data.notification).not.toHaveProperty('recipients')
    const newUser = await newActor()
    expect((await read(`${base}/${value.id}`, newUser)).status).toBe(404)
    await send(`${base}/${value.id}/read`)
    expect((await read(`${base}/${value.id}`, actor('RECORDS_OFFICER'))).body.data.notification.readAt).toBeNull()
  })
  it.each(['ADMIN', 'RECORDS_OFFICER', 'DOCTOR_IN_CHARGE'] as const)('snapshots ROLE %s without exposing its inbox to the broadcaster', async (role) => {
    const response = await send(`${base}/broadcast`, broadcast({ type: 'ROLE', role }))
    expect(response.status).toBe(201)
    const id = response.body.data.notification.id
    const recipients = await db.notificationRecipient.findMany({ where: { notificationId: id }, include: { staffUser: true } })
    expect(recipients.length).toBeGreaterThan(0)
    expect(recipients.every((r) => r.staffUser.role === role && r.staffUser.status === 'ACTIVE')).toBe(true)
    expect((await read(`${base}/${id}`)).status).toBe(role === 'ADMIN' ? 200 : 404)
  })
  it('retains delivery after role changes, without granting new recipients access', async () => {
    const who = await newActor(), response = await send(`${base}/broadcast`, broadcast({ type: 'ROLE', role: 'DOCTOR_IN_CHARGE' }))
    await db.staffUser.update({ where: { id: who.id }, data: { role: 'RECORDS_OFFICER' } })
    expect((await read(`${base}/${response.body.data.notification.id}`, who)).status).toBe(200)
    expect((await read(`${base}/${response.body.data.notification.id}`, actor('RECORDS_OFFICER'))).status).toBe(404)
  })
  it('rejects an empty eligible audience without creating content or audit', async () => {
    const active = await db.staffUser.findMany({ where: { status: 'ACTIVE', role: 'DOCTOR_IN_CHARGE' }, select: { id: true } })
    await db.staffUser.updateMany({ where: { id: { in: active.map((v) => v.id) } }, data: { status: 'SUSPENDED' } })
    try {
      const before = await db.notification.count(), response = await send(`${base}/broadcast`, broadcast({ type: 'ROLE', role: 'DOCTOR_IN_CHARGE' }))
      expect(response.status).toBe(409)
      expect(response.body.error.code).toBe('NO_NOTIFICATION_RECIPIENTS')
      expect(await db.notification.count()).toBe(before)
      expect(await db.auditEvent.count({ where: { requestId: response.headers['x-request-id'] } })).toBe(0)
    } finally { await db.staffUser.updateMany({ where: { id: { in: active.map((v) => v.id) } }, data: { status: 'ACTIVE' } }) }
  })
  it.each([{ title: '' }, { message: '  ' }, { title: 'a'.repeat(151) }, { message: 'a'.repeat(2001) },
    { message: '<script>alert(1)</script>' }, { audience: { type: 'ROLE', role: 'OWNER' } },
    { audience: { type: 'ALL', recipientId: randomUUID() } }, { senderId: randomUUID() }, { appointmentId: randomUUID() },
  ])('rejects invalid broadcast %# before persistence', async (variation) => {
    const before = await db.notification.count()
    expect((await send(`${base}/broadcast`, { ...broadcast(), ...variation })).status).toBe(400)
    expect(await db.notification.count()).toBe(before)
  })
  it.each(['Notification', 'NotificationRecipient', 'AuditEvent'])('rolls back the entire broadcast when %s insertion fails', async (flag) => {
    const before = [await db.notification.count(), await db.notificationRecipient.count(), await db.auditEvent.count()]
    await failure(flag, async () => {
      const response = await send(`${base}/broadcast`, broadcast())
      expect(response.status).toBe(500)
      expect(response.body.error.code).toBe('INTERNAL_ERROR')
      expect(JSON.stringify(response.body)).not.toMatch(/private notification SQL|Prisma/)
    })
    expect([await db.notification.count(), await db.notificationRecipient.count(), await db.auditEvent.count()]).toEqual(before)
  })
})

describe('appointment notification automation', () => {
  it('creates exactly one private-safe assigned-doctor notification in the appointment transaction', async () => {
    const { id, body } = await booked(), values = await notices(id)
    expect(values).toHaveLength(1)
    expect(values[0]).toMatchObject({ type: 'DIRECT', title: 'New appointment', message: 'An appointment has been assigned to you.', senderId: actor().id })
    expect(values[0]!.recipients.map((r) => r.staffUserId)).toEqual([body.clinicianId])
    const response = await read(`${base}/${values[0]!.id}`, actor('DOCTOR_IN_CHARGE'))
    expect(response.body.data.notification.target).toEqual({ type: 'APPOINTMENT', id })
    expect(JSON.stringify(response.body)).not.toMatch(/Private|233241234567|patientId|reason|notes/)
    expect(await db.auditEvent.count({ where: { entityId: values[0]!.id } })).toBe(0)
    expect(await db.auditEvent.count({ where: { entityId: id, action: 'APPOINTMENT_CREATED' } })).toBe(1)
  })
  it.each(['scheduledStart', 'scheduledEnd'] as const)('notifies once when %s actually changes', async (field) => {
    const { id, body } = await booked()
    const change = { [field]: new Date(Date.parse(body[field]) + 300000).toISOString() }
    expect((await send(`${appointments}/${id}`, change, actor(), 'patch')).status).toBe(200)
    expect((await notices(id)).map((v) => v.title)).toEqual(['New appointment', 'Appointment rescheduled'])
    expect((await send(`${appointments}/${id}`, change, actor(), 'patch')).status).toBe(200)
    expect(await notices(id)).toHaveLength(2)
  })
  it('notifies old and new doctors on reassignment without leaking content or granting old resource access', async () => {
    const who = await newActor(), { id } = await booked()
    const response = await send(`${appointments}/${id}`, { clinicianId: who.id }, actor(), 'patch')
    expect(response.status).toBe(200)
    const values = await notices(id)
    expect(values).toHaveLength(3)
    expect(values.find((v) => v.title === 'Appointment reassigned')!.recipients[0]!.staffUserId).toBe(actor('DOCTOR_IN_CHARGE').id)
    expect(values.filter((v) => v.title === 'New appointment').some((v) => v.recipients[0]!.staffUserId === who.id)).toBe(true)
    expect((await read(`${appointments}/${id}`, actor('DOCTOR_IN_CHARGE'))).status).toBe(404)
    expect((await read(`${appointments}/${id}`, who)).status).toBe(200)
    expect(JSON.stringify(values.map((v) => [v.title, v.message]))).not.toMatch(/Private|patient|reason|notes/)
  })
  it('coalesces simultaneous reassignment and reschedule into assignment notices', async () => {
    const who = await newActor(), { id, body } = await booked()
    expect((await send(`${appointments}/${id}`, { clinicianId: who.id,
      scheduledStart: new Date(Date.parse(body.scheduledStart) + 60000).toISOString() }, actor(), 'patch')).status).toBe(200)
    expect(await notices(id)).toHaveLength(3)
  })
  it('does not notify for text/type changes or confirmation', async () => {
    const { id } = await booked()
    expect((await send(`${appointments}/${id}`, { reason: 'Private changed reason', notes: 'Private changed notes', type: 'FOLLOW_UP' }, actor(), 'patch')).status).toBe(200)
    expect((await send(`${appointments}/${id}/status`, { status: 'CONFIRMED' }, actor(), 'patch')).status).toBe(200)
    expect(await notices(id)).toHaveLength(1)
  })
  it('sends a generic cancellation once, including under concurrent retries', async () => {
    const { id } = await booked()
    const responses = await Promise.all([send(`${appointments}/${id}/cancel`, { reason: 'Private cancellation reason' }), send(`${appointments}/${id}/cancel`, { reason: 'Private cancellation reason' })])
    expect(responses.every((r) => r.status === 200)).toBe(true)
    const values = await notices(id)
    expect(values).toHaveLength(2)
    expect(values[1]).toMatchObject({ title: 'Appointment cancelled', message: 'An appointment assigned to you has been cancelled.' })
    expect(JSON.stringify(values)).not.toContain('Private cancellation reason')
  })
  it.each(['SUSPENDED', 'DISABLED', 'DEMOTED', 'UNASSIGNED'] as const)('preserves cancellation without a new delivery to %s assignees', async (state) => {
    const who = await newActor(), { id } = await booked(who)
    if (state === 'UNASSIGNED') await db.appointment.update({ where: { id }, data: { clinicianId: null } })
    else await db.staffUser.update({ where: { id: who.id }, data: state === 'DEMOTED' ? { role: 'ADMIN' } : { status: state } })
    expect((await send(`${appointments}/${id}/cancel`)).status).toBe(200)
    expect(await notices(id)).toHaveLength(1)
  })
  it('skips inactive old doctors during reassignment but requires new-doctor delivery', async () => {
    const old = await newActor(), next = await newActor(), { id } = await booked(old)
    await db.staffUser.update({ where: { id: old.id }, data: { status: 'SUSPENDED' } })
    expect((await send(`${appointments}/${id}`, { clinicianId: next.id }, actor(), 'patch')).status).toBe(200)
    expect(await notices(id)).toHaveLength(2)
    expect((await notices(id))[1]!.recipients[0]!.staffUserId).toBe(next.id)
  })
  it('does not leave notification rows when appointment conflict prevents creation', async () => {
    const { body } = await booked(), before = await db.notification.count()
    const response = await send(appointments, body)
    expect(response.body.error.code).toBe('APPOINTMENT_CONFLICT')
    expect(await db.notification.count()).toBe(before)
  })
  it.each(['create', 'reschedule', 'reassign', 'cancel'] as const)('rolls back %s and audit if required notification persistence fails; a retry delivers once', async (operation) => {
    const { id, body } = await booked(), next = await newActor(), newBody = await appointmentInput()
    const original = await db.appointment.findUniqueOrThrow({ where: { id } })
    const requestBody = operation === 'create' ? newBody : operation === 'reassign' ? { clinicianId: next.id }
      : operation === 'reschedule' ? { scheduledStart: new Date(Date.parse(body.scheduledStart) + 60000).toISOString() } : { reason: 'Private cancel' }
    const path = operation === 'create' ? appointments : `${appointments}/${id}${operation === 'cancel' ? '/cancel' : ''}`
    const method = operation === 'reschedule' || operation === 'reassign' ? 'patch' : 'post'
    const before = [await db.notification.count(), await db.notificationRecipient.count(), await db.auditEvent.count(), await db.appointment.count()]
    await failure('NotificationRecipient', async () => expect((await send(path, requestBody, actor(), method)).status).toBe(500))
    expect([await db.notification.count(), await db.notificationRecipient.count(), await db.auditEvent.count(), await db.appointment.count()]).toEqual(before)
    expect(await db.appointment.findUniqueOrThrow({ where: { id } })).toEqual(original)
    expect((await send(path, requestBody, actor(), method)).status).toBe(operation === 'create' ? 201 : 200)
    expect(await db.notification.count()).toBe(before[0]! + (operation === 'reassign' ? 2 : 1))
  })
})

describe('notification security, integrity and authorization races', () => {
  it.each(['read', 'read-all', 'broadcast'] as const)('protects %s with Origin and CSRF', async (operation) => {
    const value = await seed(), path = operation === 'read' ? `${base}/${value.id}/read` : `${base}/${operation}`
    for (const token of [undefined, 'invalid', actor('DOCTOR_IN_CHARGE').csrf]) {
      const call = request(app).post(path).set('Cookie', actor().cookie).set('Origin', env.CLIENT_ORIGIN)
      if (token) call.set('X-CSRF-Token', token)
      expect((await call.send(operation === 'broadcast' ? broadcast() : {})).body.error.code).toBe('CSRF_INVALID')
    }
    expect((await request(app).post(path).set('Cookie', actor().cookie).set('X-CSRF-Token', actor().csrf).send({})).body.error.code).toBe('ORIGIN_NOT_ALLOWED')
  })
  it.each(['read', 'read-all'] as const)('rolls back %s when recipient persistence fails', async (operation) => {
    const who = await newActor(), value = await seed(who)
    await seed(who)
    await failure('NotificationRecipient', async () => {
      expect((await send(operation === 'read' ? `${base}/${value.id}/read` : `${base}/read-all`, {}, who)).status).toBe(500)
    })
    expect(await db.notificationRecipient.count({ where: { staffUserId: who.id, readAt: null } })).toBe(2)
  })
  it('does not log notification content, recipient identities or internal failures', async () => {
    const response = await send(`${base}/broadcast`, { ...broadcast(), title: 'Private title marker' }).set('X-Request-Id', 'notification-privacy')
    expect(response.headers['x-request-id']).toBe('notification-privacy')
    expect(logs).not.toMatch(/Private|Synthetic|@example.test|csrf|medicare_session/)
    expect(logs).toContain('notification-privacy')
    const spy = vi.spyOn(db.notificationRecipient, 'count').mockRejectedValueOnce(new Error('Private Prisma SQL data'))
    try {
      const error = await read(`${base}/unread-count`).set('X-Request-Id', 'notice-error')
      expect(error.body.error).toEqual({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', requestId: 'notice-error' })
      expect(JSON.stringify(error.body) + logs).not.toContain('Private Prisma SQL data')
    } finally { spy.mockRestore() }
  })
  it.each(['update', 'delete', 'truncate'] as const)('blocks direct notification %s and exposes no content-edit API', async (operation) => {
    const value = await seed()
    const attempt = operation === 'update' ? db.notification.update({ where: { id: value.id }, data: { message: 'Changed' } })
      : operation === 'delete' ? db.notification.delete({ where: { id: value.id } }) : db.$executeRaw`TRUNCATE TABLE "Notification" CASCADE`
    await expect(attempt).rejects.toThrow()
    expect((await send(`${base}/${value.id}`, { message: 'Changed' }, actor(), 'patch')).status).toBe(404)
    expect((await request(app).delete(`${base}/${value.id}`).set('Cookie', actor().cookie).set('Origin', env.CLIENT_ORIGIN).set('X-CSRF-Token', actor().csrf)).status).toBe(404)
  })
  it.each(['reset', 'replace', 'move', 'identity', 'createdAt', 'delete', 'truncate'] as const)('protects delivery history from %s', async (operation) => {
    const value = await seed(), row = value.recipients[0]!
    await send(`${base}/${value.id}/read`)
    if (operation === 'delete') await expect(db.notificationRecipient.delete({ where: { id: row.id } })).rejects.toThrow()
    else if (operation === 'truncate') await expect(db.$executeRaw`TRUNCATE TABLE "NotificationRecipient"`).rejects.toThrow()
    else {
      const data = operation === 'reset' ? { readAt: null } : operation === 'replace' ? { readAt: new Date('2099-01-01') }
        : operation === 'move' ? { staffUserId: actor('RECORDS_OFFICER').id } : operation === 'identity' ? { id: randomUUID() } : { createdAt: new Date('2000-01-01') }
      await expect(db.notificationRecipient.update({ where: { id: row.id }, data })).rejects.toThrow()
    }
  })
  it('enforces recipient uniqueness, restrictive foreign keys and appointment links', async () => {
    const value = await seed()
    await expect(db.notificationRecipient.create({ data: { notificationId: value.id, staffUserId: actor().id } })).rejects.toMatchObject({ code: 'P2002' })
    await expect(db.notificationRecipient.create({ data: { notificationId: value.id, staffUserId: randomUUID() } })).rejects.toMatchObject({ code: 'P2003' })
    await expect(db.notification.create({ data: { senderId: actor().id, type: 'DIRECT', title: 'Synthetic', message: 'Synthetic', appointmentId: randomUUID() } })).rejects.toMatchObject({ code: 'P2003' })
    const { id } = await booked()
    await expect(db.appointment.delete({ where: { id } })).rejects.toMatchObject({ code: 'P2003' })
  })
  it.each([{ audience: 'EXTERNAL', recipientCount: 1 }, { audience: 'ALL', recipientCount: 0 },
    { audience: 'ALL', recipientCount: 10001 }, { audience: 'ALL', recipientCount: 1.5 }, { audience: 'ALL', recipientCount: '1' },
    { audience: null, recipientCount: 1 }, { audience: 'ALL' }, { recipientCount: 1 }, { audience: 'ROLE', recipientCount: 1, message: 'Private' },
  ])('database rejects unsafe broadcast audit metadata %#', async (metadata) => {
    await expect(db.auditEvent.create({ data: { action: 'NOTIFICATION_BROADCAST_CREATED', entityType: 'NOTIFICATION', entityId: randomUUID(), metadata: { source: 'API', ...metadata } } })).rejects.toThrow()
  })
  it.each(['revoked', 'suspended', 'demoted', 'recipientSuspended'] as const)('rechecks %s after a queued broadcast', async (kind) => {
    const who = await newActor('ADMIN'), recipient = await newActor('DOCTOR_IN_CHARGE')
    let release!: () => void, ready!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve }), locked = new Promise<void>((resolve) => { ready = resolve })
    const blocker = db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(1296385106, 1)`
      ready(); await gate
      if (kind === 'revoked') await tx.staffSession.update({ where: { id: who.sessionId }, data: { revokedAt: new Date() } })
      else if (kind === 'demoted') await tx.staffUser.update({ where: { id: who.id }, data: { role: 'RECORDS_OFFICER' } })
      else await tx.staffUser.update({ where: { id: kind === 'recipientSuspended' ? recipient.id : who.id }, data: { status: 'SUSPENDED' } })
    })
    await locked
    const pending = send(`${base}/broadcast`, broadcast({ type: 'ROLE', role: 'DOCTOR_IN_CHARGE' }), who).then((r) => r)
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
    const response = await pending
    if (kind === 'recipientSuspended') {
      expect(response.status).toBe(201)
      expect(await db.notificationRecipient.count({ where: { notificationId: response.body.data.notification.id, staffUserId: recipient.id } })).toBe(0)
    } else {
      expect(response.body.error.code).toBe(kind === 'demoted' ? 'FORBIDDEN' : 'AUTHENTICATION_REQUIRED')
      expect(await db.notification.count({ where: { senderId: who.id } })).toBe(0)
    }
  })
})
