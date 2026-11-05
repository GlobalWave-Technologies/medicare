import { useEffect, useRef, useState } from 'react'
import { RefreshCw, ShieldCheck, UserPlus, UsersRound } from 'lucide-react'
import type { BackendRole, StaffUser } from '../../api/auth'
import { staffRoles, staffStatuses, type StaffMember, type StaffStatus } from '../../api/staff'
import { Pagination } from '../../components/ui/Pagination'
import { AddStaffDialog } from './AddStaffDialog'
import { StaffDetail } from './StaffDetail'
import { StaffFeedback } from './StaffFeedback'
import { StaffStatusBadge } from './StaffStatusBadge'
import { useStaffList, useStaffTotals } from './useStaff'
import { canAdministerStaff, initials, roleLabel, staffName, statusLabels } from './staff-utils'
import './staff.css'

const PAGE_SIZE = 20
const summaryOrder: StaffStatus[] = ['ACTIVE', 'PENDING', 'SUSPENDED', 'DISABLED']
type Props = { user: StaffUser; onSessionEnded: () => void }

export function StaffAdministration({ user, onSessionEnded }: Props) {
  // Gated before the workspace hooks run, so a non-admin never sends a staff request. The server still decides.
  if (!canAdministerStaff(user.role)) return <section className="panel staff-workspace" aria-labelledby="staff-restricted-title">
    <h2 id="staff-restricted-title">Administrator access required</h2><p>Staff accounts and access are managed by administrators.</p>
  </section>
  return <StaffWorkspace user={user} onSessionEnded={onSessionEnded} />
}

