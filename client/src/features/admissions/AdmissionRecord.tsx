import { PatientNumber } from '../../components/ui/PatientNumber'
import { useState } from 'react'
import { ArrowLeft, FileText, RefreshCw } from 'lucide-react'
import { admissionsApi, type AdmissionSummary } from '../../api/admissions'
import type { StaffUser } from '../../api/auth'
import { ApiError } from '../../api/client'
import { LoadingRows } from '../../components/ui/LoadingRows'
import { personName, staffName } from '../../lib/people'
import { displayTime, localTimezone } from '../../lib/time'
import { EncounterDetail } from '../records/EncounterDetail'
import { EncounterList } from '../records/EncounterList'
import { MedicationHistory } from '../records/MedicationHistory'
import { hasClinicalAccess } from '../records/clinical-utils'
import { useKeyedRead } from '../reports/report-utils'
import { admissionError, admissionStatusLabels } from './admission-utils'
import './admissions.css'

type Props = { id: string; user: StaffUser; onBack: () => void; backLabel?: string; onOpenRecord?: (admission: AdmissionSummary) => void }
// One stay, read-only: who admitted and discharged, every room, and for Medical Officers the
// discharge note, clinical records and medications. Opening it is audited by the server.
export function AdmissionRecord({ id, user, onBack, backLabel = 'Back to patient', onOpenRecord }: Props) {
  const [revision, setRevision] = useState(0), [encounter, setEncounter] = useState<string | null>(null)
  const { data, loading, error } = useKeyedRead(JSON.stringify([id, revision]), (signal) => admissionsApi.get(id, signal))
  const admission = data?.admission, clinical = hasClinicalAccess(user.role)
  if (encounter) return <EncounterDetail user={user} id={encounter} onBack={() => setEncounter(null)} onChanged={() => setRevision((n) => n + 1)}
    backLabel={`Back to ${admission?.admissionNumber ?? 'admission'}`} />
  return <section className="panel page-panel admission-record" aria-busy={loading}>
    <div className="list-tools detail-tools"><button type="button" className="button button-ghost" onClick={onBack}><ArrowLeft size={17} aria-hidden="true" />{backLabel}</button>
      <button type="button" className="button button-ghost" disabled={loading} onClick={() => setRevision((n) => n + 1)}><RefreshCw size={17} aria-hidden="true" />Refresh admission</button></div>
    {loading && <LoadingRows label="Loading admission…" rows={2} />}
    {error !== undefined && <div role="alert" className="admission-error"><p>{admissionError(error)}</p>{error instanceof ApiError && error.requestId && <small>Support reference: {error.requestId}</small>}</div>}
    {admission && <>
      <div className="detail-header"><div><p className="eyebrow">Admission record</p>
        <div className="detail-title"><h2>{admission.admissionNumber}</h2>
          <span className={`status ${admission.status === 'ADMITTED' ? 'admission-admitted' : 'admission-discharged'}`}>{admissionStatusLabels[admission.status]}</span></div>
        <p className="detail-meta"><span><strong>{personName(admission.patient)}</strong> · <PatientNumber value={admission.patient.patientNumber} /></span><span>Times in {localTimezone()}.</span></p></div>
        {admission.status === 'ADMITTED' && clinical && onOpenRecord && <div className="clinical-actions"><button type="button" className="button button-primary" onClick={() => onOpenRecord(admission)}><FileText size={17} aria-hidden="true" />Open medical record</button></div>}
      </div>
      {admission.status === 'DISCHARGED' && <p className="callout tone-neutral">This admission is closed and read-only. Clinical corrections are added as amendments to the original records.</p>}
      <dl className="patient-demographics admission-facts">
        <div><dt>Admitted</dt><dd>{displayTime(admission.admittedAt)}</dd></div>
        <div><dt>Admitted by</dt><dd>{staffName(admission.admittedBy)}</dd></div>
        <div><dt>{admission.status === 'ADMITTED' ? 'Current room' : 'Last room'}</dt><dd>{admission.roomNumber}</dd></div>
        <div><dt>Discharged</dt><dd>{admission.dischargedAt ? displayTime(admission.dischargedAt) : 'Currently admitted'}</dd></div>
        {admission.dischargedBy && <div><dt>Discharged by</dt><dd>{staffName(admission.dischargedBy)}</dd></div>}
      </dl>
      {'dischargeNotes' in admission && admission.status === 'DISCHARGED' && <section className="admission-section" aria-labelledby="discharge-note-title">
        <h3 id="discharge-note-title">Discharge note</h3>{admission.dischargeNotes ? <p className="clinical-text">{admission.dischargeNotes}</p> : <p className="clinical-empty">No discharge note recorded.</p>}
      </section>}
      <section className="admission-section" aria-labelledby="room-history-title">
        <h3 id="room-history-title">Room history</h3>
        <ol className="room-history">{admission.rooms.map((room) => <li key={room.id}>
          <p><strong>{room.roomNumber}</strong> · from {displayTime(room.assignedAt)}{room.endedAt ? ` to ${displayTime(room.endedAt)}` : ' (current)'}</p>
          <p className="room-history-meta">Assigned by {staffName(room.assignedBy)}</p>
          {room.note && <p className="room-history-note">{room.note}</p>}
        </li>)}</ol>
      </section>
      {clinical && <>
        <EncounterList user={user} admission={admission} revision={revision} onSelect={setEncounter} emptyHint="No clinical records were made during this admission." />
        <MedicationHistory patient={admission.patient} admission={admission} stayOnly revision={revision} onOpenRecord={setEncounter} />
      </>}
    </>}
  </section>
}
