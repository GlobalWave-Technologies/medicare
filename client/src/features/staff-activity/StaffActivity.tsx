import { useEffect, useState } from 'react'
import { RefreshCw, Search, UsersRound } from 'lucide-react'
import type { BackendRole } from '../../api/auth'
import { staffActivityApi, type ActiveStaffRow, type ActivityCategory, type ActivityPeriod } from '../../api/staffActivity'
import { Pagination } from '../../components/ui/Pagination'
import { ReportFeedback } from '../reports/ReportParts'
import { useAutoRefresh, useLiveRead } from '../dashboard/dashboard-utils'
import { roleLabel } from '../staff/staff-utils'
import { staffRoles } from '../../api/staff'
import { ActivityList, PresenceBadge, When } from './ActivityParts'
import { activityPeriods, categoryLabels, staffFullName } from './activity-utils'
import { StaffActivityDetail } from './StaffActivityDetail'
import './staff-activity.css'

const categories = Object.keys(categoryLabels) as (ActivityCategory | 'all')[]
const matches = (row: ActiveStaffRow, search: string, role: BackendRole | '') => {
  if (role && row.staff.role !== role) return false
  const words = search.toLowerCase().split(/\s+/).filter(Boolean)
  const haystack = `${row.staff.firstName} ${row.staff.lastName} ${row.staff.staffNumber}`.toLowerCase()
  return words.every((word) => haystack.includes(word))
}

// Administrators only. Who is signed in and how recently they used the system, then a list of
// recent actions in plain words. Nothing clinical and no patient is ever shown here.
export function StaffActivity({ initialStaffId, onSessionEnded }: { initialStaffId?: string; onSessionEnded: () => void }) {
  const [selected, setSelected] = useState(initialStaffId)
  if (selected) return <StaffActivityDetail id={selected} onBack={() => setSelected(undefined)} onSessionEnded={onSessionEnded} />
  return <Overview onOpen={setSelected} />
}

