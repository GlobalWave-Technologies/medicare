import { randomBytes, randomUUID } from 'node:crypto'
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

// Temporary-password enforcement: an administrator-issued password signs in, but only the
// account's own auth routes answer until the staff member chooses a personal password.
const db = testDatabase(), env = isolatedTestEnvironment()
const ESTABLISHED = 'Established synthetic passphrase 2026', TEMPORARY = 'Temporary synthetic passphrase 2026'
const PERSONAL = 'Personal synthetic passphrase 2026', RESET = 'Reset temporary synthetic passphrase 2026'
type Actor = { id: string; cookie: string; csrf: string }
let hash: string, logs = '', app: ReturnType<typeof createApp>, admin: Actor

async function staff(role: StaffRole = 'ADMIN') {
  return db.staffUser.create({ data: { firstName: 'Synthetic', lastName: 'Established', email: `${randomUUID()}@example.test`, role, status: 'ACTIVE', passwordHash: hash, passwordChangedAt: new Date() } })
}
async function session(id: string): Promise<Actor> {
  const value = await db.$transaction((tx) => createSession(tx, id))
  return { id, cookie: `medicare_session=${value.token}`, csrf: value.session.csrfToken }
}
const send = (method: 'post' | 'patch' | 'delete', path: string, who: Actor, body: object = {}, extra: Record<string, string> = {}) => {
  const call = request(app)[method](path).set('Cookie', who.cookie).set('Origin', env.CLIENT_ORIGIN).set('X-CSRF-Token', who.csrf)
  for (const [name, value] of Object.entries(extra)) call.set(name, value)
  return call.send(body)
}
const get = (path: string, who: Actor) => request(app).get(path).set('Cookie', who.cookie)
const login = (email: string, password: string) => request(app).post('/api/v1/auth/login').set('Origin', env.CLIENT_ORIGIN).send({ email, password })
async function signIn(email: string, password: string): Promise<Actor & { body: Record<string, any> }> {
  const response = await login(email, password)
  expect(response.status).toBe(200)
  const cookie = String(response.headers['set-cookie']).split(';')[0]!
  const csrf = (await request(app).get('/api/v1/auth/csrf').set('Cookie', cookie)).body.data.csrfToken
  return { id: response.body.data.user.id, cookie, csrf, body: response.body }
}
const recruit = (overrides: object = {}) => {
  const suffix = randomBytes(5).toString('hex').toUpperCase()
  return { firstName: 'Synthetic', lastName: 'Recruit', email: `first-${suffix.toLowerCase()}@example.test`, staffNumber: `STF-FL${suffix}`, role: 'RECORDS_OFFICER', password: TEMPORARY, ...overrides }
}
async function createViaAdmin(overrides: object = {}) {
  const body = recruit(overrides)
  const response = await send('post', '/api/v1/staff', admin, body, { 'Idempotency-Key': `first-login-${randomUUID()}` })
  expect(response.status).toBe(201)
  return { ...body, id: response.body.data.user.id as string, response }
}
const flag = async (id: string) => (await db.staffUser.findUniqueOrThrow({ where: { id }, select: { mustChangePassword: true } })).mustChangePassword
const change = (who: Actor, currentPassword: string, newPassword: string) => send('post', '/api/v1/auth/change-password', who, { currentPassword, newPassword })

beforeAll(async () => {
  hash = await hashPassword(ESTABLISHED)
  admin = await session((await staff('ADMIN')).id)
})
beforeEach(() => {
  logs = ''
  app = createApp({ env, prisma: db, checkDatabase: async () => {}, logger: createLogger('info', new Writable({
    write(chunk: Buffer, _encoding, callback) { logs += chunk.toString(); callback() },
  })) })
})
afterAll(disconnectDatabase)

