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
import { patientActivity, appointmentActivity, clinicalActivity } from '../src/modules/reports/report.queries.js'
import { resolveReportRange } from '../src/modules/reports/report.validation.js'
import type { StaffRole, AppointmentStatus, EncounterStatus } from '../src/generated/prisma/client.js'

const db = testDatabase(), env = isolatedTestEnvironment()
const paths = ['/api/v1/dashboard', '/api/v1/reports/patients', '/api/v1/reports/appointments', '/api/v1/reports/clinical-activity'] as const
const roles = ['ADMIN', 'RECORDS_OFFICER', 'DOCTOR_IN_CHARGE'] as const
type Actor = { id: string; cookie: string; sessionId: string }
const actors = new Map<StaffRole, Actor>()
const actor = (role: StaffRole = 'ADMIN') => actors.get(role)!
let hash: string, logs = '', app: ReturnType<typeof createApp>, otherDoctor: Actor
const from = '2024-02-28T00:00:00Z', to = '2024-03-02T00:00:00Z'
const query = (start = from, end = to, bucket = 'day') => new URLSearchParams({ from: start, to: end, bucket }).toString()
const read = (path: string, who = actor()) => request(app).get(path).set('Cookie', who.cookie)
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
async function appointment(time: string, status: AppointmentStatus, who = actor('DOCTOR_IN_CHARGE')) {
  const person = await patient()
  return db.appointment.create({ data: { patientId: person.id, clinicianId: who.id, createdById: actor().id, status,
    scheduledStart: new Date(time), scheduledEnd: new Date(Date.parse(time) + 60000), type: 'CONSULTATION',
    reason: 'PrivateReason', notes: 'PrivateNotes', createdAt: new Date('2020-01-01'),
    ...(status === 'CANCELLED' ? { cancelledAt: new Date(), cancelledById: actor().id, cancellationReason: 'PrivateCancellation' } : {}) } })
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
  const statuses: AppointmentStatus[] = ['SCHEDULED', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'NO_SHOW']
  for (const [i, status] of statuses.entries()) await appointment(`2024-02-28T0${i}:00:00Z`, status)
  await appointment('2024-02-29T00:00:00Z', 'COMPLETED', otherDoctor)
  await appointment(to, 'COMPLETED')
  await appointment('2024-02-27T23:59:59Z', 'COMPLETED')
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
  await db.$executeRawUnsafe(`CREATE FUNCTION test_report_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW."requestId" = 'fail-report-audit' THEN RAISE EXCEPTION 'PrivateReportSQL'; END IF; RETURN NEW; END $$`)
  await db.$executeRawUnsafe('CREATE TRIGGER test_fail_report_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION test_report_audit_failure()')
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
      const allowed = path === paths[0] || ((path === paths[3]) === (role === 'DOCTOR_IN_CHARGE'))
      const response = await read(path, actor(role))
      expect(response.status).toBe(allowed ? 200 : 403)
      expect(response.headers['cache-control']).toBe('no-store')
      if (allowed) {
        expect(response.body.success).toBe(true)
        expect(response.body.data.range.timezone).toBe('UTC')
        expect(JSON.stringify(response.body)).not.toMatch(/Private|patientId|clinicianId|createdById|authorId|password|csrf|session|email|diagnos|complaint|medicalHistory|content/)
      }
    })
  }
  it.each(['PENDING', 'SUSPENDED', 'DISABLED', 'REVOKED', 'EXPIRED'] as const)('rejects %s session on every route', async (state) => {
    const who = await newActor()
    if (state === 'REVOKED') await db.staffSession.update({ where: { id: who.sessionId }, data: { revokedAt: new Date() } })
    else if (state === 'EXPIRED') await db.staffSession.update({ where: { id: who.sessionId }, data: { expiresAt: new Date(Date.now() - 1) } })
    else await db.staffUser.update({ where: { id: who.id }, data: { status: state } })
    for (const path of paths) expect((await read(path, who)).status).toBe(401)
  })
  it.each(roles)('%s receives only its server-selected dashboard contract', async (role) => {
    const { data } = (await read(`${paths[0]}?from=${from}&to=${to}`, actor(role))).body
    expect(Object.keys(data).sort()).toEqual(['role', 'generatedAt', 'range', 'snapshot', 'period'].sort())
    expect(data.role).toBe(role)
    const common = ['upcomingAppointments', 'unreadNotifications']
    const extra = role === 'DOCTOR_IN_CHARGE' ? ['currentAuthoredDrafts'] : ['activePatients', 'archivedPatients', ...(role === 'ADMIN' ? ['activeStaff'] : [])]
    expect(Object.keys(data.snapshot).sort()).toEqual([...common, ...extra].sort())
    expect(Object.keys(data.period).sort()).toEqual(['appointments', role === 'DOCTOR_IN_CHARGE' ? 'clinical' : 'patientsRegistered'].sort())
    expect(data.period.appointments.totalAppointments).toBe(role === 'DOCTOR_IN_CHARGE' ? 6 : 7)
    if (role === 'DOCTOR_IN_CHARGE') expect(data.period.clinical).toEqual({ encountersInRange: 3, finalizedEncountersInRange: 1, amendmentsInRange: 1 })
    else expect(data.period.patientsRegistered).toBe(2)
  })
  it.each(['role=ADMIN', 'role=DOCTOR_IN_CHARGE', 'clinicianId=anything', 'bucket=day'])('rejects dashboard override %s', async (value) => {
    expect((await read(`${paths[0]}?${value}`, actor('DOCTOR_IN_CHARGE'))).status).toBe(400)
  })
  it.each(['role', 'clinicianId', 'authorId', 'patientId', 'status', 'page', 'limit', 'timezone', 'where', 'orderBy', 'select', 'include', 'diagnosis'])('rejects report selector %s', async (key) => {
    for (const path of paths.slice(1)) expect((await read(`${path}?${key}=injected`, path === paths[3] ? actor('DOCTOR_IN_CHARGE') : actor())).status).toBe(400)
  })
  it.each(['from=bad&to=bad', `from=${to}&to=${from}`, `from=${from}&to=${from}`, `from=${from}`, `to=${to}`,
    'from=2020-01-01T00:00:00Z&to=2025-01-01T00:00:00Z', 'from=2024-01-01&to=2024-02-01', 'bucket=year', 'bucket=day&bucket=week',
    'bucket=day%27%29%3BDROP%20TABLE%20%22Patient%22%3B--'])('rejects invalid range/bucket %s without audit', async (value) => {
    const before = await db.auditEvent.count()
    expect((await read(`${paths[3]}?${value}`, actor('DOCTOR_IN_CHARGE'))).status).toBe(400)
    expect(await db.auditEvent.count()).toBe(before)
  })
})

