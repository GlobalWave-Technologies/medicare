import { PatientNumber } from '../../components/ui/PatientNumber'
import { useState } from 'react'
import { ArrowRight, Plus, RefreshCw } from 'lucide-react'
import type { BackendRole } from '../../api/auth'
import { admissionsApi, type AdmissionStatus } from '../../api/admissions'
import { dashboardApi, type Dashboard } from '../../api/dashboard'
import type { View } from '../../types/index'
import { personName } from '../../lib/people'
import { displayTime } from '../../lib/time'
import type { PatientView } from '../patients/Patients'
import { KpiCard, ReportFeedback } from '../reports/ReportParts'
import { formatCount, plural } from '../reports/report-utils'
import { ActivityChart } from './ActivityChart'
import { activitySummary, chartPeriods, periodQuery, useAutoRefresh, useLiveRead, type ChartPeriod } from './dashboard-utils'
import '../reports/reports.css'
import './dashboard.css'

type Go = (view: View, patientView?: PatientView) => void
const timeOnly = (value: string) => new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(new Date(value))

// Each card answers one operational question. Admissions and discharges are hospital-wide
// aggregate counts for every role; a Medical Officer also sees their own unfinished records.
function cards(data: Dashboard, go: Go) {
  const admitted = <KpiCard key="admitted" label="Currently admitted" value={formatCount(data.snapshot.currentAdmissions)} detail="Patients in hospital now"
    action={{ label: 'View admitted patients', onClick: () => go('Patients', 'admitted') }} />
  const today = [
    <KpiCard key="admissions" label="Admissions today" value={formatCount(data.today.admissions)} detail="Since midnight (UTC)" />,
    <KpiCard key="discharges" label="Discharges today" value={formatCount(data.today.discharges)} detail="Since midnight (UTC)"
      action={{ label: 'View discharged patients', onClick: () => go('Patients', 'discharged') }} />,
  ]
  if (data.role === 'DOCTOR_IN_CHARGE') return [admitted, ...today, <KpiCard key="drafts" label="My unfinished records" value={formatCount(data.snapshot.currentAuthoredDrafts)}
    detail="Drafts to finalize before discharge" action={{ label: 'Open medical records', onClick: () => go('Medical records') }} />]
  const patients = <KpiCard key="patients" label="Total patients" value={formatCount(data.snapshot.activePatients)}
    detail={data.snapshot.archivedPatients ? `Active records (${plural(data.snapshot.archivedPatients, 'archived record')} kept separately)` : 'Active patient records'}
    action={{ label: 'View patients', onClick: () => go('Patients') }} />
  if (data.role === 'RECORDS_OFFICER') return [admitted, patients, ...today]
  return [admitted, patients, ...today, <KpiCard key="staff" label="Staff active now" value={formatCount(data.snapshot.staffActiveNow)}
    detail={`${plural(data.snapshot.staffSignedInToday, 'person', 'people')} signed in today`} action={{ label: 'Open Staff Activity', onClick: () => go('Activity') }} />]
}

// The latest stays; the full lists are in Patients.
function RecentStays({ status, revision, automatic, onOpen }: { status: AdmissionStatus; revision: number; automatic: boolean; onOpen: () => void }) {
  const { data, error, loading } = useLiveRead(status, revision, (signal) => admissionsApi.list({ status, limit: 5 }, signal, automatic))
  const current = status === 'ADMITTED', id = `recent-${status.toLowerCase()}`
  return <section className="panel recent-stays" aria-labelledby={id} aria-busy={loading}>
    <div className="recent-stays-head"><h2 id={id}>{current ? 'Recent admissions' : 'Recent discharges'}</h2>
      <button type="button" className="kpi-action" onClick={onOpen}>View all<span className="visually-hidden"> {current ? 'admitted' : 'discharged'} patients</span><ArrowRight size={16} aria-hidden="true" /></button></div>
    {loading && <div className="recent-skeleton" aria-hidden="true">{[0, 1, 2].map((n) => <span key={n} />)}</div>}
    {error !== undefined && !data && <ReportFeedback error={error} subject="dashboard" />}
    {data && (data.items.length ? <ul className="recent-stays-list">{data.items.map((item) => <li key={item.id}>
      <div><strong>{personName(item.patient)}</strong><PatientNumber className="recent-number" value={item.patient.patientNumber} /></div>
      <div className="recent-meta"><span>{item.roomNumber}</span><span>{current ? `Admitted ${displayTime(item.admittedAt)}` : `Discharged ${item.dischargedAt ? displayTime(item.dischargedAt) : ''}`}</span></div>
    </li>)}</ul> : <p className="report-empty-note">{current ? 'No patients are currently admitted.' : 'No discharges yet.'}</p>)}
  </section>
}