describe('when a password is temporary', () => {
  it('marks a new account, an administrator reset and a pending account’s first password as temporary', async () => {
    const created = await createViaAdmin()
    expect(await flag(created.id)).toBe(true)
    expect(created.response.body.data.user).not.toHaveProperty('mustChangePassword')
    const established = await staff('RECORDS_OFFICER')
    expect(await flag(established.id)).toBe(false)
    expect((await send('post', `/api/v1/staff/${established.id}/reset-password`, admin, { password: RESET })).status).toBe(200)
    expect(await flag(established.id)).toBe(true)
    const pending = await db.staffUser.create({ data: { firstName: 'Synthetic', lastName: 'Pending', email: `pending-${randomUUID()}@example.test`, role: 'DOCTOR_IN_CHARGE', status: 'PENDING' } })
    expect((await send('post', `/api/v1/staff/${pending.id}/reset-password`, admin, { password: RESET })).status).toBe(200)
    const after = await db.staffUser.findUniqueOrThrow({ where: { id: pending.id } })
    expect([after.mustChangePassword, after.status]).toEqual([true, 'PENDING'])
    expect((await login(after.email, RESET)).status).toBe(401)
    expect((await send('patch', `/api/v1/staff/${pending.id}/status`, admin, { status: 'ACTIVE' })).status).toBe(200)
    const activated = await signIn(after.email, RESET)
    expect(activated.body.data.user.mustChangePassword).toBe(true)
    expect((await get('/api/v1/patients', activated)).body.error.code).toBe('PASSWORD_CHANGE_REQUIRED')
  })

  it('the migration default leaves an existing account’s established password usable', async () => {
    const existing = await staff('DOCTOR_IN_CHARGE')
    const who = await signIn(existing.email, ESTABLISHED)
    expect(who.body.data.user.mustChangePassword).toBe(false)
    expect((await get('/api/v1/encounters', who)).status).toBe(200)
  })

  it('audits creation and reset with the existing safe events, never the password, hash or confirmation', async () => {
    const created = await createViaAdmin()
    const establishedUser = await staff('RECORDS_OFFICER')
    await send('post', `/api/v1/staff/${establishedUser.id}/reset-password`, admin, { password: RESET })
    const events = await db.auditEvent.findMany({ where: { entityId: { in: [created.id, establishedUser.id] }, action: { in: ['STAFF_CREATED', 'PASSWORD_RESET'] } } })
    // Every administrator-issued credential is temporary by rule, so the existing events carry no extra marker.
    expect(events.map((event) => [event.action, event.metadata])).toEqual(expect.arrayContaining([['STAFF_CREATED', { source: 'API' }], ['PASSWORD_RESET', { source: 'API' }]]))
    const text = JSON.stringify(await db.auditEvent.findMany()) + logs
    for (const secret of [TEMPORARY, RESET, hash]) expect(text).not.toContain(secret)
  })
})

