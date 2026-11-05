import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, LogOut, RefreshCw, ShieldCheck, UserCog } from 'lucide-react'
import { ApiError } from '../../api/client'
import type { StaffMember } from '../../api/staff'
import { RoleDialog, SessionsDialog, StatusDialog } from './StaffActions'
import { StaffFeedback } from './StaffFeedback'
import { StaffStatusBadge } from './StaffStatusBadge'
import { useStaffMember } from './useStaff'
import {
  canChangeRole, canRevokeSessions, initials, roleAccess, roleLabel, staffName, statusActions, statusLabels, statusMeaning, statusNotice, type StatusAction,
} from './staff-utils'

type Command = { kind: 'role' } | { kind: 'status'; action: StatusAction } | { kind: 'sessions' }
const actionClass: Record<StatusAction['tone'], string> = { positive: 'button-primary', caution: 'staff-button-caution', danger: 'button-danger-quiet' }

export function StaffDetail({ id, initial, selfId, notice: initialNotice = '', onBack, onChanged, onSessionEnded }: {
  id: string; initial?: StaffMember; selfId: string; notice?: string; onBack: () => void; onChanged: () => void; onSessionEnded: () => void
}) {
  const [revision, setRevision] = useState(0), [command, setCommand] = useState<Command>()
  const [result, setResult] = useState<{ revision: number; user: StaffMember }>(), [notice, setNotice] = useState(initialNotice)
  const heading = useRef<HTMLHeadingElement>(null)
  const read = useStaffMember(id, revision)
  // A command result is the newest server copy until the next deliberate refresh.
  const fresh = result?.revision === revision ? result.user : read.user
  const member = fresh ?? initial, self = id === selfId
  const missing = read.error instanceof ApiError && read.error.status === 404
  useEffect(() => { heading.current?.focus() }, [missing])
  function refresh() { setNotice(''); setResult(undefined); setRevision((n) => n + 1) }
  function changed(user: StaffMember, message: string, directory = true) {
    setCommand(undefined); setResult({ revision, user }); setNotice(message)
    // The server has revoked this browser's session too; confirm that with it rather than carrying on.
    if (self) { onSessionEnded(); return }
    if (directory) onChanged()
  }
  if (missing) return <section className="panel staff-detail" aria-labelledby="staff-detail-title">
    <div className="list-tools"><button type="button" className="button button-ghost" onClick={onBack}><ArrowLeft size={17} aria-hidden="true" />Back to staff directory</button></div>
    <h2 id="staff-detail-title" ref={heading} tabIndex={-1}>Staff account not found</h2>
    <StaffFeedback error={read.error} />
  </section>
  return <section className="panel staff-detail" aria-labelledby="staff-detail-title" aria-busy={read.loading}>
    <div className="list-tools">
      <button type="button" className="button button-ghost" onClick={onBack}><ArrowLeft size={17} aria-hidden="true" />Back to staff directory</button>
      <button type="button" className="button button-ghost" disabled={read.loading} onClick={refresh}><RefreshCw size={17} aria-hidden="true" />Refresh account</button>
    </div>
    {notice && <p role="status" className="staff-notice">{notice}</p>}
    <header className="staff-detail-header">
      {member && <span className="staff-avatar staff-avatar-large" aria-hidden="true">{initials(member)}</span>}
      <div>
        <h2 id="staff-detail-title" ref={heading} tabIndex={-1}>{member ? staffName(member) : 'Staff account'}</h2>
        {member && <div className="staff-detail-tags"><span className="staff-role-tag">{roleLabel(member.role)}</span><StaffStatusBadge status={member.status} />{self && <span className="staff-self-tag">Your account</span>}</div>}
      </div>
    </header>
    {member && <dl className="staff-identity">
      <div><dt>Staff number</dt><dd>{member.staffNumber}</dd></div>
      <div><dt>Work email</dt><dd>{member.email}</dd></div>
    </dl>}
    {read.loading && <p role="status" className="loading-note">Checking the latest account details…</p>}
    {read.error !== undefined && <div className="staff-recovery"><StaffFeedback error={read.error} />
      <p className="staff-note">Account actions are unavailable until the latest details load.</p>
      <button type="button" className="button button-ghost" onClick={refresh}>Try again</button></div>}
    {fresh && <div className="staff-sections">
      <section className="staff-section" aria-labelledby="staff-role-title">
        <h3 id="staff-role-title"><UserCog size={18} aria-hidden="true" />Role</h3>
        <p className="staff-section-value">{roleLabel(fresh.role)}</p>
        <p>{roleAccess[fresh.role]}</p>
        {canChangeRole(fresh)
          ? <><p className="staff-note">Changing the role signs this person out of all sessions.</p><div className="staff-section-actions"><button type="button" className="button button-ghost" onClick={() => setCommand({ kind: 'role' })}>Change role</button></div></>
          : <p className="staff-note">Disabled accounts keep their last role on record; it can’t be changed.</p>}
      </section>
      <section className="staff-section" aria-labelledby="staff-access-title">
        <h3 id="staff-access-title"><ShieldCheck size={18} aria-hidden="true" />Account access</h3>
        <p className="staff-section-value"><StaffStatusBadge status={fresh.status} /></p>
        <p>{statusMeaning[fresh.status]}</p>
        {statusActions[fresh.status].length
          ? <div className="staff-section-actions">{statusActions[fresh.status].map((action) => <button key={action.to} type="button" className={`button ${actionClass[action.tone]}`} onClick={() => setCommand({ kind: 'status', action })}>{action.label}</button>)}</div>
          : <p className="staff-note">No further status changes are available. Disabled is permanent.</p>}
      </section>
      <section className="staff-section" aria-labelledby="staff-sessions-title">
        <h3 id="staff-sessions-title"><LogOut size={18} aria-hidden="true" />Sessions</h3>
        {canRevokeSessions(fresh)
          ? <><p>Sign this person out everywhere, for example after a lost device or a shared computer was left signed in. Their account status doesn’t change.</p>
            <div className="staff-section-actions"><button type="button" className="button staff-button-caution" onClick={() => setCommand({ kind: 'sessions' })}>Sign out all sessions</button></div></>
          : <p>A {fresh.status === 'PENDING' ? 'pending' : fresh.status === 'SUSPENDED' ? 'suspended' : 'disabled'} account can’t be signed in, so it has no active sessions to sign out.</p>}
      </section>
    </div>}
    {fresh && command?.kind === 'role' && <RoleDialog member={fresh} self={self} onClose={() => setCommand(undefined)}
      onChanged={(user) => changed(user, `Role updated to ${roleLabel(user.role)}. Existing sessions have been signed out.`)} />}
    {fresh && command?.kind === 'status' && <StatusDialog member={fresh} action={command.action} self={self} onClose={() => setCommand(undefined)}
      onChanged={(user) => changed(user, statusNotice(fresh.status, user))} />}
    {fresh && command?.kind === 'sessions' && <SessionsDialog member={fresh} self={self} onClose={() => setCommand(undefined)}
      onRevoked={() => changed(fresh, `All sessions for ${staffName(fresh)} have been signed out. The account is still ${statusLabels[fresh.status]}.`, false)} />}
  </section>
}
