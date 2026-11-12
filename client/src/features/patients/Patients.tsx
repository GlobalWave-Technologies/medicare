import { PatientNumber } from '../../components/ui/PatientNumber'
import { useState } from 'react'
import { Plus, RefreshCw, Search, UsersRound } from 'lucide-react'
import { LoadingRows } from '../../components/ui/LoadingRows'
import type { BackendRole } from '../../api/auth'
import type { AdmissionSummary } from '../../api/admissions'
import { Pagination } from '../../components/ui/Pagination'
import { AdmissionList } from '../admissions/AdmissionLists'
import { PatientFeedback } from './PatientFeedback'
import { calculateAge, canRegisterPatients, formatTimestamp, patientName } from './patient-utils'
import { usePatients } from './usePatients'
import './patients.css'

export type PatientView = 'all' | 'admitted' | 'discharged'
const views: [PatientView, string][] = [['all', 'All patients'], ['admitted', 'Currently admitted'], ['discharged', 'Discharged']]
type Props = {
  role: BackendRole; onAdd: () => void; onSelect: (id: string) => void; refreshKey?: number; initialView?: PatientView
  onViewAdmission: (admission: AdmissionSummary) => void; onOpenRecord?: (admission: AdmissionSummary) => void; onDischarge?: (admission: AdmissionSummary) => void
}
export function Patients({ role, onAdd, onSelect, refreshKey = 0, initialView = 'all', onViewAdmission, onOpenRecord, onDischarge }: Props) {
  const [view, setView] = useState<PatientView>(initialView)
  const [search, setSearch] = useState(''), [page, setPage] = useState(1)
  const [archived, setArchived] = useState<'false' | 'true' | 'all'>('false')
  const [retry, setRetry] = useState(0)
  const { data, loading, error } = usePatients({ search, page, archived, limit: 10 }, refreshKey + retry, view === 'all')
  const canRegister = canRegisterPatients(role)
  const empty = data && data.pagination.total > 0 ? 'No patients on this page.' : search.trim() ? 'No patients match your search.' : archived === 'true' ? 'No archived patients.' : 'No patients registered yet.'
  const choose = (next: PatientView) => { setView(next); setPage(1) }
  return <section className="panel page-panel patients-panel" aria-busy={loading}>
    <div className="panel-header patients-header">
      <div><h2>{views.find(([value]) => value === view)![1]}</h2>
        <p>{view === 'all' ? (data ? `${data.pagination.total.toLocaleString()} patient records in this view` : 'Search permanent patient records') : view === 'admitted' ? 'Patients in hospital now, with their room.' : 'Closed stays, latest discharge first. Patients stay on record.'}</p></div>
      {canRegister && <button type="button" className="button button-primary patients-add-button" onClick={onAdd}><Plus size={17} aria-hidden="true" />Register patient</button>}
    </div>
    <div role="group" aria-label="Patient view" className="report-segments patient-views">
      {views.map(([value, label]) => <button key={value} type="button" aria-pressed={view === value} onClick={() => choose(value)}>{label}</button>)}
    </div>
    <div className={`patients-toolbar${view === 'all' ? '' : ' patients-toolbar-single'}`}>
      <label className="patients-search"><Search size={17} aria-hidden="true" /><input aria-label={view === 'all' ? 'Search patients' : 'Search admissions'} maxLength={100} value={search}
        placeholder={view === 'all' ? 'Search by name or patient number…' : 'Search name, number or room…'} onChange={(e) => { setSearch(e.target.value); setPage(1) }} /></label>
      {view === 'all' && <div className="patients-filter"><select aria-label="Filter patient records" value={archived} onChange={(e) => { setArchived(e.target.value as typeof archived); setPage(1) }}><option value="false">Active records</option><option value="true">Archived records</option><option value="all">All records</option></select></div>}
      <div className="patients-toolbar-actions"><button className="button button-ghost tool-compact" aria-label="Refresh" disabled={loading} onClick={() => setRetry((n) => n + 1)}><RefreshCw size={17} aria-hidden="true" /><span className="tool-label">Refresh</span></button>
        {(search || (view === 'all' && archived !== 'false')) && <button className="button button-ghost" onClick={() => { setSearch(''); setArchived('false'); setPage(1) }}>Clear filters</button>}</div>
    </div>
    {view !== 'all' ? <AdmissionList status={view === 'admitted' ? 'ADMITTED' : 'DISCHARGED'} role={role} search={search} page={page} revision={refreshKey + retry} onPage={setPage}
      onRetry={() => setRetry((n) => n + 1)} onSelectPatient={onSelect} onView={onViewAdmission} onOpenRecord={onOpenRecord} onDischarge={onDischarge} />
      : loading ? <LoadingRows label="Loading patient records…" />
      : error !== undefined ? <PatientFeedback error={error} retry={() => setRetry((value) => value + 1)} />
      : data?.items.length === 0 ? <div className="patients-state"><UsersRound size={22} aria-hidden="true" /><strong>{empty}</strong><p>{search.trim() ? 'Try a different name or patient number, or clear the filters.' : archived === 'true' ? 'Archived records will appear here when a patient record is archived.' : 'Register a patient to begin, or include archived records in your search.'}</p>
        {data.pagination.total > 0 ? <button type="button" className="button button-ghost" onClick={() => setPage(1)}>Return to first page</button>
          : !search.trim() && archived === 'false' && canRegister && <button type="button" className="button button-ghost" onClick={onAdd}>Register patient</button>}
      </div>
      : <table className="patient-table patients-table" aria-label="Patient directory">
        <thead><tr><th scope="col">Patient</th><th scope="col">Age</th><th scope="col">Status</th><th scope="col">Registered</th></tr></thead><tbody>
        {data?.items.map((patient) => <tr key={patient.id}><td>
          <div className="patient-name"><div className="avatar" aria-hidden="true">{patient.firstName[0]}{patient.lastName[0]}</div><div className="patients-name-copy">
            <button type="button" className="patient-name-button" onClick={() => onSelect(patient.id)}>{patientName(patient)}</button><PatientNumber value={patient.patientNumber} />
          </div></div></td>
          <td data-label="Age">{calculateAge(patient.dateOfBirth)}</td>
          <td data-label="Status">{patient.archivedAt ? <em className="status archived">Archived record</em> : patient.currentAdmission ? <><em className="status admission-admitted">Admitted</em><small className="admission-by">{patient.currentAdmission.roomNumber}</small></>
            : <span className="admission-muted">Not admitted</span>}</td>
          <td data-label="Registered">{formatTimestamp(patient.createdAt)}</td>
        </tr>)}</tbody>
      </table>}
    {view === 'all' && !loading && data && <Pagination label="Patient pages" pagination={data.pagination} onPage={setPage} />}
  </section>
}
