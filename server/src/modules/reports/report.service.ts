import { Prisma, type PrismaClient, type StaffRole } from '../../generated/prisma/client.js'
import { assertCurrentActor } from '../auth/security.transaction.js'
import type { AuthContext } from '../auth/auth.context.js'
import { assertPermission, type Permission } from '../../shared/authorization/permissions.js'
import { rangeDto } from './report.dto.js'
import { DAY_MS, resolveReportRange, type ReportQuery } from './report.validation.js'
import { admissionActivity, authoredDrafts, currentAdmissions, ownUnreadNotifications, patientActivity, patientSnapshot } from './report.queries.js'
import { staffPresenceCounts } from '../staff-activity/activity.service.js'

const dashboardPermission = { ADMIN: 'DASHBOARD_VIEW_ADMIN', RECORDS_OFFICER: 'DASHBOARD_VIEW_RECORDS',
  DOCTOR_IN_CHARGE: 'DASHBOARD_VIEW_CLINICAL' } as const satisfies Record<StaffRole, Permission>
function reportTransaction<T>(db: PrismaClient, auth: AuthContext,
  operation: (tx: Prisma.TransactionClient, role: StaffRole) => Promise<T>) {
  return db.$transaction(async (tx) => {
    // Prisma's timestamp parameters must not inherit a non-UTC database session.
    await tx.$executeRaw`SET LOCAL TIME ZONE 'UTC'`
    await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(1296385106, 1)`
    return operation(tx, await assertCurrentActor(tx, auth))
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 10000 })
}
// Every role sees aggregate counts only: patients admitted now, today's admissions and discharges,
// and the daily admission/discharge series for the chart (hospital-wide). Admin and Records also
// see patient totals; a Medical Officer sees their own unfinished clinical records; Admin also sees
// how many staff are active now and signed in today (counts only).
export function getDashboardForPrincipal(db: PrismaClient, auth: AuthContext, query: { from?: string; to?: string }) {
  return reportTransaction(db, auth, async (tx, role) => {
    assertPermission(role, dashboardPermission[role])
    const now = new Date(), range = resolveReportRange(query, true, now)
    const midnight = new Date(now); midnight.setUTCHours(0, 0, 0, 0)
    const today = (await admissionActivity(tx, { from: midnight, to: new Date(midnight.getTime() + DAY_MS), bucket: 'day' })).summary
    const activity = await admissionActivity(tx, range)
    const common = { role, generatedAt: now.toISOString(), range: rangeDto(range),
      today: { admissions: today.admissionsInRange, discharges: today.dischargesInRange },
      activity: { admissions: activity.summary.admissionsInRange, discharges: activity.summary.dischargesInRange, series: activity.series } }
    const snapshot = { currentAdmissions: await currentAdmissions(tx), unreadNotifications: await ownUnreadNotifications(tx, auth.principal.id) }
    if (role === 'DOCTOR_IN_CHARGE') return { ...common, snapshot: { ...snapshot, currentAuthoredDrafts: await authoredDrafts(tx, auth.principal.id) } }
    const patients = await patientSnapshot(tx)
    if (role === 'ADMIN') return { ...common, snapshot: { ...snapshot, ...patients, ...await staffPresenceCounts(tx, now) } }
    return { ...common, snapshot: { ...snapshot, ...patients } }
  })
}
export function getPatientReport(db: PrismaClient, auth: AuthContext, query: ReportQuery) {
  return reportTransaction(db, auth, async (tx, role) => {
    assertPermission(role, 'REPORT_OPERATIONAL_VIEW')
    const now = new Date(), range = resolveReportRange(query, false, now), activity = await patientActivity(tx, range)
    return { generatedAt: now.toISOString(), range: rangeDto(range), snapshot: await patientSnapshot(tx),
      summary: { registrationsInRange: activity.registrationsInRange }, series: activity.series }
  })
}
export function getAdmissionReport(db: PrismaClient, auth: AuthContext, query: ReportQuery) {
  return reportTransaction(db, auth, async (tx, role) => {
    assertPermission(role, 'REPORT_OPERATIONAL_VIEW')
    const now = new Date(), range = resolveReportRange(query, false, now), activity = await admissionActivity(tx, range)
    return { generatedAt: now.toISOString(), range: rangeDto(range), snapshot: { currentAdmissions: await currentAdmissions(tx) },
      summary: activity.summary, series: activity.series }
  })
}
