import { CopyPatientNumber, PatientNumber } from '../../components/ui/PatientNumber'
import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, BedDouble, FileText, RefreshCw } from 'lucide-react'
import { LoadingRows } from '../../components/ui/LoadingRows'
import type { StaffUser } from '../../api/auth'
import type { AdmissionSummary } from '../../api/admissions'
import { ApiError } from '../../api/client'
import { patientsApi, type Patient } from '../../api/patients'
import { AdmissionRecord } from '../admissions/AdmissionRecord'
import { PatientAdmissions } from '../admissions/PatientAdmissions'
import { PatientModal } from './PatientModal'
import { PatientDialog } from './PatientDialog'
import { PatientFeedback } from './PatientFeedback'
import { calculateAge, canManagePatients, formatBirthDate, formatTimestamp, patientName } from './patient-utils'

type Props = {
  id: string; initialPatient?: Patient; user: StaffUser; autoAdmit?: boolean; onBack: () => void; onChanged: () => void
  onOpenRecord?: (admission: AdmissionSummary) => void; onClinical?: (patient: Patient) => void
}
// The permanent patient record: identity, the current admission (or Admit patient) and every
// previous admission. Discharge never archives the record; archiving is a separate administrative step.
export function PatientDetail({ id, initialPatient, user, autoAdmit = false, onBack, onChanged, onOpenRecord, onClinical }: Props) {
  const role = user.role
  const [patient, setPatient] = useState(initialPatient), [error, setError] = useState<unknown>(null)
  const [retry, setRetry] = useState(0), [loading, setLoading] = useState(!initialPatient)
  const [editing, setEditing] = useState(false), [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false), [commandError, setCommandError] = useState<unknown>(null)
  const [notice, setNotice] = useState(initialPatient ? 'Patient registered.' : ''), [viewing, setViewing] = useState<string | null>(null)
  const inFlight = useRef(false)
  useEffect(() => {
    if (initialPatient && retry === 0) return
    const controller = new AbortController()
    void patientsApi.get(id, controller.signal).then(({ patient: result }) => {
      if (!controller.signal.aborted) setPatient(result)
    }).catch((failure: unknown) => { if (!controller.signal.aborted) setError(failure) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [id, initialPatient, retry])
  const manage = canManagePatients(role)
  function changed(result: Patient, message: string) { setPatient(result); setNotice(message); setCommandError(null); onChanged() }
  // An admission change updates the stay section itself; the record is re-read for its current admission.
  function stayChanged(message: string) { setNotice(message); setRetry((n) => n + 1); onChanged() }
  async function changeArchive() {
    if (!patient || !manage || inFlight.current) return
    inFlight.current = true; setSaving(true); setCommandError(null)
    try {
      const { patient: result } = await (patient.archivedAt ? patientsApi.reactivate(id) : patientsApi.archive(id))
      changed(result, result.archivedAt ? 'Patient archived. Historical records are retained.' : 'Patient reactivated.'); setConfirming(false)
    } catch (failure) { setCommandError(failure) }
    finally { inFlight.current = false; setSaving(false) }
  }
  if (viewing) return <AdmissionRecord id={viewing} user={user} onBack={() => setViewing(null)} onOpenRecord={onOpenRecord} />
  const admitted = Boolean(patient?.currentAdmission)
  return <section className="panel page-panel patient-detail" aria-busy={loading || saving}>
    <div className="list-tools detail-tools"><button type="button" className="button button-ghost" disabled={saving || editing || confirming} onClick={onBack}><ArrowLeft size={17} aria-hidden="true" />Back to Patients</button>
    <button type="button" className="button button-ghost tool-compact" aria-label="Refresh patient" disabled={saving || loading || editing || confirming} onClick={() => { setError(null); setNotice(''); setLoading(true); setRetry((n) => n + 1) }}><RefreshCw size={17} aria-hidden="true" /><span className="tool-label">Refresh patient</span></button></div>
    {loading && !patient ? <LoadingRows label="Loading patient details…" rows={2} /> : error !== null ? <PatientFeedback error={error} retry={error instanceof ApiError && error.status === 404 ? undefined : () => { setError(null); setLoading(true); setRetry((value) => value + 1) }} />
      : patient && <>
        <div className="detail-header patient-detail-heading"><div><p className="eyebrow">Patient record</p>
          <div className="detail-title"><h2>{patientName(patient)}</h2>{patient.archivedAt ? <span className="status archived">Archived record</span>
            : admitted ? <span className="status admission-admitted">Admitted</span> : <span className="status admission-none-status">Not admitted</span>}</div>
          <p className="detail-meta"><span className="patient-number-full"><span className="record-id patient-number"><span className="visually-hidden">Patient number </span>{patient.patientNumber}</span><CopyPatientNumber value={patient.patientNumber} /></span>
            {patient.currentAdmission && <span className="patient-room"><BedDouble size={16} aria-hidden="true" /><span className="visually-hidden">Room </span>{patient.currentAdmission.roomNumber}</span>}
            <span>{patient.dateOfBirth ? calculateAge(patient.dateOfBirth) : 'Age not recorded'}</span></p></div></div>
        {notice && <p role="status" className="patient-success">{notice}</p>}
        {patient.archivedAt && <p className="callout tone-neutral patient-archived-note">This patient record is archived. Its history is kept, but admission and clinical work need the record to be reactivated first.</p>}
        <PatientAdmissions key={`${patient.id}:${patient.currentAdmission?.id ?? 'none'}:${patient.archivedAt ?? ''}`} patient={patient} role={role} autoAdmit={autoAdmit && retry === 0}
          onChanged={stayChanged} onOpenRecord={onOpenRecord} onView={setViewing} />
        <section className="admission-section" aria-labelledby="patient-identity-title"><h3 id="patient-identity-title">Patient details</h3>
          <dl className="patient-demographics">
            <div><dt>Date of birth</dt><dd>{formatBirthDate(patient.dateOfBirth)}</dd></div><div><dt>Age</dt><dd>{calculateAge(patient.dateOfBirth)}</dd></div>
            {patient.phone && <div><dt>Phone (recorded earlier)</dt><dd>{patient.phone}</dd></div>}
            <div><dt>Registered</dt><dd>{formatTimestamp(patient.createdAt)}</dd></div>
            {patient.archivedAt && <div><dt>Archived</dt><dd>{formatTimestamp(patient.archivedAt)}</dd></div>}
          </dl>
        </section>
        {role === 'DOCTOR_IN_CHARGE' && onClinical ? <div className="patient-clinical"><p>Every clinical record, diagnosis, medication and amendment for this patient, across all admissions.</p>
          <button type="button" className="button button-ghost" onClick={() => onClinical(patient)}><FileText size={17} aria-hidden="true" />View clinical history</button></div>
          : <p className="callout tone-neutral patient-clinical-note">Clinical records are kept by Medical Officers and are not shown here.</p>}
        {manage && <div className="patient-actions">
          {!patient.archivedAt && <button type="button" className="button button-ghost" disabled={saving} onClick={() => setEditing(true)}>Edit details</button>}
          {patient.archivedAt ? <button type="button" className="button button-ghost" disabled={saving} onClick={() => { setCommandError(null); setConfirming(true) }}>Reactivate patient</button>
            : admitted ? <p className="field-helper">Discharge the patient before archiving the record.</p>
              : <button type="button" className="button button-danger-quiet" disabled={saving} onClick={() => { setCommandError(null); setConfirming(true) }}>Archive patient</button>}
        </div>}
        {editing && manage && !patient.archivedAt && <PatientModal role={role} patient={patient} onClose={() => setEditing(false)} onCreated={(result) => changed(result, 'Patient details updated.')} />}
        {confirming && manage && <PatientDialog size="compact" title={patient.archivedAt ? 'Reactivate patient?' : 'Archive patient?'} busy={saving} onClose={() => setConfirming(false)}>
          <p className="modal-lead"><strong>{patientName(patient)}</strong> · <PatientNumber value={patient.patientNumber} /></p>
          <p className={`callout ${patient.archivedAt ? 'tone-info' : 'tone-warning'}`}>{patient.archivedAt ? 'This patient will return to the active directory and can be admitted again.' : 'This patient will not be deleted. Admissions and clinical history remain available. Admission needs the record to be reactivated.'}</p>
          {saving && <p role="status" className="loading-note">Saving patient status…</p>}
          {commandError !== null && <PatientFeedback error={commandError} mutation="status" />}
          <div className="modal-footer patient-modal-footer"><button type="button" className="button button-ghost" disabled={saving} onClick={() => setConfirming(false)}>Cancel</button><button type="button" className={`button ${patient.archivedAt ? "button-primary" : "button-danger"}`} disabled={saving} onClick={() => { void changeArchive() }}>{saving ? 'Saving…' : patient.archivedAt ? 'Confirm reactivation' : 'Confirm archive'}</button></div>
        </PatientDialog>}
      </>}
  </section>
}
