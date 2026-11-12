import { useUnsavedChanges } from '../../components/ui/useUnsavedChanges'
import { useRef, useState, type FormEvent } from 'react'
import type { BackendRole } from '../../api/auth'
import { patientsApi, type Patient } from '../../api/patients'
import { submissionKeys } from '../../api/idempotency'
import { PatientDialog } from './PatientDialog'
import { PatientFeedback } from './PatientFeedback'
import { canManagePatients, canRegisterPatients, changedInput, formInput, formValues, todayDate, validatePatientForm, type PatientFormValues } from './patient-utils'

type Props = { role: BackendRole; patient?: Patient; onClose: () => void; onCreated: (patient: Patient, admitNext: boolean) => void }
// Registration offers two paths: register only, or register and continue straight to admission.
export function PatientModal({ role, patient, onClose, onCreated }: Props) {
  const [initial] = useState(() => formValues(patient))
  const [values, setValues] = useState(initial)
  const dirty = JSON.stringify(values) !== JSON.stringify(initial)
  useUnsavedChanges(dirty)
  const [saving, setSaving] = useState<'register' | 'admit' | null>(null), [error, setError] = useState<unknown>(null)
  const inFlight = useRef(false), [keys] = useState(submissionKeys)
  // Missing names are marked on the fields themselves, in the app's own style (no browser bubbles).
  const [missing, setMissing] = useState<{ firstName?: boolean; lastName?: boolean }>({})
  const close = () => { if (!inFlight.current && (!dirty || window.confirm('Discard unsaved patient changes?'))) onClose() }
  const maxDate = patient ? [todayDate(), patient.createdAt.slice(0, 10)].sort()[0] : todayDate()
  const allowed = patient ? canManagePatients(role) && !patient.archivedAt : canRegisterPatients(role)
  async function save(admitNext: boolean) {
    if (inFlight.current || !allowed) return
    const invalid = validatePatientForm(values, maxDate)
    const absent = { firstName: !values.firstName.trim(), lastName: !values.lastName.trim() }
    setMissing(absent)
    if (invalid) {
      setError(invalid)
      if (absent.firstName || absent.lastName) document.getElementById(absent.firstName ? 'patient-first-name' : 'patient-last-name')?.focus()
      return
    }
    const changes = patient ? changedInput(values, initial) : undefined
    if (changes && !Object.keys(changes).length) { setError('No changes to save.'); return }
    inFlight.current = true; setSaving(admitNext ? 'admit' : 'register'); setError(null)
    try {
      const input = formInput(values)
      // The same key covers either button: a resent registration returns the same patient.
      const result = patient ? await patientsApi.update(patient.id, changes!) : await patientsApi.create(input, keys.key(input))
      keys.settle(); onCreated(result.patient, admitNext); onClose()
    } catch (failure) { keys.settle(failure); setError(failure) }
    finally { inFlight.current = false; setSaving(null) }
  }
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void save(false) }
  if (!allowed) return null
  const busy = saving !== null
  const change = (key: keyof PatientFormValues, value: string) => { setValues((current) => ({ ...current, [key]: value })); setMissing((current) => ({ ...current, [key]: false })) }
  const missingNote = (key: 'firstName' | 'lastName') => missing[key] && <span id={`patient-${key}-missing`} className="field-error">{key === 'firstName' ? 'Enter the first name.' : 'Enter the last name.'}</span>
  return <PatientDialog title={patient ? 'Edit patient details' : 'Register patient'} busy={busy} onClose={close}>
    <form onSubmit={submit} aria-busy={busy} noValidate>
      <p className="form-intro">{patient ? 'Permanent identity details. First and last names are required.' : 'First and last names are required. Search Patients first so the same person is not registered twice.'}</p>
      <fieldset disabled={busy} className="patient-fields">
        <div className="form-grid patient-form-grid">
          <label htmlFor="patient-first-name">First name<input id="patient-first-name" name="firstName" required maxLength={100} aria-invalid={missing.firstName || undefined} aria-describedby={missing.firstName ? 'patient-firstName-missing' : undefined} value={values.firstName} onChange={(e) => change('firstName', e.target.value)} />{missingNote('firstName')}</label>
          <label htmlFor="patient-middle-name">Middle name (optional)<input id="patient-middle-name" name="middleName" maxLength={100} value={values.middleName} onChange={(e) => change('middleName', e.target.value)} /></label>
          <label htmlFor="patient-last-name">Last name<input id="patient-last-name" name="lastName" required maxLength={100} aria-invalid={missing.lastName || undefined} aria-describedby={missing.lastName ? 'patient-lastName-missing' : undefined} value={values.lastName} onChange={(e) => change('lastName', e.target.value)} />{missingNote('lastName')}</label>
          <label htmlFor="patient-dob">Date of birth (optional)<input id="patient-dob" name="dateOfBirth" type="date" aria-describedby="patient-dob-help" min="0001-01-01" max={maxDate} value={values.dateOfBirth} onChange={(e) => change('dateOfBirth', e.target.value)} /><small id="patient-dob-help" className="field-helper">Leave blank if unknown. Do not estimate a birth date.</small></label>
        </div>
      </fieldset>
      {busy && <p role="status" className="loading-note">Saving patient details…</p>}
      {error !== null && <PatientFeedback error={error} mutation={patient ? 'update' : 'create'} />}
      {!patient && <ul className="register-choices">
        <li><strong>Register patient</strong> saves the patient record only.</li>
        <li><strong>Register &amp; admit</strong> saves it, then asks for the room to admit them now.</li>
      </ul>}
      <div className="modal-footer patient-modal-footer">
        <button type="button" className="button button-ghost" disabled={busy} onClick={close}>Cancel</button>
        {patient ? <button type="submit" className="button button-primary" disabled={busy}>{busy ? 'Saving patient…' : 'Save changes'}</button> : <>
          <button type="submit" className="button button-ghost" disabled={busy}>{saving === 'register' ? 'Registering…' : 'Register patient'}</button>
          <button type="button" className="button button-primary" disabled={busy} onClick={() => { void save(true) }}>{saving === 'admit' ? 'Registering…' : 'Register & admit'}</button>
        </>}
      </div>
    </form>
  </PatientDialog>
}
