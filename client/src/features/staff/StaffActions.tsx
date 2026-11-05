import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Eye, EyeOff, TriangleAlert } from 'lucide-react'
import type { BackendRole } from '../../api/auth'
import { staffApi, staffRoles, type StaffMember } from '../../api/staff'
import { Dialog } from '../../components/ui/Dialog'
import { StaffFeedback, type StaffMutation } from './StaffFeedback'
import { roleAccess, roleLabel, staffName, statusLabels, type StatusAction } from './staff-utils'
import { PASSWORD_MAX, PASSWORD_MIN, passwordLength, passwordProblem } from '../../lib/password'

const toneClass: Record<StatusAction['tone'], string> = { positive: 'button-primary', caution: 'staff-button-caution', danger: 'button-danger' }
const lastAdminNote = 'If this is the last active administrator, the change will be refused.'

// Shared shell: one request at a time, no optimistic change, and the server result decides what is shown.
function useCommand<T>(run: () => Promise<T>, done: (result: T) => void) {
  const [busy, setBusy] = useState(false), [error, setError] = useState<unknown>()
  const pending = useRef(false)
  async function execute() {
    if (pending.current) return
    pending.current = true; setBusy(true); setError(undefined)
    try { done(await run()) } catch (caught) { setError(caught) }
    finally { pending.current = false; setBusy(false) }
  }
  return { busy, error, execute }
}
function Confirm({ title, warning, tone = 'info', mutation, command, confirm, confirmClass, busyText, onClose, children, onSubmit }: {
  title: string; warning: ReactNode; tone?: 'info' | 'caution' | 'danger'; mutation: StaffMutation; command: ReturnType<typeof useCommand>
  confirm: string; confirmClass: string; busyText: string; onClose: () => void; children?: ReactNode; onSubmit: () => void
}) {
  const id = useId()
  const submit = (event: FormEvent) => { event.preventDefault(); onSubmit() }
  return <Dialog title={title} busy={command.busy} onClose={onClose} kind="staff" closeLabel={`Close ${title.toLowerCase()}`} describedBy={`${id}-warning`}>
    <form className="staff-form staff-confirm" onSubmit={submit} noValidate>
      <div id={`${id}-warning`} className={`staff-warning tone-${tone}`}>{tone !== 'info' && <TriangleAlert size={18} aria-hidden="true" />}<div>{warning}</div></div>
      {children && <fieldset disabled={command.busy}>{children}</fieldset>}
      {command.error !== undefined && <StaffFeedback error={command.error} mutation={mutation} />}
      {command.busy && <p role="status" className="loading-note">{busyText}</p>}
      <div className="modal-footer">
        <button type="button" className="button button-ghost" disabled={command.busy} onClick={onClose}>Cancel</button>
        <button className={`button ${confirmClass}`} disabled={command.busy}>{command.busy ? busyText : confirm}</button>
      </div>
    </form>
  </Dialog>
}

export function RoleDialog({ member, self, onClose, onChanged }: { member: StaffMember; self: boolean; onClose: () => void; onChanged: (user: StaffMember) => void }) {
  const [role, setRole] = useState<BackendRole>(), [problem, setProblem] = useState(''), id = useId()
  const command = useCommand(() => staffApi.changeRole(member.id, role!), ({ user }) => onChanged(user))
  const form = useRef<HTMLDivElement>(null)
  function submit() {
    if (!role) { setProblem('Choose the new role.'); form.current?.querySelector<HTMLInputElement>('input:not(:disabled)')?.focus(); return }
    void command.execute()
  }
  return <Confirm title="Change role" mutation="role" command={command} confirm="Change role" confirmClass="button-primary" busyText="Changing role…" onClose={onClose} onSubmit={submit}
    tone={self ? 'danger' : 'info'} warning={<>
      <p>Changing {self ? 'your' : `${staffName(member)}’s`} role updates the areas {self ? 'you' : 'they'} can access and signs {self ? 'you' : 'them'} out of all current sessions. {self ? 'You' : 'They'}’ll need to sign in again.</p>
      {self ? <p><strong>This is your own account.</strong> You’ll be signed out immediately and lose access to Staff & Access. If no other active administrator exists, the change is refused.</p>
        : member.role === 'ADMIN' && member.status === 'ACTIVE' && <p>{lastAdminNote}</p>}
    </>}>
    <div ref={form}><fieldset className="staff-role-choice" aria-describedby={problem ? `${id}-error` : undefined}>
      <legend>New role for {staffName(member)}</legend>
      {staffRoles.map((option) => <label key={option} className="staff-choice">
        <input type="radio" name="newRole" value={option} checked={role === option} disabled={option === member.role} aria-describedby={`${id}-${option}`} onChange={() => { setRole(option); setProblem('') }} />
        <span><strong>{roleLabel(option)}{option === member.role && ' (current role)'}</strong><span id={`${id}-${option}`}>{roleAccess[option]}</span></span>
      </label>)}
      {problem && <span id={`${id}-error`} className="staff-field-error">{problem}</span>}
    </fieldset></div>
  </Confirm>
}

