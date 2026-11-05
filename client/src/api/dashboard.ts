import { request } from './client'
import { appointmentSummary, clinicalSummary, count, generated, invalidResponse, rangeParams, record, type AppointmentSummary, type ClinicalSummary, type ReportRange } from './reports'

type Common = { generatedAt: string; range: ReportRange }
type SharedSnapshot = { upcomingAppointments: number; unreadNotifications: number }
type PatientSnapshot = { activePatients: number; archivedPatients: number }
export type ActiveStaff = { total: number; admins: number; recordsOfficers: number; doctors: number }
export type AdminDashboard = Common & {
  role: 'ADMIN'; snapshot: SharedSnapshot & PatientSnapshot & { activeStaff: ActiveStaff }
  period: { appointments: AppointmentSummary; patientsRegistered: number }
}
export type RecordsDashboard = Common & {
  role: 'RECORDS_OFFICER'; snapshot: SharedSnapshot & PatientSnapshot
  period: { appointments: AppointmentSummary; patientsRegistered: number }
}
export type DoctorDashboard = Common & {
  role: 'DOCTOR_IN_CHARGE'; snapshot: SharedSnapshot & { currentAuthoredDrafts: number }
  period: { appointments: AppointmentSummary; clinical: ClinicalSummary }
}
export type Dashboard = AdminDashboard | RecordsDashboard | DoctorDashboard
export type DashboardQuery = { from?: string; to?: string }

// The server picks the dashboard from the session; the request carries only an optional period.
export const dashboardApi = {
  async get(query: DashboardQuery = {}, signal?: AbortSignal): Promise<Dashboard> {
    const data = record(await request<unknown>(`/dashboard${rangeParams(query, false)}`, { signal }))
    const common = generated(data), snapshot = record(data.snapshot), period = record(data.period)
    const shared = { upcomingAppointments: count(snapshot.upcomingAppointments), unreadNotifications: count(snapshot.unreadNotifications) }
    const appointments = appointmentSummary(period.appointments)
    if (data.role === 'DOCTOR_IN_CHARGE') return { ...common, role: data.role,
      snapshot: { ...shared, currentAuthoredDrafts: count(snapshot.currentAuthoredDrafts) }, period: { appointments, clinical: clinicalSummary(period.clinical) } }
    if (data.role !== 'ADMIN' && data.role !== 'RECORDS_OFFICER') throw invalidResponse()
    const patients = { activePatients: count(snapshot.activePatients), archivedPatients: count(snapshot.archivedPatients) }
    const operational = { appointments, patientsRegistered: count(period.patientsRegistered) }
    if (data.role === 'RECORDS_OFFICER') return { ...common, role: data.role, snapshot: { ...shared, ...patients }, period: operational }
    const staff = record(snapshot.activeStaff)
    return { ...common, role: data.role, period: operational, snapshot: { ...shared, ...patients, activeStaff: {
      total: count(staff.total), admins: count(staff.admins), recordsOfficers: count(staff.recordsOfficers), doctors: count(staff.doctors) } } }
  },
}
