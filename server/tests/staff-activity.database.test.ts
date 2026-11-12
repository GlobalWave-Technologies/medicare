import { randomUUID } from 'node:crypto'
import { Writable } from 'node:stream'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { disconnectDatabase } from '../src/database/prisma.js'
import { createLogger } from '../src/shared/logger/logger.js'
import { hashPassword } from '../src/shared/security/password.js'
import { createSession, recordActivity } from '../src/modules/auth/session.service.js'
import { activityLabels } from '../src/modules/staff-activity/activity.labels.js'
import { isolatedTestEnvironment, testDatabase } from './helpers/database.js'
import type { StaffRole } from '../src/generated/prisma/client.js'

// Phase 19D: who is signed in, when each person last used the system, and a safe list of what they
// did, for administrators only. Nothing clinical, no patient identifiers, no credentials.
const db = testDatabase(), env = isolatedTestEnvironment(), base = '/api/v1/staff-activity'
const PASSWORD = 'Synthetic staff activity passphrase'
type Actor = { id: string; cookie: string; csrf: string; sessionId: string; email: string }
const actors = new Map<StaffRole, Actor>()
const actor = (role: StaffRole = 'ADMIN') => actors.get(role)!
let hash: string, logs = '', app: ReturnType<typeof createApp>
const MINUTE = 60000

async function newActor(role: StaffRole, lastName = `Activity${randomUUID().slice(0, 6)}`): Promise<Actor> {
  const email = `${randomUUID()}@example.test`
  const user = await db.staffUser.create({ data: { firstName: 'Synthetic', lastName, email, role, status: 'ACTIVE', passwordHash: hash, passwordChangedAt: new Date(),
    staffNumber: `STF-${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}` } })
  const session = await db.$transaction((tx) => createSession(tx, user.id))
  return { id: user.id, cookie: `medicare_session=${session.token}`, csrf: session.session.csrfToken, sessionId: session.session.id, email }
}
async function extraSession(who: Actor): Promise<Actor> {
  const session = await db.$transaction((tx) => createSession(tx, who.id))
  return { ...who, cookie: `medicare_session=${session.token}`, csrf: session.session.csrfToken, sessionId: session.session.id }
}
function send(method: 'post' | 'patch' | 'delete', path: string, body: object = {}, who = actor()) {
  return request(app)[method](path).set('Cookie', who.cookie).set('Origin', env.CLIENT_ORIGIN).set('X-CSRF-Token', who.csrf).send(body)
}
const read = (path: string, who: Actor | null = actor(), background = false) => {
  const call = request(app).get(path)
  if (who) call.set('Cookie', who.cookie)
  if (background) call.set('X-Background-Refresh', '1')
  return call
}
// Moves a session back in time: signed in two hours ago, last used `minutes` ago.
const lastUsed = (sessionId: string, minutes: number) => db.staffSession.update({ where: { id: sessionId },
  data: { createdAt: new Date(Date.now() - 120 * MINUTE), lastActivityAt: new Date(Date.now() - minutes * MINUTE) } })
const session = (id: string) => db.staffSession.findUniqueOrThrow({ where: { id } })
// Anything secret, clinical or identifying that must never appear in an activity response.
const forbidden = /tokenHash|csrf|"password"|passwordHash|ipAddress|userAgent|metadata|requestId|"email"|PT-[0-9A-F]{8}|Private|diagnos|Paracetamol|dose|complaint|clinicalNotes|dischargeNotes|roomNumber|Ward/i

beforeAll(async () => {
  hash = await hashPassword(PASSWORD)
  for (const role of ['ADMIN', 'RECORDS_OFFICER', 'DOCTOR_IN_CHARGE'] as const) actors.set(role, await newActor(role))
})
beforeEach(() => {
  logs = ''
  app = createApp({ env, prisma: db, checkDatabase: async () => {}, logger: createLogger('info', new Writable({
    write(chunk: Buffer, _encoding, callback) { logs += chunk.toString(); callback() },
  })) })
})
afterAll(disconnectDatabase)

