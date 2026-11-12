import { useRef, useState } from 'react'
import { ArrowLeft, LogOut, RefreshCw } from 'lucide-react'
import { staffApi } from '../../api/staff'
import { staffActivityApi, type StaffSessionRow } from '../../api/staffActivity'
import { Dialog } from '../../components/ui/Dialog'
import { Pagination } from '../../components/ui/Pagination'
import { ReportFeedback } from '../reports/ReportParts'
import { useLiveRead } from '../dashboard/dashboard-utils'
import { StaffFeedback } from '../staff/StaffFeedback'
import { StaffStatusBadge } from '../staff/StaffStatusBadge'
import { roleLabel } from '../staff/staff-utils'
import { ActivityList, PresenceBadge, When } from './ActivityParts'
import { staffFullName } from './activity-utils'

type Ending = { kind: 'one'; session: StaffSessionRow } | { kind: 'all' }
const best = (sessions: StaffSessionRow[]) => sessions.some((row) => row.status === 'ACTIVE_NOW') ? 'ACTIVE_NOW' as const
  : sessions.some((row) => row.status === 'RECENTLY_ACTIVE') ? 'RECENTLY_ACTIVE' as const : sessions.length ? 'IDLE' as const : 'SIGNED_OUT' as const

// One staff member: account facts, each browser they are signed in on, and their recent actions.
// Ending a session needs confirmation and is recorded in the audit log by the server.
export function StaffActivityDetail({ id, onBack, onSessionEnded }: { id: string; onBack: () => void; onSessionEnded: () => void }) {
  const [revision, setRevision] = useState(0), [page, setPage] = useState(1), [ending, setEnding] = useState<Ending>()
  const [busy, setBusy] = useState(false), [failure, setFailure] = useState<unknown>(), [notice, setNotice] = useState('')
  const pending = useRef(false)
  const { data, error, loading, updating } = useLiveRead(`${id}:${page}`, revision, (signal) => staffActivityApi.staff(id, page, signal))
  const staff = data?.staff, name = staff ? staffFullName(staff) : 'Staff member'
  const signsMeOut = ending?.kind === 'all' ? Boolean(data?.sessions.some((row) => row.current)) : Boolean(ending?.session.current)
  async function confirm() {
    if (!ending || pending.current) return
    pending.current = true; setBusy(true); setFailure(undefined)
    try {
      if (ending.kind === 'one') await staffActivityApi.revokeSession(id, ending.session.id)
      else await staffApi.revokeSessions(id)
      setEnding(undefined); setNotice(ending.kind === 'one' ? 'Session ended. That browser must sign in again.' : `${name} has been signed out everywhere.`)
      if (signsMeOut) { onSessionEnded(); return }
      setRevision((n) => n + 1)
    } catch (caught) { setFailure(caught) }
    finally { pending.current = false; setBusy(false) }
  }
  return <section className="panel activity-detail" aria-labelledby="activity-detail-title" aria-busy={loading || updating}>
    <div className="list-tools detail-tools">
      <button type="button" className="button button-ghost" onClick={onBack}><ArrowLeft size={17} aria-hidden="true" />Back to Staff Activity</button>
      <button type="button" className="button button-ghost tool-compact" aria-label="Refresh" disabled={loading || updating} onClick={() => { setNotice(''); setRevision((n) => n + 1) }}><RefreshCw size={17} aria-hidden="true" /><span className="tool-label">Refresh</span></button>
    </div>
    {notice && <p role="status" className="staff-notice">{notice}</p>}
    {loading && <div className="recent-skeleton" aria-hidden="true">{[0, 1, 2].map((n) => <span key={n} />)}</div>}
    {error !== undefined && !data && <ReportFeedback error={error} onRetry={() => setRevision((n) => n + 1)} />}
    {data && staff && <>
      <div className="detail-header"><div><p className="eyebrow">Staff member</p>
        <div className="detail-title"><h2 id="activity-detail-title">{name}</h2><PresenceBadge status={best(data.sessions)} /></div>
        <p className="detail-meta"><span className="record-id">{staff.staffNumber}</span><span>{roleLabel(staff.role)}</span><StaffStatusBadge status={staff.status} /></p></div></div>
      <dl className="patient-demographics activity-facts">
        <div><dt>Last signed in</dt><dd>{staff.lastLoginAt ? <When value={staff.lastLoginAt} now={data.generatedAt} relative={false} /> : 'Never signed in'}</dd></div>
        <div><dt>Last active</dt><dd>{staff.lastActivityAt ? <When value={staff.lastActivityAt} now={data.generatedAt} /> : 'No activity recorded'}</dd></div>
        <div><dt>Signed in now</dt><dd>{data.sessions.length === 0 ? 'No' : data.sessions.length === 1 ? 'On 1 browser or device' : `On ${data.sessions.length} browsers or devices`}</dd></div>
      </dl>

      <section className="admission-section" aria-labelledby="activity-sessions-title">
        <div className="activity-head"><h3 id="activity-sessions-title">Current sessions</h3>
          {data.sessions.length > 0 && <button type="button" className="button button-danger-quiet" onClick={() => { setFailure(undefined); setEnding({ kind: 'all' }) }}><LogOut size={17} aria-hidden="true" />Sign out everywhere</button>}</div>
        {data.sessions.length ? <ul className="activity-sessions">{data.sessions.map((session, index) => <li key={session.id}>
          <div><strong>Session {index + 1}{session.current && ' (this browser, you)'}</strong>
            <span>Signed in <When value={session.signedInAt} now={data.generatedAt} relative={false} /> · Last active <When value={session.lastActivityAt} now={data.generatedAt} /> · Ends <When value={session.expiresAt} now={data.generatedAt} relative={false} /></span></div>
          <PresenceBadge status={session.status} />
          {!session.current && <button type="button" className="button button-ghost" onClick={() => { setFailure(undefined); setEnding({ kind: 'one', session }) }}>End session<span className="visually-hidden"> {index + 1}</span></button>}
        </li>)}</ul> : <p className="admission-empty">Not signed in on any browser or device.</p>}
      </section>

      <section className="admission-section" aria-labelledby="activity-history-title">
        <h3 id="activity-history-title">Recent activity</h3>
        {data.activity.items.length ? <><ActivityList items={data.activity.items} now={data.generatedAt} label={`Recent activity of ${name}`} showActor={false} />
          <Pagination label="Activity pages" pagination={data.activity.pagination} onPage={setPage} /></>
          : <p className="admission-empty">No activity recorded yet.</p>}
        <p className="chart-note">Includes sign-ins and sign-outs, work in the system, and changes an administrator made to this account. Clinical details are never shown.</p>
      </section>
    </>}
    {ending && staff && <Dialog title={ending.kind === 'one' ? 'End this session?' : `Sign ${name} out everywhere?`} kind="activity" size="compact" busy={busy}
      closeLabel="Close" describedBy="ending-consequence" onClose={() => { if (!busy) setEnding(undefined) }}>
      <p id="ending-consequence" className="callout tone-warning">{ending.kind === 'one'
        ? `${name} will be signed out of this browser or device and must sign in again there. Their other sessions continue.`
        : `${name} will be signed out on every browser and device and must sign in again. Unsaved work in an open form may be lost.`}
        {signsMeOut && ' This includes your own session, so you will be signed out too.'}</p>
      {busy && <p role="status" className="loading-note">Ending session…</p>}
      {failure !== undefined && <StaffFeedback error={failure} />}
      <div className="modal-footer"><button type="button" className="button button-ghost" disabled={busy} onClick={() => setEnding(undefined)}>Cancel</button>
        <button type="button" className="button button-danger" disabled={busy} onClick={() => { void confirm() }}>{busy ? 'Ending…' : ending.kind === 'one' ? 'End session' : 'Sign out everywhere'}</button></div>
    </Dialog>}
  </section>
}
