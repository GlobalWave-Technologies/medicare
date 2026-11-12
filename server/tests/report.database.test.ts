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
import { patientActivity, admissionActivity } from '../src/modules/reports/report.queries.js'
import { resolveReportRange } from '../src/modules/reports/report.validation.js'
import type { StaffRole, EncounterStatus } from '../src/generated/prisma/client.js'

const db = testDatabase(), env = isolatedTestEnvironment()
const paths = ['/api/v1/dashboard', '/api/v1/reports/patients', '/api/v1/reports/admissions'] as const
const roles = ['ADMIN', 'RECORDS_OFFICER', 'DOCTOR_IN_CHARGE'] as const
type Actor = { id: string; cookie: string; sessionId: string }
const actors = new Map<StaffRole, Actor>()
const actor = (role: StaffRole = 'ADMIN') => actors.get(role)!
let hash: string, logs = '', app: ReturnType<typeof createApp>, otherDoctor: Actor
const from = '2024-02-28T00:00:00Z', to = '2024-03-02T00:00:00Z'
const query = (start = from, end = to, bucket = 'day') => new URLSearchParams({ from: start, to: end, bucket }).toString()
const read = (path: string, who = actor()) => request(app).get(path).set('Cookie', who.cookie)
const current = () => db.admission.count({ where: { status: 'ADMITTED' } })
async function newActor(role: StaffRole = 'DOCTOR_IN_CHARGE'): Promise<Actor> {
  const user = await db.staffUser.create({ data: { firstName: 'PrivateStaff', lastName: 'Report', email: `${randomUUID()}@example.test`,
    role, status: 'ACTIVE', passwordHash: hash, passwordChangedAt: new Date() } })
  const session = await db.$transaction((tx) => createSession(tx, user.id))
  return { id: user.id, cookie: `medicare_session=${session.token}`, sessionId: session.session.id }
}
async function patient(time = '2020-01-01T00:00:00Z', archived = false) {
  return db.patient.create({ data: { firstName: 'PrivatePatient', lastName: randomUUID(), phone: '+233241234567',
    createdAt: new Date(time), archivedAt: archived ? new Date() : null, createdById: actor().id } })
}
// A stay seeded directly, honouring the database rules: admitted with its first room, then
// optionally discharged with the room closed in the same transaction.
async function stay(admittedAt: string, dischargedAt?: string) {
  const person = await patient()
  const admission = await db.admission.create({ data: { patientId: person.id, roomNumber: 'PrivateRoom', admittedAt: new Date(admittedAt), admittedById: actor().id,
    rooms: { create: { roomNumber: 'PrivateRoom', assignedAt: new Date(admittedAt), assignedById: actor().id } } } })
  if (dischargedAt) await db.$transaction([
    db.admissionRoomHistory.updateMany({ where: { admissionId: admission.id, endedAt: null }, data: { endedAt: new Date(dischargedAt) } }),
    db.admission.update({ where: { id: admission.id }, data: { status: 'DISCHARGED', dischargedAt: new Date(dischargedAt),
      dischargedById: actor('DOCTOR_IN_CHARGE').id, dischargeNotes: 'PrivateDischargeNote' } }),
  ])
  return admission
}
async function encounter(occurredAt: string, status: EncounterStatus, reviewedAt?: string, who = actor('DOCTOR_IN_CHARGE'), archived = false) {
  const person = await patient('2020-01-01T00:00:00Z', archived)
  return db.encounter.create({ data: { patientId: person.id, createdById: who.id, clinicianId: who.id, status,
    occurredAt: new Date(occurredAt), reviewedAt: reviewedAt ? new Date(reviewedAt) : null,
    clinicalNotes: 'PrivateClinicalNotes', historySummary: 'PrivateHistory', treatmentPlan: 'PrivateTreatment',
    ...(status === 'VOIDED' ? { voidedAt: new Date(), voidReason: 'PrivateVoid' } : {}) } })
}
beforeAll(async () => {
  hash = await hashPassword('Synthetic report test passphrase')
  for (const role of roles) actors.set(role, await newActor(role))
  otherDoctor = await newActor()
  await patient('2024-02-27T23:59:59.999Z')
  await patient(from)
  await patient('2024-02-29T23:59:59.999Z', true)
  await patient(to)
  // In range: admissions 2 + 1 + 0, discharges 1 + 1 + 0, by their own timestamps.
  await stay('2024-02-27T23:59:59.999Z', from)
  await stay(from)
  await stay('2024-02-28T10:00:00Z', '2024-02-29T23:59:59.999Z')
  await stay('2024-02-29T12:00:00Z', to)
  await stay(to)
  await encounter(from, 'DRAFT')
  await encounter('2020-01-01T00:00:00Z', 'DRAFT')
  await encounter('2024-02-29T00:00:00Z', 'VOIDED')
  await encounter(from, 'REVIEWED', to)
  const finalized = await encounter('2024-02-27T23:00:00Z', 'REVIEWED', from, undefined, true)
  await db.encounterAmendment.create({ data: { encounterId: finalized.id, authorId: actor('DOCTOR_IN_CHARGE').id,
    reason: 'PrivateAmendmentReason', content: 'PrivateAmendment', createdAt: new Date('2024-02-29T23:59:59Z') } })
  await db.encounterAmendment.create({ data: { encounterId: finalized.id, authorId: actor('DOCTOR_IN_CHARGE').id,
    reason: 'PrivateAmendmentReason', content: 'PrivateAmendment', createdAt: new Date(to) } })
  await encounter(from, 'REVIEWED', '2024-02-29T00:00:00Z', otherDoctor)
  await encounter(from, 'DRAFT', undefined, otherDoctor)
})
beforeEach(() => {
  logs = ''
  app = createApp({ env, prisma: db, checkDatabase: async () => {}, logger: createLogger('info', new Writable({
    write(chunk: Buffer, _encoding, callback) { logs += chunk.toString(); callback() },
  })) })
})
afterAll(disconnectDatabase)

