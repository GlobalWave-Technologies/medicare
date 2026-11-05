import { useState } from 'react'
import { ArrowRight, CalendarDays, ClipboardList, FileText, RefreshCw, ShieldCheck, UsersRound } from 'lucide-react'
import type { BackendRole } from '../../api/auth'
import { dashboardApi, type Dashboard, type DashboardQuery } from '../../api/dashboard'
import type { View } from '../../types/index'
import { KpiCard, ReportFeedback, ReportSkeleton, SectionHead, StatusBreakdown } from '../reports/ReportParts'
import { presetRange, rangeLabel } from '../reports/report-time'
import { formatCount, formatRate, generatedLabel, plural, useKeyedRead } from '../reports/report-utils'
import '../reports/reports.css'

type Period = 'today' | 'last7' | 'last30'
const periods: [Period, string, string][] = [['today', 'Today', 'today'], ['last7', 'Last 7 days', 'in the last 7 days'], ['last30', 'Last 30 days', 'in the last 30 days']]
type Go = (view: View) => void
// "Today" lets the server choose its UTC day; other periods are explicit UTC calendar ranges.
const periodQuery = (value: Period): DashboardQuery => value === 'today' ? {} : presetRange(value, Date.now())

function currentCards(data: Dashboard, go: Go) {
  const { snapshot } = data
  const unread = <KpiCard key="unread" label="Unread notifications" value={formatCount(snapshot.unreadNotifications)} detail="In your own inbox." action={{ label: 'Open notifications', onClick: () => go('Notifications') }} />
  if (data.role === 'DOCTOR_IN_CHARGE') return [
    <KpiCard key="upcoming" label="My upcoming appointments" value={formatCount(snapshot.upcomingAppointments)} detail="Assigned to you, scheduled or confirmed, from now onward." action={{ label: 'View my appointments', onClick: () => go('Appointments') }} />,
    <KpiCard key="drafts" label="My open drafts" value={formatCount(data.snapshot.currentAuthoredDrafts)} detail="Encounters you started that aren’t finalized yet." action={{ label: 'Open medical records', onClick: () => go('Medical records') }} />,
    unread,
  ]
  const patients = [
    <KpiCard key="active" label="Active patients" value={formatCount(data.snapshot.activePatients)} detail="Registered and not archived." action={{ label: 'View patients', onClick: () => go('Patients') }} />,
    <KpiCard key="archived" label="Archived patients" value={formatCount(data.snapshot.archivedPatients)} detail="Kept on record; an archived patient can be reactivated." />,
  ]
  const upcoming = <KpiCard key="upcoming" label="Upcoming appointments" value={formatCount(snapshot.upcomingAppointments)} detail="Scheduled or confirmed, from now onward." action={{ label: 'View appointments', onClick: () => go('Appointments') }} />
  if (data.role === 'RECORDS_OFFICER') return [...patients, upcoming, unread]
  const staff = data.snapshot.activeStaff
  return [...patients, <KpiCard key="staff" label="Active staff" value={formatCount(staff.total)}
    detail={`${plural(staff.admins, 'Admin')} · ${plural(staff.recordsOfficers, 'Records Officer')} · ${plural(staff.doctors, 'Doctor in Charge', 'Doctors in Charge')}`}
    action={{ label: 'Manage staff', onClick: () => go('Staff') }} />, upcoming, unread]
}
function periodCards(data: Dashboard) {
  const { appointments } = data.period
  const rates = [
    <KpiCard key="cancellation" label="Cancellation rate" value={formatRate(appointments.cancellationRate)} detail={`${formatCount(appointments.cancelled)} of ${plural(appointments.totalAppointments, 'appointment')} cancelled.`} />,
    <KpiCard key="no-show" label="No-show rate" value={formatRate(appointments.noShowRate)} detail={`${formatCount(appointments.noShow)} of ${plural(appointments.totalAppointments, 'appointment')} marked no-show.`} />,
  ]
  if (data.role === 'DOCTOR_IN_CHARGE') return [
    <KpiCard key="appointments" label="My appointments" value={formatCount(appointments.totalAppointments)} detail="Assigned to you, with a scheduled start in this period." />,
    <KpiCard key="encounters" label="Encounters documented" value={formatCount(data.period.clinical.encountersInRange)} detail="Encounters you authored, by encounter date." />,
    <KpiCard key="finalized" label="Encounters finalized" value={formatCount(data.period.clinical.finalizedEncountersInRange)} detail="Your encounters finalized in this period." />,
    <KpiCard key="amendments" label="Amendments added" value={formatCount(data.period.clinical.amendmentsInRange)} detail="Amendments you added in this period." />,
  ]
  return [
    <KpiCard key="registered" label="Patients registered" value={formatCount(data.period.patientsRegistered)} detail="New registrations, including patients archived since." />,
    <KpiCard key="appointments" label="Appointments" value={formatCount(appointments.totalAppointments)} detail="With a scheduled start in this period." />,
    ...rates,
  ]
}
const shortcuts = (role: BackendRole) => [
  { view: 'Appointments' as const, icon: CalendarDays, title: role === 'DOCTOR_IN_CHARGE' ? 'My appointments' : 'Appointment operations', text: role === 'DOCTOR_IN_CHARGE' ? 'Review your assigned visits, check in a patient and open their clinical record.' : 'Book visits, manage the schedule and record attendance.' },
  { view: 'Patients' as const, icon: UsersRound, title: 'Patient directory', text: role === 'DOCTOR_IN_CHARGE' ? 'Find a patient and open their clinical history.' : 'Register patients, update demographics and manage archived records.' },
  role === 'DOCTOR_IN_CHARGE' ? { view: 'Medical records' as const, icon: FileText, title: 'Clinical records', text: 'Review encounters, complete your drafts and add permanent amendments.' }
    : role === 'ADMIN' ? { view: 'Staff' as const, icon: ShieldCheck, title: 'Staff & Access', text: 'Add staff accounts, change roles and manage who can sign in.' }
    : { view: 'Reports' as const, icon: ClipboardList, title: 'Reports', text: 'Review patient registration and appointment activity over a reporting period.' },
]

