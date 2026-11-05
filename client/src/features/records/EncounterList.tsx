import { useState } from 'react'
import { FileText, RefreshCw } from 'lucide-react'
import { LoadingRows } from '../../components/ui/LoadingRows'
import type { EncounterStatus } from '../../api/encounters'
import type { StaffUser } from '../../api/auth'
import type { Patient } from '../../api/patients'
import { Pagination } from '../../components/ui/Pagination'
import { clinicianName, patientName } from '../appointments/appointment-utils'
import { displayTime, localDateRange, localTimezone } from '../appointments/appointment-time'
import { ClinicalFeedback } from './ClinicalFeedback'
import { clinicalLabels, hasClinicalAccess } from './clinical-utils'
import { useEncounters } from './useEncounters'
type Props = { user: StaffUser; patient?: Patient; appointmentId?: string; revision: number; onSelect: (id: string) => void }
export function EncounterList(props: Props) { return hasClinicalAccess(props.user.role) ? <List {...props} /> : null }
function List({ user, patient, appointmentId, revision, onSelect }: Props) {
  const [search, setSearch] = useState(''), [status, setStatus] = useState<EncounterStatus | ''>(''), [own, setOwn] = useState(false), [page, setPage] = useState(1), [retry, setRetry] = useState(0)
  const [from, setFrom] = useState(''), [to, setTo] = useState('')
  const range = from || to ? localDateRange(from, to) : {}
  const { data, loading, error } = useEncounters(range ? { page, limit: 20, search, status: status || undefined, clinicianId: own ? user.id : undefined, appointmentId, ...range } : null, patient?.id, revision + retry)
  const filtered = Boolean(search || status || own || from || to)
  const clear = () => { setSearch(''); setStatus(''); setOwn(false); setFrom(''); setTo(''); setPage(1) }
  return <section className="panel clinical-workspace" aria-label={patient ? 'Patient clinical history' : 'Clinical encounter list'}>
    <p className="eyebrow">Clinical records</p>
    <h2>{patient ? `Clinical history: ${patientName(patient)}` : 'Clinical encounters'}</h2>
    <p>{patient ? `${patient.patientNumber}${patient.archivedAt ? ' · Archived patient — history remains available.' : ''}` : 'Doctors can read clinical encounters across clinicians. Only the original clinical author may edit, finalize or amend.'} Times in {localTimezone()}.</p>
    <div className="clinical-filters">
      <label>Record reference<input name="clinicalSearch" value={search} maxLength={100} placeholder="Search record reference only" onChange={(event) => { setSearch(event.target.value); setPage(1) }} /></label>
      <label>Clinical status<select name="clinicalStatus" value={status} onChange={(event) => { setStatus(event.target.value as EncounterStatus | ''); setPage(1) }}><option value="">All statuses</option>{Object.entries(clinicalLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Clinician scope<select name="clinicalScope" value={own ? 'own' : 'all'} onChange={(event) => { setOwn(event.target.value === 'own'); setPage(1) }}><option value="all">All clinicians</option><option value="own">Assigned to me</option></select></label>
      <label>From date<input name="clinicalFrom" type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPage(1) }} /></label><label>Through date<input name="clinicalTo" type="date" value={to} onChange={(event) => { setTo(event.target.value); setPage(1) }} /></label>
    </div>
    <div className="list-tools"><button className="button button-ghost" disabled={loading} onClick={() => setRetry((n) => n + 1)}><RefreshCw size={17} aria-hidden="true" />Refresh clinical records</button>
      {filtered && <button className="button button-ghost" onClick={clear}>Clear clinical filters</button>}</div>
    {!range && <p role="alert" className="clinical-error">Enter both dates in chronological order, or clear both to show all dates.</p>}
    {loading && <LoadingRows label="Loading clinical records…" />}{error !== undefined && <ClinicalFeedback error={error} />}
    {data && <>{!data.items.length ? <div role="status" className="empty-state"><FileText size={22} aria-hidden="true" /><strong>{filtered ? 'No clinical records match these filters.' : patient ? 'No clinical encounters have been recorded for this patient.' : 'No clinical encounters have been recorded.'}</strong>
        {filtered ? <button className="button button-ghost" onClick={clear}>Clear clinical filters</button> : <p>{patient ? 'Start a new encounter to document this patient’s care.' : 'Encounters appear here once a doctor documents a visit.'}</p>}</div>
      : <ol className="clinical-history">{data.items.map((encounter) => <li key={encounter.id}><article>
        <div className="clinical-history-head"><button className="clinical-open" onClick={() => onSelect(encounter.id)}>{encounter.reference}</button><span className={`clinical-status clinical-status-${encounter.status.toLowerCase()}`}>{clinicalLabels[encounter.status]}</span></div>
        {!patient && <p><strong>{patientName(encounter.patient)}</strong> · {encounter.patient.patientNumber}</p>}<p className="clinical-history-meta">{displayTime(encounter.occurredAt)} · {clinicianName(encounter.clinician)}{encounter.appointment && <> · Appointment {encounter.appointment.reference}</>}</p>
        <p>Diagnoses: {encounter.diagnoses.length ? encounter.diagnoses.map((item) => `${item.description}${item.code ? ` (${item.code})` : ''}`).join('; ') : 'None recorded'}</p>
      </article></li>)}</ol>}
      {data.pagination.page > Math.max(1, data.pagination.totalPages) && <button className="button button-ghost" onClick={() => setPage(1)}>Return to first page</button>}
      <Pagination label="Clinical record pages" pagination={data.pagination} onPage={setPage} />
    </>}
  </section>
}