describe('patient, appointment and clinical aggregates', () => {
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
  it('counts by scheduledStart, with every status and range-wide rate denominators', async () => {
    const { data } = (await read(`${paths[2]}?${query()}`)).body
    expect(Object.keys(data).sort()).toEqual(['generatedAt', 'range', 'summary', 'series'].sort())
    expect(data.summary).toEqual({ totalAppointments: 7, scheduled: 1, confirmed: 1, checkedIn: 1, completed: 2, cancelled: 1, noShow: 1, cancellationRate: 14.29, noShowRate: 14.29 })
    expect(data.series.map((row: { totalAppointments: number }) => row.totalAppointments)).toEqual([6, 1, 0])
    expect(data.series[0].cancellationRate).toBe(16.67)
    expect(data.series[2].noShowRate).toBe(0)
  })
  it('uses own authored occurredAt, reviewedAt and amendment createdAt independently', async () => {
    const { data } = (await read(`${paths[3]}?${query()}`, actor('DOCTOR_IN_CHARGE'))).body
    expect(Object.keys(data).sort()).toEqual(['generatedAt', 'range', 'snapshot', 'summary', 'series'].sort())
    expect(data.snapshot).toEqual({ currentAuthoredDrafts: 2 })
    expect(data.summary).toEqual({ encountersInRange: 3, finalizedEncountersInRange: 1, amendmentsInRange: 1 })
    expect(data.series).toEqual([
      { period: '2024-02-28', encounters: 2, finalized: 1, amendments: 0 },
      { period: '2024-02-29', encounters: 1, finalized: 0, amendments: 1 },
      { period: '2024-03-01', encounters: 0, finalized: 0, amendments: 0 },
    ])
    const other = (await read(`${paths[3]}?${query()}`, otherDoctor)).body.data
    expect(other.summary).toEqual({ encountersInRange: 2, finalizedEncountersInRange: 1, amendmentsInRange: 0 })
    expect(other.snapshot.currentAuthoredDrafts).toBe(1)
  })
  for (const bucket of ['day', 'week', 'month']) {
    it.each(paths.slice(1))(`${bucket} trend matches totals on %s`, async (path) => {
      const { data } = (await read(`${path}?${query(from, to, bucket)}`, path === paths[3] ? actor('DOCTOR_IN_CHARGE') : actor())).body
      const keys = path === paths[1] ? [['registrations', 'registrationsInRange']] : path === paths[2] ? [['totalAppointments', 'totalAppointments'], ['cancelled', 'cancelled'], ['noShow', 'noShow']]
        : [['encounters', 'encountersInRange'], ['finalized', 'finalizedEncountersInRange'], ['amendments', 'amendmentsInRange']]
      for (const [seriesKey, totalKey] of keys) expect(data.series.reduce((sum: number, row: Record<string, number>) => sum + row[seriesKey!]!, 0)).toBe(data.summary[totalKey!])
      expect(data.series.map((row: { period: string }) => row.period)).toEqual(bucket === 'week' ? ['2024-02-26'] : bucket === 'month' ? ['2024-02-01', '2024-03-01'] : ['2024-02-28', '2024-02-29', '2024-03-01'])
    })
  }
  it.each(paths.slice(1))('zero-fills empty %s without NaN, null or pagination', async (path) => {
    const { data } = (await read(`${path}?${query('2011-01-01T00:00:00Z', '2011-01-04T00:00:00Z')}`, path === paths[3] ? actor('DOCTOR_IN_CHARGE') : actor())).body
    expect(Object.values(data.summary).every((value) => value === 0)).toBe(true)
    expect(data.series).toHaveLength(3)
    for (const row of data.series) expect(Object.entries(row).filter(([key]) => key !== 'period').every(([, value]) => value === 0)).toBe(true)
    expect(JSON.stringify(data)).not.toMatch(/null|NaN|pagination|Infinity/)
  })
  it.each(paths)('bounds default range on %s', async (path) => {
    const { data } = (await read(path, path === paths[3] ? actor('DOCTOR_IN_CHARGE') : actor())).body
    const today = new Date(data.generatedAt); today.setUTCHours(0, 0, 0, 0)
    expect(Date.parse(data.range.to)).toBe(today.getTime() + 86400000)
    expect(Date.parse(data.range.to) - Date.parse(data.range.from)).toBe((path === paths[0] ? 1 : 30) * 86400000)
  })
  it('normalizes offset endpoints before filtering and grouping', async () => {
    const { data } = (await read(`${paths[1]}?${query('2024-02-28T02:00:00+02:00', '2024-03-01T22:00:00-02:00')}`)).body
    expect(data.range.from).toBe('2024-02-28T00:00:00.000Z')
    expect(data.range.to).toBe('2024-03-02T00:00:00.000Z')
    expect(data.summary.registrationsInRange).toBe(2)
  })
  it.each(['Pacific/Honolulu', 'Asia/Tokyo'])('keeps grouped SQL in UTC under database timezone %s', async (zone) => {
    const range = resolveReportRange({ from, to }, false)
    const baseline = await db.$transaction(async (tx) => [await patientActivity(tx, range), await appointmentActivity(tx, range), await clinicalActivity(tx, range, actor('DOCTOR_IN_CHARGE').id)])
    const shifted = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('TimeZone', ${zone}, true)`
      return [await patientActivity(tx, range), await appointmentActivity(tx, range), await clinicalActivity(tx, range, actor('DOCTOR_IN_CHARGE').id)]
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
  it('returns a valid empty personal dashboard for a doctor with no activity', async () => {
    const who = await newActor(), response = await read(paths[0], who)
    expect(response.status).toBe(200)
    expect(response.body.data.snapshot).toEqual({ currentAuthoredDrafts: 0, upcomingAppointments: 0, unreadNotifications: 0 })
    for (const summary of Object.values(response.body.data.period) as Record<string, number>[]) expect(Object.values(summary).every((value) => value === 0)).toBe(true)
  })
  it.each(roles)('%s defaults to actual UTC-today registrations and scheduled appointment statuses', async (role) => {
    const today = new Date(); today.setUTCHours(0, 0, 0, 0)
    const tomorrow = new Date(today.getTime() + 86400000)
    const clinician = await newActor()
    await patient(today.toISOString())
    await appointment(new Date(today.getTime() + 60000).toISOString(), 'COMPLETED', clinician)
    const { data } = (await read(paths[0], actor(role))).body
    const scope = role === 'DOCTOR_IN_CHARGE' ? { clinicianId: actor(role).id } : {}
    const scheduledStart = { gte: today, lt: tomorrow }
    expect(data.period.appointments.totalAppointments).toBe(await db.appointment.count({ where: { ...scope, scheduledStart } }))
    expect(data.period.appointments.completed).toBe(await db.appointment.count({ where: { ...scope, scheduledStart, status: 'COMPLETED' } }))
    if (role !== 'DOCTOR_IN_CHARGE') expect(data.period.patientsRegistered).toBe(await db.patient.count({ where: { createdAt: { gte: today, lt: tomorrow } } }))
  })
  it('counts only own unread notifications without changing read state', async () => {
    const who = await newActor(), other = await newActor()
    for (const readAt of [null, new Date()]) await db.notification.create({ data: { type: 'DIRECT', senderId: actor().id, title: 'PrivateTitle', message: 'PrivateMessage',
      recipients: { create: [{ staffUserId: who.id, createdAt: new Date('2020-01-01'), readAt }, { staffUserId: other.id, createdAt: new Date('2020-01-01') }] } } })
    expect((await read(paths[0], who)).body.data.snapshot.unreadNotifications).toBe(1)
    expect((await read(paths[0], other)).body.data.snapshot.unreadNotifications).toBe(2)
    expect(await db.notificationRecipient.count({ where: { staffUserId: who.id, readAt: null } })).toBe(1)
  })
  it('counts upcoming scheduled/confirmed appointments with doctor ownership independently of report dates', async () => {
    const who = await newActor(), other = await newActor()
    await appointment('2090-01-01T01:00:00Z', 'SCHEDULED', who)
    await appointment('2090-01-01T02:00:00Z', 'CONFIRMED', who)
    await appointment('2090-01-01T03:00:00Z', 'CHECKED_IN', who)
    await appointment('2090-01-01T04:00:00Z', 'CANCELLED', who)
    await appointment('2090-01-01T05:00:00Z', 'SCHEDULED', other)
    expect((await read(`${paths[0]}?from=${from}&to=${to}`, who)).body.data.snapshot.upcomingAppointments).toBe(2)
    expect((await read(paths[0], other)).body.data.snapshot.upcomingAppointments).toBe(1)
    expect((await read(paths[0])).body.data.snapshot.upcomingAppointments).toBe(3)
  })
  it('counts active staff by role without exposing staff records', async () => {
    const { activeStaff } = (await read(paths[0])).body.data.snapshot
    expect(activeStaff).toEqual({ total: await db.staffUser.count({ where: { status: 'ACTIVE' } }),
      admins: await db.staffUser.count({ where: { status: 'ACTIVE', role: 'ADMIN' } }),
      recordsOfficers: await db.staffUser.count({ where: { status: 'ACTIVE', role: 'RECORDS_OFFICER' } }),
      doctors: await db.staffUser.count({ where: { status: 'ACTIVE', role: 'DOCTOR_IN_CHARGE' } }) })
  })
  it('writes one minimal clinical report audit with no aggregate payload', async () => {
    const before = await db.auditEvent.count()
    const response = await read(`${paths[3]}?${query()}`, actor('DOCTOR_IN_CHARGE')).set('X-Request-Id', 'clinical-report-audit')
    expect(response.status).toBe(200)
    expect(await db.auditEvent.count()).toBe(before + 1)
    const audit = await db.auditEvent.findFirstOrThrow({ where: { requestId: 'clinical-report-audit' } })
    expect(audit).toMatchObject({ actorId: actor('DOCTOR_IN_CHARGE').id, action: 'CLINICAL_REPORT_VIEWED', entityType: 'STAFF_USER', entityId: actor('DOCTOR_IN_CHARGE').id, metadata: { source: 'API' } })
  })
  it('does not audit operational reports, any dashboard, or denied access', async () => {
    const before = await db.auditEvent.count()
    for (const role of roles) await read(paths[0], actor(role))
    await read(paths[1]); await read(paths[2]); await read(paths[3]); await read(paths[1], actor('DOCTOR_IN_CHARGE'))
    expect(await db.auditEvent.count()).toBe(before)
  })
  it('fails closed on clinical audit failure with a safe correlated error', async () => {
    const before = await db.auditEvent.count()
    const response = await read(`${paths[3]}?${query()}`, actor('DOCTOR_IN_CHARGE')).set('X-Request-Id', 'fail-report-audit')
    expect(response.status).toBe(500)
    expect(response.body).not.toHaveProperty('data')
    expect(response.body.error).toEqual({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', requestId: 'fail-report-audit' })
    expect(await db.auditEvent.count()).toBe(before)
    expect(logs + JSON.stringify(response.body)).not.toMatch(/PrivateReportSQL|SELECT|Prisma|encountersInRange|amendmentsInRange/)
  })
  it.each(paths)('keeps identities, payloads and query text out of logs for %s', async (path) => {
    const response = await read(path, path === paths[3] ? actor('DOCTOR_IN_CHARGE') : actor()).set('X-Request-Id', 'report-privacy')
    expect(response.status).toBe(200)
    expect(logs).toContain('report-privacy')
    expect(logs).not.toMatch(/Private|registrationsInRange|totalAppointments|currentAuthoredDrafts|@example.test|medicare_session|csrf|passwordHash/)
    expect(logs).not.toContain(actor().id)
  })
  it.each(['/api/v1/reports/export', '/api/v1/reports/patients.csv', '/api/v1/reports/diagnoses', '/api/v1/reports/chief-complaints'])('does not implement export or clinical-detail route %s', async (path) => expect((await read(path)).status).toBe(404))
  it.each(['revoked', 'suspended', 'roleChanged'] as const)('rechecks %s after waiting on the authorization lock', async (kind) => {
    const who = await newActor()
    let release!: () => void, ready!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve }), locked = new Promise<void>((resolve) => { ready = resolve })
    const blocker = db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(1296385106, 1)`
      ready(); await gate
      if (kind === 'revoked') await tx.staffSession.update({ where: { id: who.sessionId }, data: { revokedAt: new Date() } })
      else await tx.staffUser.update({ where: { id: who.id }, data: kind === 'suspended' ? { status: 'SUSPENDED' } : { role: 'RECORDS_OFFICER' } })
    })
    await locked
    const pending = read(paths[3], who).then((response) => response)
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
    expect((await pending).status).toBe(kind === 'roleChanged' ? 403 : 401)
    expect(await db.auditEvent.count({ where: { actorId: who.id, action: 'CLINICAL_REPORT_VIEWED' } })).toBe(0)
  })
})
