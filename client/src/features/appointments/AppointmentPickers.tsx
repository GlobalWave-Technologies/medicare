import { useEffect, useRef, useState } from 'react'
import { appointmentsApi, type AppointmentClinician } from '../../api/appointments'
import type { Patient } from '../../api/patients'
import { usePatients } from '../patients/usePatients'
import { Pagination } from '../../components/ui/Pagination'
import { AppointmentFeedback } from './AppointmentFeedback'
import { clinicianName, patientName } from './appointment-utils'

export function PatientPicker({ selected, onSelect }: { selected: Patient | null; onSelect: (patient: Patient | null) => void }) {
  const [search, setSearch] = useState(''), [page, setPage] = useState(1), [revision, setRevision] = useState(0)
  const searchInput = useRef<HTMLInputElement>(null), clearButton = useRef<HTMLButtonElement>(null), previousSelection = useRef(selected)
  useEffect(() => {
    if (previousSelection.current !== selected) {
      if (selected) clearButton.current?.focus()
      else searchInput.current?.focus()
      previousSelection.current = selected
    }
  }, [selected])
  const { data, loading, error } = usePatients({ page, limit: 10, search, archived: 'false' }, revision, !selected)
  return <section className="appointment-picker" aria-label="Select patient">
    {selected ? <div><strong>Selected patient</strong><p>{patientName(selected)} · {selected.patientNumber}</p>
      <button ref={clearButton} type="button" className="button button-ghost" onClick={() => onSelect(null)}>Clear patient selection</button></div>
      : <><label>Search active patients<input ref={searchInput} name="patientSearch" value={search} maxLength={100} onChange={(event) => { setSearch(event.target.value); setPage(1) }} /></label>
        {loading && <p role="status" className="loading-note">Searching patients…</p>}
        {error !== undefined && <><AppointmentFeedback error={error} /><button type="button" className="button button-ghost" onClick={() => setRevision((n) => n + 1)}>Retry patients</button></>}
        {data && <><ul className="appointment-patient-results" aria-label="Patient results">{data.items.filter((patient) => !patient.archivedAt).map((patient) => <li key={patient.id}>
          <button type="button" onClick={() => onSelect(patient)}>{patientName(patient)} <small>{patient.patientNumber}</small></button>
        </li>)}</ul>
          {!data.items.some((patient) => !patient.archivedAt) && <p role="status" className="field-helper">No active patients found. Try another search.</p>}
          <Pagination pagination={data.pagination} onPage={setPage} label="Patient lookup pages" /></>}
      </>}
  </section>
}

export function ClinicianPicker({ value, onChange, filter = false }: { value: string; onChange: (id: string) => void; filter?: boolean }) {
  const [revision, setRevision] = useState(0)
  const [result, setResult] = useState<{ revision: number; clinicians?: AppointmentClinician[]; error?: unknown }>()
  useEffect(() => {
    const controller = new AbortController()
    void appointmentsApi.clinicians(controller.signal).then(({ clinicians }) => {
      if (!controller.signal.aborted) setResult({ revision, clinicians })
    }).catch((error: unknown) => { if (!controller.signal.aborted) setResult({ revision, error }) })
    return () => controller.abort()
  }, [revision])
  const loading = result?.revision !== revision
  const clinicians = !loading ? result?.clinicians : undefined
  return <div className="appointment-clinician-picker">
    <label>{filter ? 'Filter by clinician' : 'Clinician'}<select name="clinicianId" value={value} disabled={loading || !clinicians} onChange={(event) => onChange(event.target.value)}>
      <option value="">{filter ? 'All clinicians' : 'Select an active doctor'}</option>
      {value && !clinicians?.some((clinician) => clinician.id === value) && <option value={value} disabled>Previously selected clinician — reload and reselect</option>}
      {clinicians?.map((clinician) => <option value={clinician.id} key={clinician.id}>{clinicianName(clinician)} · {clinician.staffNumber}</option>)}
    </select></label>
    {loading && <small role="status" className="field-helper">Loading active doctors…</small>}
    {!loading && result?.error !== undefined && <AppointmentFeedback error={result.error} />}
    {clinicians?.length === 0 && <small role="status" className="field-helper">No active doctors are available.</small>}
    {(!filter || result?.error !== undefined || clinicians?.length === 0) && <button type="button" className="button-link" disabled={loading} onClick={() => setRevision((n) => n + 1)}>Reload doctors</button>}
  </div>
}
