import type { BackendRole } from '../../api/auth'
import { ApiError, authErrorMessage } from '../../api/client'
import type { InboxNotification, NotificationType } from '../../api/notifications'

export const TITLE_LIMIT = 150
export const MESSAGE_LIMIT = 2000
export const canBroadcast = (role: BackendRole) => role === 'ADMIN'
export const typeLabels: Record<NotificationType, string> = { DIRECT: 'Direct notice', BROADCAST: 'Staff broadcast' }
export const audienceRoles: [BackendRole, string][] = [['ADMIN', 'Administrators'], ['RECORDS_OFFICER', 'Records Officers'], ['DOCTOR_IN_CHARGE', 'Doctors in Charge']]
export const appointmentTarget = (notification: InboxNotification) => notification.target?.type === 'APPOINTMENT' ? notification.target.id : undefined

export const compactCount = (count: number) => count > 99 ? '99+' : String(count)
export const unreadLabel = (count: number) => `${count} unread notification${count === 1 ? '' : 's'}`

function localDay(date: Date) { return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() }
export function notificationTime(value: string, now: number) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'Time not recorded'
  const today = new Date(now), yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
  const time = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(date)
  if (localDay(date) === localDay(today)) return `Today, ${time}`
  if (localDay(date) === yesterday.getTime()) return `Yesterday, ${time}`
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

// Mirrors the server's plain-text rule so staff see the problem before sending.
const allowedCharacter = (character: string) => {
  const code = character.codePointAt(0)!
  return [9, 10, 13].includes(code) || (code >= 32 && (code < 127 || code > 159))
}
export function plainTextProblem(value: string, label: string, limit: number) {
  const text = value.trim()
  if (!text) return `Enter the broadcast ${label}.`
  if (text.length > limit) return `The ${label} allows up to ${limit} characters.`
  if (/[<>]/u.test(text)) return 'Use plain text only. Remove the < and > characters.'
  if (![...text].every(allowedCharacter)) return 'Remove unsupported control characters.'
  return undefined
}

const errors: Record<string, string> = {
  NOTIFICATION_NOT_FOUND: 'Notification not found.',
  NO_NOTIFICATION_RECIPIENTS: 'No active staff accounts match this audience. Choose a different audience.',
  NOTIFICATION_AUDIENCE_TOO_LARGE: 'This audience is too large for a single broadcast. Choose a specific role, or contact system support.',
}
export function notificationError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.code && errors[error.code]) return errors[error.code]
    if (error.status === 404) return 'Notification not found.'
    if (error.status === 401) return 'Your session has expired. Sign in again.'
    if (error.code === 'VALIDATION_ERROR') return 'Check the title and message. Use plain text without angle brackets or control characters.'
  }
  return authErrorMessage(error)
}