describe('permissions', () => {
  const paths = () => [`${base}/active`, `${base}/events`, `${base}/staff/${actor('DOCTOR_IN_CHARGE').id}`]
  it('lets an administrator read every activity view', async () => {
    for (const path of paths()) expect([path, (await read(path)).status]).toEqual([path, 200])
  })
  it.each(['DOCTOR_IN_CHARGE', 'RECORDS_OFFICER'] as const)('refuses %s on every activity route, including session revocation', async (role) => {
    for (const path of paths()) expect([path, (await read(path, actor(role))).status]).toEqual([path, 403])
    const target = await newActor('RECORDS_OFFICER')
    expect((await send('post', `/api/v1/staff/${target.id}/sessions/${target.sessionId}/revoke`, {}, actor(role))).status).toBe(403)
    expect((await session(target.sessionId)).revokedAt).toBeNull()
  })
  it('refuses requests without a session', async () => {
    for (const path of paths()) expect([path, (await read(path, null)).status]).toEqual([path, 401])
  })
  it('refuses an administrator who still holds a temporary password', async () => {
    const admin = await newActor('ADMIN')
    await db.staffUser.update({ where: { id: admin.id }, data: { mustChangePassword: true } })
    expect((await read(`${base}/active`, admin)).status).toBe(403)
  })
  it.each(['limit=51', 'limit=0', 'page=0', 'period=year', 'category=views', 'role=SUPERUSER', 'actorId=x', 'action=LOGIN_FAILED', 'staffId=x', `search=${'x'.repeat(101)}`])(
    'rejects activity query %s', async (query) => expect((await read(`${base}/events?${query}`)).status).toBe(400))
  it('rejects malformed staff and session identifiers', async () => {
    expect((await read(`${base}/staff/not-a-uuid`)).status).toBe(400)
    expect((await read(`${base}/staff/${randomUUID()}`)).status).toBe(404)
    expect((await send('post', `/api/v1/staff/${actor('RECORDS_OFFICER').id}/sessions/nope/revoke`)).status).toBe(400)
  })
})

describe('last login and last activity', () => {
  it('records the last sign-in and counts it as activity', async () => {
    const who = await newActor('RECORDS_OFFICER')
    expect((await db.staffUser.findUniqueOrThrow({ where: { id: who.id } })).lastLoginAt).toBeNull()
    const before = Date.now()
    const login = await request(app).post('/api/v1/auth/login').set('Origin', env.CLIENT_ORIGIN).send({ email: who.email, password: PASSWORD })
    expect(login.status).toBe(200)
    const user = await db.staffUser.findUniqueOrThrow({ where: { id: who.id } })
    expect(user.lastLoginAt!.getTime()).toBeGreaterThanOrEqual(before - 1000)
    expect(user.lastActivityAt!.getTime()).toBe(user.lastLoginAt!.getTime())
    const created = await db.staffSession.findFirstOrThrow({ where: { staffUserId: who.id }, orderBy: { createdAt: 'desc' } })
    expect(created.lastActivityAt.getTime()).toBe(created.createdAt.getTime())
  })
  it('records activity from a signed-in request, at most once a minute per session', async () => {
    const who = await newActor('RECORDS_OFFICER')
    await lastUsed(who.sessionId, 3)
    const stale = (await session(who.sessionId)).lastActivityAt
    expect((await read('/api/v1/patients', who)).status).toBe(200)
    const touched = (await session(who.sessionId)).lastActivityAt
    expect(touched.getTime()).toBeGreaterThan(stale.getTime() + 2 * MINUTE)
    expect((await db.staffUser.findUniqueOrThrow({ where: { id: who.id } })).lastActivityAt!.getTime()).toBe(touched.getTime())
    // Within the minute nothing more is written.
    for (let i = 0; i < 3; i++) expect((await read('/api/v1/patients', who)).status).toBe(200)
    expect((await session(who.sessionId)).lastActivityAt.getTime()).toBe(touched.getTime())
  })
  it('does not count automatic background refreshes as activity', async () => {
    const who = await newActor('RECORDS_OFFICER')
    await lastUsed(who.sessionId, 10)
    const stale = (await session(who.sessionId)).lastActivityAt
    expect((await read('/api/v1/dashboard', who, true)).status).toBe(200)
    expect((await session(who.sessionId)).lastActivityAt.getTime()).toBe(stale.getTime())
  })
  it('never moves activity on a revoked or expired session, and never backwards', async () => {
    const who = await newActor('RECORDS_OFFICER')
    await lastUsed(who.sessionId, 10)
    const before = await session(who.sessionId)
    await db.staffSession.update({ where: { id: who.sessionId }, data: { revokedAt: new Date() } })
    expect(await recordActivity(db, before)).toBe(false)
    expect((await session(who.sessionId)).lastActivityAt.getTime()).toBe(before.lastActivityAt.getTime())
    const later = await extraSession(who)
    expect(await recordActivity(db, await session(later.sessionId), new Date(Date.now() - 5 * MINUTE))).toBe(false)
    await expect(db.staffSession.update({ where: { id: later.sessionId }, data: { lastActivityAt: new Date(Date.now() - 24 * 3600000) } })).rejects.toThrow()
  })
  it('shows last sign-in and last activity in Staff & Access, or nothing for someone who never signed in', async () => {
    const never = await db.staffUser.create({ data: { firstName: 'Synthetic', lastName: 'Never', email: `${randomUUID()}@example.test`, role: 'RECORDS_OFFICER', status: 'PENDING',
      staffNumber: `STF-${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}` } })
    const detail = (await read(`/api/v1/staff/${never.id}`)).body.data.user
    expect([detail.lastLoginAt, detail.lastActivityAt]).toEqual([null, null])
    const list = (await read('/api/v1/staff?limit=100')).body.data.users as Array<Record<string, unknown>>
    expect(list.every((user) => 'lastLoginAt' in user && 'lastActivityAt' in user && !('passwordHash' in user))).toBe(true)
    // The signed-in identity keeps its own small shape.
    expect(Object.keys((await read('/api/v1/auth/me')).body.data.user)).not.toContain('lastActivityAt')
  })
})

