import { useRef, useState, type FormEvent } from 'react'
import { appointmentsApi, type Appointment } from '../../api/appointments'
import { AppointmentDialog } from './AppointmentDialog'
import { AppointmentFeedback } from './AppointmentFeedback'
export function AppointmentCancellation({ appointment, onClose, onSaved }: { appointment: Appointment; onClose: () => void; onSaved: (appointment: Appointment) => void }) {
  const [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(), [validation, setValidation] = useState('')
  const pending = useRef(false)
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (pending.current) return
    if (reason.trim().length > 500) { setValidation('Cancellation reason allows up to 500 characters.'); return }
    pending.current = true; setBusy(true); setError(undefined); setValidation('')
    try { const result = await appointmentsApi.cancel(appointment.id, reason.trim() || null); onSaved(result.appointment); onClose() }
    catch (caught) { setError(caught) }
    finally { pending.current = false; setBusy(false) }
  }
  return <AppointmentDialog size="compact" title="Cancel appointment" busy={busy} onClose={onClose}><form className="appointment-form" onSubmit={submit}>
    <p className="callout tone-warning">Cancel {appointment.reference}? The appointment history remains. This action does not remove the record.</p>
    {error !== undefined && <AppointmentFeedback error={error} mutation />}{validation && <p role="alert" className="appointment-error">{validation}</p>}
    {busy && <p role="status" className="loading-note">Cancelling appointment…</p>}
    <label>Cancellation reason (optional)<textarea name="cancellationReason" maxLength={500} value={reason} disabled={busy} onChange={(event) => setReason(event.target.value)} /></label>
    <div className="modal-footer"><button type="button" className="button button-ghost" disabled={busy} onClick={onClose}>Keep appointment</button><button className="button button-danger" disabled={busy}>{busy ? 'Cancelling…' : 'Confirm cancellation'}</button></div>
  </form></AppointmentDialog>
}