function Overview({ onOpen }: { onOpen: (id: string) => void }) {
  const [typed, setTyped] = useState(''), [search, setSearch] = useState(''), [role, setRole] = useState<BackendRole | ''>('')
  const [period, setPeriod] = useState<ActivityPeriod>('today'), [category, setCategory] = useState<ActivityCategory | 'all'>('all'), [page, setPage] = useState(1)
  const [tick, refresh, automatic] = useAutoRefresh()
  useEffect(() => { const timer = window.setTimeout(() => { setSearch(typed.trim()); setPage(1) }, 300); return () => window.clearTimeout(timer) }, [typed])
  const active = useLiveRead('active', tick, (signal) => staffActivityApi.active(signal, automatic))
  const query = { page, period, category, search, role: role || undefined }
  const events = useLiveRead(JSON.stringify(query), tick, (signal) => staffActivityApi.events(query, signal, automatic))
  const rows = active.data?.staff.filter((row) => matches(row, search, role)) ?? []
  const filtered = Boolean(search || role)
  const updatedAt = events.data?.generatedAt ?? active.data?.generatedAt
  return <div className="staff-activity">
    <div className="dashboard-toolbar">
      <p className="dashboard-updated" role="status">{updatedAt ? <>Updated <When value={updatedAt} now={updatedAt} relative={false} />{(active.updating || events.updating) && ' · updating…'}</> : 'Loading staff activity…'}</p>
      <button type="button" className="button button-ghost" aria-label="Refresh staff activity" disabled={active.loading || events.loading} onClick={refresh}><RefreshCw size={17} aria-hidden="true" />Refresh</button>
    </div>
    <div className="activity-filters" role="search" aria-label="Find staff">
      <label className="patients-search"><Search size={17} aria-hidden="true" /><input aria-label="Search staff by name or staff number" maxLength={100} value={typed}
        placeholder="Search staff by name or staff number…" onChange={(event) => setTyped(event.target.value)} /></label>
      <label className="activity-role">Role<select name="activityRole" value={role} onChange={(event) => { setRole(event.target.value as BackendRole | ''); setPage(1) }}>
        <option value="">All roles</option>{staffRoles.map((value) => <option key={value} value={value}>{roleLabel(value)}</option>)}</select></label>
      {filtered && <button type="button" className="button button-ghost" onClick={() => { setTyped(''); setSearch(''); setRole(''); setPage(1) }}>Clear filters</button>}
    </div>

    <section className="panel activity-panel" aria-labelledby="active-staff-title" aria-busy={active.loading}>
      <div className="activity-head"><h2 id="active-staff-title">Active staff</h2>
        {active.data && <p>{active.data.summary.activeNow} active now · {active.data.summary.signedIn} signed in · {active.data.summary.signedInToday} signed in today</p>}</div>
      {active.loading && <div className="recent-skeleton" aria-hidden="true">{[0, 1, 2].map((n) => <span key={n} />)}</div>}
      {active.error !== undefined && !active.data && <ReportFeedback error={active.error} onRetry={refresh} />}
      {active.data && (rows.length ? <table className="activity-table" aria-label="Signed-in staff">
        <thead><tr><th scope="col">Staff member</th><th scope="col">Role</th><th scope="col">Signed in</th><th scope="col">Last active</th><th scope="col">Status</th><th scope="col">Sessions</th><th scope="col"><span className="visually-hidden">Actions</span></th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.staff.id}>
          <td><strong>{staffFullName(row.staff)}</strong><small>{row.staff.staffNumber}</small></td>
          <td data-label="Role">{roleLabel(row.staff.role)}</td>
          <td data-label="Signed in"><When value={row.signedInAt} now={active.data!.generatedAt} relative={false} /></td>
          <td data-label="Last active"><When value={row.lastActivityAt} now={active.data!.generatedAt} /></td>
          <td data-label="Status"><PresenceBadge status={row.status} /></td>
          <td data-label="Sessions">{row.sessions}</td>
          <td className="activity-row-action"><button type="button" className="button button-ghost" onClick={() => onOpen(row.staff.id)}>View activity<span className="visually-hidden"> for {staffFullName(row.staff)}</span></button></td>
        </tr>)}</tbody>
      </table> : <div className="activity-empty"><UsersRound size={20} aria-hidden="true" /><p>{filtered ? 'No signed-in staff match these filters.' : 'No staff are signed in right now.'}</p></div>)}
      {active.data && <p className="chart-note">Active now: used the system in the last {active.data.thresholds.activeNowMinutes} minutes. Recently active: in the last {active.data.thresholds.recentMinutes} minutes. Idle: still signed in, but not used for longer. Being signed in does not mean someone is at the screen.</p>}
    </section>

    <section className="panel activity-panel" aria-labelledby="recent-activity-title" aria-busy={events.loading}>
      <div className="activity-head activity-head-controls"><h2 id="recent-activity-title">Recent staff activity</h2>
        <div role="group" aria-label="Activity period" className="report-segments">{activityPeriods.map(([value, label]) => <button key={value} type="button" aria-pressed={period === value} onClick={() => { setPeriod(value); setPage(1) }}>{label}</button>)}</div>
        <label className="activity-category-filter">Show<select name="activityCategory" value={category} onChange={(event) => { setCategory(event.target.value as ActivityCategory | 'all'); setPage(1) }}>
          {categories.map((value) => <option key={value} value={value}>{categoryLabels[value]}</option>)}</select></label>
      </div>
      {events.loading && <div className="recent-skeleton" aria-hidden="true">{[0, 1, 2, 3].map((n) => <span key={n} />)}</div>}
      {events.error !== undefined && !events.data && <ReportFeedback error={events.error} onRetry={refresh} />}
      {events.data && (events.data.items.length ? <div className={events.sameKey ? undefined : 'is-busy'}>
        <ActivityList items={events.data.items} now={events.data.generatedAt} label="Recent staff activity" />
        <Pagination label="Activity pages" pagination={events.data.pagination} onPage={setPage} />
      </div> : <div className="activity-empty"><p>{filtered || category !== 'all' ? 'No activity matches these filters for this period.' : 'No staff activity recorded for this period.'}</p></div>)}
      <p className="chart-note">Shows actions such as signing in, registering, admitting and discharging patients, and finalizing records, in plain words. It never shows clinical details or which patient was involved. Times are in your local time.</p>
    </section>
  </div>
}