describe('who is signed in', () => {
  it('shows each signed-in person once, with Active now, Recently active and Idle from their last activity', async () => {
    const active = await newActor('DOCTOR_IN_CHARGE', 'ActiveNow'), recent = await newActor('DOCTOR_IN_CHARGE', 'Recent'), idle = await newActor('RECORDS_OFFICER', 'Idle')
    await lastUsed(active.sessionId, 2); await lastUsed(recent.sessionId, 12); await lastUsed(idle.sessionId, 45)
    const { data } = (await read(`${base}/active`)).body
    const row = (id: string) => data.staff.find((entry: { staff: { id: string } }) => entry.staff.id === id)
    expect([row(active.id).status, row(recent.id).status, row(idle.id).status]).toEqual(['ACTIVE_NOW', 'RECENTLY_ACTIVE', 'IDLE'])
    expect(data.thresholds).toEqual({ activeNowMinutes: 5, recentMinutes: 30 })
    expect(Object.keys(row(active.id)).sort()).toEqual(['lastActivityAt', 'sessions', 'signedInAt', 'staff', 'status'])
    expect(Object.keys(row(active.id).staff).sort()).toEqual(['firstName', 'id', 'lastName', 'role', 'staffNumber'])
    expect(data.summary.signedIn).toBe(data.staff.length)
    expect(data.summary.activeNow).toBe(data.staff.filter((entry: { status: string }) => entry.status === 'ACTIVE_NOW').length)
    expect(JSON.stringify(data)).not.toMatch(forbidden)
  })
  it('counts several sessions of one person, each with its own sign-in and activity, without tokens', async () => {
    const who = await newActor('DOCTOR_IN_CHARGE'), second = await extraSession(who)
    await lastUsed(who.sessionId, 20)
    const entry = (await read(`${base}/active`)).body.data.staff.find((row: { staff: { id: string } }) => row.staff.id === who.id)
    expect(entry.sessions).toBe(2); expect(entry.status).toBe('ACTIVE_NOW')
    const detail = (await read(`${base}/staff/${who.id}`)).body.data
    expect(detail.sessions.map((row: { id: string }) => row.id).sort()).toEqual([who.sessionId, second.sessionId].sort())
    for (const row of detail.sessions) expect(Object.keys(row).sort()).toEqual(['current', 'expiresAt', 'id', 'lastActivityAt', 'signedInAt', 'status'])
    expect(detail.sessions.find((row: { id: string }) => row.id === who.sessionId).status).toBe('RECENTLY_ACTIVE')
    expect(JSON.stringify(detail)).not.toMatch(forbidden)
  })
  it('drops signed-out, revoked and expired sessions and inactive accounts from the list', async () => {
    const out = await newActor('RECORDS_OFFICER'), expired = await newActor('RECORDS_OFFICER'), suspended = await newActor('RECORDS_OFFICER')
    expect((await send('post', '/api/v1/auth/logout', {}, out)).status).toBe(200)
    await db.staffSession.update({ where: { id: expired.sessionId }, data: { createdAt: new Date(Date.now() - 120000), lastActivityAt: new Date(Date.now() - 120000), expiresAt: new Date(Date.now() - 60000) } })
    await db.staffUser.update({ where: { id: suspended.id }, data: { status: 'SUSPENDED' } })
    const ids = (await read(`${base}/active`)).body.data.staff.map((row: { staff: { id: string } }) => row.staff.id)
    for (const gone of [out, expired, suspended]) expect(ids).not.toContain(gone.id)
    expect((await read(`${base}/staff/${expired.id}`)).body.data.sessions).toEqual([])
  })
  it('marks the administrator’s own session as current', async () => {
    const detail = (await read(`${base}/staff/${actor().id}`)).body.data
    expect(detail.sessions.find((row: { id: string }) => row.id === actor().sessionId).current).toBe(true)
  })
  it('adds staff active now and signed in today to the administrator’s Overview only', async () => {
    const admin = (await read('/api/v1/dashboard')).body.data.snapshot
    expect(admin.staffActiveNow).toBeGreaterThanOrEqual(1); expect(Number.isInteger(admin.staffSignedInToday)).toBe(true)
    for (const role of ['RECORDS_OFFICER', 'DOCTOR_IN_CHARGE'] as const) expect(Object.keys((await read('/api/v1/dashboard', actor(role))).body.data.snapshot)).not.toContain('staffActiveNow')
  })
})