describe('signing in with a temporary password', () => {
  it('returns the identity with the flag and refuses every normal application route', async () => {
    const created = await createViaAdmin({ role: 'ADMIN' })
    const who = await signIn(created.email, TEMPORARY)
    expect(who.body.data.user).toMatchObject({ id: created.id, role: 'ADMIN', status: 'ACTIVE', mustChangePassword: true })
    expect(Object.keys(who.body.data.user).sort()).toEqual(['email', 'firstName', 'id', 'lastName', 'mustChangePassword', 'role', 'staffNumber', 'status'])
    const refused = [
      await get('/api/v1/patients', who), await get(`/api/v1/patients/${randomUUID()}`, who), await get('/api/v1/admissions', who),
      await get(`/api/v1/admissions/${randomUUID()}`, who), await get(`/api/v1/patients/${randomUUID()}/medications`, who),
      await get('/api/v1/encounters', who), await get('/api/v1/notifications', who), await get('/api/v1/notifications/unread-count', who),
      await get('/api/v1/staff', who), await get('/api/v1/dashboard', who), await get('/api/v1/reports/patients', who),
      await send('post', '/api/v1/patients', who, { firstName: 'Synthetic', lastName: 'Bypass' }, { 'Idempotency-Key': `bypass-${randomUUID()}` }),
      await send('post', '/api/v1/admissions', who, { patientId: randomUUID(), roomNumber: 'Bypass room' }, { 'Idempotency-Key': `bypass-${randomUUID()}` }),
      await send('post', `/api/v1/admissions/${randomUUID()}/discharge`, who, {}),
      await send('post', '/api/v1/notifications/broadcast', who, { title: 'Bypass', message: 'Synthetic bypass attempt', audience: { type: 'ALL' } }, { 'Idempotency-Key': `bypass-${randomUUID()}` }),
      await send('post', '/api/v1/staff', who, recruit(), { 'Idempotency-Key': `bypass-${randomUUID()}` }),
      await send('post', `/api/v1/staff/${admin.id}/reset-password`, who, { password: 'Bypass synthetic passphrase 2026' }),
      await send('delete', `/api/v1/staff/${admin.id}/sessions`, who),
    ]
    expect(refused.map((response) => [response.status, response.body.error?.code])).toEqual(refused.map(() => [403, 'PASSWORD_CHANGE_REQUIRED']))
    expect(await db.patient.count({ where: { lastName: 'Bypass' } })).toBe(0)
    expect(await db.admission.count({ where: { roomNumber: 'Bypass room' } })).toBe(0)
    expect(await db.notification.count({ where: { title: 'Bypass' } })).toBe(0)
    expect((await get('/api/v1/health', who)).status).toBe(200)
  })

  it('allows only identity, CSRF, sign-out and changing the password', async () => {
    const created = await createViaAdmin({ role: 'DOCTOR_IN_CHARGE' })
    const who = await signIn(created.email, TEMPORARY)
    expect((await get('/api/v1/auth/me', who)).body.data.user.mustChangePassword).toBe(true)
    expect((await get('/api/v1/auth/csrf', who)).body.data.csrfToken).toBe(who.csrf)
    expect((await send('post', '/api/v1/auth/logout', who)).status).toBe(200)
    expect((await get('/api/v1/auth/me', who)).status).toBe(401)
    const again = await signIn(created.email, TEMPORARY)
    expect((await send('post', '/api/v1/auth/logout-all', again)).status).toBe(200)
    expect(await flag(created.id)).toBe(true)
  })

  it('still requires CSRF and a trusted origin for the password change', async () => {
    const created = await createViaAdmin()
    const who = await signIn(created.email, TEMPORARY)
    const noCsrf = await request(app).post('/api/v1/auth/change-password').set('Cookie', who.cookie).set('Origin', env.CLIENT_ORIGIN).send({ currentPassword: TEMPORARY, newPassword: PERSONAL })
    const wrongOrigin = await request(app).post('/api/v1/auth/change-password').set('Cookie', who.cookie).set('Origin', 'https://evil.example').set('X-CSRF-Token', who.csrf).send({ currentPassword: TEMPORARY, newPassword: PERSONAL })
    expect([noCsrf.status, noCsrf.body.error.code]).toEqual([403, 'CSRF_INVALID'])
    expect(wrongOrigin.status).toBe(403)
    expect(await flag(created.id)).toBe(true)
  })

  it('a disabled or suspended account cannot sign in, whatever the flag says', async () => {
    for (const status of ['DISABLED', 'SUSPENDED'] as const) {
      const created = await createViaAdmin()
      const who = await signIn(created.email, TEMPORARY)
      await db.staffUser.update({ where: { id: created.id }, data: { status } })
      expect((await get('/api/v1/auth/me', who)).status).toBe(401)
      expect((await login(created.email, TEMPORARY)).status).toBe(401)
      expect(await flag(created.id)).toBe(true)
    }
  })
})

