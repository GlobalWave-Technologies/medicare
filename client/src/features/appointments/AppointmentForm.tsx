import { useUnsavedChanges } from '../../components/ui/useUnsavedChanges'
import { useRef, useState, type FormEvent } from 'react'
import type { BackendRole } from '../../api/auth'
import { appointmentsApi, type Appointment, type CreateAppointmentInput } from '../../api/appointments'
import type { Patient } from '../../api/patients'
import { ApiError } from '../../api/client'
import { AppointmentDialog } from './AppointmentDialog'
import { AppointmentFeedback } from './AppointmentFeedback'
import { PatientPicker, ClinicianPicker } from './AppointmentPickers'
import { canManageAppointments, formInput, formValues, isEditable, localTimezone, patientName, typeLabels, validateForm } from './appointment-utils'

export function AppointmentForm({ role, appointment, onClose, onSaved }: { role: BackendRole; appointment?: Appointment; onClose: () => void; onSaved: (appointment: Appointment) => void }) {
  const [initial] = useState(() => formValues(appointment))
  const [values, setValues] = useState(initial), [patient, setPatient] = useState<Patient | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(), [validation, setValidation] = useState<string | null>(null)
  const pending = useRef(false)
  const dirty = Boolean(patient) || JSON.stringify(values) !== JSON.stringify(initial)
  useUnsavedChanges(dirty)
  const close = () => { if (!pending.current && (!dirty || window.confirm('Discard unsaved appointment changes?'))) onClose() }
  if (!canManageAppointments(role) || (appointment && !isEditable(appointment))) return null
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (pending.current) return
    const message = !appointment && !patient ? 'Select an active patient from the search results.' : validateForm(values, appointment)
    setValidation(message); setError(undefined)
    if (message) return
    pending.current = true; setBusy(true)
    try {
      const input = formInput(values, appointment)
      const result = appointment ? await appointmentsApi.update(appointment.id, input)
        : await appointmentsApi.create({ ...input, patientId: patient!.id } as CreateAppointmentInput)
      onSaved(result.appointment); onClose()
    } catch (caught) {
      setError(caught)
      if (caught instanceof ApiError && ['CLINICIAN_NOT_FOUND', 'CLINICIAN_NOT_ACTIVE', 'INVALID_CLINICIAN_ROLE'].includes(caught.code ?? '')) setValues((current) => ({ ...current, clinicianId: '' }))
    } finally { pending.current = false; setBusy(false) }
  }
  return <AppointmentDialog title={appointment ? 'Edit appointment' : 'Book appointment'} busy={busy} onClose={close}>
    <form onSubmit={submit} noValidate className="appointment-form">
      <p className="form-intro">Times are in {localTimezone()}. When clocks repeat an hour, newly entered times use its first occurrence.</p>
      {validation && <p role="alert" className="appointment-error">{validation}</p>}
      {error !== undefined && <AppointmentFeedback error={error} mutation />}
      {busy && <p role="status" className="loading-note">Saving appointment…</p>}
      <fieldset disabled={busy}>
        {appointment ? <div className="appointment-picker"><strong>Patient</strong><p>{patientName(appointment.patient)} · {appointment.patient.patientNumber}</p><small>To change the patient, cancel this appointment and book another.</small></div> : <PatientPicker selected={patient} onSelect={setPatient} />}
        <ClinicianPicker value={values.clinicianId} onChange={(clinicianId) => setValues({ ...values, clinicianId })} />
        <div className="appointment-form-grid">
          <label>Start (local time)<input type="datetime-local" aria-describedby="appointment-time-help" name="start" required value={values.start} onChange={(event) => setValues({ ...values, start: event.target.value })} /></label>
          <label>End (local time)<input type="datetime-local" aria-describedby="appointment-time-help" name="end" required value={values.end} onChange={(event) => setValues({ ...values, end: event.target.value })} /></label>
        </div>
        <small id="appointment-time-help">Duration: 5 minutes to 12 hours. Availability is checked when you save.</small>
        <label>Appointment type<select name="type" value={values.type} onChange={(event) => setValues({ ...values, type: event.target.value as Appointment['type'] })}>{Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Reason (optional)<textarea name="reason" maxLength={500} value={values.reason} onChange={(event) => setValues({ ...values, reason: event.target.value })} /></label>
        <label>Scheduling notes (optional)<textarea name="notes" maxLength={5000} value={values.notes} onChange={(event) => setValues({ ...values, notes: event.target.value })} /></label>
      </fieldset>
      <div className="modal-footer"><button type="button" className="button button-ghost" disabled={busy} onClick={close}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? 'Saving…' : appointment ? 'Save changes' : 'Book appointment'}</button></div>
    </form>
  </AppointmentDialog>
}
