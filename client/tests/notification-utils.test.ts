import { expect, it } from 'vitest'
import { ApiError } from '../src/api/client'
import { appointmentTarget, canBroadcast, compactCount, MESSAGE_LIMIT, notificationError, notificationTime, plainTextProblem, TITLE_LIMIT, unreadLabel } from '../src/features/notifications/notification-utils'
import { appointmentNotice, broadcastNotice } from './notification-fixtures'

it.each([[1, '1'], [42, '42'], [99, '99'], [100, '99+'], [12500, '99+']])('compacts %i unread to %s', (count, label) => expect(compactCount(count)).toBe(label))
it('describes the exact unread count for assistive technology', () => {
  expect(unreadLabel(1)).toBe('1 unread notification'); expect(unreadLabel(5)).toBe('5 unread notifications'); expect(unreadLabel(150)).toBe('150 unread notifications')
})
it('labels local today and yesterday, then falls back to a full local date', () => {
  const now = new Date(2026, 10, 4, 18, 0).getTime(), time = (date: Date) => new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(date)
  const today = new Date(2026, 10, 4, 14, 32), yesterday = new Date(2026, 10, 3, 9, 15), older = new Date(2026, 10, 2, 16, 20)
  expect(notificationTime(today.toISOString(), now)).toBe(`Today, ${time(today)}`)
  expect(notificationTime(yesterday.toISOString(), now)).toBe(`Yesterday, ${time(yesterday)}`)
  expect(notificationTime(new Date(2026, 10, 4, 0, 0).toISOString(), now)).toMatch(/^Today, /)
  expect(notificationTime(older.toISOString(), now)).toBe(new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(older))
  expect(notificationTime(new Date(2026, 0, 1, 9, 0).toISOString(), new Date(2026, 0, 2, 8, 0).getTime())).toMatch(/^Yesterday, /)
  expect(notificationTime('not a date', now)).toBe('Time not recorded')
})
it('applies the server plain-text rules to trimmed broadcast text', () => {
  expect(plainTextProblem('   ', 'title', TITLE_LIMIT)).toBe('Enter the broadcast title.')
  expect(plainTextProblem(` ${'a'.repeat(TITLE_LIMIT)}  `, 'title', TITLE_LIMIT)).toBeUndefined()
  expect(plainTextProblem('a'.repeat(TITLE_LIMIT + 1), 'title', TITLE_LIMIT)).toBe('The title allows up to 150 characters.')
  expect(plainTextProblem('a'.repeat(MESSAGE_LIMIT + 1), 'message', MESSAGE_LIMIT)).toBe('The message allows up to 2000 characters.')
  expect(plainTextProblem('Ward <b>3</b>', 'message', MESSAGE_LIMIT)).toBe('Use plain text only. Remove the < and > characters.')
  expect(plainTextProblem('Bell\u0007', 'message', MESSAGE_LIMIT)).toBe('Remove unsupported control characters.')
  expect(plainTextProblem('Line one\n\tLine two — café 14:00', 'message', MESSAGE_LIMIT)).toBeUndefined()
})
it('allows broadcasts only for administrators and links only appointment targets', () => {
  expect(canBroadcast('ADMIN')).toBe(true); expect(canBroadcast('RECORDS_OFFICER')).toBe(false); expect(canBroadcast('DOCTOR_IN_CHARGE')).toBe(false)
  expect(appointmentTarget(appointmentNotice)).toBe(appointmentNotice.target!.id)
  expect(appointmentTarget(broadcastNotice)).toBeUndefined()
  expect(appointmentTarget({ ...appointmentNotice, target: { type: 'PATIENT', id: 'unsupported' } })).toBeUndefined()
})
it.each([
  [new ApiError(404, 'Owned by another account', 'NOTIFICATION_NOT_FOUND'), 'Notification not found.'],
  [new ApiError(404, 'raw'), 'Notification not found.'],
  [new ApiError(409, 'raw', 'NO_NOTIFICATION_RECIPIENTS'), 'No active staff accounts match this audience. Choose a different audience.'],
  [new ApiError(409, 'raw', 'NOTIFICATION_AUDIENCE_TOO_LARGE'), 'This audience is too large for a single broadcast. Choose a specific role, or contact system support.'],
  [new ApiError(400, 'raw', 'VALIDATION_ERROR'), 'Check the title and message. Use plain text without angle brackets or control characters.'],
  [new ApiError(403, 'raw', 'FORBIDDEN'), 'You do not have permission to perform this action.'],
  [new ApiError(403, 'raw', 'CSRF_INVALID'), 'Your security token needs refreshing. Please try again.'],
  [new ApiError(401, 'raw', 'UNAUTHENTICATED'), 'Your session has expired. Sign in again.'],
  [new ApiError(500, 'stack trace detail', 'INTERNAL_ERROR'), 'Unable to contact the server. Please try again.'],
])('maps %s to safe staff wording', (error, message) => expect(notificationError(error)).toBe(message))