function StaffWorkspace({ user, onSessionEnded }: Props) {
  const [role, setRole] = useState<BackendRole | ''>(''), [status, setStatus] = useState<StaffStatus | ''>(''), [page, setPage] = useState(1)
  const [revision, setRevision] = useState(0), [adding, setAdding] = useState(false)
  const [selection, setSelection] = useState<{ id: string; initial?: StaffMember; notice?: string }>()
  const restore = useRef<string>(undefined), directory = useRef<HTMLDivElement>(null), heading = useRef<HTMLHeadingElement>(null)
  const { data, loading, error } = useStaffList({ page, limit: PAGE_SIZE, role: role || undefined, status: status || undefined }, revision)
  const totals = useStaffTotals(revision)
  const filtered = Boolean(role || status)
  const reload = () => setRevision((n) => n + 1)
  const clear = () => { setRole(''); setStatus(''); setPage(1) }
  useEffect(() => {
    if (selection || !restore.current) return
    const buttons = Array.from(directory.current?.querySelectorAll<HTMLButtonElement>(`[data-staff-id="${restore.current}"]`) ?? [])
    restore.current = undefined;
    (buttons.find((button) => button.getClientRects().length) ?? buttons[0] ?? heading.current)?.focus()
  }, [selection])
  function open(member: StaffMember) { restore.current = member.id; setSelection({ id: member.id, initial: member }) }
  function created(member: StaffMember) {
    restore.current = member.id
    setSelection({ id: member.id, initial: member, notice: `Account created for ${staffName(member)} (${member.staffNumber}). They can sign in now with the initial password you set.` })
    reload()
  }
  const onlySelf = !filtered && data?.pagination.total === 1 && data.users[0]?.id === user.id
  const manage = (member: StaffMember) => <button type="button" className="button button-ghost staff-manage" data-staff-id={member.id} aria-label={`Manage ${staffName(member)}`} onClick={() => open(member)}>Manage</button>
  const selfTag = (member: StaffMember) => member.id === user.id && <span className="staff-self-tag">Your account</span>
  return <>
    <section ref={directory} hidden={Boolean(selection)} className="panel staff-workspace" aria-labelledby="staff-directory-title" aria-busy={loading}>
      <div className="staff-header">
        <div><p className="staff-kicker">Staff administration</p><h2 id="staff-directory-title" ref={heading} tabIndex={-1}>Staff directory</h2>
          <p>Every staff account with access to Medicare, its role and its current status.</p></div>
        <div className="staff-toolbar">
          <button type="button" className="button button-ghost" aria-label="Refresh staff directory" disabled={loading} onClick={reload}><RefreshCw size={17} aria-hidden="true" />Refresh</button>
          <button type="button" className="button button-primary" onClick={() => setAdding(true)}><UserPlus size={17} aria-hidden="true" />Add staff member</button>
        </div>
      </div>
      <section className="staff-summary" aria-labelledby="staff-summary-title">
        <h3 id="staff-summary-title">Accounts by status</h3>
        {totals.error !== undefined
          ? <div className="staff-summary-error"><p>Account totals are unavailable.</p><button type="button" className="button button-ghost" onClick={reload}>Try again</button></div>
          : <dl>{summaryOrder.map((value) => <div key={value} className={`staff-summary-card status-${value.toLowerCase()}`}>
            <dt><StaffStatusBadge status={value} /></dt><dd>{totals.totals ? totals.totals[value].toLocaleString() : <span aria-label="Loading">…</span>}</dd>
          </div>)}</dl>}
        <p className="field-helper">Totals cover every staff account, not only the page shown.</p>
      </section>
      <div className="staff-filters">
        <label>Role<select name="staffRole" value={role} onChange={(event) => { setRole(event.target.value as BackendRole | ''); setPage(1) }}>
          <option value="">All roles</option>{staffRoles.map((value) => <option key={value} value={value}>{roleLabel(value)}</option>)}</select></label>
        <label>Status<select name="staffStatus" value={status} onChange={(event) => { setStatus(event.target.value as StaffStatus | ''); setPage(1) }}>
          <option value="">All statuses</option>{staffStatuses.map((value) => <option key={value} value={value}>{statusLabels[value]}</option>)}</select></label>
        {filtered && <button type="button" className="button button-ghost" onClick={clear}>Clear filters</button>}
      </div>
      {data && <p className="staff-scope" aria-live="polite">{data.pagination.total.toLocaleString()} staff account{data.pagination.total === 1 ? '' : 's'}{filtered ? ' match these filters' : ' in total'}</p>}
      {loading && <><p role="status" className="loading-note">Loading staff accounts…</p><div className="staff-skeleton" aria-hidden="true">{[0, 1, 2].map((row) => <div key={row}><span /><span /></div>)}</div></>}
      {error !== undefined && <div className="staff-recovery"><StaffFeedback error={error} /><button type="button" className="button button-ghost" onClick={reload}>Try again</button></div>}
      {data && !data.users.length && <div className="staff-empty" role="status"><UsersRound size={22} aria-hidden="true" />
        {data.pagination.total > 0 ? <><p>No staff accounts on this page.</p><button type="button" className="button button-ghost" onClick={() => setPage(1)}>Return to first page</button></>
          : filtered ? <><p>No staff accounts match these filters.</p><button type="button" className="button button-ghost" onClick={clear}>Clear filters</button></>
          : <p>No staff accounts were returned.</p>}
      </div>}
      {data && data.users.length > 0 && <>
        <table className="staff-table" aria-label="Staff accounts">
          <thead><tr><th scope="col">Staff member</th><th scope="col">Staff number</th><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead>
          <tbody>{data.users.map((member) => <tr key={member.id}>
            <td><div className="staff-person"><span className="staff-avatar" aria-hidden="true">{initials(member)}</span><div><strong>{staffName(member)}</strong>{selfTag(member)}</div></div></td>
            <td>{member.staffNumber}</td><td className="staff-email">{member.email}</td><td>{roleLabel(member.role)}</td>
            <td><StaffStatusBadge status={member.status} /></td><td>{manage(member)}</td>
          </tr>)}</tbody>
        </table>
        <ul className="staff-cards" aria-label="Staff accounts">{data.users.map((member) => <li key={member.id}>
          <article className="staff-card" aria-labelledby={`staff-card-${member.id}`}>
            <div className="staff-person"><span className="staff-avatar" aria-hidden="true">{initials(member)}</span>
              <div><h3 id={`staff-card-${member.id}`}>{staffName(member)}</h3>{selfTag(member)}</div></div>
            <dl>
              <div><dt>Staff number</dt><dd>{member.staffNumber}</dd></div>
              <div><dt>Role</dt><dd>{roleLabel(member.role)}</dd></div>
              <div><dt>Status</dt><dd><StaffStatusBadge status={member.status} /></dd></div>
              <div className="staff-card-email"><dt>Email</dt><dd className="staff-email">{member.email}</dd></div>
            </dl>
            {manage(member)}
          </article>
        </li>)}</ul>
      </>}
      {onlySelf && <div className="staff-callout"><ShieldCheck size={20} aria-hidden="true" /><div><p><strong>No additional staff accounts have been added yet.</strong></p>
        <p>Add records officers, doctors in charge and other administrators so each person signs in with their own account.</p></div>
        <button type="button" className="button button-primary" onClick={() => setAdding(true)}>Add staff member</button></div>}
      {data && data.pagination.total > 0 && <Pagination label="Staff pages" pagination={data.pagination} onPage={setPage} />}
    </section>
    {selection && <StaffDetail key={selection.id} id={selection.id} initial={selection.initial} notice={selection.notice} selfId={user.id}
      onBack={() => setSelection(undefined)} onChanged={reload} onSessionEnded={onSessionEnded} />}
    {adding && <AddStaffDialog onClose={() => setAdding(false)} onCreated={created} />}
  </>
}
