import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, FileText, RefreshCw } from 'lucide-react'
import { LoadingRows } from '../../components/ui/LoadingRows'
import type { BackendRole } from '../../api/auth'
import { ApiError } from '../../api/client'
import { patientsApi, type Patient } from '../../api/patients'
import { PatientModal } from './PatientModal'
import { PatientDialog } from './PatientDialog'
import { PatientFeedback } from './PatientFeedback'
import { calculateAge, canManagePatients, formatBirthDate, formatTimestamp, patientName } from './patient-utils'

type Props = { id: string; initialPatient?: Patient; role: BackendRole; onBack: () => void; onChanged: () => void; onClinical?: (patient: Patient) => void }
export function PatientDetail({ id, initialPatient, role, onBack, onChanged, onClinical }: Props) {
  const [patient, setPatient] = useState(initialPatient), [error, setError] = useState<unknown>(null)
  const [retry, setRetry] = useState(0), [loading, setLoading] = useState(!initialPatient)
  const [editing, setEditing] = useState(false), [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false), [commandError, setCommandError] = useState<unknown>(null)
  const [notice, setNotice] = useState(initialPatient ? 'Patient registered.' : '')
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
  async function changeArchive() {
    if (!patient || !manage || inFlight.current) return
    inFlight.current = true; setSaving(true); setCommandError(null)
    try {
      const { patient: result } = await (patient.archivedAt ? patientsApi.reactivate(id) : patientsApi.archive(id))
      changed(result, result.archivedAt ? 'Patient archived. Historical records are retained.' : 'Patient reactivated.'); setConfirming(false)
    } catch (failure) { setCommandError(failure) }
    finally { inFlight.current = false; setSaving(false) }
  }
  return <section className="panel page-panel patient-detail" aria-busy={loading || saving}>
    <div className="list-tools detail-tools"><button type="button" className="button button-ghost" disabled={saving || editing || confirming} onClick={onBack}><ArrowLeft size={17} aria-hidden="true" />Back to Patients</button>
    <button type="button" className="button button-ghost" disabled={saving || loading || editing || confirming} onClick={() => { setError(null); setNotice(''); setLoading(true); setRetry((n) => n + 1) }}><RefreshCw size={17} aria-hidden="true" />Refresh patient</button></div>
    {loading ? <LoadingRows label="Loading patient details…" rows={2} /> : error !== null ? <PatientFeedback error={error} retry={error instanceof ApiError && error.status === 404 ? undefined : () => { setError(null); setLoading(true); setRetry((value) => value + 1) }} />
      : patient && <>
        <div className="detail-header patient-detail-heading"><div><p className="eyebrow">Patient record</p>
          <div className="detail-title"><h2>{patientName(patient)}</h2><span className={`status ${patient.archivedAt ? 'archived' : 'active'}`}>{patient.archivedAt ? 'Archived' : 'Active'}</span></div>
          <p className="detail-meta"><span className="record-id"><span className="visually-hidden">Patient number </span>{patient.patientNumber}</span></p></div></div>
        {notice && <p role="status" className="patient-success">{notice}</p>}
        {patient.archivedAt && <p className="callout tone-neutral patient-archived-note">This patient is archived. Their history is kept, but new appointments and clinical work need the patient to be reactivated first.</p>}
        <dl className="patient-demographics">
          <div><dt>Date of birth</dt><dd>{formatBirthDate(patient.dateOfBirth)}</dd></div><div><dt>Age</dt><dd>{calculateAge(patient.dateOfBirth)}</dd></div>
          <div><dt>Phone</dt><dd>{patient.phone ?? 'Not recorded'}</dd></div><div><dt>Registered (UTC)</dt><dd>{formatTimestamp(patient.createdAt)}</dd></div>
          <div><dt>Updated (UTC)</dt><dd>{formatTimestamp(patient.updatedAt)}</dd></div>{patient.archivedAt && <div><dt>Archived (UTC)</dt><dd>{formatTimestamp(patient.archivedAt)}</dd></div>}
        </dl>
        {role === 'DOCTOR_IN_CHARGE' && onClinical ? <div className="patient-clinical"><p>Encounters, diagnoses and amendments for this patient are kept in Medical Records.</p>
          <button type="button" className="button button-primary" onClick={() => onClinical(patient)}><FileText size={17} aria-hidden="true" />View clinical history</button></div>
          : <p className="callout tone-neutral patient-clinical-note">Clinical records are managed separately. Clinical history is not displayed in this demographic record.</p>}
        {manage && <div className="patient-actions">
          {!patient.archivedAt && <button type="button" className="button button-primary" disabled={saving} onClick={() => setEditing(true)}>Edit details</button>}
          <button type="button" className={`button ${patient.archivedAt ? "button-ghost" : "button-danger-quiet"}`} disabled={saving} onClick={() => { setCommandError(null); setConfirming(true) }}>{patient.archivedAt ? 'Reactivate patient' : 'Archive patient'}</button>
        </div>}
        {editing && manage && !patient.archivedAt && <PatientModal role={role} patient={patient} onClose={() => setEditing(false)} onCreated={(result) => changed(result, 'Patient details updated.')} />}
        {confirming && manage && <PatientDialog size="compact" title={patient.archivedAt ? 'Reactivate patient?' : 'Archive patient?'} busy={saving} onClose={() => setConfirming(false)}>
          <p className="modal-lead"><strong>{patientName(patient)}</strong> · {patient.patientNumber}</p>
          <p className={`callout ${patient.archivedAt ? 'tone-info' : 'tone-warning'}`}>{patient.archivedAt ? 'This patient will return to the active directory and can receive new active workflows.' : 'This patient will not be deleted. Historical records remain available. New active workflows require reactivation.'}</p>
          {saving && <p role="status" className="loading-note">Saving patient status…</p>}
          {commandError !== null && <PatientFeedback error={commandError} mutation="status" />}
          <div className="modal-footer patient-modal-footer"><button type="button" className="button button-ghost" disabled={saving} onClick={() => setConfirming(false)}>Cancel</button><button type="button" className={`button ${patient.archivedAt ? "button-primary" : "button-danger"}`} disabled={saving} onClick={() => { void changeArchive() }}>{saving ? 'Saving…' : patient.archivedAt ? 'Confirm reactivation' : 'Confirm archive'}</button></div>
        </PatientDialog>}
      </>}
  </section>
}
