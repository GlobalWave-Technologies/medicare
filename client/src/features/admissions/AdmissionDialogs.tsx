import { PatientNumber } from '../../components/ui/PatientNumber'
import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ApiError } from '../../api/client'
import { admissionsApi, type Admission, type AdmissionSummary } from '../../api/admissions'
import type { PatientSummary } from '../../api/common'
import { submissionKeys } from '../../api/idempotency'
import { Dialog } from '../../components/ui/Dialog'
import { useUnsavedChanges } from '../../components/ui/useUnsavedChanges'
import { personName } from '../../lib/people'
import { localInputToISO, localTimezone, toLocalInput } from '../../lib/time'
import { admissionError, isUnconfirmed, unconfirmed, DISCHARGE_NOTE_LIMIT, NOTE_LIMIT, ROOM_LIMIT, roomProblem, textProblem, timeProblem, type AdmissionMutation } from './admission-utils'
import './admissions.css'

function Feedback({ error, mutation, children }: { error: unknown; mutation: AdmissionMutation; children?: ReactNode }) {
  return <div role="alert" className="admission-error">
    <p>{isUnconfirmed(error) ? unconfirmed[mutation] : admissionError(error)}</p>
    {error instanceof ApiError && error.requestId && <small>Support reference: {error.requestId}</small>}
    {children}
  </div>
}
const lead = (patient: PatientSummary, extra?: string) => <p className="modal-lead"><strong>{personName(patient)}</strong> · <PatientNumber value={patient.patientNumber} />{extra && <> · {extra}</>}</p>

type AdmitProps = { patient: PatientSummary; intro?: string; onClose: () => void; onAdmitted: (admission: Admission) => void; onOpenCurrent?: () => void }
// Room and time only. The time defaults to now and is sent only when staff change it.
export function AdmitDialog({ patient, intro, onClose, onAdmitted, onOpenCurrent }: AdmitProps) {
  const [initialTime] = useState(() => toLocalInput(new Date().toISOString()))
  const [room, setRoom] = useState(''), [time, setTime] = useState(initialTime)
  const [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null)
  const pending = useRef(false), [keys] = useState(submissionKeys)
  const dirty = Boolean(room.trim()) || time !== initialTime
  useUnsavedChanges(dirty)
  const close = () => { if (!pending.current && (!dirty || window.confirm('Discard this admission?'))) onClose() }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (pending.current) return
    const problem = roomProblem(room) ?? (time !== initialTime ? timeProblem(time, 'admission date and time') : null)
    if (problem) { setError(problem); return }
    const input = { patientId: patient.id, roomNumber: room.trim(), ...(time !== initialTime ? { admittedAt: localInputToISO(time)! } : {}) }
    pending.current = true; setBusy(true); setError(null)
    try {
      const { admission } = await admissionsApi.admit(input, keys.key(input))
      keys.settle(); onAdmitted(admission); onClose()
    } catch (caught) { keys.settle(caught); setError(caught) }
    finally { pending.current = false; setBusy(false) }
  }
  const already = error instanceof ApiError && error.code === 'PATIENT_ALREADY_ADMITTED'
  return <Dialog title="Admit patient" kind="admission" closeLabel="Close admission dialog" busy={busy} onClose={close}>
    <form className="admission-form" onSubmit={submit} noValidate aria-busy={busy}>
      {lead(patient)}
      {intro && <p role="status" className="notice">{intro}</p>}
      <fieldset disabled={busy}>
        <label htmlFor="admission-room">Room<input id="admission-room" name="roomNumber" maxLength={ROOM_LIMIT} autoComplete="off" required
          placeholder="For example Room 4 or Ward A – Bed 6" value={room} onChange={(event) => setRoom(event.target.value)} /></label>
        <label htmlFor="admission-time">Admission date and time<input id="admission-time" name="admittedAt" type="datetime-local" aria-describedby="admission-time-help"
          value={time} onChange={(event) => setTime(event.target.value)} />
          <small id="admission-time-help" className="field-helper">Defaults to now. Change it only to record an earlier admission. Times in {localTimezone()}.</small></label>
      </fieldset>
      {busy && <p role="status" className="loading-note">Saving admission…</p>}
      {error !== null && <Feedback error={error} mutation="admit">
        {already && onOpenCurrent && <button type="button" className="button button-ghost" onClick={() => { onOpenCurrent(); onClose() }}>Open current admission</button>}
      </Feedback>}
      <div className="modal-footer"><button type="button" className="button button-ghost" disabled={busy} onClick={close}>Cancel</button>
        <button className="button button-primary" disabled={busy}>{busy ? 'Saving admission…' : 'Save admission'}</button></div>
    </form>
  </Dialog>
}

