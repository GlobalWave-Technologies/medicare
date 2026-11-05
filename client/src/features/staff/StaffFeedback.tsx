import { ApiError } from '../../api/client'
import { staffError, uncertain } from './staff-utils'

const uncertainMessages = {
  create: 'The new account could not be confirmed. Select Create account again without changing anything; the account will not be created twice.',
  password: 'The password change could not be confirmed. Refresh this account and set the password again if needed; setting it again is safe.',
  role: 'The role change could not be confirmed. Refresh this account to see its current role before trying again.',
  status: 'The status change could not be confirmed. Refresh this account to see its current status before trying again.',
  sessions: 'Signing out could not be confirmed. Refresh this account, then try again if needed. Signing out again is safe.',
}
export type StaffMutation = keyof typeof uncertainMessages
export function StaffFeedback({ error, mutation, id }: { error: unknown; mutation?: StaffMutation; id?: string }) {
  return <div id={id} role="alert" className="staff-error">{mutation && uncertain(error) ? uncertainMessages[mutation] : staffError(error)}
    {error instanceof ApiError && error.requestId && <small>Support reference: {error.requestId}</small>}
  </div>
}