function statusWarning(member: StaffMember, action: StatusAction, self: boolean) {
  const name = staffName(member), adminAtRisk = !self && member.role === 'ADMIN' && member.status === 'ACTIVE'
  if (action.to === 'DISABLED') return <>
    <p><strong>This permanently disables {self ? 'your' : `${name}’s`} account under the current system policy and cannot be reversed.</strong></p>
    <p>{self ? 'You' : 'They'} will be signed out on all devices and can never sign in with this account again. The account stays in the staff directory for the record.</p>
    {self ? <p><strong>This is your own account.</strong> You will permanently lose access. If no other active administrator exists, the change is refused.</p> : adminAtRisk && <p>{lastAdminNote}</p>}
  </>
  if (action.to === 'SUSPENDED') return <>
    <p>{self ? 'You' : name} will be signed out on all devices and unable to access Medicare until an administrator reactivates the account.</p>
    {self ? <p><strong>This is your own account.</strong> You’ll be signed out immediately and need another administrator to reactivate you. If no other active administrator exists, the change is refused.</p> : adminAtRisk && <p>{lastAdminNote}</p>}
  </>
  return member.status === 'SUSPENDED'
    ? <p>{name} will be able to sign in again with their existing password. They are not signed in automatically, and earlier sessions stay signed out.</p>
    : <p>{name} will be able to sign in with the credentials already set for this account.</p>
}
export function StatusDialog({ member, action, self, onClose, onChanged }: {
  member: StaffMember; action: StatusAction; self: boolean; onClose: () => void; onChanged: (user: StaffMember) => void
}) {
  const [understood, setUnderstood] = useState(false), [problem, setProblem] = useState(''), id = useId()
  const command = useCommand(() => staffApi.changeStatus(member.id, action.to), ({ user }) => onChanged(user))
  const terminal = action.to === 'DISABLED'
  function submit() {
    if (terminal && !understood) { setProblem('Confirm that you understand this can’t be undone.'); document.getElementById(`${id}-understood`)?.focus(); return }
    void command.execute()
  }
  return <Confirm title={terminal ? 'Disable account permanently' : action.label} mutation="status" command={command} confirm={action.label} confirmClass={toneClass[action.tone]}
    busyText={terminal ? 'Disabling account…' : action.to === 'SUSPENDED' ? 'Suspending account…' : 'Activating account…'} onClose={onClose} onSubmit={submit}
    tone={action.tone === 'positive' ? 'info' : action.tone} warning={<>
      <p className="staff-transition">{statusLabels[member.status]} <span aria-hidden="true">→</span><span className="visually-hidden">to</span> {statusLabels[action.to]}</p>
      {statusWarning(member, action, self)}
    </>}>
    {terminal && <label className="staff-acknowledge">
      <input id={`${id}-understood`} type="checkbox" name="understood" checked={understood} aria-invalid={Boolean(problem)} aria-describedby={problem ? `${id}-error` : undefined} onChange={(event) => { setUnderstood(event.target.checked); setProblem('') }} />
      I understand this account can’t be reactivated.</label>}
    {problem && <span id={`${id}-error`} className="staff-field-error">{problem}</span>}
  </Confirm>
}