describe('ending sessions', () => {
  it('ends one session: that browser is signed out, the others keep working, and it is audited once', async () => {
    const who = await newActor('DOCTOR_IN_CHARGE'), other = await extraSession(who)
    const response = await send('post', `/api/v1/staff/${who.id}/sessions/${who.sessionId}/revoke`)
    expect(response.status).toBe(200); expect(response.body.data).toEqual({ revoked: true })
    expect((await read('/api/v1/patients', who)).status).toBe(401)
    expect((await read('/api/v1/patients', other)).status).toBe(200)
    const audit = await db.auditEvent.findMany({ where: { action: 'STAFF_SESSION_REVOKED', entityId: who.id } })
    expect(audit.map((row) => [row.actorId, row.entityType, row.metadata])).toEqual([[actor().id, 'STAFF_USER', { source: 'API' }]])
    expect((await send('post', `/api/v1/staff/${who.id}/sessions/${who.sessionId}/revoke`)).body.error.code).toBe('SESSION_NOT_FOUND')
    expect(await db.auditEvent.count({ where: { action: 'STAFF_SESSION_REVOKED', entityId: who.id } })).toBe(1)
  })
  it('refuses a session that belongs to someone else, a missing CSRF token or another origin', async () => {
    const who = await newActor('RECORDS_OFFICER'), stranger = await newActor('RECORDS_OFFICER')
    expect((await send('post', `/api/v1/staff/${stranger.id}/sessions/${who.sessionId}/revoke`)).status).toBe(404)
    expect((await request(app).post(`/api/v1/staff/${who.id}/sessions/${who.sessionId}/revoke`).set('Cookie', actor().cookie).set('Origin', env.CLIENT_ORIGIN).send({})).status).toBe(403)
    expect((await request(app).post(`/api/v1/staff/${who.id}/sessions/${who.sessionId}/revoke`).set('Cookie', actor().cookie).set('Origin', 'https://elsewhere.example').set('X-CSRF-Token', actor().csrf).send({})).status).toBe(403)
    expect((await send('post', `/api/v1/staff/${who.id}/sessions/${who.sessionId}/revoke`, { reason: 'x' })).status).toBe(400)
    expect((await session(who.sessionId)).revokedAt).toBeNull()
  })
  it('signs a person out everywhere and says so in the activity list', async () => {
    const who = await newActor('DOCTOR_IN_CHARGE', 'Everywhere'), other = await extraSession(who)
    expect((await send('delete', `/api/v1/staff/${who.id}/sessions`)).status).toBe(200)
    for (const browser of [who, other]) expect((await read('/api/v1/patients', browser)).status).toBe(401)
    const items = (await read(`${base}/staff/${who.id}`)).body.data.activity.items
    expect(items[0]).toMatchObject({ event: 'SESSION_REVOKED', category: 'authentication', text: 'Signed Synthetic Everywhere out on all devices', actor: { id: actor().id } })
  })
})

