import { useEffect, useState } from 'react'
import type { Appointment } from '../../api/appointments'
import type { StaffUser } from '../../api/auth'
import { encountersApi } from '../../api/encounters'
import { canStartLinked, hasClinicalAccess } from './clinical-utils'
import { ClinicalFeedback } from './ClinicalFeedback'
type Props = { user: StaffUser; appointment: Appointment; onEnter: (appointment: Appointment, encounterId?: string) => void }
export function AppointmentClinicalLink(props: Props) {
  if (!hasClinicalAccess(props.user.role) || props.appointment.clinician?.id !== props.user.id) return null
  return <Discovery key={props.appointment.id} {...props} />
}
function Discovery({ user, appointment, onEnter }: Props) {
  const [revision, setRevision] = useState(0), [result, setResult] = useState<{ revision: number; id?: string; error?: unknown }>()
  useEffect(() => {
    const controller = new AbortController()
    void encountersApi.list({ appointmentId: appointment.id, page: 1, limit: 1 }, controller.signal).then(({ items }) => { if (!controller.signal.aborted) setResult({ revision, id: items[0]?.id }) })
      .catch((error: unknown) => { if (!controller.signal.aborted) setResult({ revision, error }) })
    return () => controller.abort()
  }, [appointment.id, revision])
  const loading = result?.revision !== revision
  return <section aria-label="Appointment clinical record" className="clinical-link">
    {loading ? <p role="status">Checking for a linked clinical record…</p> : result?.error !== undefined ? <ClinicalFeedback error={result.error} />
      : result?.id ? <button className="button button-primary" onClick={() => onEnter(appointment, result.id)}>Open clinical record</button>
        : canStartLinked(user, appointment) ? <button className="button button-primary" onClick={() => onEnter(appointment)}>Start clinical encounter</button>
          : <p>A new clinical encounter requires a checked-in or completed appointment assigned to you.</p>}
    <button className="button-link" disabled={loading} onClick={() => setRevision((n) => n + 1)}>Refresh linked record</button>
  </section>
}