export function SessionsDialog({ member, self, onClose, onRevoked }: { member: StaffMember; self: boolean; onClose: () => void; onRevoked: () => void }) {
  const command = useCommand(() => staffApi.revokeSessions(member.id), () => onRevoked())
  return <Confirm title="Sign out all sessions" mutation="sessions" command={command} confirm="Sign out all sessions" confirmClass="staff-button-caution" busyText="Signing out sessions…"
    onClose={onClose} onSubmit={() => void command.execute()} tone="caution" warning={self
      ? <><p>This immediately signs you out on all devices, <strong>including this browser</strong>. You’ll need to sign in again.</p><p>Your account stays {statusLabels[member.status]}.</p></>
      : <><p>This immediately signs {staffName(member)} out on all devices. Any unsaved work in their open sessions may be lost.</p><p>Their account stays {statusLabels[member.status]} and they can sign in again.</p></>} />
}

// Sets a pending account's first password, or replaces a forgotten or exposed one. The password is
// held only in this dialog and sent once; it is never shown again after the server accepts it.
export function PasswordDialog({ member, onClose, onDone }: { member: StaffMember; onClose: () => void; onDone: (user: StaffMember) => void }) {
  const setup = member.status === 'PENDING', name = staffName(member), id = useId(), fields = useRef<HTMLDivElement>(null)
  const [password, setPassword] = useState(''), [confirm, setConfirm] = useState(''), [show, setShow] = useState(false)
  const [problems, setProblems] = useState<{ password?: string; confirm?: string }>({})
  const command = useCommand(() => staffApi.resetPassword(member.id, password), ({ user }) => onDone(user))
  function submit() {
    const next: { password?: string; confirm?: string } = { password: passwordProblem(password, 'Enter the new password.') }
    if (!next.password && confirm !== password) next.confirm = 'The passwords don’t match.'
    setProblems(next); setShow(false)
    if (next.password || next.confirm) { fields.current?.querySelector<HTMLInputElement>(`[name="${next.password ? 'newPassword' : 'confirmNewPassword'}"]`)?.focus(); return }
    void command.execute()
  }
  const describe = (field: 'password' | 'confirm', ...extra: string[]) => [...extra, problems[field] ? `${id}-${field}-error` : ''].filter(Boolean).join(' ') || undefined
  return <Confirm title={setup ? 'Set password' : 'Reset password'} mutation="password" command={command} confirm={setup ? 'Set password' : 'Reset password'}
    confirmClass="staff-button-caution" busyText={setup ? 'Setting password…' : 'Resetting password…'} onClose={onClose} onSubmit={submit} tone="caution" warning={setup
      ? <><p>This sets the password {name} will use to sign in. The account stays Pending until you activate it.</p>
        <p>Give the password to {name} through your hospital’s approved secure channel. It isn’t shown again after you save it.</p></>
      : <><p>This replaces {name}’s password and <strong>immediately signs them out on all devices</strong>. Their old password stops working.</p>
        <p>Give the new password to {name} through your hospital’s approved secure channel. It isn’t shown again after you save it. Medicare never emails or displays passwords.</p></>}>
    <div ref={fields} className="staff-password">
      <div className="staff-password-heading"><strong>New password</strong>
        <button type="button" className="button button-ghost staff-password-toggle" aria-pressed={show} aria-controls={`${id}-password ${id}-confirm`} onClick={() => setShow((value) => !value)}>
          {show ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}{show ? 'Hide passwords' : 'Show passwords'}</button></div>
      <p id={`${id}-help`} className="field-helper">{PASSWORD_MIN} to {PASSWORD_MAX} characters; spaces are allowed.</p>
      <div className="staff-form-row">
        <label>New password<input id={`${id}-password`} name="newPassword" type={show ? 'text' : 'password'} value={password} autoComplete="new-password" spellCheck={false}
          aria-invalid={Boolean(problems.password)} aria-describedby={describe('password', `${id}-help`, `${id}-count`)} onChange={(event) => { setPassword(event.target.value); setProblems({}) }} />
          <span id={`${id}-count`} className="field-helper">{passwordLength(password)} of at least {PASSWORD_MIN} characters</span>
          {problems.password && <span id={`${id}-password-error`} className="staff-field-error">{problems.password}</span>}</label>
        <label>Confirm new password<input id={`${id}-confirm`} name="confirmNewPassword" type={show ? 'text' : 'password'} value={confirm} autoComplete="new-password" spellCheck={false}
          aria-invalid={Boolean(problems.confirm)} aria-describedby={describe('confirm')} onChange={(event) => { setConfirm(event.target.value); setProblems({}) }} />
          {problems.confirm && <span id={`${id}-confirm-error`} className="staff-field-error">{problems.confirm}</span>}</label>
      </div>
    </div>
  </Confirm>
}
