import { request } from './client'
import { count, generated, invalidResponse, rangeParams, record, type ReportRange } from './reports'

// Aggregate counts only: no patient, staff or clinical record ever reaches the dashboard.
type Common = {
  generatedAt: string; range: ReportRange
  today: { admissions: number; discharges: number }
  activity: { admissions: number; discharges: number; series: ActivityPoint[] }
}
type SharedSnapshot = { currentAdmissions: number; unreadNotifications: number }
export type ActivityPoint = { period: string; admissions: number; discharges: number }
export type AdminDashboard = Common & { role: 'ADMIN'; snapshot: SharedSnapshot & PatientTotals & { staffActiveNow: number; staffSignedInToday: number } }
export type RecordsDashboard = Common & { role: 'RECORDS_OFFICER'; snapshot: SharedSnapshot & PatientTotals }
export type DoctorDashboard = Common & { role: 'DOCTOR_IN_CHARGE'; snapshot: SharedSnapshot & { currentAuthoredDrafts: number } }
type PatientTotals = { activePatients: number; archivedPatients: number }
export type Dashboard = AdminDashboard | RecordsDashboard | DoctorDashboard
export type DashboardQuery = { from?: string; to?: string }

function series(value: unknown): ActivityPoint[] {
  if (!Array.isArray(value) || value.length > 32) throw invalidResponse()
  return value.map((item) => {
    const row = record(item)
    if (typeof row.period !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.period)) throw invalidResponse()
    return { period: row.period, admissions: count(row.admissions), discharges: count(row.discharges) }
  })
}

// The server picks the dashboard from the session; the request carries only the chart period.
// An automatic refresh says so, and is then not counted as the person's own activity.
export const dashboardApi = {
  async get(query: DashboardQuery = {}, signal?: AbortSignal, automatic = false): Promise<Dashboard> {
    const data = record(await request<unknown>(`/dashboard${rangeParams(query, false)}`, { signal, headers: automatic ? { 'X-Background-Refresh': '1' } : undefined }))
    const { generatedAt, range } = generated(data), snapshot = record(data.snapshot), today = record(data.today), activity = record(data.activity)
    if (range.bucket !== 'day') throw invalidResponse()
    const common: Common = { generatedAt, range, today: { admissions: count(today.admissions), discharges: count(today.discharges) },
      activity: { admissions: count(activity.admissions), discharges: count(activity.discharges), series: series(activity.series) } }
    const shared = { currentAdmissions: count(snapshot.currentAdmissions), unreadNotifications: count(snapshot.unreadNotifications) }
    if (data.role === 'DOCTOR_IN_CHARGE') return { ...common, role: data.role, snapshot: { ...shared, currentAuthoredDrafts: count(snapshot.currentAuthoredDrafts) } }
    if (data.role !== 'ADMIN' && data.role !== 'RECORDS_OFFICER') throw invalidResponse()
    const patients = { activePatients: count(snapshot.activePatients), archivedPatients: count(snapshot.archivedPatients) }
    if (data.role === 'RECORDS_OFFICER') return { ...common, role: data.role, snapshot: { ...shared, ...patients } }
    return { ...common, role: data.role, snapshot: { ...shared, ...patients, staffActiveNow: count(snapshot.staffActiveNow), staffSignedInToday: count(snapshot.staffSignedInToday) } }
  },
}
