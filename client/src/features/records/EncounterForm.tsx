import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { StaffUser } from '../../api/auth'
import type { AppointmentPatient } from '../../api/appointments'
import { ApiError } from '../../api/client'
import { encountersApi, type Encounter } from '../../api/encounters'
import { submissionKeys } from '../../api/idempotency'
import { localTimezone } from '../appointments/appointment-time'
import { patientName } from '../appointments/appointment-utils'
import { ClinicalDialog } from './ClinicalDialog'
import { ClinicalFeedback } from './ClinicalFeedback'
import { canEditDraft, clinicalFormValues, clinicalInput, hasClinicalAccess, validateClinical } from './clinical-utils'

type Props = { user: StaffUser; patient: AppointmentPatient; appointment?: { id: string; reference: string } | null; encounter?: Encounter; onClose: () => void; onSaved: (encounter: Encounter) => void; onOpenExisting?: () => void }
export function EncounterForm(props: Props) {
  if (!hasClinicalAccess(props.user.role) || (props.encounter && !canEditDraft(props.user, props.encounter))) return null
  return <Editor {...props} />
}
function Editor({ patient, appointment, encounter, onClose, onSaved, onOpenExisting }: Props) {
  const [initial] = useState(() => clinicalFormValues(encounter)), [values, setValues] = useState(initial)
  const [error, setError] = useState<unknown>(), [validation, setValidation] = useState<string | null>(null), [busy, setBusy] = useState(false)
  const pending = useRef(false), nextKey = useRef(31), [keys] = useState(submissionKeys)
  const dirty = JSON.stringify(values) !== JSON.stringify(initial)
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  const close = () => { if (!pending.current && (!dirty || window.confirm('Discard unsaved clinical changes?'))) onClose() }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (pending.current) return
    const problem = validateClinical(values, encounter)
    setValidation(problem); setError(undefined)
    if (problem) return
    pending.current = true; setBusy(true)
    try {
      const input = clinicalInput(values, encounter)
      const creation = { ...input, patientId: patient.id, ...(appointment ? { appointmentId: appointment.id } : {}) }
      const result = encounter ? await encountersApi.updateDraft(encounter, input) : await encountersApi.create(creation, keys.key(creation))
      keys.settle(); onSaved(result.encounter); onClose()
    } catch (caught) { keys.settle(caught); setError(caught) }
    finally { pending.current = false; setBusy(false) }
  }
  return <ClinicalDialog size="wide" title={encounter ? 'Edit clinical draft' : 'New clinical encounter'} busy={busy} onClose={close}>
    <form className="clinical-form" noValidate onSubmit={submit}>
      <p className="modal-lead"><strong>{patientName(patient)}</strong> · {patient.patientNumber}{appointment && <> · Appointment {appointment.reference}</>}</p>
      <p className="callout tone-brand">Patient, appointment and authorship cannot be changed after creation. Saving creates or updates a draft; it does not finalize the record.</p>
      <p id="clinical-time-help" className="field-helper">Times in {localTimezone()}. Repeated clock times use the first occurrence when newly entered. Historical entries are allowed.</p>
      {validation && <p role="alert" className="clinical-error">{validation}</p>}{error !== undefined && <ClinicalFeedback error={error} mutation={encounter ? 'update' : 'create'} />}
      {busy && <p role="status" className="loading-note">Saving clinical draft…</p>}
      {error instanceof ApiError && error.code === 'APPOINTMENT_ALREADY_HAS_ENCOUNTER' && onOpenExisting && <button type="button" className="button button-ghost" onClick={() => { if (!dirty || window.confirm('Discard unsaved clinical changes and open the existing record?')) { onOpenExisting(); onClose() } }}>Open existing clinical record</button>}
      <nav className="editor-sections" aria-label="Clinical editor sections"><a href="#clinical-narrative">Clinical notes</a><a href="#clinical-complaints">Complaints</a><a href="#clinical-diagnoses">Diagnoses</a></nav>
      <fieldset disabled={busy}>
        <div className="clinical-form-grid"><label>Encounter time<input name="occurredAt" type="datetime-local" aria-describedby="clinical-time-help" value={values.occurredAt} onChange={(event) => setValues({ ...values, occurredAt: event.target.value })} /></label>
          <label>Follow-up time (optional)<input name="followUpAt" type="datetime-local" aria-describedby="clinical-time-help" value={values.followUpAt} onChange={(event) => setValues({ ...values, followUpAt: event.target.value })} /></label></div>
        <label>Room (optional)<input name="roomLabel" maxLength={100} value={values.roomLabel} onChange={(event) => setValues({ ...values, roomLabel: event.target.value })} /></label>
        <h3 id="clinical-narrative" tabIndex={-1}>Clinical notes and plan</h3>
        {(['historySummary', 'clinicalNotes', 'treatmentPlan'] as const).map((key) => <label key={key}>{({ historySummary: 'History summary', clinicalNotes: 'Clinical notes', treatmentPlan: 'Treatment plan' })[key]}<textarea name={key} rows={7} maxLength={20000} aria-describedby="clinical-text-help" value={values[key]} onChange={(event) => setValues({ ...values, [key]: event.target.value })} /></label>)}
        <small id="clinical-text-help" className="field-helper">Optional fields, up to 20,000 characters each. Internal line breaks are preserved. At least one clinical field, complaint or diagnosis is needed before finalization.</small>
        <section aria-label="Complaints"><h3 id="clinical-complaints" tabIndex={-1}>Complaints</h3><p>Up to 30 complaints; each description allows 200 characters.</p>
          {values.complaints.map((item, index) => <div className="clinical-child" key={item.key}><label>Complaint {index + 1}<textarea name={`complaint-${index}`} rows={2} maxLength={200} value={item.description} onChange={(event) => setValues({ ...values, complaints: values.complaints.map((current) => current.key === item.key ? { ...current, description: event.target.value } : current) })} /></label><button type="button" className="button button-ghost" onClick={() => setValues({ ...values, complaints: values.complaints.filter((current) => current.key !== item.key) })}>Remove complaint {index + 1}</button></div>)}
          <button type="button" className="button button-ghost" disabled={values.complaints.length >= 30} onClick={() => setValues({ ...values, complaints: [...values.complaints, { key: nextKey.current++, description: '' }] })}>Add complaint</button>
        </section>
        <section aria-label="Diagnoses"><h3 id="clinical-diagnoses" tabIndex={-1}>Diagnoses</h3><p id="diagnosis-help">Up to 30 diagnoses. Codes are optional labels; no coding registry validation is provided.</p>
          {values.diagnoses.map((item, index) => <div className="clinical-child" key={item.key}>
            {(['description', 'code', 'notes'] as const).map((key) => <label key={key}>Diagnosis {index + 1} {key}{key !== 'description' ? ' (optional)' : ''}<textarea name={`diagnosis-${index}-${key}`} rows={key === 'notes' ? 3 : 2} maxLength={key === 'description' ? 500 : key === 'code' ? 64 : 5000} aria-describedby="diagnosis-help" value={item[key]} onChange={(event) => setValues({ ...values, diagnoses: values.diagnoses.map((current) => current.key === item.key ? { ...current, [key]: event.target.value } : current) })} /></label>)}
            <button type="button" className="button button-ghost" onClick={() => setValues({ ...values, diagnoses: values.diagnoses.filter((current) => current.key !== item.key) })}>Remove diagnosis {index + 1}</button>
          </div>)}
          <button type="button" className="button button-ghost" disabled={values.diagnoses.length >= 30} onClick={() => setValues({ ...values, diagnoses: [...values.diagnoses, { key: nextKey.current++, description: '', code: '', notes: '' }] })}>Add diagnosis</button>
        </section>
      </fieldset>
      <div className="modal-footer"><button type="button" className="button button-ghost" disabled={busy} onClick={close}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? 'Saving draft…' : 'Save draft'}</button></div>
    </form>
  </ClinicalDialog>
}
