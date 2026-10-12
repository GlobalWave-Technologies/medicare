import { randomUUID } from 'node:crypto'
import { Writable } from 'node:stream'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app.js'
import { disconnectDatabase } from '../src/database/prisma.js'
import type { StaffRole, StaffStatus } from '../src/generated/prisma/client.js'
import { createLogger } from '../src/shared/logger/logger.js'
import { hashPassword, verifyPassword } from '../src/shared/security/password.js'
import { createSession, hashSessionToken } from '../src/modules/auth/session.service.js'
import { isolatedTestEnvironment, testDatabase } from './helpers/database.js'

const db = testDatabase()
const env = isolatedTestEnvironment()
const origin = env.CLIENT_ORIGIN
const password = 'Synthetic authentication passphrase 2026'
let passwordHash: string
let adminId: string
let app: ReturnType<typeof createApp>
let logs = ''
const secrets = new Set<string>([password])

function buildApp(production = false) {
  return createApp({ prisma: db, env: { ...env, NODE_ENV: production ? 'production' : 'test' },
    logger: createLogger('info', new Writable({ write(chunk: Buffer, _encoding, callback) {
      logs += chunk.toString(); callback()
    } })), checkDatabase: async () => { await db.$queryRaw`SELECT 1` } })
}

async function staff(role: StaffRole = 'RECORDS_OFFICER', status: StaffStatus = 'ACTIVE') {
  return db.staffUser.create({ data: { firstName: 'Synthetic', lastName: 'Auth',
    email: `synthetic-${randomUUID()}@example.test`, role, status, passwordHash, passwordChangedAt: new Date() } })
}

async function session(id = adminId) {
  const created = await db.$transaction((tx) => createSession(tx, id))
  secrets.add(created.token)
  secrets.add(created.session.csrfToken)
  return { cookie: `medicare_session=${created.token}`, csrf: created.session.csrfToken,
    token: created.token, id: created.session.id }
}
type Session = Awaited<ReturnType<typeof session>>

function mutation(method: 'post' | 'patch' | 'delete', path: string, auth: Session, body?: object) {
  const test = request(app)[method](path).set('Cookie', auth.cookie).set('Origin', origin).set('X-CSRF-Token', auth.csrf)
  return body ? test.send(body) : test
}

function login(email: string, suppliedPassword = password) {
  return request(app).post('/api/v1/auth/login').set('Origin', origin).send({ email, password: suppliedPassword })
}

function cookieFrom(response: request.Response) {
  const cookies: unknown = response.headers['set-cookie']
  if (!Array.isArray(cookies) || typeof cookies[0] !== 'string') throw new Error('Expected session cookie')
  return cookies[0]
}

function safeUser(value: object) {
  expect(Object.keys(value).sort()).toEqual(['id', 'staffNumber', 'firstName', 'lastName', 'email', 'role', 'status'].sort())
  expect(JSON.stringify(value)).not.toContain(password)
}

beforeAll(async () => {
  passwordHash = await hashPassword(password)
  secrets.add(passwordHash)
  adminId = (await staff('ADMIN')).id
  // Disposable database only: inject an audit failure to prove real rollback.
  await db.$executeRawUnsafe(`CREATE FUNCTION test_reject_auth_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW."requestId" = 'fail-audit' THEN RAISE EXCEPTION 'synthetic private SQL detail'; END IF; RETURN NEW; END $$`)
  await db.$executeRawUnsafe(`CREATE TRIGGER test_auth_audit_failure BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION test_reject_auth_audit()`)
})

beforeEach(async () => {
  // Preserve append-only history; isolate account/session state without deleting
  // records. The runner gives this entire suite its own generated database.
  await db.staffUser.updateMany({ where: { role: 'ADMIN' }, data: { role: 'RECORDS_OFFICER' } })
  await db.staffUser.update({ where: { id: adminId }, data: { role: 'ADMIN', status: 'ACTIVE' } })
  await db.staffSession.updateMany({ data: { revokedAt: new Date() } })
  app = buildApp()
  logs = ''
})
afterAll(disconnectDatabase)

