import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { Writable } from 'node:stream'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { disconnectDatabase } from '../src/database/prisma.js'
import { createLogger } from '../src/shared/logger/logger.js'
import { hashPassword } from '../src/shared/security/password.js'
import { createSession, hashSessionToken, pruneExpiredSessions } from '../src/modules/auth/session.service.js'
import { isolatedTestEnvironment, testDatabase } from './helpers/database.js'
import type { StaffRole, StaffStatus } from '../src/generated/prisma/client.js'

const db = testDatabase(), env = isolatedTestEnvironment()
const PASSWORD = 'Synthetic credential test passphrase', NEW_PASSWORD = 'Replacement synthetic passphrase 2026'
type Actor = { id: string; email: string; cookie: string; csrf: string; sessionId: string }
let hash: string, logs = '', app: ReturnType<typeof createApp>
const admins: Actor[] = []
async function staff(role: StaffRole = 'ADMIN', status: StaffStatus = 'ACTIVE', withPassword = true) {
  return db.staffUser.create({ data: { firstName: 'Synthetic', lastName: 'Credentials', email: `${randomUUID()}@example.test`, role, status,
    ...(withPassword ? { passwordHash: hash, passwordChangedAt: new Date() } : {}) } })
}
async function session(user: { id: string; email: string }): Promise<Actor> {
  const value = await db.$transaction((tx) => createSession(tx, user.id))
  return { id: user.id, email: user.email, cookie: `medicare_session=${value.token}`, csrf: value.session.csrfToken, sessionId: value.session.id }
}
const signedIn = async (role: StaffRole = 'ADMIN') => session(await staff(role))
function post(path: string, body: object, who: Actor, key?: string, csrf: string | null = who.csrf) {
  const call = request(app).post(path).set('Cookie', who.cookie).set('Origin', env.CLIENT_ORIGIN)
  if (csrf !== null) call.set('X-CSRF-Token', csrf)
  if (key !== undefined) call.set('Idempotency-Key', key)
  return call.send(body)
}
const me = (who: Actor) => request(app).get('/api/v1/auth/me').set('Cookie', who.cookie)
const login = (email: string, password: string) => request(app).post('/api/v1/auth/login').set('Origin', env.CLIENT_ORIGIN).send({ email, password })
const account = (overrides: object = {}) => {
  const suffix = randomBytes(5).toString('hex').toUpperCase()
  return { firstName: 'Synthetic', lastName: 'Recruit', email: `recruit-${suffix.toLowerCase()}@example.test`, staffNumber: `STF-NEW${suffix}`,
    role: 'RECORDS_OFFICER', password: PASSWORD, ...overrides }
}
const key = () => `staff-${randomUUID()}`
const created = (email: string) => db.staffUser.findMany({ where: { email } })
const audits = (entityId: string, action?: string) => db.auditEvent.findMany({ where: { entityId, ...(action ? { action: action as never } : {}) } })

beforeAll(async () => {
  hash = await hashPassword(PASSWORD)
  for (let index = 0; index < 2; index++) admins.push(await signedIn('ADMIN'))
})
beforeEach(() => {
  logs = ''
  app = createApp({ env, prisma: db, checkDatabase: async () => {}, logger: createLogger('info', new Writable({
    write(chunk: Buffer, _encoding, callback) { logs += chunk.toString(); callback() },
  })) })
})
afterAll(disconnectDatabase)

