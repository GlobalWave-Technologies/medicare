import { ApiError } from '../../api/client'
import { appointmentError } from './appointment-utils'
export function AppointmentFeedback({ error, mutation = false }: { error: unknown; mutation?: boolean }) {
  const uncertain = mutation && (!(error instanceof ApiError) || error.status >= 500)
  return <div role="alert" className="appointment-error">{uncertain ? 'The save could not be confirmed, and the appointment may already have been saved. Close this form and refresh the schedule to check before trying again.' : appointmentError(error)}
    {error instanceof ApiError && error.requestId && <small>Support reference: {error.requestId}</small>}
  </div>
}
