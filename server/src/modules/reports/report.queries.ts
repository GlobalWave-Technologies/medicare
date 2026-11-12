import { Prisma } from '../../generated/prisma/client.js'
import type { ReportRange } from './report.validation.js'
import { buildTimeBuckets, countNumber } from './report.dto.js'

type Database = Prisma.TransactionClient
type CountRow = { period: string; count: bigint }
// Identifiers/expressions are fixed code; even date_trunc's whitelisted unit is a bound value.
// Bind ISO strings with explicit timestamptz casts: raw Date parameters can be
// encoded as timestamp-without-zone by the adapter and inherit the session zone.
const units = { day: 'day', week: 'week', month: 'month' } as const
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
// Admissions by admission time and discharges by discharge time, each in its own period.
export async function admissionActivity(db: Database, range: ReportRange) {
  const rows = await db.$queryRaw<Array<CountRow & { metric: 'admissions' | 'discharges' }>>(Prisma.sql`
    SELECT to_char(date_trunc(${units[range.bucket]}, "admittedAt" AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS period,
      'admissions' AS metric, count(*) AS count FROM "Admission"
      WHERE "admittedAt" >= ${range.from.toISOString()}::timestamptz AND "admittedAt" < ${range.to.toISOString()}::timestamptz GROUP BY 1
    UNION ALL
    SELECT to_char(date_trunc(${units[range.bucket]}, "dischargedAt" AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS period,
      'discharges' AS metric, count(*) AS count FROM "Admission"
      WHERE "status" = 'DISCHARGED' AND "dischargedAt" >= ${range.from.toISOString()}::timestamptz AND "dischargedAt" < ${range.to.toISOString()}::timestamptz GROUP BY 1`)
  const periods = new Map(buildTimeBuckets(range).map((period) => [period, { admissions: 0, discharges: 0 }]))
  for (const row of rows) {
    const period = periods.get(row.period)
    if (!period || !['admissions', 'discharges'].includes(row.metric)) throw new Error('Unexpected admission aggregate')
    period[row.metric] = countNumber(row.count)
  }
  const series = [...periods].map(([period, counts]) => ({ period, admissions: counts.admissions, discharges: counts.discharges }))
  const sum = (key: 'admissions' | 'discharges') => countNumber(series.reduce((total, row) => total + row[key], 0))
  return { summary: { admissionsInRange: sum('admissions'), dischargesInRange: sum('discharges') }, series }
}
export function currentAdmissions(db: Database) {
  return db.admission.count({ where: { status: 'ADMITTED' } })
}
// A Medical Officer's own clinical records that are still drafts (they block discharge).
export function authoredDrafts(db: Database, authorId: string) {
  return db.encounter.count({ where: { createdById: authorId, status: 'DRAFT' } })
}
export function ownUnreadNotifications(db: Database, staffUserId: string) {
  return db.notificationRecipient.count({ where: { staffUserId, readAt: null } })
}
