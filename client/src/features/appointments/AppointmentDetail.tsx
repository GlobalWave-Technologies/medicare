import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import { LoadingRows } from '../../components/ui/LoadingRows'
import type { StaffUser } from '../../api/auth'
import { appointmentsApi, type Appointment, type AppointmentStatusUpdate } from '../../api/appointments'
import { canChangeStatus, canManageAppointments, clinicianName, displayTime, durationLabel, isEditable, localTimezone, patientName, statusActions, statusLabels, typeLabels } from './appointment-utils'
import { AppointmentFeedback } from './AppointmentFeedback'
import { AppointmentForm } from './AppointmentForm'
import { AppointmentCancellation } from './AppointmentCancellation'
import { useAppointmentClock } from './useAppointments'
import { AppointmentClinicalLink } from '../records/AppointmentClinicalLink'
import './appointments.css'

export function AppointmentDetail({ id, initialAppointment, user, onBack, onChanged, onClinical, backLabel = 'Back to Appointments' }: { id: string; initialAppointment?: Appointment; user: StaffUser; onBack: () => void; onChanged: () => void; onClinical?: (appointment: Appointment, encounterId?: string) => void; backLabel?: string }) {
  const [appointment, setAppointment] = useState(initialAppointment), [loading, setLoading] = useState(!initialAppointment), [error, setError] = useState<unknown>()
  const [revision, setRevision] = useState(0), [busy, setBusy] = useState(false), [dialog, setDialog] = useState<'edit' | 'cancel' | null>(null), [notice, setNotice] = useState(initialAppointment ? 'Appointment booked.' : '')
  const pending = useRef(false), now = useAppointmentClock()
  useEffect(() => {
    if (initialAppointment && revision === 0) return
    const controller = new AbortController()
    void appointmentsApi.get(id, controller.signal).then((result) => {
      if (!controller.signal.aborted) { setAppointment(result.appointment); setLoading(false) }
    }).catch((caught: unknown) => { if (!controller.signal.aborted) { setError(caught); setLoading(false); setAppointment(undefined) } })
    return () => controller.abort()
  }, [id, initialAppointment, revision])
  function saved(value: Appointment) { setAppointment(value); setError(undefined); setNotice(value.status === 'CANCELLED' ? 'Appointment cancelled. History is retained.' : `Appointment updated. Status: ${statusLabels[value.status]}.`); onChanged() }
  async function changeStatus(status: AppointmentStatusUpdate) {
    if (!appointment || pending.current || !canChangeStatus(user, appointment) || !statusActions(appointment, now).some((action) => action.status === status && !action.disabledReason)) return
    pending.current = true; setBusy(true); setError(undefined); setNotice('')
    try { saved((await appointmentsApi.changeStatus(id, status)).appointment) }
    catch (caught) { setError(caught) }
    finally { pending.current = false; setBusy(false) }
  }
  const manager = canManageAppointments(user.role)
  const actions = appointment && canChangeStatus(user, appointment) ? statusActions(appointment, now) : []
  const open = appointment ? isEditable(appointment) || appointment.status === 'CHECKED_IN' : false
  return <section className="panel appointment-workspace appointment-detail" aria-busy={loading || busy}>
    <div className="list-tools detail-tools"><button className="button button-ghost" disabled={busy || Boolean(dialog)} onClick={onBack}><ArrowLeft size={17} aria-hidden="true" />{backLabel}</button>
      <button className="button button-ghost" disabled={busy || loading || Boolean(dialog)} onClick={() => { setLoading(true); setError(undefined); setNotice(''); setRevision((n) => n + 1) }}><RefreshCw size={17} aria-hidden="true" />Refresh appointment</button></div>
    {busy && <p role="status" className="loading-note">Updating appointment status…</p>}
    {loading && <LoadingRows label="Loading appointment…" rows={2} />}{error !== undefined && <AppointmentFeedback error={error} />}{notice && <p role="status" className="notice">{notice}</p>}
    {appointment && !loading && <>
      <div className="detail-header"><div><p className="eyebrow">Appointment</p>
        <div className="detail-title"><h2>{appointment.reference}</h2><span className={`appointment-status status-${appointment.status.toLowerCase()}`}>{statusLabels[appointment.status]}</span></div>
        <p className="appointment-summary">{displayTime(appointment.scheduledStart)}<span>to {displayTime(appointment.scheduledEnd)} · {durationLabel(appointment.scheduledStart, appointment.scheduledEnd)}</span></p>
        <p className="detail-meta">{typeLabels[appointment.type]} · Times in {localTimezone()}.</p>
      </div></div>
      <dl className="appointment-detail-grid">
        <div><dt>Patient</dt><dd>{patientName(appointment.patient)}<small>{appointment.patient.patientNumber}</small></dd></div>
        <div><dt>Clinician</dt><dd>{clinicianName(appointment.clinician)}<small>{appointment.clinician?.staffNumber}</small></dd></div>
        <div><dt>Reason</dt><dd>{appointment.reason || 'Not recorded'}</dd></div><div><dt>Scheduling notes</dt><dd>{appointment.notes || 'Not recorded'}</dd></div>
        {appointment.status === 'CANCELLED' && <><div><dt>Cancelled</dt><dd>{appointment.cancelledAt ? displayTime(appointment.cancelledAt) : 'Not recorded'}</dd></div><div><dt>Cancellation reason</dt><dd>{appointment.cancellationReason || 'Not recorded'}</dd></div></>}
      </dl>
      <dl className="appointment-history"><div><dt>Created</dt><dd>{displayTime(appointment.createdAt)}</dd></div><div><dt>Last updated</dt><dd>{displayTime(appointment.updatedAt)}</dd></div></dl>
      <div className="appointment-panels">
        <section className="appointment-step" aria-labelledby="appointment-step-title">
          <h3 id="appointment-step-title">{open ? 'Next step' : 'Appointment closed'}</h3>
          <p className="workflow-guidance">{appointment.status === "SCHEDULED" ? "Confirm the visit before checking the patient in." : appointment.status === "CONFIRMED" ? "Check in the patient when they arrive. Mark no-show only if they do not attend." : appointment.status === "CHECKED_IN" ? "The patient has checked in. Complete the visit when attendance is finished. Clinical documentation is saved separately." : "This appointment is closed. Its history remains available."}</p>
          {actions.length > 0 && <div className="appointment-step-actions" role="group" aria-label="Appointment actions">{actions.map((action) => <div key={action.status}><button className={`button ${action.status === "NO_SHOW" ? "button-danger-quiet" : "button-primary"}`} disabled={busy || Boolean(action.disabledReason)} aria-describedby={action.disabledReason ? `timing-${action.status}` : undefined} onClick={() => void changeStatus(action.status)}>{action.label}</button>{action.disabledReason && <small id={`timing-${action.status}`}>{action.disabledReason}</small>}</div>)}</div>}
        </section>
        {manager && isEditable(appointment) && <section className="appointment-manage" aria-labelledby="appointment-manage-title">
          <h3 id="appointment-manage-title">Manage booking</h3>
          <p>Change the time, clinician or details, or cancel the visit. The booking history is kept either way.</p>
          <div className="appointment-manage-actions"><button className="button button-ghost" disabled={busy} onClick={() => setDialog('edit')}>Edit / reschedule</button><button className="button button-danger-quiet" disabled={busy} onClick={() => setDialog('cancel')}>Cancel appointment</button></div>
        </section>}
      </div>
      <div className="appointment-clinical">{user.role === 'DOCTOR_IN_CHARGE' && appointment.clinician?.id === user.id && onClinical ? <AppointmentClinicalLink user={user} appointment={appointment} onEnter={onClinical} />
        : <p className="callout tone-neutral">Clinical documentation for this visit is kept in Medical Records and is not shown here.</p>}</div>
      {dialog === 'edit' && manager && <AppointmentForm role={user.role} appointment={appointment} onClose={() => setDialog(null)} onSaved={saved} />}
      {dialog === 'cancel' && manager && <AppointmentCancellation appointment={appointment} onClose={() => setDialog(null)} onSaved={saved} />}
    </>}
  </section>
}