describe('staff creation idempotency', () => {
  it('replays an identical creation: one account, one audit event and the original result', async () => {
    const body = account(), retry = key()
    const first = await post('/api/v1/staff', body, admins[0]!, retry).expect(201)
    const second = await post('/api/v1/staff', body, admins[0]!, retry).expect(201)
    expect([first.headers['idempotency-replayed'], second.headers['idempotency-replayed']]).toEqual([undefined, 'true'])
    expect(second.body).toEqual(first.body)
    expect(Object.keys(first.body.data.user).sort()).toEqual(['email', 'firstName', 'id', 'lastName', 'role', 'staffNumber', 'status'])
    const users = await created(body.email)
    expect(users.map((user) => user.id)).toEqual([first.body.data.user.id])
    expect(await audits(users[0]!.id, 'STAFF_CREATED')).toHaveLength(1)
    const records = await db.idempotencyRecord.findMany({ where: { staffUserId: users[0]!.id } })
    expect(records.map((record) => [record.operation, record.principalId])).toEqual([['STAFF_CREATE', admins[0]!.id]])
    // Only digests are kept: no password, no password digest, no request content.
    const stored = JSON.stringify(records)
    for (const secret of [PASSWORD, createHash('sha256').update(PASSWORD).digest('hex'), body.email, body.staffNumber]) expect(stored).not.toContain(secret)
    expect(logs).not.toContain(PASSWORD)
  })

  it('refuses the same key with a changed field or a changed password, without a second account', async () => {
    const body = account(), retry = key()
    await post('/api/v1/staff', body, admins[0]!, retry).expect(201)
    for (const changed of [{ lastName: 'Different' }, { password: 'Another synthetic passphrase 99' }, { role: 'DOCTOR_IN_CHARGE' }]) {
      const response = await post('/api/v1/staff', { ...body, ...changed }, admins[0]!, retry).expect(409)
      expect(response.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED')
      expect(response.text).not.toContain(PASSWORD)
    }
    expect(await created(body.email)).toHaveLength(1)
    expect(logs).not.toMatch(/Another synthetic passphrase/)
  })

  it('creates exactly one account from concurrent identical requests', async () => {
    const body = account(), retry = key()
    const responses = await Promise.all(Array.from({ length: 5 }, () => post('/api/v1/staff', body, admins[0]!, retry)))
    expect(responses.map((response) => response.status)).toEqual([201, 201, 201, 201, 201])
    expect(new Set(responses.map((response) => response.body.data.user.id)).size).toBe(1)
    expect(responses.filter((response) => response.headers['idempotency-replayed'] === 'true')).toHaveLength(4)
    const users = await created(body.email)
    expect(users).toHaveLength(1)
    expect(await audits(users[0]!.id, 'STAFF_CREATED')).toHaveLength(1)
  })

  it('never replays another administrator’s request, and keeps duplicate refusals for new keys', async () => {
    const body = account(), retry = key()
    await post('/api/v1/staff', body, admins[0]!, retry).expect(201)
    const other = await post('/api/v1/staff', body, admins[1]!, retry).expect(409)
    expect([other.body.error.code, other.headers['idempotency-replayed']]).toEqual(['EMAIL_ALREADY_EXISTS', undefined])
    expect((await post('/api/v1/staff', body, admins[0]!, key()).expect(409)).body.error.code).toBe('EMAIL_ALREADY_EXISTS')
    expect((await post('/api/v1/staff', { ...body, email: `fresh-${randomUUID()}@example.test` }, admins[0]!, key()).expect(409)).body.error.code)
      .toBe('STAFF_NUMBER_ALREADY_EXISTS')
    expect((await post('/api/v1/staff', body, admins[0]!).expect(409)).body.error.code).toBe('EMAIL_ALREADY_EXISTS')
    expect(await created(body.email)).toHaveLength(1)
  })

  it('does not consume a key when CSRF, authorization or validation refuses the request', async () => {
    const body = account(), retry = key(), records = await signedIn('RECORDS_OFFICER')
    expect((await post('/api/v1/staff', body, admins[0]!, retry, null).expect(403)).body.error.code).toBe('CSRF_INVALID')
    expect((await post('/api/v1/staff', body, admins[0]!, retry, 'f'.repeat(64)).expect(403)).body.error.code).toBe('CSRF_INVALID')
    expect((await post('/api/v1/staff', body, records, retry).expect(403)).body.error.code).toBe('FORBIDDEN')
    expect((await post('/api/v1/staff', { ...body, password: 'short' }, admins[0]!, retry).expect(400)).body.error.code).toBe('VALIDATION_ERROR')
    expect((await post('/api/v1/staff', body, admins[0]!, 'bad key').expect(400)).body.error.code).toBe('INVALID_IDEMPOTENCY_KEY')
    expect(await db.idempotencyRecord.count({ where: { keyHash: createHash('sha256').update(retry).digest('hex') } })).toBe(0)
    const accepted = await post('/api/v1/staff', body, admins[0]!, retry).expect(201)
    expect(accepted.headers['idempotency-replayed']).toBeUndefined()
    expect(await created(body.email)).toHaveLength(1)
  })
})

describe('changing your own password', () => {
  it('requires the current password, signs out every session and only the new password works afterwards', async () => {
    const user = await staff('DOCTOR_IN_CHARGE'), first = await session(user), second = await session(user)
    const response = await post('/api/v1/auth/change-password', { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }, first).expect(200)
    expect(response.body).toEqual({ success: true, data: { passwordChanged: true } })
    expect(String(response.headers['set-cookie'])).toMatch(/^medicare_session=; Path=\/; Expires=Thu, 01 Jan 1970/)
    expect(response.headers['cache-control']).toBe('no-store')
    await me(first).expect(401); await me(second).expect(401)
    expect(await db.staffSession.count({ where: { staffUserId: user.id, revokedAt: null } })).toBe(0)
    expect((await login(user.email, PASSWORD).expect(401)).body.error.code).toBe('INVALID_CREDENTIALS')
    await login(user.email, NEW_PASSWORD).expect(200)
    const changed = await audits(user.id, 'PASSWORD_CHANGED')
    expect(changed.map((event) => [event.actorId, event.metadata])).toEqual([[user.id, { source: 'API' }]])
    const stored = await db.staffUser.findUniqueOrThrow({ where: { id: user.id } })
    expect(stored.passwordHash).toMatch(/^\$argon2id\$/); expect(stored.passwordChangedAt!.getTime()).toBeGreaterThan(user.passwordChangedAt!.getTime())
    expect(logs).not.toMatch(new RegExp(`${PASSWORD}|${NEW_PASSWORD}`))
  })

  it('refuses a wrong, unchanged or non-compliant password and any extra field, changing nothing', async () => {
    const user = await staff('RECORDS_OFFICER'), actor = await session(user)
    const attempts: [object, number, string][] = [
      [{ currentPassword: 'Not the synthetic passphrase', newPassword: NEW_PASSWORD }, 400, 'CURRENT_PASSWORD_INVALID'],
      [{ currentPassword: PASSWORD, newPassword: PASSWORD }, 400, 'PASSWORD_UNCHANGED'],
      [{ currentPassword: PASSWORD, newPassword: 'too short' }, 400, 'VALIDATION_ERROR'],
      [{ currentPassword: PASSWORD, newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD }, 400, 'VALIDATION_ERROR'],
      [{ newPassword: NEW_PASSWORD }, 400, 'VALIDATION_ERROR'],
    ]
    for (const [body, status, code] of attempts) {
      const response = await post('/api/v1/auth/change-password', body, actor).expect(status)
      expect([code, response.body.error.code]).toEqual([code, code])
      expect(response.text).not.toMatch(/passphrase|too short/)
    }
    await me(actor).expect(200)
    expect((await db.staffUser.findUniqueOrThrow({ where: { id: user.id } })).passwordHash).toBe(user.passwordHash)
    expect(await audits(user.id, 'PASSWORD_CHANGED')).toHaveLength(0)
  })

  it('needs CSRF and a trusted origin, and limits refused attempts per account', async () => {
    const user = await staff('ADMIN'), actor = await session(user), other = await session(await staff('ADMIN'))
    const body = { currentPassword: 'Wrong synthetic passphrase here', newPassword: NEW_PASSWORD }
    expect((await post('/api/v1/auth/change-password', body, actor, undefined, null).expect(403)).body.error.code).toBe('CSRF_INVALID')
    expect((await request(app).post('/api/v1/auth/change-password').set('Cookie', actor.cookie).set('X-CSRF-Token', actor.csrf)
      .set('Origin', 'https://untrusted.example.test').send(body).expect(403)).body.error.code).toBe('ORIGIN_NOT_ALLOWED')
    await request(app).post('/api/v1/auth/change-password').set('Origin', env.CLIENT_ORIGIN).send(body).expect(401)
    for (let attempt = 0; attempt < 5; attempt++) await post('/api/v1/auth/change-password', body, actor).expect(400)
    const limited = await post('/api/v1/auth/change-password', { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }, actor).expect(429)
    expect(limited.body.error.code).toBe('PASSWORD_CHANGE_RATE_LIMITED')
    // Another account is not affected by this account's refused attempts.
    await post('/api/v1/auth/change-password', { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }, other).expect(200)
    expect((await db.staffUser.findUniqueOrThrow({ where: { id: user.id } })).passwordHash).toBe(user.passwordHash)
  })
})

describe('administrator password reset and credential setup', () => {
  const reset = (id: string, body: object, who: Actor, csrf?: string | null) => post(`/api/v1/staff/${id}/reset-password`, body, who, undefined, csrf)

  it('resets an active account, signs out its sessions and never returns the password', async () => {
    const target = await staff('DOCTOR_IN_CHARGE'), targetSession = await session(target)
    const before = await db.staffUser.count({ where: { role: 'ADMIN', status: 'ACTIVE' } })
    const response = await reset(target.id, { password: NEW_PASSWORD }, admins[0]!).expect(200)
    expect(Object.keys(response.body.data.user).sort()).toEqual(['email', 'firstName', 'id', 'lastName', 'role', 'staffNumber', 'status'])
    expect(response.text).not.toMatch(/passphrase|argon2|passwordHash/)
    expect(response.body.data.user.status).toBe('ACTIVE')
    await me(targetSession).expect(401)
    await login(target.email, PASSWORD).expect(401)
    await login(target.email, NEW_PASSWORD).expect(200)
    expect((await audits(target.id, 'PASSWORD_RESET')).map((event) => [event.actorId, event.metadata])).toEqual([[admins[0]!.id, { source: 'API' }]])
    // The administrator's own session and the active-administrator count are unchanged.
    await me(admins[0]!).expect(200)
    expect(await db.staffUser.count({ where: { role: 'ADMIN', status: 'ACTIVE' } })).toBe(before)
    expect(logs).not.toContain(NEW_PASSWORD)
  })

  it('sets credentials for a pending account without activating it, and keeps suspended accounts suspended', async () => {
    const pending = await staff('RECORDS_OFFICER', 'PENDING', false)
    const change = (id: string, status: string) => request(app).patch(`/api/v1/staff/${id}/status`).set('Cookie', admins[0]!.cookie)
      .set('Origin', env.CLIENT_ORIGIN).set('X-CSRF-Token', admins[0]!.csrf).send({ status })
    expect((await change(pending.id, 'ACTIVE').expect(409)).body.error.code).toBe('CREDENTIALS_REQUIRED')
    expect((await reset(pending.id, { password: NEW_PASSWORD }, admins[0]!).expect(200)).body.data.user.status).toBe('PENDING')
    await login(pending.email, NEW_PASSWORD).expect(401)
    await change(pending.id, 'ACTIVE').expect(200)
    await login(pending.email, NEW_PASSWORD).expect(200)
    const suspended = await staff('DOCTOR_IN_CHARGE', 'SUSPENDED')
    expect((await reset(suspended.id, { password: NEW_PASSWORD }, admins[0]!).expect(200)).body.data.user.status).toBe('SUSPENDED')
    await login(suspended.email, NEW_PASSWORD).expect(401)
  })

  it('refuses disabled accounts, self-reset, other roles, missing CSRF and weak passwords', async () => {
    const disabled = await staff('DOCTOR_IN_CHARGE', 'DISABLED'), target = await staff('RECORDS_OFFICER')
    expect((await reset(disabled.id, { password: NEW_PASSWORD }, admins[0]!).expect(409)).body.error.code).toBe('ACCOUNT_DISABLED')
    expect((await reset(admins[0]!.id, { password: NEW_PASSWORD }, admins[0]!).expect(409)).body.error.code).toBe('SELF_PASSWORD_RESET')
    for (const role of ['RECORDS_OFFICER', 'DOCTOR_IN_CHARGE'] as const) {
      expect((await reset(target.id, { password: NEW_PASSWORD }, await signedIn(role)).expect(403)).body.error.code).toBe('FORBIDDEN')
    }
    expect((await reset(target.id, { password: NEW_PASSWORD }, admins[0]!, null).expect(403)).body.error.code).toBe('CSRF_INVALID')
    expect((await reset(target.id, { password: 'short' }, admins[0]!).expect(400)).body.error.code).toBe('VALIDATION_ERROR')
    expect((await reset(target.id, { password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD }, admins[0]!).expect(400)).body.error.code).toBe('VALIDATION_ERROR')
    expect((await reset(randomUUID(), { password: NEW_PASSWORD }, admins[0]!).expect(404)).body.error.code).toBe('STAFF_NOT_FOUND')
    for (const id of [disabled.id, target.id, admins[0]!.id]) {
      expect((await db.staffUser.findUniqueOrThrow({ where: { id } })).passwordHash).toBe(hash)
      expect(await audits(id, 'PASSWORD_RESET')).toHaveLength(0)
    }
  })
})

describe('session pruning', () => {
  async function expiredSession(staffUserId: string, revoked: boolean) {
    const created = new Date(Date.now() - 10 * 3600000)
    return db.staffSession.create({ data: { staffUserId, tokenHash: hashSessionToken(randomBytes(32).toString('hex')), csrfToken: randomBytes(32).toString('hex'),
      createdAt: created, expiresAt: new Date(created.getTime() + 8 * 3600000), revokedAt: revoked ? new Date(created.getTime() + 3600000) : null } })
  }
  it('removes only sessions whose expiry has passed, in batches, and is safe to rerun', async () => {
    const user = await staff('RECORDS_OFFICER')
    const active = await session(user), revokedActive = await session(user)
    await db.staffSession.update({ where: { id: revokedActive.sessionId }, data: { revokedAt: new Date() } })
    const expired = [await expiredSession(user.id, false), await expiredSession(user.id, true)]
    const created = new Date(Date.now() - 10 * 3600000)
    await db.staffSession.createMany({ data: Array.from({ length: 1205 }, () => ({ staffUserId: user.id, tokenHash: hashSessionToken(randomBytes(32).toString('hex')),
      csrfToken: randomBytes(32).toString('hex'), createdAt: created, expiresAt: new Date(created.getTime() + 3600000) })) })
    const expiredTotal = await db.staffSession.count({ where: { expiresAt: { lte: new Date() } } })
    expect(await pruneExpiredSessions(db)).toBe(expiredTotal)
    expect(await pruneExpiredSessions(db)).toBe(0)
    const left = (await db.staffSession.findMany({ where: { staffUserId: user.id }, select: { id: true } })).map((row) => row.id).sort()
    expect(left).toEqual([active.sessionId, revokedActive.sessionId].sort())
    for (const row of expired) expect(await db.staffSession.findUnique({ where: { id: row.id } })).toBeNull()
    await me(active).expect(200)
  })

  it('runs as a maintenance command that reports a count or fails with a fixed code and a non-zero exit', async () => {
    const run = async (script: string, databaseUrl: string) => {
      const child = spawn(process.execPath, [script], { cwd: new URL('../', import.meta.url), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
        env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, DATABASE_URL: databaseUrl } })
      let output = ''
      child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() }); child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString() })
      const [code] = await once(child, 'exit') as [number]
      return { code, output }
    }
    await expiredSession((await staff('ADMIN')).id, false)
    for (const [script, noun] of [['dist/cli/pruneSessions.js', 'expired session'], ['dist/cli/pruneIdempotency.js', 'expired idempotency record']] as const) {
      const ok = await run(script, env.DATABASE_URL)
      expect([script, ok.code]).toEqual([script, 0]); expect(ok.output).toMatch(new RegExp(`^Removed \\d+ ${noun}\\(s\\)\\.\\n$`))
      const again = await run(script, env.DATABASE_URL)
      expect(again.output).toBe(`Removed 0 ${noun}(s).\n`)
      const invalid = await run(script, 'mysql://private-user:private-secret@localhost/db')
      expect([invalid.code, invalid.output]).toEqual([1, `${noun.startsWith('expired session') ? 'Session' : 'Idempotency'} cleanup failed: INVALID_CONFIGURATION\n`])
      const unreachable = await run(script, 'postgresql://private-user:private-secret@127.0.0.1:1/medicare_test_absent')
      expect(unreachable.code).toBe(1); expect(unreachable.output).toMatch(/cleanup failed: CLEANUP_FAILED\n/)
      expect(invalid.output + unreachable.output).not.toMatch(/private-secret|private-user/)
    }
  })
})
