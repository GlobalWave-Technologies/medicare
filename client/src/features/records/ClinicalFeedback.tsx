import { ApiError } from '../../api/client'
import { clinicalError } from './clinical-utils'

// New drafts carry an idempotency key, and identical amendments and repeat finalizations are refused,
// so resubmitting those unchanged is safe. Draft edits are checked against the record first.
const unconfirmed = {
  create: 'The draft could not be confirmed. Select Save draft again without changing anything; the draft will not be saved twice.',
  update: 'The save result could not be confirmed. Close this dialog and refresh the clinical record or patient history before submitting again. The original request may have succeeded.',
  finalize: 'Finalization could not be confirmed. Close this dialog and refresh the clinical record to check its status. A record cannot be finalized twice.',
  amend: 'The amendment could not be confirmed. Select Add permanent amendment again without changing anything; an identical amendment is never added twice.',
}
export type ClinicalMutation = keyof typeof unconfirmed
export function ClinicalFeedback({ error, mutation }: { error: unknown; mutation?: ClinicalMutation }) {
  const uncertain = mutation && (!(error instanceof ApiError) || error.status >= 500)
  return <div role="alert" className="clinical-error">{uncertain ? unconfirmed[mutation] : clinicalError(error)}
    {error instanceof ApiError && error.requestId && <small>Support reference: {error.requestId}</small>}</div>
}