export function Overview({ role, onView, onRegister }: { role: BackendRole; onView: Go; onRegister?: () => void }) {
  const [period, setPeriod] = useState<ChartPeriod>('last7')
  const [tick, refresh, automatic] = useAutoRefresh()
  const { data, error, loading, updating, sameKey } = useLiveRead(period, tick, (signal) => dashboardApi.get(periodQuery(period, Date.now()), signal, automatic))
  const phrase = chartPeriods.find(([value]) => value === period)![2]
  const title = 'Admissions and discharges'
  return <div className="dashboard" aria-busy={loading}>
    <div className="dashboard-toolbar">
      <p className="dashboard-updated" role="status">{data ? <>Updated <time dateTime={data.generatedAt}>{timeOnly(data.generatedAt)}</time>{updating && ' · updating…'}</> : loading ? 'Loading current figures…' : 'Figures unavailable'}</p>
      <button type="button" className="button button-ghost" aria-label="Refresh overview" disabled={updating || loading} onClick={refresh}><RefreshCw size={17} aria-hidden="true" />Refresh</button>
      {onRegister && <button type="button" className="button button-primary dashboard-register" onClick={onRegister}><Plus size={17} aria-hidden="true" />Register patient</button>}
    </div>
    {error !== undefined && (data ? <p role="alert" className="dashboard-stale">The latest figures couldn’t be loaded, so the figures from {timeOnly(data.generatedAt)} are shown.
      <button type="button" className="button-link" onClick={refresh}>Try again</button></p> : <ReportFeedback error={error} subject="dashboard" onRetry={refresh} />)}
    <section aria-labelledby="overview-now" className="dashboard-now">
      <h2 id="overview-now" className="visually-hidden">Today</h2>
      {data ? <div className={`kpi-grid dashboard-kpis${role === 'ADMIN' ? ' kpi-five' : ''}`}>{cards(data, onView)}</div>
        : loading && <div className={`kpi-grid dashboard-kpis${role === 'ADMIN' ? ' kpi-five' : ''}`} aria-hidden="true">{(role === 'ADMIN' ? [0, 1, 2, 3, 4] : [0, 1, 2, 3]).map((n) => <div key={n} className="kpi-card skeleton-card"><span /><span /></div>)}</div>}
    </section>
    <section className="panel dashboard-chart" aria-labelledby="activity-title" aria-busy={updating}>
      <div className="dashboard-chart-head">
        <div><h2 id="activity-title">{title}</h2>
          <p id="activity-summary">{data && sameKey ? activitySummary(data.activity.admissions, data.activity.discharges, phrase, data.activity.series) : `Hospital-wide, ${phrase}.`}</p></div>
        <div role="group" aria-label="Chart period" className="report-segments">
          {chartPeriods.map(([value, label]) => <button key={value} type="button" aria-pressed={period === value} onClick={() => setPeriod(value)}>{label}</button>)}
        </div>
      </div>
      {loading ? <div className="chart-placeholder" aria-hidden="true"><span /></div>
        : data && (data.activity.admissions + data.activity.discharges === 0 && sameKey
          ? <p className="chart-empty">No admission activity recorded for this period.</p>
          : <ActivityChart series={data.activity.series} title={`${title} per day, ${phrase}`} busy={!sameKey} />)}
      <p className="chart-note">Counted per UTC calendar day across the whole hospital: admissions by admission time, discharges by discharge time. Updates every minute while this page is open.</p>
    </section>
    <div className="recent-stays-grid">
      <RecentStays status="ADMITTED" revision={tick} automatic={automatic} onOpen={() => onView('Patients', 'admitted')} />
      {role !== 'DOCTOR_IN_CHARGE' && <RecentStays status="DISCHARGED" revision={tick} automatic={automatic} onOpen={() => onView('Patients', 'discharged')} />}
    </div>
  </div>
}
