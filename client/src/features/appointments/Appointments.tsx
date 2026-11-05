import { useState } from 'react'
import { CalendarDays, Plus, RefreshCw } from 'lucide-react'
import { LoadingRows } from '../../components/ui/LoadingRows'
import type { StaffUser } from '../../api/auth'
import type { AppointmentStatus, AppointmentType } from '../../api/appointments'
import { canManageAppointments, clinicianName, displayTime, localDateRange, localTimezone, patientName, presetRange, statusLabels, typeLabels } from './appointment-utils'
import { useAppointmentClock, useAppointments } from './useAppointments'
import { AppointmentFeedback } from './AppointmentFeedback'
import { Pagination } from '../../components/ui/Pagination'
import { ClinicianPicker } from './AppointmentPickers'
import './appointments.css'

export function Appointments({ user, onBook, onSelect, refreshKey = 0 }: { user: StaffUser; onBook: () => void; onSelect: (id: string) => void; refreshKey?: number }) {
  const [search, setSearch] = useState(''), [status, setStatus] = useState<AppointmentStatus | ''>(''), [type, setType] = useState<AppointmentType | ''>('')
  const [clinicianId, setClinicianId] = useState(''), [page, setPage] = useState(1), [retry, setRetry] = useState(0)
  const [mode, setMode] = useState<'all' | 'today' | 'week' | 'custom'>('week'), [from, setFrom] = useState(''), [to, setTo] = useState('')
  const now = useAppointmentClock()
  const range = mode === 'custom' ? localDateRange(from, to) : presetRange(mode, now)
  const { data, loading, error } = useAppointments(range ? { page, limit: 10, search, status: status || undefined, type: type || undefined, clinicianId: clinicianId || undefined, ...range } : null, user.role, refreshKey + retry)
  const manager = canManageAppointments(user.role)
  const filtered = Boolean(search || status || type || clinicianId || mode !== 'week')
  const reset = () => { setSearch(''); setStatus(''); setType(''); setClinicianId(''); setMode('week'); setFrom(''); setTo(''); setPage(1) }
  return <section className="panel appointments-panel appointment-workspace">
    <div className="appointments-header"><div><p className="appointments-kicker">Appointment schedule</p><h2>{manager ? 'Hospital appointments' : 'My appointments'}</h2><p>{manager ? 'Search the hospital schedule.' : 'Only appointments assigned to you are shown.'} Times in {localTimezone()}.</p></div>
      {manager && <button className="button button-primary" onClick={onBook}><Plus size={17} aria-hidden="true" />Book appointment</button>}
    </div>
    <div className="appointment-filters">
      <label>Search appointments<input name="appointmentSearch" value={search} maxLength={100} placeholder="Reference, patient number or name" onChange={(event) => { setSearch(event.target.value); setPage(1) }} /></label>
      <label>Status<select name="status" value={status} onChange={(event) => { setStatus(event.target.value as AppointmentStatus | ''); setPage(1) }}><option value="">All statuses</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Type<select name="type" value={type} onChange={(event) => { setType(event.target.value as AppointmentType | ''); setPage(1) }}><option value="">All types</option>{Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Date range<select name="range" value={mode} onChange={(event) => { setMode(event.target.value as typeof mode); setPage(1) }}><option value="week">This week</option><option value="today">Today</option><option value="all">All dates</option><option value="custom">Custom dates</option></select></label>
      {manager && <ClinicianPicker filter value={clinicianId} onChange={(id) => { setClinicianId(id); setPage(1) }} />}
      {mode === 'custom' && <><label>From date<input type="date" name="from" value={from} onChange={(event) => { setFrom(event.target.value); setPage(1) }} /></label><label>Through date<input type="date" name="to" value={to} onChange={(event) => { setTo(event.target.value); setPage(1) }} /></label></>}
    </div>
    <div className="list-tools"><button className="button button-ghost" disabled={loading} onClick={() => setRetry((n) => n + 1)}><RefreshCw size={17} aria-hidden="true" />Refresh appointments</button>
      {filtered && <button className="button button-ghost" onClick={reset}>Reset appointment filters</button>}</div>
    {!range && <p role="alert" className="appointment-error">Choose valid from and through dates in chronological order.</p>}
    {loading && <LoadingRows label="Loading appointments…" />}
    {error !== undefined && <AppointmentFeedback error={error} />}
    {data && !loading && <>
      {!data.items.length ? <div role="status" className="empty-state"><CalendarDays size={22} aria-hidden="true" /><strong>{search.trim() ? 'No appointments match your search.' : 'No appointments in this view.'}</strong>
        <p>Adjust the filters to see other dates or statuses.</p>
        {filtered ? <button className="button button-ghost" onClick={reset}>Reset appointment filters</button> : manager && <button className="button button-ghost" onClick={onBook}>Book appointment</button>}</div>
        : <div className="appointment-table-scroll"><table className="appointment-table" aria-label="Appointments"><thead><tr><th scope="col">Appointment / patient</th><th scope="col">Clinician</th><th scope="col">Local schedule</th><th scope="col">Type / status</th></tr></thead><tbody>{data.items.map((appointment) => <tr key={appointment.id}>
          <td><button className="appointment-open" onClick={() => onSelect(appointment.id)}>{appointment.reference}</button><strong>{patientName(appointment.patient)}</strong><small>{appointment.patient.patientNumber}</small></td>
          <td data-label="Clinician">{clinicianName(appointment.clinician)}<small>{appointment.clinician?.staffNumber}</small></td>
          <td data-label="Local schedule">{displayTime(appointment.scheduledStart)}<small>to {displayTime(appointment.scheduledEnd)}</small></td>
          <td data-label="Type / status">{typeLabels[appointment.type]}<span className={`appointment-status status-${appointment.status.toLowerCase()}`}>{statusLabels[appointment.status]}</span></td>
        </tr>)}</tbody></table></div>}
      {data.pagination.page > Math.max(1, data.pagination.totalPages) && <button className="button button-ghost" onClick={() => setPage(1)}>Return to first page</button>}
      <Pagination label="Appointment pages" pagination={data.pagination} onPage={setPage} />
    </>}
  </section>
}
