import { Prisma, type AppointmentStatus } from '../../generated/prisma/client.js'
import type { ReportRange } from './report.validation.js'
import { appointmentStatusField, appointmentSummary, buildTimeBuckets, countNumber, emptyAppointmentCounts } from './report.dto.js'

type Database = Prisma.TransactionClient
type CountRow = { period: string; count: bigint }
// Identifiers/expressions are fixed code; even date_trunc's whitelisted unit is a bound value.
// Bind ISO strings with explicit timestamptz casts: raw Date parameters can be
// encoded as timestamp-without-zone by the adapter and inherit the session zone.
const units = { day: 'day', week: 'week', month: 'month' } as const
const windowWhere = (range: ReportRange) => ({ gte: range.from, lt: range.to })
export async function patientSnapshot(db: Database) {
  const [row] = await db.$queryRaw<Array<{ active: bigint; archived: bigint }>>`
    SELECT count(*) FILTER (WHERE "archivedAt" IS NULL) AS active,
      count(*) FILTER (WHERE "archivedAt" IS NOT NULL) AS archived FROM "Patient"`
  return { activePatients: countNumber(row!.active), archivedPatients: countNumber(row!.archived) }
}
export async function patientActivity(db: Database, range: ReportRange) {
  const rows = await db.$queryRaw<CountRow[]>`
    SELECT to_char(date_trunc(${units[range.bucket]}, "createdAt" AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS period,
      count(*) AS count FROM "Patient" WHERE "createdAt" >= ${range.from.toISOString()}::timestamptz AND "createdAt" < ${range.to.toISOString()}::timestamptz
    GROUP BY 1 ORDER BY 1`
  const counts = new Map(rows.map((row) => [row.period, countNumber(row.count)]))
  const series = buildTimeBuckets(range).map((period) => ({ period, registrations: counts.get(period) ?? 0 }))
  return { registrationsInRange: countNumber(series.reduce((total, row) => total + row.registrations, 0)), series }
}
export async function appointmentActivity(db: Database, range: ReportRange, clinicianId?: string) {
  const scope = clinicianId ? Prisma.sql`AND "clinicianId" = ${clinicianId}::uuid` : Prisma.empty
  const rows = await db.$queryRaw<Array<CountRow & { status: AppointmentStatus }>>(Prisma.sql`
    SELECT to_char(date_trunc(${units[range.bucket]}, "scheduledStart" AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS period,
      "status", count(*) AS count FROM "Appointment"
    WHERE "scheduledStart" >= ${range.from.toISOString()}::timestamptz AND "scheduledStart" < ${range.to.toISOString()}::timestamptz ${scope}
    GROUP BY 1, "status" ORDER BY 1, "status"`)
  const periods = new Map(buildTimeBuckets(range).map((period) => [period, emptyAppointmentCounts()]))
  const totals = emptyAppointmentCounts()
  for (const row of rows) {
    const field = appointmentStatusField[row.status], count = countNumber(row.count)
    const period = periods.get(row.period)
    if (!period || !field) throw new Error('Unexpected appointment aggregate')
    period[field] = count; totals[field] = countNumber(totals[field] + count)
  }
  return { summary: appointmentSummary(totals), series: [...periods].map(([period, counts]) => ({ period, ...appointmentSummary(counts) })) }
}
export async function clinicalActivity(db: Database, range: ReportRange, authorId: string) {
  // Each timestamp has a distinct meaning. Never use updatedAt or fetch clinical text.
  const rows = await db.$queryRaw<Array<CountRow & { metric: 'encounters' | 'finalized' | 'amendments' }>>(Prisma.sql`
    SELECT to_char(date_trunc(${units[range.bucket]}, "occurredAt" AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS period,
      'encounters' AS metric, count(*) AS count FROM "Encounter"
      WHERE "createdById" = ${authorId}::uuid AND "occurredAt" >= ${range.from.toISOString()}::timestamptz AND "occurredAt" < ${range.to.toISOString()}::timestamptz GROUP BY 1
    UNION ALL
    SELECT to_char(date_trunc(${units[range.bucket]}, "reviewedAt" AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS period,
      'finalized' AS metric, count(*) AS count FROM "Encounter"
      WHERE "createdById" = ${authorId}::uuid AND "status" = 'REVIEWED'
      AND "reviewedAt" >= ${range.from.toISOString()}::timestamptz AND "reviewedAt" < ${range.to.toISOString()}::timestamptz GROUP BY 1
    UNION ALL
    SELECT to_char(date_trunc(${units[range.bucket]}, "createdAt" AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS period,
      'amendments' AS metric, count(*) AS count FROM "EncounterAmendment"
      WHERE "authorId" = ${authorId}::uuid AND "createdAt" >= ${range.from.toISOString()}::timestamptz AND "createdAt" < ${range.to.toISOString()}::timestamptz GROUP BY 1`)
  const periods = new Map(buildTimeBuckets(range).map((period) => [period, { encounters: 0, finalized: 0, amendments: 0 }]))
  for (const row of rows) {
    const period = periods.get(row.period)
    if (!period || !['encounters', 'finalized', 'amendments'].includes(row.metric)) throw new Error('Unexpected clinical aggregate')
    period[row.metric] = countNumber(row.count)
  }
  const series = [...periods].map(([period, counts]) => ({ period, encounters: counts.encounters, finalized: counts.finalized, amendments: counts.amendments }))
  const sum = (key: 'encounters' | 'finalized' | 'amendments') => countNumber(series.reduce((total, row) => total + row[key], 0))
  return { currentAuthoredDrafts: await db.encounter.count({ where: { createdById: authorId, status: 'DRAFT' } }),
    summary: { encountersInRange: sum('encounters'), finalizedEncountersInRange: sum('finalized'), amendmentsInRange: sum('amendments') }, series }
}
export function upcomingAppointments(db: Database, now: Date, clinicianId?: string) {
  return db.appointment.count({ where: { clinicianId, scheduledStart: { gte: now }, status: { in: ['SCHEDULED', 'CONFIRMED'] } } })
}
export function ownUnreadNotifications(db: Database, staffUserId: string) {
  return db.notificationRecipient.count({ where: { staffUserId, readAt: null } })
}
export async function activeStaffSnapshot(db: Database) {
  const rows = await db.staffUser.groupBy({ by: ['role'], where: { status: 'ACTIVE' }, _count: { _all: true } })
  const count = (role: 'ADMIN' | 'RECORDS_OFFICER' | 'DOCTOR_IN_CHARGE') => rows.find((row) => row.role === role)?._count._all ?? 0
  return { total: rows.reduce((sum, row) => sum + row._count._all, 0), admins: count('ADMIN'), recordsOfficers: count('RECORDS_OFFICER'), doctors: count('DOCTOR_IN_CHARGE') }
}
export function registrationsCount(db: Database, range: ReportRange) {
  return db.patient.count({ where: { createdAt: windowWhere(range) } })
}
