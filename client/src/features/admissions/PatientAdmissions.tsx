import { useState } from 'react'
import { BedDouble, FileText } from 'lucide-react'
import type { AdmissionSummary } from '../../api/admissions'
import type { BackendRole } from '../../api/auth'
import { ApiError } from '../../api/client'
import type { Patient } from '../../api/patients'
import { LoadingRows } from '../../components/ui/LoadingRows'
import { staffName } from '../../lib/people'
import { displayTime } from '../../lib/time'
import { AdmitDialog, ChangeRoomDialog, DischargeDialog } from './AdmissionDialogs'
import { admissionError, canDischarge, canOpenMedicalRecord } from './admission-utils'
import { useAdmissions } from './useAdmissions'
import './admissions.css'

type Props = {
  patient: Patient; role: BackendRole; autoAdmit?: boolean; onChanged: (message: string) => void
  onOpenRecord?: (admission: AdmissionSummary) => void; onView: (admissionId: string) => void
}
// The patient record's stay section: the current admission with its actions, or "Not currently
// admitted" with Admit patient, then every previous admission.
export function PatientAdmissions({ patient, role, autoAdmit = false, onChanged, onOpenRecord, onView }: Props) {
  const [revision, setRevision] = useState(0)
  const { data, loading, error } = useAdmissions({ patientId: patient.id, limit: 50 }, revision)
  const [dialog, setDialog] = useState<'admit' | 'room' | 'discharge' | null>(autoAdmit && !patient.currentAdmission && !patient.archivedAt ? 'admit' : null)
  const current = data?.items.find((item) => item.status === 'ADMITTED')
  const previous = data?.items.filter((item) => item.status === 'DISCHARGED') ?? []
  const saved = (message: string) => { setRevision((n) => n + 1); onChanged(message) }
  const clinical = canOpenMedicalRecord(role) && onOpenRecord
  return <>
    <section className="admission-section" aria-labelledby="current-admission-title">
      <h3 id="current-admission-title">Current admission</h3>
      {loading ? <LoadingRows label="Loading admissions…" rows={1} />
        : error !== undefined ? <div role="alert" className="admission-error"><p>{admissionError(error)}</p>
          {error instanceof ApiError && error.requestId && <small>Support reference: {error.requestId}</small>}
          <button type="button" className="button button-ghost" onClick={() => setRevision((n) => n + 1)}>Try again</button></div>
        : current ? <div className="admission-current">
          <div className="patient-actions admission-actions">
            {clinical && <button type="button" className="button button-primary" onClick={() => onOpenRecord(current)}><FileText size={17} aria-hidden="true" />Open medical record</button>}
            <button type="button" className="button button-ghost" onClick={() => setDialog('room')}>Change room</button>
            <button type="button" className="button button-ghost" onClick={() => onView(current.id)}>View admission</button>
            {canDischarge(role) && <button type="button" className="button button-danger-quiet admission-actions-end" onClick={() => setDialog('discharge')}>Discharge patient</button>}
          </div>
          <dl className="patient-demographics admission-facts">
            <div><dt>Room</dt><dd className="admission-room">{current.roomNumber}</dd></div>
            <div><dt>Admitted</dt><dd>{displayTime(current.admittedAt)}</dd></div>
            <div><dt>Admitted by</dt><dd>{staffName(current.admittedBy)}</dd></div>
            <div><dt>Admission</dt><dd><span className="record-id">{current.admissionNumber}</span></dd></div>
          </dl>
        </div>
        : <div className="admission-none">
          <p><span className="status admission-none-status">Not currently admitted</span></p>
          {patient.archivedAt ? <p className="callout tone-neutral">This patient record is archived. Reactivate it before admitting the patient.</p>
            : <button type="button" className="button button-primary" onClick={() => setDialog('admit')}><BedDouble size={17} aria-hidden="true" />Admit patient</button>}
        </div>}
    </section>
    <section className="admission-section" aria-labelledby="previous-admissions-title">
      <h3 id="previous-admissions-title">Previous admissions</h3>
      {data && (previous.length ? <table className="patient-table admission-table" aria-label="Previous admissions">
        <thead><tr><th scope="col">Admission</th><th scope="col">Admitted</th><th scope="col">Discharged</th><th scope="col">Last room</th><th scope="col">Status</th><th scope="col"><span className="visually-hidden">Actions</span></th></tr></thead>
        <tbody>{previous.map((item) => <tr key={item.id}>
          <td data-label="Admission"><span className="record-id">{item.admissionNumber}</span></td>
          <td data-label="Admitted">{displayTime(item.admittedAt)}</td>
          <td data-label="Discharged">{item.dischargedAt ? displayTime(item.dischargedAt) : 'Not recorded'}</td>
          <td data-label="Last room">{item.roomNumber}</td>
          <td data-label="Status"><span className="status admission-discharged">Discharged</span></td>
          <td className="admission-row-actions"><button type="button" className="button button-ghost" onClick={() => onView(item.id)}>View record<span className="visually-hidden"> {item.admissionNumber}</span></button></td>
        </tr>)}</tbody>
      </table> : <p className="admission-empty">No previous admissions.</p>)}
    </section>
    {dialog === 'admit' && <AdmitDialog patient={patient} intro={autoAdmit ? 'Patient registered. Now record the admission.' : undefined} onClose={() => setDialog(null)}
      onAdmitted={(admission) => saved(`Patient admitted to ${admission.roomNumber}.`)} onOpenCurrent={() => setRevision((n) => n + 1)} />}
    {dialog === 'room' && current && <ChangeRoomDialog admission={current} onClose={() => setDialog(null)} onSaved={(admission) => saved(`Room changed to ${admission.roomNumber}.`)} />}
    {dialog === 'discharge' && current && <DischargeDialog admission={current} onClose={() => setDialog(null)} onSaved={() => saved('Patient discharged. Their medical history remains available.')}
      onOpenRecord={clinical ? () => onOpenRecord(current) : undefined} />}
  </>
}