export function Overview({ role, onView }: { role: BackendRole; onView: Go }) {
  const [period, setPeriod] = useState<{ value: Period; query: DashboardQuery }>({ value: 'today', query: {} })
  const [revision, setRevision] = useState(0)
  const { data, loading, error } = useKeyedRead(JSON.stringify([period.query, revision]), (signal) => dashboardApi.get(period.query, signal))
  const choose = (value: Period) => setPeriod({ value, query: periodQuery(value) })
  const refresh = () => { choose(period.value); setRevision((n) => n + 1) }
  const phrase = periods.find(([value]) => value === period.value)![2]
  const doctor = data?.role === 'DOCTOR_IN_CHARGE'
  return <div className="dashboard" aria-busy={loading}>
    <div className="report-toolbar">
      <div role="group" aria-label="Activity period" className="report-segments">
        {periods.map(([value, label]) => <button key={value} type="button" aria-pressed={period.value === value} onClick={() => choose(value)}>{label}</button>)}
      </div>
      <div className="report-refresh">
        <p>{data ? <>Last refreshed <time dateTime={data.generatedAt}>{generatedLabel(data.generatedAt)}</time></> : loading ? 'Loading current figures…' : 'Figures unavailable'}</p>
        <button type="button" className="button button-ghost" aria-label="Refresh overview" disabled={loading} onClick={refresh}><RefreshCw size={17} aria-hidden="true" />Refresh</button>
      </div>
    </div>
    {loading && <ReportSkeleton label="Loading overview…" cards={role === 'DOCTOR_IN_CHARGE' ? 3 : 4} />}
    {error !== undefined && <ReportFeedback error={error} subject="dashboard" onRetry={refresh} />}
    {data && <>
      <section className="panel report-section dashboard-now" aria-labelledby="overview-now">
        <SectionHead id="overview-now" title={doctor ? 'My current workload' : 'Current status'}><p>Live counts when the overview was refreshed. They don’t depend on the activity period.</p></SectionHead>
        <div className="kpi-grid">{currentCards(data, onView)}</div>
      </section>
      <section className="panel report-section" aria-labelledby="overview-period">
        <SectionHead id="overview-period" title={`${doctor ? 'My activity' : 'Hospital activity'} ${phrase}`}>
          <p>{rangeLabel(data.range)} (UTC calendar {period.value === 'today' ? 'day' : 'days'}). {doctor ? 'Only appointments assigned to you and your own clinical work.' : 'Across the whole hospital.'}</p>
        </SectionHead>
        <div className="kpi-grid">{periodCards(data)}</div>
        <StatusBreakdown summary={data.period.appointments} title={doctor ? 'My appointments by current status' : 'Appointments by current status'}
          empty={`No appointments ${doctor ? 'assigned to you are ' : 'are '}scheduled ${phrase}.`} />
      </section>
    </>}
    <section className="dashboard-shortcuts" aria-labelledby="overview-shortcuts">
      <h2 id="overview-shortcuts">Your workspaces</h2>
      <div className="workflow-grid">{shortcuts(role).map(({ view, icon: Icon, title, text }) => <button key={view} type="button" className="workflow-card" onClick={() => onView(view)}>
        <Icon size={24} aria-hidden="true" /><strong>{title}</strong><span>{text}</span><span className="workflow-link">Open workspace <ArrowRight size={16} aria-hidden="true" /></span>
      </button>)}</div>
    </section>
  </div>
}
