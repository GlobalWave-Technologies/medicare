import { ApiError } from '../../api/client'
import { patientError } from './patient-utils'

// Registration carries an idempotency key, so resubmitting the unchanged open form is safe.
const unconfirmed = {
  create: 'The registration could not be confirmed. Select Register patient again without changing anything; the patient will not be registered twice.',
  update: 'The changes could not be confirmed. Select Save changes again, or close this form and check the patient record.',
  status: 'The status change could not be confirmed. Close this and refresh the patient record to check its current status before trying again.',
}
export type PatientMutation = keyof typeof unconfirmed
export function PatientFeedback({ error, retry, mutation }: { error: unknown; retry?: () => void; mutation?: PatientMutation }) {
  const uncertain = mutation && typeof error !== 'string' && (!(error instanceof ApiError) || error.status >= 500)
  return <div className="patients-state patients-state-error" role="alert">
    <p>{uncertain ? unconfirmed[mutation] : patientError(error)}</p>
    {error instanceof ApiError && error.requestId && <small>Support reference: {error.requestId}</small>}
    {retry && <button type="button" className="button button-ghost" onClick={retry}>Try again</button>}
  </div>
}
