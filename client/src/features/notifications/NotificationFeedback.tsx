import { ApiError } from '../../api/client'
import { notificationError } from './notification-utils'

// Broadcasts carry an idempotency key, so resending the unchanged open form is safe.
const uncertainMessages = {
  read: 'The read status could not be confirmed. Refresh notifications to see the current state.',
  broadcast: 'The broadcast could not be confirmed. Select Send broadcast again without changing anything; it will not be sent twice.',
}
export function NotificationFeedback({ error, mutation }: { error: unknown; mutation?: keyof typeof uncertainMessages }) {
  const uncertain = mutation && (!(error instanceof ApiError) || error.status >= 500)
  return <div role="alert" className="notification-error">{uncertain ? uncertainMessages[mutation] : notificationError(error)}
    {error instanceof ApiError && error.requestId && <small>Support reference: {error.requestId}</small>}
  </div>
}
