import { useUnsavedChanges } from '../../components/ui/useUnsavedChanges'
import { useRef, useState, type FormEvent } from 'react'
import type { BackendRole } from '../../api/auth'
import { patientsApi, type Patient } from '../../api/patients'
import { submissionKeys } from '../../api/idempotency'
import { PatientDialog } from './PatientDialog'
import { PatientFeedback } from './PatientFeedback'
import { canManagePatients, changedInput, formInput, formValues, todayDate, validatePatientForm, type PatientFormValues } from './patient-utils'

type Props = { role: BackendRole; patient?: Patient; onClose: () => void; onCreated: (patient: Patient) => void }
export function PatientModal({ role, patient, onClose, onCreated }: Props) {
  const [initial] = useState(() => formValues(patient))
  const [values, setValues] = useState(initial)
  const dirty = JSON.stringify(values) !== JSON.stringify(initial)
  useUnsavedChanges(dirty)
  const [saving, setSaving] = useState(false), [error, setError] = useState<unknown>(null)
  const inFlight = useRef(false), [keys] = useState(submissionKeys)
  const close = () => { if (!inFlight.current && (!dirty || window.confirm('Discard unsaved patient changes?'))) onClose() }
  const maxDate = patient ? [todayDate(), patient.createdAt.slice(0, 10)].sort()[0] : todayDate()
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (inFlight.current || !canManagePatients(role) || patient?.archivedAt) return
    const invalid = validatePatientForm(values, maxDate)
    if (invalid) { setError(invalid); return }
    const changes = patient ? changedInput(values, initial) : undefined
    if (changes && !Object.keys(changes).length) { setError('No changes to save.'); return }
    inFlight.current = true; setSaving(true); setError(null)
    try {
      const input = formInput(values)
      const result = patient ? await patientsApi.update(patient.id, changes!) : await patientsApi.create(input, keys.key(input))
      keys.settle(); onCreated(result.patient); onClose()
    } catch (failure) { keys.settle(failure); setError(failure) }
    finally { inFlight.current = false; setSaving(false) }
  }
  if (!canManagePatients(role) || patient?.archivedAt) return null
  const change = (key: keyof PatientFormValues, value: string) => setValues((current) => ({ ...current, [key]: value }))
  return <PatientDialog title={patient ? 'Edit patient details' : 'Add a new patient'} busy={saving} onClose={close}>
    <form onSubmit={submit} aria-busy={saving}>
      <p className="form-intro">Demographic details only. First and last names are required.</p>
      <fieldset disabled={saving} className="patient-fields">
        <div className="form-grid patient-form-grid">
          <label htmlFor="patient-first-name">First name<input id="patient-first-name" name="firstName" required maxLength={100} value={values.firstName} onChange={(e) => change('firstName', e.target.value)} /></label>
          <label htmlFor="patient-middle-name">Middle name (optional)<input id="patient-middle-name" name="middleName" maxLength={100} value={values.middleName} onChange={(e) => change('middleName', e.target.value)} /></label>
          <label htmlFor="patient-last-name">Last name<input id="patient-last-name" name="lastName" required maxLength={100} value={values.lastName} onChange={(e) => change('lastName', e.target.value)} /></label>
          <label htmlFor="patient-dob">Date of birth (optional)<input id="patient-dob" name="dateOfBirth" type="date" aria-describedby="patient-dob-help" min="0001-01-01" max={maxDate} value={values.dateOfBirth} onChange={(e) => change('dateOfBirth', e.target.value)} /><small id="patient-dob-help" className="field-helper">Leave blank if unknown. Do not estimate a birth date.</small></label>
          <label htmlFor="patient-phone" className="wide">Phone number (optional)<input id="patient-phone" name="phone" type="tel" aria-describedby="patient-phone-help" maxLength={64} value={values.phone} onChange={(e) => change('phone', e.target.value)} /><small id="patient-phone-help" className="field-helper">7–15 digits; include an international prefix when known.</small></label>
        </div>
      </fieldset>
      {saving && <p role="status" className="loading-note">Saving patient details…</p>}
      {error !== null && <PatientFeedback error={error} mutation={patient ? 'update' : 'create'} />}
      <div className="modal-footer patient-modal-footer">
        <button type="button" className="button button-ghost" disabled={saving} onClick={close}>Cancel</button>
        <button type="submit" className="button button-primary" disabled={saving}>{saving ? 'Saving patient…' : patient ? 'Save changes' : 'Register patient'}</button>
      </div>
    </form>
  </PatientDialog>
}
