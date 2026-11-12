import { PatientNumber } from '../../components/ui/PatientNumber'
import { useState } from 'react'
import { FileText, RefreshCw } from 'lucide-react'
import { LoadingRows } from '../../components/ui/LoadingRows'
import type { EncounterStatus } from '../../api/encounters'
import type { StaffUser } from '../../api/auth'
import type { PatientSummary } from '../../api/common'
import { Pagination } from '../../components/ui/Pagination'
import { personName, staffName } from '../../lib/people'
import { displayTime, localDateRange, localTimezone } from '../../lib/time'
import { ClinicalFeedback } from './ClinicalFeedback'
import { clinicalLabels, hasClinicalAccess } from './clinical-utils'
import { useEncounters } from './useEncounters'
type Props = {
  user: StaffUser; patient?: PatientSummary & { archivedAt?: string | null }; admission?: { id: string; admissionNumber: string }
  revision: number; onSelect: (id: string) => void; emptyHint?: string
}
export function EncounterList(props: Props) { return hasClinicalAccess(props.user.role) ? <List {...props} /> : null }
// One list for every scope: all records, one patient's history, or one admission's records.
function List({ user, patient, admission, revision, onSelect, emptyHint }: Props) {
  const [search, setSearch] = useState(''), [status, setStatus] = useState<EncounterStatus | ''>(''), [own, setOwn] = useState(false), [page, setPage] = useState(1), [retry, setRetry] = useState(0)
  const [from, setFrom] = useState(''), [to, setTo] = useState('')
  const range = from || to ? localDateRange(from, to) : {}
  const { data, loading, error } = useEncounters(range ? { page, limit: 20, search, status: status || undefined, clinicianId: own ? user.id : undefined, admissionId: admission?.id, ...range } : null,
    admission ? undefined : patient?.id, revision + retry)
  const filtered = Boolean(search || status || own || from || to)
  const clear = () => { setSearch(''); setStatus(''); setOwn(false); setFrom(''); setTo(''); setPage(1) }
  const title = admission ? 'Clinical records' : patient ? `Clinical history: ${personName(patient)}` : 'Clinical records'
  return <section className="panel clinical-workspace" aria-label={admission ? 'Admission clinical records' : patient ? 'Patient clinical history' : 'Clinical record list'}>
    <h2>{title}</h2>
    <p>{patient ? `${patient.patientNumber}${patient.archivedAt ? ' · Archived patient — history remains available.' : ''} ` : admission ? `For admission ${admission.admissionNumber}. ` : ''}Only the Medical Officer who wrote a record can edit, finalize or amend it. Times in {localTimezone()}.</p>
    {/* Filters stay out of the way until needed; most admissions have only a few records. Refresh sits on the same row. */}
    <div className="clinical-list-toolbar">
    <details className="clinical-filter-panel" open={filtered || undefined}>
    <summary>Filter records{filtered && <span className="tag">Filters on</span>}</summary>
    <div className="clinical-filters">
      <label>Record reference<input name="clinicalSearch" value={search} maxLength={100} placeholder="Search record reference only" onChange={(event) => { setSearch(event.target.value); setPage(1) }} /></label>
      <label>Clinical status<select name="clinicalStatus" value={status} onChange={(event) => { setStatus(event.target.value as EncounterStatus | ''); setPage(1) }}><option value="">All statuses</option>{Object.entries(clinicalLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Clinician scope<select name="clinicalScope" value={own ? 'own' : 'all'} onChange={(event) => { setOwn(event.target.value === 'own'); setPage(1) }}><option value="all">All clinicians</option><option value="own">Written by me</option></select></label>
      <label>From date<input name="clinicalFrom" type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPage(1) }} /></label><label>Through date<input name="clinicalTo" type="date" value={to} onChange={(event) => { setTo(event.target.value); setPage(1) }} /></label>
    </div>
    {filtered && <div className="list-tools"><button className="button button-ghost" onClick={clear}>Clear clinical filters</button></div>}
    </details>
    <button className="button button-ghost tool-compact" aria-label="Refresh clinical records" disabled={loading} onClick={() => setRetry((n) => n + 1)}><RefreshCw size={17} aria-hidden="true" /><span className="tool-label">Refresh clinical records</span></button>
    </div>
    {!range && <p role="alert" className="clinical-error">Enter both dates in chronological order, or clear both to show all dates.</p>}
    {loading && <LoadingRows label="Loading clinical records…" />}{error !== undefined && <ClinicalFeedback error={error} />}
    {data && <>{!data.items.length ? <div role="status" className="empty-state"><FileText size={22} aria-hidden="true" /><strong>{filtered ? 'No clinical records match these filters.' : admission ? 'No clinical records for this admission yet.' : patient ? 'No clinical records have been made for this patient.' : 'No clinical records have been made.'}</strong>
        {filtered ? <button className="button button-ghost" onClick={clear}>Clear clinical filters</button> : <p>{emptyHint ?? (patient || admission ? 'Records are opened on the patient’s current admission.' : 'Records appear here once a Medical Officer documents care.')}</p>}</div>
      : <ol className="clinical-history">{data.items.map((encounter) => <li key={encounter.id}><article>
        <div className="clinical-history-head"><button className="clinical-open" onClick={() => onSelect(encounter.id)}>{displayTime(encounter.occurredAt)}<span className="visually-hidden"> clinical record {encounter.reference}</span></button><span className={`clinical-status clinical-status-${encounter.status.toLowerCase()}`}>{clinicalLabels[encounter.status]}</span></div>
        {!patient && !admission && <p><strong>{personName(encounter.patient)}</strong> · <PatientNumber value={encounter.patient.patientNumber} /></p>}
        <p className="clinical-history-meta">By {staffName(encounter.clinician)}
          {encounter.admission && !admission && <> · Admission {encounter.admission.admissionNumber}</>}{encounter.appointment && <> · Past appointment {encounter.appointment.reference}</>}
          <span className="clinical-reference" aria-hidden="true">{encounter.reference}</span></p>
        <p>Diagnoses: {encounter.diagnoses.length ? encounter.diagnoses.map((item) => `${item.description}${item.code ? ` (${item.code})` : ''}`).join('; ') : 'None recorded'}</p>
      </article></li>)}</ol>}
      {data.pagination.page > Math.max(1, data.pagination.totalPages) && <button className="button button-ghost" onClick={() => setPage(1)}>Return to first page</button>}
      <Pagination label="Clinical record pages" pagination={data.pagination} onPage={setPage} />
    </>}
  </section>
}