describe('report authorization and contracts', () => {
  it.each(paths)('requires authentication for %s', async (path) => expect((await request(app).get(path)).status).toBe(401))
  for (const role of roles) {
    it.each(paths)(`${role} permission for %s`, async (path) => {
      const allowed = path === paths[0] || role !== 'DOCTOR_IN_CHARGE'
      const response = await read(path, actor(role))
      expect(response.status).toBe(allowed ? 200 : 403)
      expect(response.headers['cache-control']).toBe('no-store')
      if (allowed) {
        expect(response.body.success).toBe(true)
        expect(response.body.data.range.timezone).toBe('UTC')
        expect(JSON.stringify(response.body)).not.toMatch(/Private|patientId|clinicianId|createdById|authorId|password|csrf|session|email|diagnos|complaint|medicalHistory|content|roomNumber|dischargeNotes/)
      }
    })
  }
  it.each(['PENDING', 'SUSPENDED', 'DISABLED', 'REVOKED', 'EXPIRED'] as const)('rejects %s session on every route', async (state) => {
    const who = await newActor('RECORDS_OFFICER')
    if (state === 'REVOKED') await db.staffSession.update({ where: { id: who.sessionId }, data: { revokedAt: new Date() } })
    // A window wholly in the past: independent of small clock differences between Node and PostgreSQL.
    else if (state === 'EXPIRED') await db.staffSession.update({ where: { id: who.sessionId }, data: { createdAt: new Date(Date.now() - 120000), expiresAt: new Date(Date.now() - 60000) } })
    else await db.staffUser.update({ where: { id: who.id }, data: { status: state } })
    for (const path of paths) expect((await read(path, who)).status).toBe(401)
  })
  it.each(roles)('%s receives only its server-selected dashboard contract', async (role) => {
    const { data } = (await read(`${paths[0]}?from=${from}&to=${to}`, actor(role))).body
    expect(Object.keys(data).sort()).toEqual(['role', 'generatedAt', 'range', 'snapshot', 'today', 'activity'].sort())
    expect(data.role).toBe(role)
    const common = ['currentAdmissions', 'unreadNotifications']
    const extra = role === 'DOCTOR_IN_CHARGE' ? ['currentAuthoredDrafts'] : ['activePatients', 'archivedPatients', ...(role === 'ADMIN' ? ['staffActiveNow', 'staffSignedInToday'] : [])]
    expect(Object.keys(data.snapshot).sort()).toEqual([...common, ...extra].sort())
    expect(Object.keys(data.today).sort()).toEqual(['admissions', 'discharges'])
    // The chart series is hospital-wide, aggregate-only and identical for every role.
    expect(data.activity).toEqual({ admissions: 3, discharges: 2, series: [
      { period: '2024-02-28', admissions: 2, discharges: 1 }, { period: '2024-02-29', admissions: 1, discharges: 1 }, { period: '2024-03-01', admissions: 0, discharges: 0 }] })
    expect(data.range.bucket).toBe('day')
    expect(data.snapshot.currentAdmissions).toBe(await current())
    if (role === 'DOCTOR_IN_CHARGE') expect(data.snapshot.currentAuthoredDrafts).toBe(2)
    expect(JSON.stringify(data)).not.toMatch(/ppointment|activeStaff|clinical|encounter/i)
  })
  it.each(['role=ADMIN', 'role=DOCTOR_IN_CHARGE', 'clinicianId=anything', 'bucket=day'])('rejects dashboard override %s', async (value) => {
    expect((await read(`${paths[0]}?${value}`, actor('DOCTOR_IN_CHARGE'))).status).toBe(400)
  })
  it.each(['role', 'clinicianId', 'authorId', 'patientId', 'status', 'page', 'limit', 'timezone', 'where', 'orderBy', 'select', 'include', 'diagnosis'])('rejects report selector %s', async (key) => {
    for (const path of paths.slice(1)) expect((await read(`${path}?${key}=injected`)).status).toBe(400)
  })
  it('limits the dashboard chart to 31 UTC days', async () => {
    expect((await read(`${paths[0]}?from=2024-01-01T00:00:00Z&to=2024-02-01T00:00:00Z`)).status).toBe(200)
    const over = await read(`${paths[0]}?from=2024-01-01T00:00:00Z&to=2024-02-01T00:00:00.001Z`)
    expect([over.status, over.body.error.code]).toEqual([400, 'REPORT_RANGE_TOO_LARGE'])
    const month = (await read(`${paths[0]}?from=2024-01-01T00:00:00Z&to=2024-02-01T00:00:00Z`)).body.data
    expect(month.activity.series).toHaveLength(31)
  })
  it.each(['from=bad&to=bad', `from=${to}&to=${from}`, `from=${from}&to=${from}`, `from=${from}`, `to=${to}`,
    'from=2020-01-01T00:00:00Z&to=2025-01-01T00:00:00Z', 'from=2024-01-01&to=2024-02-01', 'bucket=year', 'bucket=day&bucket=week',
    'bucket=day%27%29%3BDROP%20TABLE%20%22Patient%22%3B--'])('rejects invalid range/bucket %s without audit', async (value) => {
    const before = await db.auditEvent.count()
    expect((await read(`${paths[2]}?${value}`)).status).toBe(400)
    expect(await db.auditEvent.count()).toBe(before)
  })
  it.each(['/api/v1/reports/appointments', '/api/v1/reports/clinical-activity'])('retires %s for every role', async (path) => {
    for (const role of roles) expect((await read(path, actor(role))).status).toBe(404)
  })
})

