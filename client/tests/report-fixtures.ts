import type { BackendRole } from '../src/api/auth'
import type { AdminDashboard, Dashboard, DoctorDashboard, RecordsDashboard } from '../src/api/dashboard'
import type { AppointmentReport, AppointmentSummary, ClinicalActivityReport, PatientReport, ReportBucket } from '../src/api/reports'

export const generatedAt = '2026-11-05T09:30:00.000Z'
export const range = (from: string, to: string, bucket: ReportBucket = 'day') => ({ from, to, bucket, timezone: 'UTC' as const })
export const today = range('2026-11-05T00:00:00.000Z', '2026-11-06T00:00:00.000Z')
export const last30 = range('2026-10-07T00:00:00.000Z', '2026-11-06T00:00:00.000Z')
export const summary = (over: Partial<AppointmentSummary> = {}): AppointmentSummary => ({
  totalAppointments: 12, scheduled: 3, confirmed: 2, checkedIn: 1, completed: 4, cancelled: 1, noShow: 1, cancellationRate: 8.33, noShowRate: 8.33, ...over,
})
export const zeroSummary = summary({ totalAppointments: 0, scheduled: 0, confirmed: 0, checkedIn: 0, completed: 0, cancelled: 0, noShow: 0, cancellationRate: 0, noShowRate: 0 })

export const adminDashboard: AdminDashboard = {
  role: 'ADMIN', generatedAt, range: today,
  snapshot: { upcomingAppointments: 7, unreadNotifications: 3, activePatients: 128, archivedPatients: 6, activeStaff: { total: 15, admins: 2, recordsOfficers: 5, doctors: 8 } },
  period: { appointments: summary(), patientsRegistered: 4 },
}
export const recordsDashboard: RecordsDashboard = {
  role: 'RECORDS_OFFICER', generatedAt, range: today,
  snapshot: { upcomingAppointments: 7, unreadNotifications: 1, activePatients: 128, archivedPatients: 6 },
  period: { appointments: summary(), patientsRegistered: 4 },
}
export const doctorDashboard: DoctorDashboard = {
  role: 'DOCTOR_IN_CHARGE', generatedAt, range: today,
  snapshot: { upcomingAppointments: 2, unreadNotifications: 0, currentAuthoredDrafts: 3 },
  period: { appointments: summary({ totalAppointments: 4, scheduled: 1, confirmed: 1, checkedIn: 1, completed: 1, cancelled: 0, noShow: 0, cancellationRate: 0, noShowRate: 0 }),
    clinical: { encountersInRange: 2, finalizedEncountersInRange: 1, amendmentsInRange: 1 } },
}
export const dashboardFor = (role: BackendRole): Dashboard => role === 'ADMIN' ? adminDashboard : role === 'RECORDS_OFFICER' ? recordsDashboard : doctorDashboard

const days = (count: number, start = Date.UTC(2026, 9, 7)) => Array.from({ length: count }, (_, index) => new Date(start + index * 86400000).toISOString().slice(0, 10))
const registrations = days(30).map((period, index) => ({ period, registrations: [0, 2, 1, 0, 3][index % 5]! }))
export const patientReport: PatientReport = {
  generatedAt, range: last30, snapshot: { activePatients: 128, archivedPatients: 6 },
  summary: { registrationsInRange: registrations.reduce((total, row) => total + row.registrations, 0) }, series: registrations,
}
const appointmentRows = days(30).map((period, index) => ({ period, ...(index % 3 ? zeroSummary : summary({ totalAppointments: 4, scheduled: 1, confirmed: 1, checkedIn: 0, completed: 1, cancelled: 1, noShow: 0, cancellationRate: 25, noShowRate: 0 })) }))
export const appointmentReport: AppointmentReport = {
  generatedAt, range: last30, series: appointmentRows,
  summary: summary({ totalAppointments: 40, scheduled: 10, confirmed: 10, checkedIn: 0, completed: 10, cancelled: 10, noShow: 0, cancellationRate: 25, noShowRate: 0 }),
}
export const clinicalReport: ClinicalActivityReport = {
  generatedAt, range: range('2026-10-07T00:00:00.000Z', '2026-11-06T00:00:00.000Z', 'week'),
  snapshot: { currentAuthoredDrafts: 3 }, summary: { encountersInRange: 9, finalizedEncountersInRange: 6, amendmentsInRange: 2 },
  series: [
    { period: '2026-10-05', encounters: 1, finalized: 0, amendments: 0 }, { period: '2026-10-12', encounters: 2, finalized: 2, amendments: 1 },
    { period: '2026-10-19', encounters: 3, finalized: 1, amendments: 0 }, { period: '2026-10-26', encounters: 2, finalized: 2, amendments: 1 },
    { period: '2026-11-02', encounters: 1, finalized: 1, amendments: 0 },
  ],
}
export const emptyPatientReport: PatientReport = { ...patientReport, summary: { registrationsInRange: 0 }, series: registrations.map((row) => ({ ...row, registrations: 0 })) }
export const emptyAppointmentReport: AppointmentReport = { ...appointmentReport, summary: zeroSummary, series: appointmentRows.map((row) => ({ ...row, ...zeroSummary })) }
export const emptyClinicalReport: ClinicalActivityReport = { ...clinicalReport, snapshot: { currentAuthoredDrafts: 0 }, summary: { encountersInRange: 0, finalizedEncountersInRange: 0, amendmentsInRange: 0 },
  series: clinicalReport.series.map((row) => ({ ...row, encounters: 0, finalized: 0, amendments: 0 })) }