describe('replacing the temporary password', () => {
  it('a wrong current password or an invalid new password leaves the requirement in place', async () => {
    const created = await createViaAdmin()
    const who = await signIn(created.email, TEMPORARY)
    const wrong = await change(who, 'Not the temporary synthetic passphrase', PERSONAL)
    const short = await change(who, TEMPORARY, 'too short')
    const same = await change(who, TEMPORARY, TEMPORARY)
    expect([wrong.body.error.code, short.body.error.code, same.body.error.code]).toEqual(['CURRENT_PASSWORD_INVALID', 'VALIDATION_ERROR', 'PASSWORD_UNCHANGED'])
    expect(await flag(created.id)).toBe(true)
    expect((await get('/api/v1/auth/me', who)).status).toBe(200)
    expect((await get('/api/v1/patients', who)).body.error.code).toBe('PASSWORD_CHANGE_REQUIRED')
  })

  it('clears the flag with the password, revokes every session and restores normal access on the next sign-in', async () => {
    const created = await createViaAdmin({ role: 'RECORDS_OFFICER' })
    const first = await signIn(created.email, TEMPORARY), second = await signIn(created.email, TEMPORARY)
    const changed = await change(first, TEMPORARY, PERSONAL)
    expect([changed.status, changed.body.data.passwordChanged]).toEqual([200, true])
    expect(String(changed.headers['set-cookie'])).toMatch(/medicare_session=;/)
    expect(await flag(created.id)).toBe(false)
    expect((await get('/api/v1/auth/me', first)).status).toBe(401)
    expect((await get('/api/v1/auth/me', second)).status).toBe(401)
    expect(await db.staffSession.count({ where: { staffUserId: created.id, revokedAt: null } })).toBe(0)
    expect((await login(created.email, TEMPORARY)).status).toBe(401)
    const personal = await signIn(created.email, PERSONAL)
    expect(personal.body.data.user).toMatchObject({ mustChangePassword: false, role: 'RECORDS_OFFICER' })
    expect((await get('/api/v1/patients', personal)).status).toBe(200)
    expect((await get('/api/v1/reports/patients', personal)).status).toBe(200)
    const audit = await db.auditEvent.findMany({ where: { entityId: created.id, action: 'PASSWORD_CHANGED' } })
    expect(audit.map((event) => event.metadata)).toEqual([{ source: 'API' }])
    for (const secret of [TEMPORARY, PERSONAL]) { expect(logs).not.toContain(secret); expect(JSON.stringify(await db.auditEvent.findMany())).not.toContain(secret) }
  })

  it('an administrator reset makes the person replace the password again, and existing sessions stop at once', async () => {
    const created = await createViaAdmin({ role: 'DOCTOR_IN_CHARGE' })
    await change(await signIn(created.email, TEMPORARY), TEMPORARY, PERSONAL)
    const working = await signIn(created.email, PERSONAL)
    expect((await get('/api/v1/encounters', working)).status).toBe(200)
    expect((await send('post', `/api/v1/staff/${created.id}/reset-password`, admin, { password: RESET })).status).toBe(200)
    expect((await get('/api/v1/encounters', working)).status).toBe(401)
    expect((await login(created.email, PERSONAL)).status).toBe(401)
    const reset = await signIn(created.email, RESET)
    expect(reset.body.data.user.mustChangePassword).toBe(true)
    expect((await get('/api/v1/encounters', reset)).body.error.code).toBe('PASSWORD_CHANGE_REQUIRED')
    const chosen = 'Second personal synthetic passphrase 2026'
    expect((await change(reset, RESET, chosen)).status).toBe(200)
    const back = await signIn(created.email, chosen)
    expect([back.body.data.user.mustChangePassword, back.body.data.user.role]).toEqual([false, 'DOCTOR_IN_CHARGE'])
    expect((await get('/api/v1/encounters', back)).status).toBe(200)
  })

  it('a flagged administrator cannot use staff administration even with a valid session and CSRF token', async () => {
    const created = await createViaAdmin({ role: 'ADMIN' })
    const who = await signIn(created.email, TEMPORARY)
    const victim = await staff('RECORDS_OFFICER')
    const attempt = await send('patch', `/api/v1/staff/${victim.id}/role`, who, { role: 'ADMIN' })
    expect([attempt.status, attempt.body.error.code]).toEqual([403, 'PASSWORD_CHANGE_REQUIRED'])
    expect((await db.staffUser.findUniqueOrThrow({ where: { id: victim.id } })).role).toBe('RECORDS_OFFICER')
  })
})
