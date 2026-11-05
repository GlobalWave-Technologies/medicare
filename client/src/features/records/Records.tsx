import { AppointmentClinicalLink } from './AppointmentClinicalLink'
import { useState } from 'react'
import { ArrowLeft, Plus } from 'lucide-react'
import type { StaffUser } from '../../api/auth'
import type { Patient } from '../../api/patients'
import type { Appointment } from '../../api/appointments'
import { encountersApi, type Encounter } from '../../api/encounters'
import { canStartLinked, hasClinicalAccess } from './clinical-utils'
import { EncounterList } from './EncounterList'
import { EncounterDetail } from './EncounterDetail'
import { EncounterForm } from './EncounterForm'
import { ClinicalFeedback } from './ClinicalFeedback'
import './records.css'
export type ClinicalContext = { kind: 'patient'; patient: Patient } | { kind: 'appointment'; appointment: Appointment; encounterId?: string }
type Props = { user: StaffUser; context?: ClinicalContext; onBack: () => void; onChoosePatient: () => void }
export function Records(props: Props) { return hasClinicalAccess(props.user.role) ? <Workspace {...props} /> : null }
function Workspace({ user, context, onBack, onChoosePatient }: Props) {
  const [selection, setSelection] = useState<{ id: string; initial?: Encounter } | null>(context?.kind === 'appointment' && context.encounterId ? { id: context.encounterId } : null)
  const [creating, setCreating] = useState(context?.kind === 'appointment' && !context.encounterId && canStartLinked(user, context.appointment))
  const [revision, setRevision] = useState(0), [error, setError] = useState<unknown>(), [finding, setFinding] = useState(false)
  const patient = context?.kind === 'patient' ? context.patient : undefined
  const appointment = context?.kind === 'appointment' ? context.appointment : undefined
  async function openExisting() {
    if (!appointment || finding) return
    setFinding(true); setError(undefined)
    try {
      const { items } = await encountersApi.list({ appointmentId: appointment.id, page: 1, limit: 1 })
      if (items[0]) setSelection({ id: items[0].id })
      else setError(new Error('Linked encounter unavailable'))
      setRevision((n) => n + 1)
    } catch (caught) { setError(caught) }
    finally { setFinding(false) }
  }
  return <div className="clinical-module">
    <div className="clinical-actions">
      {context && <button className="button button-ghost" disabled={creating || finding} onClick={onBack}><ArrowLeft size={17} aria-hidden="true" />{patient ? 'Back to patient' : 'Back to appointment'}</button>}
      {!context && !selection && <button className="button button-primary" onClick={onChoosePatient}><Plus size={17} aria-hidden="true" />Choose patient for new encounter</button>}
      {patient && !patient.archivedAt && !selection && <button className="button button-primary" onClick={() => setCreating(true)}><Plus size={17} aria-hidden="true" />New encounter for this patient</button>}
    </div>
    {appointment && !selection && !creating && <AppointmentClinicalLink user={user} appointment={appointment} onEnter={(_appointment, encounterId) => { if (encounterId) setSelection({ id: encounterId }); else setCreating(true) }} />}
    {error !== undefined && <ClinicalFeedback error={error} />}{finding && <p role="status" className="loading-note">Finding the existing clinical record…</p>}
    <div hidden={Boolean(selection)}><EncounterList user={user} patient={patient} appointmentId={appointment?.id} revision={revision} onSelect={(id) => setSelection({ id })} /></div>
    {selection && <EncounterDetail key={selection.id} user={user} id={selection.id} initial={selection.initial} onBack={() => setSelection(null)} onChanged={() => setRevision((n) => n + 1)} />}
    {creating && (patient || appointment) && <EncounterForm user={user} patient={patient ?? appointment!.patient} appointment={appointment} onClose={() => setCreating(false)} onSaved={(encounter) => { setSelection({ id: encounter.id, initial: encounter }); setRevision((n) => n + 1) }} onOpenExisting={appointment ? () => { void openExisting() } : undefined} />}
  </div>
}
