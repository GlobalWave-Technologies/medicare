import type { BackendRole } from '../src/api/auth'
import type { AdmissionSummary } from '../src/api/admissions'
import type { AdminDashboard, Dashboard, DoctorDashboard, RecordsDashboard } from '../src/api/dashboard'
import type { AdmissionReport, PatientReport, ReportBucket } from '../src/api/reports'

export const generatedAt = '2026-11-05T09:30:00.000Z'
export const range = (from: string, to: string, bucket: ReportBucket = 'day') => ({ from, to, bucket, timezone: 'UTC' as const })
export const today = range('2026-11-05T00:00:00.000Z', '2026-11-06T00:00:00.000Z')
export const last30 = range('2026-10-07T00:00:00.000Z', '2026-11-06T00:00:00.000Z')

export const last7 = range('2026-10-30T00:00:00.000Z', '2026-11-06T00:00:00.000Z')
// Seven UTC days ending today (5 Nov), as the server returns them for the default chart.
export const week = Array.from({ length: 7 }, (_, index) => ({ period: new Date(Date.UTC(2026, 9, 30) + index * 86400000).toISOString().slice(0, 10),
  admissions: [2, 0, 3, 1, 4, 2, 5][index]!, discharges: [1, 1, 0, 2, 3, 1, 2][index]! }))
const activity = { admissions: 17, discharges: 10, series: week }, todays = { admissions: 5, discharges: 2 }
export const adminDashboard: AdminDashboard = {
  role: 'ADMIN', generatedAt, range: last7, today: todays, activity,
  snapshot: { currentAdmissions: 9, unreadNotifications: 3, activePatients: 128, archivedPatients: 6, staffActiveNow: 4, staffSignedInToday: 7 },
}
export const recordsDashboard: RecordsDashboard = {
  role: 'RECORDS_OFFICER', generatedAt, range: last7, today: todays, activity,
  snapshot: { currentAdmissions: 9, unreadNotifications: 1, activePatients: 128, archivedPatients: 6 },
}
export const doctorDashboard: DoctorDashboard = {
  role: 'DOCTOR_IN_CHARGE', generatedAt, range: last7, today: todays, activity,
  snapshot: { currentAdmissions: 9, unreadNotifications: 0, currentAuthoredDrafts: 3 },
}
export const emptyActivity = { admissions: 0, discharges: 0, series: week.map((point) => ({ ...point, admissions: 0, discharges: 0 })) }
export const dashboardFor = (role: BackendRole): Dashboard => role === 'ADMIN' ? adminDashboard : role === 'RECORDS_OFFICER' ? recordsDashboard : doctorDashboard

// A short list of stays for the overview's recent admissions and discharges.
const staff = { id: 'staff-1', staffNumber: 'STF-A1', firstName: 'Synthetic', lastName: 'Officer' }
export const recentStay = (status: 'ADMITTED' | 'DISCHARGED', index = 1): AdmissionSummary => ({
  id: `stay-${status}-${index}`, admissionNumber: `AD-00000${index}`, status, roomNumber: `Ward A - Bed ${index}`,
  admittedAt: '2026-11-04T08:00:00.000Z', dischargedAt: status === 'DISCHARGED' ? '2026-11-05T08:00:00.000Z' : null,
  patient: { id: `patient-${index}`, patientNumber: `PT-RECENT-${index}`, firstName: 'Recent', middleName: null, lastName: `Patient ${index}` },
  admittedBy: staff, dischargedBy: status === 'DISCHARGED' ? staff : null,
})
export const recentPage = (status: 'ADMITTED' | 'DISCHARGED') => ({ items: [recentStay(status)], pagination: { page: 1, limit: 5, total: 1, totalPages: 1 } })

const days = (count: number, start = Date.UTC(2026, 9, 7)) => Array.from({ length: count }, (_, index) => new Date(start + index * 86400000).toISOString().slice(0, 10))
const registrations = days(30).map((period, index) => ({ period, registrations: [0, 2, 1, 0, 3][index % 5]! }))
export const patientReport: PatientReport = {
  generatedAt, range: last30, snapshot: { activePatients: 128, archivedPatients: 6 },
  summary: { registrationsInRange: registrations.reduce((total, row) => total + row.registrations, 0) }, series: registrations,
}
const stays = days(30).map((period, index) => ({ period, admissions: [1, 0, 2][index % 3]!, discharges: [0, 1, 1][index % 3]! }))
export const admissionReport: AdmissionReport = {
  generatedAt, range: last30, snapshot: { currentAdmissions: 9 }, series: stays,
  summary: { admissionsInRange: stays.reduce((total, row) => total + row.admissions, 0), dischargesInRange: stays.reduce((total, row) => total + row.discharges, 0) },
}
export const emptyPatientReport: PatientReport = { ...patientReport, summary: { registrationsInRange: 0 }, series: registrations.map((row) => ({ ...row, registrations: 0 })) }
export const emptyAdmissionReport: AdmissionReport = { ...admissionReport, summary: { admissionsInRange: 0, dischargesInRange: 0 }, series: stays.map((row) => ({ ...row, admissions: 0, discharges: 0 })) }
