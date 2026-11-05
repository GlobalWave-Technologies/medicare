import { useState } from 'react'
import { Plus, RefreshCw, Search, UsersRound } from 'lucide-react'
import { LoadingRows } from '../../components/ui/LoadingRows'
import type { BackendRole } from '../../api/auth'
import { Pagination } from '../../components/ui/Pagination'
import { PatientFeedback } from './PatientFeedback'
import { calculateAge, canManagePatients, formatTimestamp, patientName } from './patient-utils'
import { usePatients } from './usePatients'
import './patients.css'

type Props = { role: BackendRole; onAdd: () => void; onSelect: (id: string) => void; refreshKey?: number }
export function Patients({ role, onAdd, onSelect, refreshKey = 0 }: Props) {
  const [search, setSearch] = useState(''), [page, setPage] = useState(1)
  const [archived, setArchived] = useState<'false' | 'true' | 'all'>('false')
  const [retry, setRetry] = useState(0)
  const { data, loading, error } = usePatients({ search, page, archived, limit: 10 }, refreshKey + retry)
  const canManage = canManagePatients(role)
  const empty = data && data.pagination.total > 0 ? 'No patients on this page.' : search.trim() ? 'No patients match your search.' : archived === 'true' ? 'No archived patients.' : 'No patients registered yet.'
  return <section className="panel page-panel patients-panel" aria-busy={loading}>
    <div className="panel-header patients-header">
      <div><p className="patients-kicker">Patient management</p><h2>Patient directory</h2><p>{data ? `${data.pagination.total.toLocaleString()} patient records in this view` : 'Search and manage patient demographics'}</p></div>
      {canManage && <button type="button" className="button button-primary patients-add-button" onClick={onAdd}><Plus size={17} aria-hidden="true" />Add patient</button>}
    </div>
    <div className="patients-toolbar">
      <label className="patients-search"><Search size={17} aria-hidden="true" /><input aria-label="Search patients" maxLength={100} value={search} placeholder="Search by name, patient number or phone…" onChange={(e) => { setSearch(e.target.value); setPage(1) }} /></label>
      <div className="patients-filter"><select aria-label="Filter patient records" value={archived} onChange={(e) => { setArchived(e.target.value as typeof archived); setPage(1) }}><option value="false">Active patients</option><option value="true">Archived patients</option><option value="all">All patients</option></select></div>
    </div>
    <div className="list-tools"><button className="button button-ghost" disabled={loading} onClick={() => setRetry((n) => n + 1)}><RefreshCw size={17} aria-hidden="true" />Refresh patients</button>
      {(search || archived !== 'false') && <button className="button button-ghost" onClick={() => { setSearch(''); setArchived('false'); setPage(1) }}>Clear patient filters</button>}</div>
    {loading ? <LoadingRows label="Loading patient records…" />
      : error !== undefined ? <PatientFeedback error={error} retry={() => setRetry((value) => value + 1)} />
      : data?.items.length === 0 ? <div className="patients-state"><UsersRound size={22} aria-hidden="true" /><strong>{empty}</strong><p>{search.trim() ? "Try a different name, patient number or phone, or clear the filters." : archived === "true" ? "Archived records will appear here when a patient is archived." : canManage ? "Register a patient to begin, or include archived records in your search." : "Ask the records office to register the patient, or include archived records in your search."}</p>
        {data.pagination.total > 0 ? <button type="button" className="button button-ghost" onClick={() => setPage(1)}>Return to first page</button>
          : !search.trim() && archived === 'false' && canManage && <button type="button" className="button button-ghost" onClick={onAdd}>Register patient</button>}
      </div>
      : <table className="patient-table patients-table" aria-label="Patient directory">
        <thead><tr><th scope="col">Patient</th><th scope="col">Age</th><th scope="col">Phone</th><th scope="col">Status</th><th scope="col">Registered (UTC)</th></tr></thead><tbody>
        {data?.items.map((patient) => <tr key={patient.id}><td>
          <div className="patient-name"><div className="avatar avatar-blue" aria-hidden="true">{patient.firstName[0]}{patient.lastName[0]}</div><div className="patients-name-copy">
            <button type="button" className="patient-name-button" onClick={() => onSelect(patient.id)}>{patientName(patient)}</button><span>{patient.patientNumber}</span>
          </div></div></td>
          <td data-label="Age">{calculateAge(patient.dateOfBirth)}</td><td data-label="Phone">{patient.phone ?? 'Not recorded'}</td>
          <td data-label="Status"><em className={`status ${patient.archivedAt ? 'archived' : 'active'}`}>{patient.archivedAt ? 'Archived' : 'Active'}</em></td>
          <td data-label="Registered (UTC)">{formatTimestamp(patient.createdAt)}</td>
        </tr>)}</tbody>
      </table>}
    {!loading && data && <Pagination label="Patient pages" pagination={data.pagination} onPage={setPage} />}
  </section>
}
