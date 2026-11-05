import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Eye, EyeOff, KeyRound } from 'lucide-react'
import type { BackendRole } from '../../api/auth'
import { ApiError } from '../../api/client'
import { staffApi, staffRoles, type StaffMember } from '../../api/staff'
import { Dialog } from '../../components/ui/Dialog'
import { useUnsavedChanges } from '../../components/ui/useUnsavedChanges'
import { StaffFeedback } from './StaffFeedback'
import {
  EMAIL_LIMIT, NAME_LIMIT, PASSWORD_MAX, PASSWORD_MIN, passwordLength, roleAccess, roleLabel, staffError, staffFormProblems, uncertain,
  type StaffField, type StaffForm,
} from './staff-utils'

const blank: StaffForm = { firstName: '', lastName: '', email: '', staffNumber: '', role: '', password: '', confirmPassword: '' }
const order: StaffField[] = ['firstName', 'lastName', 'email', 'staffNumber', 'role', 'password', 'confirmPassword']
const fieldErrors: Record<string, StaffField> = { EMAIL_ALREADY_EXISTS: 'email', STAFF_NUMBER_ALREADY_EXISTS: 'staffNumber' }

export function AddStaffDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (user: StaffMember) => void }) {
  const [form, setForm] = useState<StaffForm>(blank), [problems, setProblems] = useState<Partial<Record<StaffField, string>>>({})
  const [error, setError] = useState<unknown>(), [busy, setBusy] = useState(false), [showPassword, setShowPassword] = useState(false)
  const [unconfirmed, setUnconfirmed] = useState(false), [duplicate, setDuplicate] = useState(false), [refused, setRefused] = useState<{ field: StaffField }>()
  const pending = useRef(false), formRef = useRef<HTMLFormElement>(null), id = useId()
  const dirty = Object.values(form).some((value) => value.trim() !== '')
  useUnsavedChanges(dirty)
  const close = () => { if (!pending.current && (!dirty || window.confirm('Discard this new staff account? The details you entered will be lost.'))) onClose() }
  const set = (field: StaffField, value: string) => setForm((current) => ({ ...current, [field]: value }))
  const focus = (field: StaffField) => formRef.current?.querySelector<HTMLElement>(`[name="${field}"]`)?.focus()
  // A refused field can only take focus once the form is enabled again.
  useEffect(() => { if (!busy && refused) focus(refused.field) }, [busy, refused])
  const errorId = (field: StaffField) => `${id}-${field}-error`
  const described = (field: StaffField, ...extra: string[]) => [...extra, problems[field] ? errorId(field) : ''].filter(Boolean).join(' ') || undefined
  const problem = (field: StaffField) => problems[field] && <span id={errorId(field)} className="staff-field-error">{problems[field]}</span>
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (pending.current) return
    const next = staffFormProblems(form)
    setProblems(next); setShowPassword(false)
    const first = order.find((field) => next[field])
    if (first) { focus(first); return }
    pending.current = true; setBusy(true); setError(undefined); setDuplicate(false); setRefused(undefined)
    try {
      const { user } = await staffApi.create({ ...form, role: form.role as BackendRole })
      onCreated(user); onClose()
    } catch (caught) {
      const field = caught instanceof ApiError && caught.code ? fieldErrors[caught.code] : undefined
      setDuplicate(caught instanceof ApiError && caught.status === 409)
      if (uncertain(caught)) setUnconfirmed(true)
      // A duplicate is reported on its field; everything else, with its support reference, in the alert.
      if (field) { setProblems({ [field]: staffError(caught) }); setRefused({ field }) } else setError(caught)
    } finally { pending.current = false; setBusy(false) }
  }
  return <Dialog title="Add staff member" busy={busy} onClose={close} kind="staff" closeLabel="Close add staff member">
    <form ref={formRef} className="staff-form" onSubmit={submit} noValidate>
      <p className="staff-form-intro">The account can sign in as soon as it is created. Check the details carefully: the name, email and staff number can’t be edited later in Staff & Access.</p>
      <fieldset disabled={busy}>
        <div className="staff-form-row">
          <label>First name<input name="firstName" value={form.firstName} maxLength={NAME_LIMIT} autoComplete="off" aria-invalid={Boolean(problems.firstName)} aria-describedby={described('firstName')} onChange={(event) => set('firstName', event.target.value)} />{problem('firstName')}</label>
          <label>Last name<input name="lastName" value={form.lastName} maxLength={NAME_LIMIT} autoComplete="off" aria-invalid={Boolean(problems.lastName)} aria-describedby={described('lastName')} onChange={(event) => set('lastName', event.target.value)} />{problem('lastName')}</label>
        </div>
        <div className="staff-form-row">
          <label>Work email<input name="email" type="email" inputMode="email" value={form.email} maxLength={EMAIL_LIMIT} autoComplete="off" spellCheck={false} aria-invalid={Boolean(problems.email)} aria-describedby={described('email', `${id}-email-help`)} onChange={(event) => set('email', event.target.value)} />
            <span id={`${id}-email-help`} className="field-helper">Used to sign in. Each account needs its own address.</span>{problem('email')}</label>
          <label>Staff number<input name="staffNumber" value={form.staffNumber} maxLength={36} autoComplete="off" spellCheck={false} autoCapitalize="characters" aria-invalid={Boolean(problems.staffNumber)} aria-describedby={described('staffNumber', `${id}-number-help`)} onChange={(event) => set('staffNumber', event.target.value)} />
            <span id={`${id}-number-help`} className="field-helper">STF- followed by 6 to 32 letters or digits, as issued by your institution.</span>{problem('staffNumber')}</label>
        </div>
        <fieldset className="staff-role-choice" aria-describedby={described('role')}>
          <legend>Role</legend>
          {staffRoles.map((role) => <label key={role} className="staff-choice">
            <input type="radio" name="role" value={role} checked={form.role === role} aria-describedby={`${id}-role-${role}`} onChange={() => set('role', role)} />
            <span><strong>{roleLabel(role)}</strong><span id={`${id}-role-${role}`}>{roleAccess[role]}</span></span>
          </label>)}
          {problem('role')}
        </fieldset>
        <div className="staff-password">
          <div className="staff-password-heading"><KeyRound size={18} aria-hidden="true" /><strong>Initial password</strong>
            <button type="button" className="button button-ghost staff-password-toggle" aria-pressed={showPassword} aria-controls={`${id}-password ${id}-confirm`} onClick={() => setShowPassword((value) => !value)}>
              {showPassword ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}{showPassword ? 'Hide passwords' : 'Show passwords'}</button></div>
          <p id={`${id}-password-help`} className="field-helper">{PASSWORD_MIN} to {PASSWORD_MAX} characters; spaces are allowed. Give it to the staff member through your hospital’s approved secure channel. It is not shown again after the account is created.</p>
          <div className="staff-form-row">
            <label>Password<input id={`${id}-password`} name="password" type={showPassword ? 'text' : 'password'} value={form.password} autoComplete="new-password" spellCheck={false} aria-invalid={Boolean(problems.password)} aria-describedby={described('password', `${id}-password-help`, `${id}-password-count`)} onChange={(event) => set('password', event.target.value)} />
              <span id={`${id}-password-count`} className="field-helper">{passwordLength(form.password)} of at least {PASSWORD_MIN} characters</span>{problem('password')}</label>
            <label>Confirm password<input id={`${id}-confirm`} name="confirmPassword" type={showPassword ? 'text' : 'password'} value={form.confirmPassword} autoComplete="new-password" spellCheck={false} aria-invalid={Boolean(problems.confirmPassword)} aria-describedby={described('confirmPassword')} onChange={(event) => set('confirmPassword', event.target.value)} />{problem('confirmPassword')}</label>
          </div>
        </div>
      </fieldset>
      {error !== undefined && <StaffFeedback error={error} mutation="create" />}
      {unconfirmed && duplicate && <p role="status" className="staff-note">An earlier attempt could not be confirmed, so this account may already exist. Close this form and check the staff directory.</p>}
      {busy && <p role="status" className="loading-note">Creating staff account…</p>}
      <div className="modal-footer">
        <button type="button" className="button button-ghost" disabled={busy} onClick={close}>Cancel</button>
        <button className="button button-primary" disabled={busy}>{busy ? 'Creating account…' : 'Create account'}</button>
      </div>
    </form>
  </Dialog>
}
