import { ApiError, isRecord, mutation, request } from './client'
import type { BackendRole } from './auth'
import type { AppointmentPagination } from './appointments'

export type NotificationType = 'DIRECT' | 'BROADCAST'
// APPOINTMENT is the only target the server issues today; other types are shown without an action.
export type NotificationTarget = { type: string; id: string }
export type NotificationContent = {
  id: string; type: NotificationType; title: string; message: string; createdAt: string; target: NotificationTarget | null
}
export type InboxNotification = NotificationContent & { readAt: string | null }
export type NotificationPage = { items: InboxNotification[]; pagination: AppointmentPagination }
export type NotificationQuery = { page?: number; limit?: number; read?: boolean; type?: NotificationType }
export type BroadcastAudience = { type: 'ALL' } | { type: 'ROLE'; role: BackendRole }
export type BroadcastInput = { title: string; message: string; audience: BroadcastAudience }
export type BroadcastResult = { notification: NotificationContent; recipientCount: number }
type Result = { notification: InboxNotification }

const path = (id: string) => `/notifications/${encodeURIComponent(id)}`
const audience = (value: BroadcastAudience): BroadcastAudience => value.type === 'ROLE' ? { type: 'ROLE', role: value.role } : { type: 'ALL' }

// The recipient is always the signed-in account; no call accepts a staff identifier.
export const notificationsApi = {
  list(query: NotificationQuery = {}, signal?: AbortSignal) {
    const params = new URLSearchParams({ page: String(query.page ?? 1), limit: String(query.limit ?? 20) })
    if (query.read !== undefined) params.set('read', String(query.read))
    if (query.type) params.set('type', query.type)
    return request<NotificationPage>(`/notifications?${params}`, { signal })
  },
  get: (id: string, signal?: AbortSignal) => request<Result>(path(id), { signal }),
  async unreadCount(signal?: AbortSignal) {
    const data = await request<unknown>('/notifications/unread-count', { signal })
    const count = isRecord(data) ? data.count : undefined
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
      throw new ApiError(502, 'The server returned an unexpected response.', 'INVALID_RESPONSE')
    }
    return { count }
  },
  markRead: (id: string) => mutation<Result>(`${path(id)}/read`, { method: 'POST' }),
  markAllRead: () => mutation<{ updated: number }>('/notifications/read-all', { method: 'POST' }),
  broadcast: (input: BroadcastInput, idempotencyKey?: string) => mutation<BroadcastResult>('/notifications/broadcast', {
    method: 'POST', body: JSON.stringify({ title: input.title.trim(), message: input.message.trim(), audience: audience(input.audience) }),
  }, { idempotencyKey }),
}