type StayProps = { admission: AdmissionSummary; onClose: () => void; onSaved: (admission: Admission) => void }
export function ChangeRoomDialog({ admission, onClose, onSaved }: StayProps) {
  const [room, setRoom] = useState(''), [note, setNote] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null), pending = useRef(false)
  const dirty = Boolean(room.trim() || note.trim())
  useUnsavedChanges(dirty)
  const close = () => { if (!pending.current && (!dirty || window.confirm('Discard this room change?'))) onClose() }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (pending.current) return
    const problem = roomProblem(room) ?? textProblem(note, 'transfer note', NOTE_LIMIT, false)
      ?? (room.trim() === admission.roomNumber ? 'The patient is already in this room.' : null)
    if (problem) { setError(problem); return }
    pending.current = true; setBusy(true); setError(null)
    try {
      const result = await admissionsApi.changeRoom(admission.id, { roomNumber: room.trim(), ...(note.trim() ? { note: note.trim() } : {}) })
      onSaved(result.admission); onClose()
    } catch (caught) { setError(caught) }
    finally { pending.current = false; setBusy(false) }
  }
  return <Dialog title="Change room" kind="admission" closeLabel="Close room dialog" size="compact" busy={busy} onClose={close}>
    <form className="admission-form" onSubmit={submit} noValidate aria-busy={busy}>
      {lead(admission.patient, admission.admissionNumber)}
      <p className="admission-current-room">Current room: <strong>{admission.roomNumber}</strong></p>
      <fieldset disabled={busy}>
        <label htmlFor="admission-new-room">New room<input id="admission-new-room" name="roomNumber" maxLength={ROOM_LIMIT} autoComplete="off" required
          value={room} onChange={(event) => setRoom(event.target.value)} /></label>
        <label htmlFor="admission-transfer-note">Transfer note (optional)<textarea id="admission-transfer-note" name="note" rows={3} maxLength={NOTE_LIMIT}
          aria-describedby="admission-note-help" value={note} onChange={(event) => setNote(event.target.value)} />
          <small id="admission-note-help" className="field-helper">Kept in the room history and visible to all staff who can see admissions. Do not include clinical details.</small></label>
      </fieldset>
      {busy && <p role="status" className="loading-note">Changing room…</p>}
      {error !== null && <Feedback error={error} mutation="room" />}
      <div className="modal-footer"><button type="button" className="button button-ghost" disabled={busy} onClick={close}>Cancel</button>
        <button className="button button-primary" disabled={busy}>{busy ? 'Changing room…' : 'Change room'}</button></div>
    </form>
  </Dialog>
}

// The confirmation states what discharge does. The time is sent only when staff change it.
export function DischargeDialog({ admission, onClose, onSaved, onOpenRecord }: StayProps & { onOpenRecord?: () => void }) {
  const [initialTime] = useState(() => toLocalInput(new Date().toISOString()))
  const [time, setTime] = useState(initialTime), [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null), pending = useRef(false)
  const dirty = Boolean(notes.trim()) || time !== initialTime
  useUnsavedChanges(dirty)
  const close = () => { if (!pending.current && (!dirty || window.confirm('Discard this discharge?'))) onClose() }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (pending.current) return
    const problem = (time !== initialTime ? timeProblem(time, 'discharge date and time') : null) ?? textProblem(notes, 'discharge note', DISCHARGE_NOTE_LIMIT, true)
    if (problem) { setError(problem); return }
    pending.current = true; setBusy(true); setError(null)
    try {
      const result = await admissionsApi.discharge(admission.id, { ...(time !== initialTime ? { dischargedAt: localInputToISO(time)! } : {}),
        ...(notes.trim() ? { dischargeNotes: notes.trim() } : {}) })
      onSaved(result.admission); onClose()
    } catch (caught) { setError(caught) }
    finally { pending.current = false; setBusy(false) }
  }
  const drafts = error instanceof ApiError && error.code === 'ADMISSION_HAS_DRAFT_RECORDS'
  return <Dialog title="Discharge patient" kind="admission" closeLabel="Close discharge dialog" busy={busy} onClose={close} describedBy="discharge-consequence">
    <form className="admission-form" onSubmit={submit} noValidate aria-busy={busy}>
      {/* Who, which stay and which room, so the right admission is closed. */}
      <dl className="stay-summary">
        <div><dt>Patient</dt><dd><strong>{personName(admission.patient)}</strong><PatientNumber value={admission.patient.patientNumber} /></dd></div>
        <div><dt>Admission</dt><dd>{admission.admissionNumber}</dd></div>
        <div><dt>Room</dt><dd>{admission.roomNumber}</dd></div>
      </dl>
      <p id="discharge-consequence" className="callout tone-warning">Discharging this patient will close the current admission and remove them from Currently admitted. Their admission, room history, clinical records and medications stay in their history.</p>
      <fieldset disabled={busy}>
        <label htmlFor="discharge-time">Discharge date and time<input id="discharge-time" name="dischargedAt" type="datetime-local" aria-describedby="discharge-time-help"
          value={time} onChange={(event) => setTime(event.target.value)} />
          <small id="discharge-time-help" className="field-helper">Defaults to now. Times in {localTimezone()}.</small></label>
        <label htmlFor="discharge-notes">Discharge note or summary (optional)<textarea id="discharge-notes" name="dischargeNotes" rows={6} maxLength={DISCHARGE_NOTE_LIMIT}
          value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
      </fieldset>
      {busy && <p role="status" className="loading-note">Discharging patient…</p>}
      {error !== null && <Feedback error={error} mutation="discharge">
        {drafts && onOpenRecord && <button type="button" className="button button-ghost" onClick={() => { onOpenRecord(); onClose() }}>Open medical record</button>}
      </Feedback>}
      <div className="modal-footer"><button type="button" className="button button-ghost" disabled={busy} onClick={close}>Cancel</button>
        <button className="button button-danger" disabled={busy}>{busy ? 'Discharging…' : 'Discharge patient'}</button></div>
    </form>
  </Dialog>
}