describe('staff authentication', () => {
  it('authenticates normalized email and persists a hashed, eight-hour session atomically', async () => {
    const user = await staff()
    const response = await login(` ${user.email.toUpperCase()} `)
    expect(response.status).toBe(200)
    safeUser(response.body.data.user)
    const cookie = cookieFrom(response)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
    expect(cookie).toContain('Path=/')
    expect(cookie).toContain('Expires=')
    expect(cookie).not.toContain('Secure')
    const token = cookie.split(';')[0]!.split('=')[1]!
    secrets.add(token)
    const saved = await db.staffSession.findUniqueOrThrow({ where: { tokenHash: hashSessionToken(token) } })
    expect(JSON.stringify(saved)).not.toContain(token)
    expect(saved.csrfToken).not.toBe(token)
    expect(saved.expiresAt.getTime() - saved.createdAt.getTime()).toBe(8 * 60 * 60 * 1000)
    expect((await db.staffUser.findUniqueOrThrow({ where: { id: user.id } })).lastLoginAt).toBeInstanceOf(Date)
    expect(await db.auditEvent.count({ where: { entityId: user.id, action: 'LOGIN_SUCCEEDED' } })).toBe(1)
    expect(response.body.data).not.toHaveProperty('token')
  })

  it('sets Secure in production and omits all credentials from the response', async () => {
    app = buildApp(true)
    const user = await staff()
    const response = await login(user.email)
    expect(response.status).toBe(200)
    expect(cookieFrom(response)).toContain('Secure')
    safeUser(response.body.data.user)
    expect(response.headers['cache-control']).toBe('no-store')
  })

  it.each(['wrong', 'unknown', 'PENDING', 'SUSPENDED', 'DISABLED'] as const)('returns generic failure for %s', async (scenario) => {
    const user = await staff('RECORDS_OFFICER', scenario === 'wrong' || scenario === 'unknown' ? 'ACTIVE' : scenario)
    const response = await login(scenario === 'unknown' ? 'unknown@example.test' : user.email,
      scenario === 'wrong' ? 'Wrong synthetic passphrase' : password)
    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('INVALID_CREDENTIALS')
    expect(response.body.error.message).toBe('Invalid email or password')
    expect(response.headers['set-cookie']).toBeUndefined()
    expect(await db.staffSession.count({ where: { staffUserId: user.id } })).toBe(0)
    const event = await db.auditEvent.findFirstOrThrow({ where: { requestId: response.headers['x-request-id'] } })
    expect(event.action).toBe('LOGIN_FAILED')
    expect(event.entityType).toBe('AUTH_ATTEMPT')
    expect(event.actorId).toBeNull()
    expect(JSON.stringify(event)).not.toContain(user.email)
  })

  it.each([{ role: 'ADMIN' }, { userId: randomUUID() }, { status: 'ACTIVE' }])('rejects client-selected authorization %j', async (extra) => {
    const user = await staff()
    const response = await request(app).post('/api/v1/auth/login').set('Origin', origin).send({ email: user.email, password, ...extra })
    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('supports multiple independent sessions without accepting session fixation', async () => {
    const user = await staff()
    const first = await login(user.email)
    const second = await login(user.email).set('Cookie', cookieFrom(first).split(';')[0]!)
    expect(second.status).toBe(200)
    expect(cookieFrom(first)).not.toBe(cookieFrom(second))
    expect(await db.staffSession.count({ where: { staffUserId: user.id, revokedAt: null } })).toBe(2)
  })

  it('returns session identity regardless of supplied identity or role headers/query', async () => {
    const user = await staff('DOCTOR_IN_CHARGE')
    const auth = await session(user.id)
    const response = await request(app).get(`/api/v1/auth/me?userId=${adminId}&role=ADMIN`)
      .set('Cookie', auth.cookie).set('X-Role', 'ADMIN')
    expect(response.status).toBe(200)
    expect(response.body.data.user.id).toBe(user.id)
    expect(response.body.data.user.role).toBe('DOCTOR_IN_CHARGE')
    safeUser(response.body.data.user)
  })

  it.each(['missing', 'malformed', 'duplicate', 'unknown', 'expired', 'revoked', 'SUSPENDED', 'DISABLED'] as const)('rejects %s session', async (scenario) => {
    const user = await staff()
    const auth = await session(user.id)
    let cookie = auth.cookie
    if (scenario === 'missing') cookie = ''
    if (scenario === 'malformed') cookie = 'medicare_session=invalid'
    if (scenario === 'duplicate') cookie += `; ${auth.cookie}`
    if (scenario === 'unknown') cookie = `medicare_session=${'f'.repeat(64)}`
    if (scenario === 'expired') await db.staffSession.update({ where: { id: auth.id }, data: {
      createdAt: new Date(Date.now() - 10000), expiresAt: new Date(Date.now() - 1000) } })
    if (scenario === 'revoked') await db.staffSession.update({ where: { id: auth.id }, data: { revokedAt: new Date() } })
    if (scenario === 'SUSPENDED' || scenario === 'DISABLED') await db.staffUser.update({ where: { id: user.id }, data: { status: scenario } })
    const response = await request(app).get('/api/v1/auth/me').set('Cookie', cookie)
    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('AUTHENTICATION_REQUIRED')
  })

  it('rechecks current database role on every request', async () => {
    const user = await staff('ADMIN')
    const auth = await session(user.id)
    await db.staffUser.update({ where: { id: user.id }, data: { role: 'DOCTOR_IN_CHARGE' } })
    expect((await request(app).get('/api/v1/staff').set('Cookie', auth.cookie)).status).toBe(403)
  })

  it('logs out only the current session, clears cookie, and safely rejects replay', async () => {
    const auth = await session()
    const other = await session()
    const response = await mutation('post', '/api/v1/auth/logout', auth)
    expect(response.status).toBe(200)
    expect(cookieFrom(response)).toContain('Expires=Thu, 01 Jan 1970')
    expect((await db.staffSession.findUniqueOrThrow({ where: { id: auth.id } })).revokedAt).not.toBeNull()
    expect((await request(app).get('/api/v1/auth/me').set('Cookie', other.cookie)).status).toBe(200)
    expect((await mutation('post', '/api/v1/auth/logout', auth)).status).toBe(401)
    expect(await db.auditEvent.count({ where: { requestId: response.headers['x-request-id'], action: 'LOGOUT' } })).toBe(1)
  })

  it('logout-all revokes every own session including current, but not another account', async () => {
    const auth = await session()
    const other = await session()
    const foreign = await session((await staff()).id)
    expect((await mutation('post', '/api/v1/auth/logout-all', auth)).status).toBe(200)
    for (const cookie of [auth.cookie, other.cookie]) expect((await request(app).get('/api/v1/auth/me').set('Cookie', cookie)).status).toBe(401)
    expect((await request(app).get('/api/v1/auth/me').set('Cookie', foreign.cookie)).status).toBe(200)
  })
})

describe('CSRF and origin boundaries', () => {
  it('retrieves a stable session-specific synchronizer token with no caching', async () => {
    const auth = await session()
    const response = await request(app).get('/api/v1/auth/csrf').set('Cookie', auth.cookie)
    expect(response.status).toBe(200)
    expect(response.body.data.csrfToken).toBe(auth.csrf)
    expect(response.body.data.csrfToken).not.toBe(auth.token)
    expect(response.headers['cache-control']).toBe('no-store')
    expect((await request(app).get('/api/v1/auth/csrf')).status).toBe(401)
  })

  it.each(['missing', 'invalid', 'other-session'] as const)('rejects %s CSRF token without revoking session', async (scenario) => {
    const auth = await session()
    const response = await request(app).post('/api/v1/auth/logout').set('Cookie', auth.cookie).set('Origin', origin)
      .set('X-CSRF-Token', scenario === 'missing' ? '' : scenario === 'invalid' ? 'invalid' : (await session()).csrf)
    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('CSRF_INVALID')
    expect((await db.staffSession.findUniqueOrThrow({ where: { id: auth.id } })).revokedAt).toBeNull()
  })

  it.each(['', 'null', 'https://attacker.example', `${origin}.attacker.example`])('rejects login Origin %s', async (value) => {
    const response = await request(app).post('/api/v1/auth/login').set('Origin', value).send({ email: 'synthetic@example.test', password })
    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('ORIGIN_NOT_ALLOWED')
  })

  it('requires Origin even with valid CSRF and rejects untrusted credentialed reads', async () => {
    const auth = await session()
    expect((await request(app).post('/api/v1/auth/logout').set('Cookie', auth.cookie).set('X-CSRF-Token', auth.csrf)).status).toBe(403)
    expect((await request(app).get('/api/v1/auth/me').set('Cookie', auth.cookie).set('Origin', 'https://attacker.example')).status).toBe(403)
  })

  it('allows safe GET, HEAD, and trusted preflight without CSRF', async () => {
    const auth = await session()
    expect((await request(app).head('/api/v1/auth/me').set('Cookie', auth.cookie)).status).toBe(200)
    const response = await request(app).options('/api/v1/staff').set('Origin', origin)
      .set('Access-Control-Request-Method', 'POST').set('Access-Control-Request-Headers', 'X-CSRF-Token')
    expect(response.status).toBe(204)
    expect(response.headers['access-control-allow-origin']).toBe(origin)
    expect(response.headers['access-control-allow-credentials']).toBe('true')
    expect(response.headers['access-control-allow-headers']).toContain('X-CSRF-Token')
  })
})

const adminRoutes = [
  ['get', '/api/v1/staff'], ['post', '/api/v1/staff'], ['get', `/api/v1/staff/${randomUUID()}`],
  ['patch', `/api/v1/staff/${randomUUID()}/role`], ['patch', `/api/v1/staff/${randomUUID()}/status`],
  ['delete', `/api/v1/staff/${randomUUID()}/sessions`],
] as const

describe('staff authorization and provisioning', () => {
  it.each(adminRoutes)('requires authentication for %s %s', async (method, path) => {
    expect((await request(app)[method](path).set('Origin', origin)).status).toBe(401)
  })

  it.each(['RECORDS_OFFICER', 'DOCTOR_IN_CHARGE'] as const)('denies all staff administration to %s', async (role) => {
    const auth = await session((await staff(role)).id)
    for (const [method, path] of adminRoutes) {
      const response = await request(app)[method](path).set('Origin', origin).set('Cookie', auth.cookie)
        .set('X-CSRF-Token', auth.csrf).set('X-Role', 'ADMIN')
      expect(response.status).toBe(403)
      expect(response.body.error.code).toBe('FORBIDDEN')
    }
  })

  it.each(['ADMIN', 'RECORDS_OFFICER', 'DOCTOR_IN_CHARGE'] as const)('provisions an ACTIVE %s with audited initial password', async (role) => {
    const auth = await session()
    const identity = { firstName: ' Synthetic ', lastName: 'New', email: `NEW-${randomUUID()}@EXAMPLE.TEST`,
      staffNumber: `stf-${randomUUID().replaceAll('-', '')}`, role, password }
    const response = await mutation('post', '/api/v1/staff', auth, identity)
    expect(response.status).toBe(201)
    safeUser(response.body.data.user)
    expect(response.body.data.user).toMatchObject({ status: 'ACTIVE', role, email: identity.email.toLowerCase(), firstName: 'Synthetic' })
    expect(logs).not.toContain(identity.password)
    const saved = await db.staffUser.findUniqueOrThrow({ where: { id: response.body.data.user.id } })
    expect(await verifyPassword(password, saved.passwordHash!)).toBe(true)
    expect(saved.passwordChangedAt).toBeInstanceOf(Date)
    const event = await db.auditEvent.findFirstOrThrow({ where: { entityId: saved.id, action: 'STAFF_CREATED' } })
    expect(event.actorId).toBe(adminId)
    expect(event.requestId).toBe(response.headers['x-request-id'])
  })

  it.each(['email', 'staffNumber'] as const)('rejects duplicate normalized %s', async (field) => {
    const auth = await session()
    const existing = await staff()
    const response = await mutation('post', '/api/v1/staff', auth, {
      firstName: 'Synthetic', lastName: 'Duplicate', email: field === 'email' ? ` ${existing.email.toUpperCase()} ` : `unique-${randomUUID()}@example.test`,
      staffNumber: field === 'staffNumber' ? existing.staffNumber.toLowerCase() : 'STF-UNIQUE123', role: 'RECORDS_OFFICER', password,
    })
    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe(field === 'email' ? 'EMAIL_ALREADY_EXISTS' : 'STAFF_NUMBER_ALREADY_EXISTS')
  })

  it('rejects weak initial passwords and client-selected provisioning status', async () => {
    const auth = await session()
    const identity = { firstName: 'Synthetic', lastName: 'Invalid', email: 'invalid@example.test',
      staffNumber: 'STF-INVALID01', role: 'RECORDS_OFFICER', password: 'weak' }
    expect((await mutation('post', '/api/v1/staff', auth, identity)).status).toBe(400)
    expect((await mutation('post', '/api/v1/staff', auth, { ...identity, password, status: 'ACTIVE' })).status).toBe(400)
    expect(await db.staffUser.findUnique({ where: { email: identity.email } })).toBeNull()
  })

  it('lists and filters paginated safe staff DTOs and returns safe detail', async () => {
    const auth = await session()
    const response = await request(app).get('/api/v1/staff?page=1&limit=2&role=ADMIN&status=ACTIVE').set('Cookie', auth.cookie)
    expect(response.status).toBe(200)
    expect(response.body.data.pagination).toEqual({ page: 1, limit: 2, total: 1 })
    expect(response.body.data.users).toHaveLength(1)
    safeUser(response.body.data.users[0])
    const detail = await request(app).get(`/api/v1/staff/${adminId}`).set('Cookie', auth.cookie)
    expect(detail.status).toBe(200)
    safeUser(detail.body.data.user)
    const defaults = await request(app).get('/api/v1/staff').set('Cookie', auth.cookie)
    expect(defaults.body.data.pagination).toMatchObject({ page: 1, limit: 20 })
  })

  it.each(['limit=101', 'limit=0', 'page=-1', 'page=1.5', 'role=OWNER', 'status=UNKNOWN', 'extra=1', 'page=1&page=2'])('rejects unsafe query %s', async (query) => {
    const auth = await session()
    expect((await request(app).get(`/api/v1/staff?${query}`).set('Cookie', auth.cookie)).status).toBe(400)
  })

  it('distinguishes invalid UUID from missing staff safely', async () => {
    const auth = await session()
    expect((await request(app).get('/api/v1/staff/not-uuid').set('Cookie', auth.cookie)).status).toBe(400)
    const missing = await request(app).get(`/api/v1/staff/${randomUUID()}`).set('Cookie', auth.cookie)
    expect(missing.status).toBe(404)
    expect(missing.body.error.code).toBe('STAFF_NOT_FOUND')
  })

  it.each([['role', { role: 'OWNER' }], ['role', { role: 'ADMIN', status: 'ACTIVE' }],
    ['status', { status: 'UNKNOWN' }], ['status', { status: 'SUSPENDED', role: 'ADMIN' }]] as const)(
    'rejects invalid or extra fields for %s %j', async (path, body) => {
      const auth = await session()
      expect((await mutation('patch', `/api/v1/staff/${adminId}/${path}`, auth, body)).status).toBe(400)
    })

  it.each(['role', 'status', 'sessions'] as const)('rejects nonexistent target for %s', async (path) => {
    const auth = await session()
    const response = await mutation(path === 'sessions' ? 'delete' : 'patch', `/api/v1/staff/${randomUUID()}/${path}`, auth,
      path === 'role' ? { role: 'ADMIN' } : path === 'status' ? { status: 'SUSPENDED' } : undefined)
    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('STAFF_NOT_FOUND')
  })
})

describe('account lifecycle, revocation and concurrent administration', () => {
  it('changes role, revokes all target sessions, and records role audit', async () => {
    const auth = await session()
    const user = await staff()
    const target = await session(user.id)
    await session(user.id)
    const response = await mutation('patch', `/api/v1/staff/${user.id}/role`, auth, { role: 'DOCTOR_IN_CHARGE' })
    expect(response.status).toBe(200)
    expect(response.body.data.user.role).toBe('DOCTOR_IN_CHARGE')
    expect(await db.staffSession.count({ where: { staffUserId: user.id, revokedAt: null } })).toBe(0)
    expect((await request(app).get('/api/v1/auth/me').set('Cookie', target.cookie)).status).toBe(401)
    expect(await db.auditEvent.count({ where: { entityId: user.id, action: 'STAFF_ROLE_CHANGED' } })).toBe(1)
  })

  it.each([
    ['PENDING', 'ACTIVE'], ['PENDING', 'DISABLED'], ['ACTIVE', 'SUSPENDED'],
    ['ACTIVE', 'DISABLED'], ['SUSPENDED', 'ACTIVE'], ['SUSPENDED', 'DISABLED'],
  ] as const)('allows %s -> %s and revokes previous sessions', async (from, to) => {
    const auth = await session()
    const user = await staff('RECORDS_OFFICER', from)
    await session(user.id)
    const response = await mutation('patch', `/api/v1/staff/${user.id}/status`, auth, { status: to })
    expect(response.status).toBe(200)
    expect(response.body.data.user.status).toBe(to)
    expect(await db.staffSession.count({ where: { staffUserId: user.id, revokedAt: null } })).toBe(0)
    expect(await db.auditEvent.count({ where: { entityId: user.id, action: 'STAFF_STATUS_CHANGED' } })).toBe(1)
    if (to === 'ACTIVE') expect((await login(user.email)).status).toBe(200)
  })

  it.each([['DISABLED', 'ACTIVE'], ['ACTIVE', 'PENDING'], ['ACTIVE', 'ACTIVE'], ['PENDING', 'SUSPENDED']] as const)('rejects invalid %s -> %s', async (from, to) => {
    const auth = await session()
    const user = await staff('RECORDS_OFFICER', from)
    const response = await mutation('patch', `/api/v1/staff/${user.id}/status`, auth, { status: to })
    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('INVALID_STATUS_TRANSITION')
  })

  it('rejects activation without provisioned credentials', async () => {
    const auth = await session()
    const user = await staff('RECORDS_OFFICER', 'PENDING')
    await db.staffUser.update({ where: { id: user.id }, data: { passwordHash: null, passwordChangedAt: null } })
    const response = await mutation('patch', `/api/v1/staff/${user.id}/status`, auth, { status: 'ACTIVE' })
    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('CREDENTIALS_REQUIRED')
  })

  it.each([['role', { role: 'RECORDS_OFFICER' }], ['status', { status: 'SUSPENDED' }], ['status', { status: 'DISABLED' }]] as const)('protects last ACTIVE ADMIN: %s %j', async (path, body) => {
    const auth = await session()
    await staff('ADMIN', 'PENDING')
    await staff('ADMIN', 'DISABLED')
    const response = await mutation('patch', `/api/v1/staff/${adminId}/${path}`, auth, body)
    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('LAST_ADMIN_PROTECTION')
    expect((await db.staffSession.findUniqueOrThrow({ where: { id: auth.id } })).revokedAt).toBeNull()
  })

  it.each([['role', { role: 'DOCTOR_IN_CHARGE' }], ['status', { status: 'SUSPENDED' }]] as const)('allows self change with another active admin: %s', async (path, body) => {
    const auth = await session()
    await staff('ADMIN')
    const response = await mutation('patch', `/api/v1/staff/${adminId}/${path}`, auth, body)
    expect(response.status).toBe(200)
    expect(cookieFrom(response)).toContain('Expires=Thu, 01 Jan 1970')
    expect((await request(app).get('/api/v1/auth/me').set('Cookie', auth.cookie)).status).toBe(401)
  })

  it.each([['role', { role: 'RECORDS_OFFICER' }], ['status', { status: 'DISABLED' }]] as const)('serializes concurrent last-admin removal: %s', async (path, body) => {
    const otherAdmin = await staff('ADMIN')
    const one = await session()
    const two = await session(otherAdmin.id)
    const responses = await Promise.all([
      mutation('patch', `/api/v1/staff/${adminId}/${path}`, one, body),
      mutation('patch', `/api/v1/staff/${otherAdmin.id}/${path}`, two, body),
    ])
    expect(responses.map((res) => res.status).sort()).toEqual([200, 409])
    expect(await db.staffUser.count({ where: { role: 'ADMIN', status: 'ACTIVE' } })).toBe(1)
  })

  it('rechecks a queued administrator after another request revokes its session', async () => {
    const other = await staff('ADMIN')
    const auth = await session(other.id)
    const target = await staff()
    let release: (() => void) | undefined
    let acquired: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const locked = new Promise<void>((resolve) => { acquired = resolve })
    const blocker = db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(1296385106, 1)`
      acquired!()
      await gate
      await tx.staffSession.update({ where: { id: auth.id }, data: { revokedAt: new Date() } })
    })
    await locked
    const pending = mutation('patch', `/api/v1/staff/${target.id}/role`, auth, { role: 'ADMIN' }).then((response) => response)
    try {
      // Observe the request waiting on the database lock, proving middleware has
      // already accepted the session before we revoke it in the first transaction.
      const deadline = Date.now() + 2000
      let waiting = false
      while (!waiting && Date.now() < deadline) {
        const rows = await db.$queryRaw<Array<{ waiting: boolean }>>`
          SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database()
            AND wait_event = 'advisory') AS waiting`
        waiting = rows[0]!.waiting
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 20))
      }
      expect(waiting).toBe(true)
    } finally { release!() }
    await blocker
    expect((await pending).status).toBe(401)
    expect((await db.staffUser.findUniqueOrThrow({ where: { id: target.id } })).role).toBe('RECORDS_OFFICER')
  })

  it('lets an administrator revoke all sessions of another account with an audit', async () => {
    const auth = await session()
    const user = await staff()
    await session(user.id)
    await session(user.id)
    const response = await mutation('delete', `/api/v1/staff/${user.id}/sessions`, auth)
    expect(response.status).toBe(200)
    expect(await db.staffSession.count({ where: { staffUserId: user.id, revokedAt: null } })).toBe(0)
    expect(await db.auditEvent.count({ where: { entityId: user.id, action: 'SESSION_REVOKED' } })).toBe(1)
  })

  it.each(['role', 'status', 'sessions'])('requires CSRF for staff %s mutation', async (path) => {
    const auth = await session()
    const response = await request(app)[path === 'sessions' ? 'delete' : 'patch'](`/api/v1/staff/${adminId}/${path}`)
      .set('Cookie', auth.cookie).set('Origin', origin).send({ role: 'ADMIN', status: 'SUSPENDED' })
    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('CSRF_INVALID')
  })
})

describe('atomicity, abuse controls and private data', () => {
  it('enforces session hash uniqueness, staff relation, token format and expiry in PostgreSQL', async () => {
    const auth = await session()
    const original = await db.staffSession.findUniqueOrThrow({ where: { id: auth.id } })
    const { id: _id, ...data } = original
    await expect(db.staffSession.create({ data })).rejects.toMatchObject({ code: 'P2002' })
    await expect(db.staffSession.create({ data: { ...data, tokenHash: 'd'.repeat(64), staffUserId: randomUUID() } })).rejects.toMatchObject({ code: 'P2003' })
    await expect(db.staffSession.update({ where: { id: auth.id }, data: { tokenHash: 'plain-token' } })).rejects.toThrow()
    await expect(db.staffSession.update({ where: { id: auth.id }, data: { expiresAt: original.createdAt } })).rejects.toThrow()
  })
  it('rolls back login session and lastLogin when audit persistence fails', async () => {
    const user = await staff()
    const response = await login(user.email).set('X-Request-Id', 'fail-audit')
    expect(response.status).toBe(500)
    expect(response.headers['set-cookie']).toBeUndefined()
    expect(response.body.error).toEqual({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', requestId: 'fail-audit' })
    expect(await db.staffSession.count({ where: { staffUserId: user.id } })).toBe(0)
    expect((await db.staffUser.findUniqueOrThrow({ where: { id: user.id } })).lastLoginAt).toBeNull()
  })

  it('rolls back staff creation if audit persistence fails', async () => {
    const auth = await session()
    const email = 'rollback-create@example.test'
    const response = await mutation('post', '/api/v1/staff', auth, { firstName: 'Synthetic', lastName: 'Rollback',
      staffNumber: 'STF-ROLLBACK01', email, role: 'RECORDS_OFFICER', password }).set('X-Request-Id', 'fail-audit')
    expect(response.status).toBe(500)
    expect(await db.staffUser.findUnique({ where: { email } })).toBeNull()
  })

  it.each(['role', 'status', 'sessions'] as const)('rolls back %s and revocation when audit fails', async (path) => {
    const auth = await session()
    const user = await staff()
    const target = await session(user.id)
    const response = await mutation(path === 'sessions' ? 'delete' : 'patch', `/api/v1/staff/${user.id}/${path}`, auth,
      path === 'role' ? { role: 'ADMIN' } : path === 'status' ? { status: 'SUSPENDED' } : undefined).set('X-Request-Id', 'fail-audit')
    expect(response.status).toBe(500)
    expect((await db.staffSession.findUniqueOrThrow({ where: { id: target.id } })).revokedAt).toBeNull()
    expect(await db.staffUser.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({ role: user.role, status: user.status })
  })

  it('rolls back logout on audit failure', async () => {
    const auth = await session()
    const response = await mutation('post', '/api/v1/auth/logout', auth).set('X-Request-Id', 'fail-audit')
    expect(response.status).toBe(500)
    expect(response.headers['set-cookie']).toBeUndefined()
    expect((await db.staffSession.findUniqueOrThrow({ where: { id: auth.id } })).revokedAt).toBeNull()
  })

  it('limits login per IP after ten requests and includes Retry-After and request ID', async () => {
    for (let i = 0; i < 10; i++) expect((await login('unknown@example.test', 'wrong')).status).toBe(401)
    const response = await login('unknown@example.test', 'wrong')
    expect(response.status).toBe(429)
    expect(response.body.error.code).toBe('LOGIN_RATE_LIMITED')
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0)
    expect(response.body.error.requestId).toBe(response.headers['x-request-id'])
    expect(response.headers.ratelimit).toBeDefined()
  })

  it('does not trust spoofed forwarding headers to bypass the rate limit', async () => {
    for (let i = 0; i < 10; i++) await login('unknown@example.test', 'wrong')
    const response = await login('unknown@example.test', 'wrong').set('X-Forwarded-For', '192.0.2.200')
    expect(response.status).toBe(429)
  })

  it('returns safe errors for malformed JSON, validation failures, and internal exceptions', async () => {
    app = buildApp(true)
    const malformed = await request(app).post('/api/v1/auth/login').set('Origin', origin).set('Content-Type', 'application/json').send('{')
    expect(malformed.status).toBe(400)
    expect(malformed.body.error.code).toBe('INVALID_JSON')
    expect((await request(app).post('/api/v1/auth/login').set('Origin', origin).send({ email: 'invalid', password })).status).toBe(400)
    const spy = vi.spyOn(db.staffUser, 'findUnique').mockRejectedValueOnce(new Error('private database connection and SQL stack'))
    try {
      const response = await login('synthetic@example.test').set('X-Request-Id', 'safe-error-id')
      expect(response.status).toBe(500)
      expect(response.body.error).toEqual({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', requestId: 'safe-error-id' })
      expect(JSON.stringify(response.body)).not.toMatch(/stack|SQL|Prisma|connection/)
    } finally { spy.mockRestore() }
  })

  it('keeps passwords, session secrets, CSRF and arbitrary user-agent contents out of logs and audits', async () => {
    const user = await staff()
    const response = await login(user.email).set('User-Agent', `synthetic password ${password}`).set('X-Request-Id', 'privacy-audit')
    const cookie = cookieFrom(response).split(';')[0]!
    const token = cookie.split('=')[1]!
    secrets.add(token)
    const csrfResponse = await request(app).get('/api/v1/auth/csrf').set('Cookie', cookie)
    secrets.add(csrfResponse.body.data.csrfToken)
    await request(app).post('/api/v1/auth/logout').set('Cookie', cookie).set('Origin', origin).set('X-CSRF-Token', csrfResponse.body.data.csrfToken)
    const events = await db.auditEvent.findMany()
    const serialized = JSON.stringify(events)
    for (const secret of secrets) {
      expect(logs).not.toContain(secret)
      expect(serialized).not.toContain(secret)
    }
    expect(serialized).not.toContain('synthetic private SQL detail')
    const event = events.find((item) => item.requestId === 'privacy-audit')!
    expect(event.userAgent).toBe('Other')
    expect(event.ipAddress).not.toBeNull()
  })
})
