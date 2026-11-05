import { useId, useRef, useState, type FormEvent } from 'react'
import { ShieldAlert } from 'lucide-react'
import type { BackendRole } from '../../api/auth'
import { notificationsApi, type BroadcastAudience, type BroadcastResult } from '../../api/notifications'
import { submissionKeys } from '../../api/idempotency'
import { Dialog } from '../../components/ui/Dialog'
import { useUnsavedChanges } from '../../components/ui/useUnsavedChanges'
import { NotificationFeedback } from './NotificationFeedback'
import { audienceRoles, MESSAGE_LIMIT, plainTextProblem, TITLE_LIMIT } from './notification-utils'

type Field = 'title' | 'message' | 'role'
const fieldNames: Record<Field, string> = { role: 'audienceRole', title: 'broadcastTitle', message: 'broadcastMessage' }
export function BroadcastComposer({ onClose, onSent }: { onClose: () => void; onSent: (result: BroadcastResult, audience: BroadcastAudience) => void }) {
  const [scope, setScope] = useState<'ALL' | 'ROLE'>('ALL'), [role, setRole] = useState<BackendRole | ''>('')
  const [title, setTitle] = useState(''), [message, setMessage] = useState('')
  const [problems, setProblems] = useState<Partial<Record<Field, string>>>({}), [error, setError] = useState<unknown>(), [busy, setBusy] = useState(false)
  const pending = useRef(false), form = useRef<HTMLFormElement>(null), id = useId(), [keys] = useState(submissionKeys)
  const dirty = Boolean(title.trim() || message.trim())
  useUnsavedChanges(dirty)
  const close = () => { if (!pending.current && (!dirty || window.confirm('Discard this unsent broadcast?'))) onClose() }
  const described = (field: Field, ...extra: string[]) => [...extra, problems[field] ? `${id}-${field}-error` : ''].filter(Boolean).join(' ') || undefined
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (pending.current) return
    const next: Partial<Record<Field, string>> = {
      role: scope === 'ROLE' && !role ? 'Choose the staff role that should receive this broadcast.' : undefined,
      title: plainTextProblem(title, 'title', TITLE_LIMIT), message: plainTextProblem(message, 'message', MESSAGE_LIMIT),
    }
    const invalid = (Object.keys(next) as Field[]).filter((field) => next[field])
    setProblems(next)
    if (invalid[0]) { form.current?.querySelector<HTMLElement>(`[name="${fieldNames[invalid[0]]}"]`)?.focus(); return }
    const audience: BroadcastAudience = scope === 'ROLE' && role ? { type: 'ROLE', role } : { type: 'ALL' }
    pending.current = true; setBusy(true); setError(undefined)
    const payload = { title: title.trim(), message: message.trim(), audience }
    try { const result = await notificationsApi.broadcast(payload, keys.key(payload)); keys.settle(); onSent(result, audience); onClose() }
    catch (caught) { keys.settle(caught); setError(caught) }
    finally { pending.current = false; setBusy(false) }
  }
  return <Dialog title="New staff broadcast" busy={busy} onClose={close} kind="notification" closeLabel="Close broadcast composer">
    <form ref={form} className="notification-form" onSubmit={submit} noValidate>
      <fieldset disabled={busy}>
        <fieldset className="notification-audience" aria-describedby={`${id}-audience-help`}>
          <legend>Audience</legend>
          <label className="notification-choice"><input type="radio" name="audience" value="ALL" checked={scope === 'ALL'} onChange={() => setScope('ALL')} />All active staff</label>
          <label className="notification-choice"><input type="radio" name="audience" value="ROLE" checked={scope === 'ROLE'} onChange={() => setScope('ROLE')} />Specific role</label>
          <p id={`${id}-audience-help`} className="field-helper">Broadcasts are delivered to active staff accounts.</p>
        </fieldset>
        {scope === 'ROLE' && <label>Staff role
          <select name="audienceRole" value={role} aria-invalid={Boolean(problems.role)} aria-describedby={described('role')} onChange={(event) => setRole(event.target.value as BackendRole | '')}>
            <option value="">Choose a role</option>{audienceRoles.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          {problems.role && <span id={`${id}-role-error`} className="notification-field-error">{problems.role}</span>}
        </label>}
        <label>Title
          <input name="broadcastTitle" value={title} maxLength={TITLE_LIMIT} autoComplete="off" aria-invalid={Boolean(problems.title)} aria-describedby={described('title', `${id}-title-count`)} onChange={(event) => setTitle(event.target.value)} />
          <span id={`${id}-title-count`} className="field-helper">{title.length} of {TITLE_LIMIT} characters</span>
          {problems.title && <span id={`${id}-title-error`} className="notification-field-error">{problems.title}</span>}
        </label>
        <label>Message
          <textarea name="broadcastMessage" value={message} maxLength={MESSAGE_LIMIT} rows={6} aria-invalid={Boolean(problems.message)} aria-describedby={described('message', `${id}-message-count`, `${id}-privacy`)} onChange={(event) => setMessage(event.target.value)} />
          <span id={`${id}-message-count`} className="field-helper">{message.length} of {MESSAGE_LIMIT} characters. Plain text only.</span>
          {problems.message && <span id={`${id}-message-error`} className="notification-field-error">{problems.message}</span>}
        </label>
        <div id={`${id}-privacy`} className="notification-privacy"><ShieldAlert size={18} aria-hidden="true" /><p>Do not include confidential patient or clinical information. A sent broadcast cannot be edited or withdrawn.</p></div>
      </fieldset>
      {error !== undefined && <NotificationFeedback error={error} mutation="broadcast" />}
      {busy && <p role="status" className="loading-note">Sending broadcast…</p>}
      <div className="modal-footer">
        <button type="button" className="button button-ghost" disabled={busy} onClick={close}>Cancel</button>
        <button className="button button-primary" disabled={busy}>{busy ? 'Sending…' : 'Send broadcast'}</button>
      </div>
    </form>
  </Dialog>
}