describe('patient, admission and clinical aggregates', () => {
  it('counts exact registration boundaries, archived history and current snapshots separately', async () => {
    const { data } = (await read(`${paths[1]}?${query()}`)).body
    expect(Object.keys(data).sort()).toEqual(['generatedAt', 'range', 'snapshot', 'summary', 'series'].sort())
    expect(data.summary).toEqual({ registrationsInRange: 2 })
    expect(data.series).toEqual([{ period: '2024-02-28', registrations: 1 }, { period: '2024-02-29', registrations: 1 }, { period: '2024-03-01', registrations: 0 }])
    expect(data.snapshot).toEqual({ activePatients: await db.patient.count({ where: { archivedAt: null } }), archivedPatients: 2 })
    const empty = (await read(`${paths[1]}?${query('2010-01-01T00:00:00Z', '2010-01-02T00:00:00Z')}`)).body.data
    expect(empty.snapshot).toEqual(data.snapshot)
    expect(empty.summary.registrationsInRange).toBe(0)
  })
  it('counts admissions by admission time and discharges by discharge time, with exact half-open boundaries', async () => {
    const { data } = (await read(`${paths[2]}?${query()}`)).body
    expect(Object.keys(data).sort()).toEqual(['generatedAt', 'range', 'snapshot', 'summary', 'series'].sort())
    expect(data.summary).toEqual({ admissionsInRange: 3, dischargesInRange: 2 })
    expect(data.series).toEqual([
      { period: '2024-02-28', admissions: 2, discharges: 1 },
      { period: '2024-02-29', admissions: 1, discharges: 1 },
      { period: '2024-03-01', admissions: 0, discharges: 0 },
    ])
    expect(data.snapshot).toEqual({ currentAdmissions: await current() })
  })
  it('counts each Medical Officer’s own unfinished records only', async () => {
    expect((await read(paths[0], actor('DOCTOR_IN_CHARGE'))).body.data.snapshot.currentAuthoredDrafts).toBe(2)
    expect((await read(paths[0], otherDoctor)).body.data.snapshot.currentAuthoredDrafts).toBe(1)
  })
  for (const bucket of ['day', 'week', 'month']) {
    it.each(paths.slice(1))(`${bucket} trend matches totals on %s`, async (path) => {
      const { data } = (await read(`${path}?${query(from, to, bucket)}`)).body
      const keys = path === paths[1] ? [['registrations', 'registrationsInRange']] : [['admissions', 'admissionsInRange'], ['discharges', 'dischargesInRange']]
      for (const [seriesKey, totalKey] of keys) expect(data.series.reduce((sum: number, row: Record<string, number>) => sum + row[seriesKey!]!, 0)).toBe(data.summary[totalKey!])
      expect(data.series.map((row: { period: string }) => row.period)).toEqual(bucket === 'week' ? ['2024-02-26'] : bucket === 'month' ? ['2024-02-01', '2024-03-01'] : ['2024-02-28', '2024-02-29', '2024-03-01'])
    })
  }
  it.each(paths.slice(1))('zero-fills empty %s without NaN, null or pagination', async (path) => {
    const { data } = (await read(`${path}?${query('2011-01-01T00:00:00Z', '2011-01-04T00:00:00Z')}`)).body
    expect(Object.values(data.summary).every((value) => value === 0)).toBe(true)
    expect(data.series).toHaveLength(3)
    for (const row of data.series) expect(Object.entries(row).filter(([key]) => key !== 'period').every(([, value]) => value === 0)).toBe(true)
    expect(JSON.stringify(data)).not.toMatch(/null|NaN|pagination|Infinity/)
  })
  it.each(paths)('bounds default range on %s', async (path) => {
    const { data } = (await read(path)).body
    const today = new Date(data.generatedAt); today.setUTCHours(0, 0, 0, 0)
    expect(Date.parse(data.range.to)).toBe(today.getTime() + 86400000)
    expect(Date.parse(data.range.to) - Date.parse(data.range.from)).toBe((path === paths[0] ? 7 : 30) * 86400000)
  })
  it('normalizes offset endpoints before filtering and grouping', async () => {
    const { data } = (await read(`${paths[1]}?${query('2024-02-28T02:00:00+02:00', '2024-03-01T22:00:00-02:00')}`)).body
    expect(data.range.from).toBe('2024-02-28T00:00:00.000Z')
    expect(data.range.to).toBe('2024-03-02T00:00:00.000Z')
    expect(data.summary.registrationsInRange).toBe(2)
  })
  it.each(['Pacific/Honolulu', 'Asia/Tokyo'])('keeps grouped SQL in UTC under database timezone %s', async (zone) => {
    const range = resolveReportRange({ from, to }, false)
    const baseline = await db.$transaction(async (tx) => [await patientActivity(tx, range), await admissionActivity(tx, range)])
    const shifted = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('TimeZone', ${zone}, true)`
      return [await patientActivity(tx, range), await admissionActivity(tx, range)]
    })
    expect(shifted).toEqual(baseline)
  })
  it('returns at most 367 partial daily buckets for a maximum range', async () => {
    const start = '2023-01-01T12:00:00Z', end = new Date(Date.parse(start) + 366 * 86400000).toISOString()
    const response = await read(`${paths[2]}?${query(start, end)}`)
    expect(response.status).toBe(200)
    expect(response.body.data.series).toHaveLength(367)
  })
})

describe('dashboard snapshots, audit and privacy', () => {
  it('returns a valid empty personal workload and a full 7-day chart for a Medical Officer with no activity', async () => {
    const who = await newActor(), response = await read(paths[0], who)
    expect(response.status).toBe(200)
    expect(response.body.data.snapshot).toEqual({ currentAuthoredDrafts: 0, currentAdmissions: await current(), unreadNotifications: 0 })
    expect(response.body.data.activity.series).toHaveLength(7)
    expect(JSON.stringify(response.body.data)).not.toMatch(/null|NaN|Infinity/)
  })
  it.each(roles)('%s sees actual UTC-today admissions and discharges, also as the last chart point', async (role) => {
    const today = new Date(); today.setUTCHours(0, 0, 0, 0)
    const tomorrow = new Date(today.getTime() + 86400000), window = { gte: today, lt: tomorrow }
    await patient(today.toISOString())
    const admitted = new Date(Math.min(Date.now() - 120000, today.getTime() + 60000))
    await stay(admitted.toISOString(), new Date(admitted.getTime() + 1000).toISOString())
    const { data } = (await read(paths[0], actor(role))).body
    expect(data.today.admissions).toBe(await db.admission.count({ where: { admittedAt: window } }))
    expect(data.today.discharges).toBe(await db.admission.count({ where: { status: 'DISCHARGED', dischargedAt: window } }))
    expect(data.today.admissions).toBeGreaterThan(0)
    const last = data.activity.series.at(-1)
    expect([last.period, last.admissions, last.discharges]).toEqual([today.toISOString().slice(0, 10), data.today.admissions, data.today.discharges])
  })
  it('counts only own unread notifications without changing read state', async () => {
    const who = await newActor(), other = await newActor()
    for (const readAt of [null, new Date()]) await db.notification.create({ data: { type: 'DIRECT', senderId: actor().id, title: 'PrivateTitle', message: 'PrivateMessage',
      recipients: { create: [{ staffUserId: who.id, createdAt: new Date('2020-01-01'), readAt }, { staffUserId: other.id, createdAt: new Date('2020-01-01') }] } } })
    expect((await read(paths[0], who)).body.data.snapshot.unreadNotifications).toBe(1)
    expect((await read(paths[0], other)).body.data.snapshot.unreadNotifications).toBe(2)
    expect(await db.notificationRecipient.count({ where: { staffUserId: who.id, readAt: null } })).toBe(1)
  })
  it('counts current admissions hospital-wide for every role, independently of report dates', async () => {
    const before = await current()
    await stay('2023-06-01T00:00:00Z')
    await stay('2023-06-01T00:00:00Z', '2023-06-02T00:00:00Z')
    for (const role of roles) expect((await read(`${paths[0]}?from=${from}&to=${to}`, actor(role))).body.data.snapshot.currentAdmissions).toBe(before + 1)
  })
  it('does not audit reports, any dashboard, or denied access', async () => {
    const before = await db.auditEvent.count()
    for (const role of roles) await read(paths[0], actor(role))
    await read(paths[1]); await read(paths[2]); await read(paths[2], actor('DOCTOR_IN_CHARGE'))
    expect(await db.auditEvent.count()).toBe(before)
  })
  it.each(paths)('keeps identities, payloads and query text out of logs for %s', async (path) => {
    const response = await read(path).set('X-Request-Id', 'report-privacy')
    expect(response.status).toBe(200)
    expect(logs).toContain('report-privacy')
    expect(logs).not.toMatch(/Private|registrationsInRange|admissionsInRange|currentAdmissions|@example.test|medicare_session|csrf|passwordHash/)
    expect(logs).not.toContain(actor().id)
  })
  it.each(['/api/v1/reports/export', '/api/v1/reports/patients.csv', '/api/v1/reports/diagnoses', '/api/v1/reports/chief-complaints', '/api/v1/reports/medications'])('does not implement export or clinical-detail route %s', async (path) => expect((await read(path)).status).toBe(404))
  it.each(['revoked', 'suspended', 'roleChanged'] as const)('rechecks %s after waiting on the authorization lock', async (kind) => {
    const who = await newActor('RECORDS_OFFICER')
    let release!: () => void, ready!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve }), locked = new Promise<void>((resolve) => { ready = resolve })
    const blocker = db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(1296385106, 1)`
      ready(); await gate
      if (kind === 'revoked') await tx.staffSession.update({ where: { id: who.sessionId }, data: { revokedAt: new Date() } })
      else await tx.staffUser.update({ where: { id: who.id }, data: kind === 'suspended' ? { status: 'SUSPENDED' } : { role: 'DOCTOR_IN_CHARGE' } })
    })
    await locked
    const pending = read(paths[2], who).then((response) => response)
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
    expect(response.status).toBe(kind === 'roleChanged' ? 403 : 401)
    expect(response.body).not.toHaveProperty('data')
  })
})