describe('the activity list', () => {
  async function clinicalWork() {
    const doctor = actor('DOCTOR_IN_CHARGE'), ro = actor('RECORDS_OFFICER'), tag = randomUUID().slice(0, 8)
    const patient = (await send('post', '/api/v1/patients', { firstName: 'Private', lastName: `Patient${tag}` }, ro)).body.data.patient
    const stay = (await send('post', '/api/v1/admissions', { patientId: patient.id, roomNumber: 'Ward Private 9' }, ro)).body.data.admission
    const medicine = await db.medication.findFirstOrThrow({ where: { name: 'Paracetamol' } })
    const record = (await send('post', '/api/v1/encounters', { admissionId: stay.id, clinicalNotes: 'Private clinical note', complaints: [{ description: 'Private complaint' }],
      diagnoses: [{ description: 'Private diagnosis malaria' }], medications: [{ medicationId: medicine.id, dose: 'Private dose 2 tablets', route: 'Oral', frequency: 'Twice daily' }] }, doctor)).body.data.encounter
    expect((await send('post', `/api/v1/encounters/${record.id}/finalize`, {}, doctor)).status).toBe(200)
    expect((await send('post', `/api/v1/admissions/${stay.id}/discharge`, { dischargeNotes: 'Private discharge note' }, doctor)).status).toBe(200)
    await read(`/api/v1/encounters/${record.id}`, doctor)
    return { patient, record }
  }
  it('describes clinical work in safe sentences only, never its content or the patient', async () => {
    const { patient } = await clinicalWork()
    const { data } = (await read(`${base}/events?limit=50&role=DOCTOR_IN_CHARGE`)).body
    const texts = data.items.filter((item: { actor: { id: string } }) => item.actor.id === actor('DOCTOR_IN_CHARGE').id).map((item: { text: string }) => item.text)
    expect(texts).toEqual(expect.arrayContaining(['Created a draft clinical record', 'Finalized a clinical record', 'Discharged a patient']))
    const json = JSON.stringify(data)
    expect(json).not.toMatch(forbidden); expect(json).not.toContain(patient.patientNumber); expect(json).not.toContain(patient.id)
    // Viewing a record is not listed as activity.
    expect(data.items.some((item: { event: string }) => /VIEWED/.test(item.event))).toBe(false)
    for (const item of data.items) expect(Object.keys(item).sort()).toEqual(['actor', 'category', 'event', 'id', 'occurredAt', 'subject', 'text'])
  })
  it('filters by category, role, staff name or number, and period, newest first', async () => {
    await clinicalWork()
    const events = async (query: string) => (await read(`${base}/events?limit=50&${query}`)).body.data.items as Array<{ category: string; actor: { role: string; staffNumber: string; lastName: string }; occurredAt: string }>
    expect((await events('category=admissions')).every((item) => item.category === 'admissions')).toBe(true)
    expect((await events('category=clinical')).length).toBeGreaterThan(0)
    expect((await events('role=RECORDS_OFFICER')).every((item) => item.actor.role === 'RECORDS_OFFICER')).toBe(true)
    const doctor = await db.staffUser.findUniqueOrThrow({ where: { id: actor('DOCTOR_IN_CHARGE').id } })
    const byNumber = await events(`search=${doctor.staffNumber.slice(4, 10).toLowerCase()}`)
    expect(byNumber.length).toBeGreaterThan(0); expect(byNumber.every((item) => item.actor.staffNumber === doctor.staffNumber)).toBe(true)
    expect((await events(`search=${encodeURIComponent(`synthetic ${doctor.lastName}`)}`)).every((item) => item.actor.lastName === doctor.lastName)).toBe(true)
    expect(await events('search=%25')).toEqual([])
    const times = (await events('period=last30')).map((item) => item.occurredAt)
    expect(times).toEqual([...times].sort().reverse())
    const old = await db.auditEvent.create({ data: { actorId: actor('RECORDS_OFFICER').id, action: 'PATIENT_CREATED', entityType: 'PATIENT', entityId: randomUUID(), metadata: { source: 'API' }, createdAt: new Date(Date.now() - 3 * 86400000) } })
    const has = async (period: string) => (await events(`period=${period}&category=patients&role=RECORDS_OFFICER`)).some((item) => (item as unknown as { id: string }).id === old.id)
    expect([await has('today'), await has('last7'), await has('last30')]).toEqual([false, true, true])
  })
  it('pages through at most 50 events at a time with an exact total', async () => {
    const { data } = (await read(`${base}/events?limit=2&period=last30`)).body
    expect(data.items).toHaveLength(2); expect(data.pagination.limit).toBe(2); expect(data.pagination.total).toBeGreaterThan(2)
    const next = (await read(`${base}/events?limit=2&page=2&period=last30`)).body.data.items
    expect(next.map((item: { id: string }) => item.id)).not.toContain(data.items[0].id)
  })
  it('lists sign-ins, sign-outs and password changes as authentication, and leaves out failed sign-ins', async () => {
    const who = await newActor('RECORDS_OFFICER', 'Signer')
    await request(app).post('/api/v1/auth/login').set('Origin', env.CLIENT_ORIGIN).send({ email: who.email, password: PASSWORD })
    await request(app).post('/api/v1/auth/login').set('Origin', env.CLIENT_ORIGIN).send({ email: who.email, password: 'Wrong synthetic passphrase' })
    await send('post', '/api/v1/auth/logout', {}, who)
    const items = (await read(`${base}/staff/${who.id}`)).body.data.activity.items as Array<{ text: string; category: string }>
    expect(items.map((item) => item.text)).toEqual(['Signed out', 'Signed in'])
    expect(items.every((item) => item.category === 'authentication')).toBe(true)
    expect(JSON.stringify(items)).not.toMatch(/LOGIN_FAILED|Wrong/)
  })
  it('names the staff member an administrator acted on, and nobody else', async () => {
    const target = await newActor('RECORDS_OFFICER', 'Target')
    expect((await send('post', `/api/v1/staff/${target.id}/reset-password`, { password: 'Synthetic reset passphrase 2026' })).status).toBe(200)
    const item = (await read(`${base}/staff/${target.id}`)).body.data.activity.items[0]
    expect(item).toMatchObject({ event: 'PASSWORD_RESET', category: 'staff', text: 'Reset Synthetic Target’s password', subject: { id: target.id }, actor: { id: actor().id } })
  })
  it('labels every listed action in plain words, never with the internal name', () => {
    for (const [action, label] of Object.entries(activityLabels)) {
      const text = label.text('Synthetic Person', false)
      expect([action, /^[A-Z][a-z]/.test(text) && !/_/.test(text)]).toEqual([action, true])
    }
  })
  it('does not audit an administrator reading the activity views', async () => {
    const before = await db.auditEvent.count()
    await read(`${base}/active`); await read(`${base}/events`); await read(`${base}/staff/${actor('RECORDS_OFFICER').id}`)
    expect(await db.auditEvent.count()).toBe(before)
    expect(logs).not.toMatch(/Private|tokenHash|csrfToken/)
  })
})
