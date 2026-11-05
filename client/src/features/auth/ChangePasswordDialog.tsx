import { useId, useRef, useState, type FormEvent } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { authApi } from '../../api/auth'
import { ApiError, authErrorMessage } from '../../api/client'
import { Dialog } from '../../components/ui/Dialog'
import { PASSWORD_MAX, PASSWORD_MIN, passwordLength, passwordProblem } from '../../lib/password'

type Field = 'current' | 'next' | 'confirm'
const names: Record<Field, string> = { current: 'currentPassword', next: 'newPassword', confirm: 'confirmNewPassword' }

// Changes the signed-in person's own password. The confirmation is checked here and never sent.
// On success the server has signed out every session, so the caller returns to sign-in.
export function ChangePasswordDialog({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [form, setForm] = useState<Record<Field, string>>({ current: '', next: '', confirm: '' }), [show, setShow] = useState(false)
  const [problems, setProblems] = useState<Partial<Record<Field, string>>>({}), [error, setError] = useState<unknown>(), [busy, setBusy] = useState(false)
  const pending = useRef(false), formRef = useRef<HTMLFormElement>(null), id = useId()
  const focus = (field: Field) => formRef.current?.querySelector<HTMLInputElement>(`[name="${names[field]}"]`)?.focus()
  const set = (field: Field, value: string) => { setForm((current) => ({ ...current, [field]: value })); setProblems({}) }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (pending.current) return
    const next: Partial<Record<Field, string>> = {}
    if (!form.current) next.current = 'Enter your current password.'
    const policy = passwordProblem(form.next, 'Enter a new password.')
    if (policy) next.next = policy
    else if (form.next === form.current) next.next = 'Choose a password different from your current one.'
    if (!next.next && form.confirm !== form.next) next.confirm = 'The new passwords don’t match.'
    setProblems(next); setShow(false); setError(undefined)
    const first = (['current', 'next', 'confirm'] as const).find((field) => next[field])
    if (first) { focus(first); return }
    pending.current = true; setBusy(true)
    try {
      await authApi.changePassword(form.current, form.next)
      onChanged()
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'CURRENT_PASSWORD_INVALID') { setProblems({ current: 'Your current password isn’t correct.' }); setBusy(false); pending.current = false; setTimeout(() => focus('current')); return }
      if (caught instanceof ApiError && caught.code === 'PASSWORD_UNCHANGED') { setProblems({ next: 'Choose a password different from your current one.' }); setBusy(false); pending.current = false; setTimeout(() => focus('next')); return }
      setError(caught)
    }
    pending.current = false; setBusy(false)
  }
  const describe = (field: Field, ...extra: string[]) => [...extra, problems[field] ? `${id}-${field}-error` : ''].filter(Boolean).join(' ') || undefined
  const problem = (field: Field) => problems[field] && <span id={`${id}-${field}-error`} className="staff-field-error">{problems[field]}</span>
  const input = (field: Field, label: string, autoComplete: string, extra: string[] = []) => <label>{label}
    <input name={names[field]} type={show ? 'text' : 'password'} value={form[field]} autoComplete={autoComplete} spellCheck={false}
      aria-invalid={Boolean(problems[field])} aria-describedby={describe(field, ...extra)} onChange={(event) => set(field, event.target.value)} />
    {field === 'next' && <span id={`${id}-count`} className="field-helper">{passwordLength(form.next)} of at least {PASSWORD_MIN} characters</span>}
    {problem(field)}</label>
  return <Dialog title="Change password" busy={busy} onClose={onClose} kind="staff" size="compact" closeLabel="Close change password" describedBy={`${id}-intro`}>
    <form ref={formRef} className="staff-form" onSubmit={submit} noValidate>
      <p id={`${id}-intro`} className="staff-form-intro">After the change you’ll be signed out on all devices, including this one, and sign in again with the new password.</p>
      <fieldset disabled={busy}>
        {input('current', 'Current password', 'current-password')}
        <div className="staff-password">
          <div className="staff-password-heading"><strong>New password</strong>
            <button type="button" className="button button-ghost staff-password-toggle" aria-pressed={show} onClick={() => setShow((value) => !value)}>
              {show ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}{show ? 'Hide passwords' : 'Show passwords'}</button></div>
          <p id={`${id}-help`} className="field-helper">{PASSWORD_MIN} to {PASSWORD_MAX} characters; spaces are allowed. Don’t reuse a password from another service.</p>
          {input('next', 'New password', 'new-password', [`${id}-help`, `${id}-count`])}
          {input('confirm', 'Confirm new password', 'new-password')}
        </div>
      </fieldset>
      {error !== undefined && <div role="alert" className="staff-error">{changeError(error)}
        {error instanceof ApiError && error.requestId && <small>Support reference: {error.requestId}</small>}</div>}
      {busy && <p role="status" className="loading-note">Changing password…</p>}
      <div className="modal-footer">
        <button type="button" className="button button-ghost" disabled={busy} onClick={onClose}>Cancel</button>
        <button className="button button-primary" disabled={busy}>{busy ? 'Changing password…' : 'Change password'}</button>
      </div>
    </form>
  </Dialog>
}

function changeError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.code === 'PASSWORD_CHANGE_RATE_LIMITED') return `Too many incorrect attempts. Try again in ${Math.max(1, Math.ceil((error.retryAfter ?? 900) / 60))} minutes.`
    if (error.code === 'PASSWORD_CHANGED_ELSEWHERE') return 'Your password was changed elsewhere. Sign in again with your current password.'
    if (error.code === 'VALIDATION_ERROR') return 'The new password wasn’t accepted. Check it meets the rules and try again.'
    if (error.status >= 500) return 'The password change could not be confirmed. If you are asked to sign in, use your new password; otherwise try again.'
  } else return 'The password change could not be confirmed. If you are asked to sign in, use your new password; otherwise try again.'
  return authErrorMessage(error)
}
