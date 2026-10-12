import { Prisma, type PrismaClient, type StaffRole } from '../../generated/prisma/client.js'
import { assertCurrentActor } from '../auth/security.transaction.js'
import type { AuthContext, AuditContext } from '../auth/auth.context.js'
import { assertPermission, type Permission } from '../../shared/authorization/permissions.js'
import { appendAuditEvent } from '../../shared/audit/audit.js'
import { rangeDto } from './report.dto.js'
import { resolveReportRange, type ReportQuery } from './report.validation.js'
import { activeStaffSnapshot, appointmentActivity, clinicalActivity, ownUnreadNotifications, patientActivity, patientSnapshot, registrationsCount, upcomingAppointments } from './report.queries.js'

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
export function getDashboardForPrincipal(db: PrismaClient, auth: AuthContext, query: { from?: string; to?: string }) {
  return reportTransaction(db, auth, async (tx, role) => {
    assertPermission(role, dashboardPermission[role])
    const now = new Date(), range = resolveReportRange(query, true, now)
    const common = { role, generatedAt: now.toISOString(), range: rangeDto(range) }
    const clinicianId = role === 'DOCTOR_IN_CHARGE' ? auth.principal.id : undefined
    const appointments = (await appointmentActivity(tx, range, clinicianId)).summary
    const snapshot = { upcomingAppointments: await upcomingAppointments(tx, now, clinicianId),
      unreadNotifications: await ownUnreadNotifications(tx, auth.principal.id) }
    if (role === 'DOCTOR_IN_CHARGE') {
      const clinical = await clinicalActivity(tx, range, auth.principal.id)
      return { ...common, snapshot: { ...snapshot, currentAuthoredDrafts: clinical.currentAuthoredDrafts },
        period: { appointments, clinical: clinical.summary } }
    }
    const patients = await patientSnapshot(tx), patientsRegistered = await registrationsCount(tx, range)
    if (role === 'ADMIN') return { ...common,
      snapshot: { ...snapshot, ...patients, activeStaff: await activeStaffSnapshot(tx) }, period: { appointments, patientsRegistered } }
    return { ...common, snapshot: { ...snapshot, ...patients }, period: { appointments, patientsRegistered } }
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
export function getAppointmentReport(db: PrismaClient, auth: AuthContext, query: ReportQuery) {
  return reportTransaction(db, auth, async (tx, role) => {
    assertPermission(role, 'REPORT_OPERATIONAL_VIEW')
    const now = new Date(), range = resolveReportRange(query, false, now), activity = await appointmentActivity(tx, range)
    return { generatedAt: now.toISOString(), range: rangeDto(range), summary: activity.summary, series: activity.series }
  })
}
export function getClinicalActivityReport(db: PrismaClient, auth: AuthContext, context: AuditContext, query: ReportQuery) {
  return reportTransaction(db, auth, async (tx, role) => {
    assertPermission(role, 'REPORT_CLINICAL_AGGREGATE_VIEW')
    const now = new Date(), range = resolveReportRange(query, false, now), activity = await clinicalActivity(tx, range, auth.principal.id)
    await appendAuditEvent(tx, { ...context, actorId: auth.principal.id, action: 'CLINICAL_REPORT_VIEWED',
      entityType: 'STAFF_USER', entityId: auth.principal.id, metadata: { source: 'API' } })
    return { generatedAt: now.toISOString(), range: rangeDto(range), snapshot: { currentAuthoredDrafts: activity.currentAuthoredDrafts },
      summary: activity.summary, series: activity.series }
  })
}
