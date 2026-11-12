import { PatientNumber } from '../../components/ui/PatientNumber'
import { BedDouble, History } from 'lucide-react'
import type { AdmissionStatus, AdmissionSummary } from '../../api/admissions'
import type { BackendRole } from '../../api/auth'
import { ApiError } from '../../api/client'
import { LoadingRows } from '../../components/ui/LoadingRows'
import { Pagination } from '../../components/ui/Pagination'
import { personName, staffName } from '../../lib/people'
import { displayTime } from '../../lib/time'
import { admissionError, canDischarge, canOpenMedicalRecord } from './admission-utils'
import { useAdmissions } from './useAdmissions'
import './admissions.css'

type Props = {
  status: AdmissionStatus; role: BackendRole; search: string; page: number; revision: number; onPage: (page: number) => void
  onSelectPatient: (patientId: string) => void; onView: (admission: AdmissionSummary) => void
  onOpenRecord?: (admission: AdmissionSummary) => void; onDischarge?: (admission: AdmissionSummary) => void; onRetry: () => void
}
// "Currently admitted" and "Discharged" views of the Patients workspace. Discharged stays never
// appear in the current list.
export function AdmissionList({ status, role, search, page, revision, onPage, onSelectPatient, onView, onOpenRecord, onDischarge, onRetry }: Props) {
  const { data, loading, error } = useAdmissions({ status, search, page, limit: 10 }, revision)
  const current = status === 'ADMITTED'
  const label = current ? 'Currently admitted patients' : 'Discharged admissions'
  if (loading) return <LoadingRows label={current ? 'Loading current admissions…' : 'Loading discharged admissions…'} />
  if (error !== undefined) return <div role="alert" className="patients-state patients-state-error"><p>{admissionError(error)}</p>
    {error instanceof ApiError && error.requestId && <small>Support reference: {error.requestId}</small>}
    <button type="button" className="button button-ghost" onClick={onRetry}>Try again</button></div>
  if (!data) return null
  if (!data.items.length) return <div className="patients-state">{current ? <BedDouble size={22} aria-hidden="true" /> : <History size={22} aria-hidden="true" />}
    <strong>{data.pagination.total > 0 ? 'No admissions on this page.' : search.trim() ? 'No admissions match your search.' : current ? 'No patients are currently admitted.' : 'No discharged admissions yet.'}</strong>
    <p>{search.trim() ? 'Try a patient name, patient number, admission number or room.' : current ? 'Admit a patient from their record, or use Register & admit for a new patient.' : 'Discharged stays appear here, with their full history.'}</p>
    {data.pagination.total > 0 && <button type="button" className="button button-ghost" onClick={() => onPage(1)}>Return to first page</button>}</div>
  return <>
    <table className="patient-table patients-table admission-table" aria-label={label}>
      <thead><tr><th scope="col">Patient</th><th scope="col">Room</th><th scope="col">Admitted</th>
        {!current && <th scope="col">Discharged</th>}<th scope="col">Admission</th><th scope="col"><span className="visually-hidden">Actions</span></th></tr></thead>
      <tbody>{data.items.map((admission) => <tr key={admission.id}>
        <td><div className="patients-name-copy"><button type="button" className="patient-name-button" onClick={() => onSelectPatient(admission.patient.id)}>{personName(admission.patient)}</button>
          <PatientNumber value={admission.patient.patientNumber} /></div></td>
        <td data-label="Room">{admission.roomNumber}</td>
        <td data-label="Admitted">{displayTime(admission.admittedAt)}<small className="admission-by">by {staffName(admission.admittedBy)}</small></td>
        {!current && <td data-label="Discharged">{admission.dischargedAt ? displayTime(admission.dischargedAt) : 'Not recorded'}<small className="admission-by">by {staffName(admission.dischargedBy)}</small></td>}
        <td data-label="Admission"><span className="record-id">{admission.admissionNumber}</span></td>
        <td className="admission-row-actions">
          {current && canOpenMedicalRecord(role) && onOpenRecord && <button type="button" className="button button-ghost" onClick={() => onOpenRecord(admission)}>Medical record<span className="visually-hidden"> for {personName(admission.patient)}</span></button>}
          {current && canDischarge(role) && onDischarge && <button type="button" className="button button-danger-quiet" onClick={() => onDischarge(admission)}>Discharge<span className="visually-hidden"> {personName(admission.patient)}</span></button>}
          {!current && <button type="button" className="button button-ghost" onClick={() => onView(admission)}>View record<span className="visually-hidden"> {admission.admissionNumber}</span></button>}
        </td>
      </tr>)}</tbody>
    </table>
    <Pagination label={current ? 'Current admission pages' : 'Discharged admission pages'} pagination={data.pagination} onPage={onPage} />
  </>
}
