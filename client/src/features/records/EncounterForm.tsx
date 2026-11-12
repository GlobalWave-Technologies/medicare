import { PatientNumber } from '../../components/ui/PatientNumber'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { StaffUser } from '../../api/auth'
import type { PatientSummary } from '../../api/common'
import { encountersApi, type Encounter } from '../../api/encounters'
import { submissionKeys } from '../../api/idempotency'
import { personName } from '../../lib/people'
import { localTimezone } from '../../lib/time'
import { ClinicalDialog } from './ClinicalDialog'
import { ClinicalFeedback } from './ClinicalFeedback'
import { canAddToCatalog } from '../medications/catalog-utils'
import { MedicationOrders } from './MedicationOrders'
import { canEditDraft, clinicalFormValues, clinicalInput, hasClinicalAccess, validateClinical } from './clinical-utils'

export type AdmissionContext = { id: string; admissionNumber: string; roomNumber?: string }
type Props = { user: StaffUser; patient: PatientSummary; admission?: AdmissionContext | null; encounter?: Encounter; onClose: () => void; onSaved: (encounter: Encounter) => void }
export function EncounterForm(props: Props) {
  if (!hasClinicalAccess(props.user.role) || (props.encounter && !canEditDraft(props.user, props.encounter))) return null
  // A new record is always opened on the patient's current admission.
  if (!props.encounter && !props.admission) return null
  return <Editor {...props} />
}
function Editor({ user, patient, admission, encounter, onClose, onSaved }: Props) {
  const [initial] = useState(() => clinicalFormValues(encounter, admission?.roomNumber ?? '')), [values, setValues] = useState(initial)
  const [error, setError] = useState<unknown>(), [validation, setValidation] = useState<string | null>(null), [busy, setBusy] = useState(false)
  const pending = useRef(false), nextKey = useRef(31), [keys] = useState(submissionKeys)
  // A medication order still being entered counts as unsaved work.
  const [orderOpen, setOrderOpen] = useState(false)
  const dirty = orderOpen || JSON.stringify(values) !== JSON.stringify(initial)
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
    if (orderOpen) { setValidation('Finish the medication you are entering first: select Add to record, Update medication or Cancel.'); return }
    const problem = validateClinical(values, encounter)
    setValidation(problem); setError(undefined)
    if (problem) return
    pending.current = true; setBusy(true)
    try {
      const input = clinicalInput(values, encounter)
      const result = encounter ? await encountersApi.updateDraft(encounter, input)
        : await encountersApi.create({ ...input, admissionId: admission!.id }, keys.key({ ...input, admissionId: admission!.id }))
      keys.settle(); onSaved(result.encounter); onClose()
    } catch (caught) { keys.settle(caught); setError(caught) }
    finally { pending.current = false; setBusy(false) }
  }
  const stay = encounter?.admission ?? admission
  return <ClinicalDialog size="wide" title={encounter ? 'Edit clinical draft' : 'New clinical record'} busy={busy} onClose={close}>
    <form className="clinical-form" noValidate onSubmit={submit}>
      <p className="modal-lead"><strong>{personName(patient)}</strong> · <PatientNumber value={patient.patientNumber} />{stay && <> · <span className="nowrap">Admission {stay.admissionNumber}</span></>}</p>
      <div className="callout tone-info draft-final-guide"><ul>
        <li><strong>Save draft</strong>: the record stays a draft that you can still change.</li>
        <li><strong>Finalize record</strong> (from the saved record, when it is complete): it becomes part of the permanent medical record and can no longer be changed. Corrections are added as amendments.</li>
      </ul></div>
      <p id="clinical-time-help" className="field-helper">Times are in your local time ({localTimezone()}).</p>
      {validation && <p role="alert" className="clinical-error">{validation}</p>}{error !== undefined && <ClinicalFeedback error={error} mutation={encounter ? 'update' : 'create'} />}
      {busy && <p role="status" className="loading-note">Saving clinical draft…</p>}
      <nav className="editor-sections" aria-label="Clinical editor sections"><span aria-hidden="true">Jump to:</span><a href="#clinical-complaints">Complaints</a><a href="#clinical-narrative">Notes</a><a href="#clinical-diagnoses">Diagnoses</a><a href="#clinical-treatment">Treatment</a><a href="#clinical-medications">Medications</a></nav>
      <fieldset disabled={busy}>
        <div className="clinical-form-grid"><label>Encounter time<input name="occurredAt" type="datetime-local" aria-describedby="clinical-time-help" value={values.occurredAt} onChange={(event) => setValues({ ...values, occurredAt: event.target.value })} /></label>
          <label>Follow-up time (optional)<input name="followUpAt" type="datetime-local" aria-describedby="clinical-time-help" value={values.followUpAt} onChange={(event) => setValues({ ...values, followUpAt: event.target.value })} /></label></div>
        <label>Room (optional)<input name="roomLabel" maxLength={100} value={values.roomLabel} onChange={(event) => setValues({ ...values, roomLabel: event.target.value })} /></label>
        <section aria-label="Complaints"><h3 id="clinical-complaints" tabIndex={-1}>Complaints</h3><p>Add each presenting complaint separately.</p>
          {values.complaints.map((item, index) => <div className="clinical-child" key={item.key}><label>Complaint {index + 1}<textarea name={`complaint-${index}`} rows={2} maxLength={200} value={item.description} onChange={(event) => setValues({ ...values, complaints: values.complaints.map((current) => current.key === item.key ? { ...current, description: event.target.value } : current) })} /></label><button type="button" className="button button-ghost" onClick={() => setValues({ ...values, complaints: values.complaints.filter((current) => current.key !== item.key) })}>Remove complaint {index + 1}</button></div>)}
          <button type="button" className="button button-ghost" disabled={values.complaints.length >= 30} onClick={() => setValues({ ...values, complaints: [...values.complaints, { key: nextKey.current++, description: '' }] })}>Add complaint</button>
        </section>
        <section aria-label="Notes"><h3 id="clinical-narrative" tabIndex={-1}>Notes</h3>
          {(['historySummary', 'clinicalNotes'] as const).map((key) => <label key={key}>{key === 'historySummary' ? 'History summary' : 'Clinical notes'}<textarea name={key} rows={7} maxLength={20000} aria-describedby="clinical-text-help" value={values[key]} onChange={(event) => setValues({ ...values, [key]: event.target.value })} /></label>)}
          <small id="clinical-text-help" className="field-helper">Every field is optional, but a record needs at least one note, complaint, diagnosis or medication before it can be finalized.</small>
        </section>
        <section aria-label="Diagnoses"><h3 id="clinical-diagnoses" tabIndex={-1}>Diagnoses</h3><p id="diagnosis-help">A code is optional.</p>
          {values.diagnoses.map((item, index) => <div className="clinical-child" key={item.key}>
            {(['description', 'code', 'notes'] as const).map((key) => <label key={key}>Diagnosis {index + 1}{key === 'code' ? ' code (optional)' : key === 'notes' ? ' notes (optional)' : ''}<textarea name={`diagnosis-${index}-${key}`} rows={key === 'notes' ? 3 : 2} maxLength={key === 'description' ? 500 : key === 'code' ? 64 : 5000} aria-describedby="diagnosis-help" value={item[key]} onChange={(event) => setValues({ ...values, diagnoses: values.diagnoses.map((current) => current.key === item.key ? { ...current, [key]: event.target.value } : current) })} /></label>)}
            <button type="button" className="button button-ghost" onClick={() => setValues({ ...values, diagnoses: values.diagnoses.filter((current) => current.key !== item.key) })}>Remove diagnosis {index + 1}</button>
          </div>)}
          <button type="button" className="button button-ghost" disabled={values.diagnoses.length >= 30} onClick={() => setValues({ ...values, diagnoses: [...values.diagnoses, { key: nextKey.current++, description: '', code: '', notes: '' }] })}>Add diagnosis</button>
        </section>
        <section aria-label="Treatment"><h3 id="clinical-treatment" tabIndex={-1}>Treatment</h3>
          <label>Treatment plan<textarea name="treatmentPlan" rows={5} maxLength={20000} aria-describedby="clinical-text-help" value={values.treatmentPlan} onChange={(event) => setValues({ ...values, treatmentPlan: event.target.value })} /></label>
        </section>
        <MedicationOrders orders={values.medications} nextKey={() => nextKey.current++} onPendingChange={setOrderOpen} canAddToCatalog={canAddToCatalog(user.role)}
          onChange={(medications) => setValues((current) => ({ ...current, medications }))} />
      </fieldset>
      <div className="modal-footer"><button type="button" className="button button-ghost" disabled={busy} onClick={close}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? 'Saving draft…' : 'Save draft'}</button></div>
    </form>
  </ClinicalDialog>
}
