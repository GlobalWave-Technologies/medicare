import type { StaffUser } from '../src/api/auth'
import type { InboxNotification, NotificationPage } from '../src/api/notifications'

export const staff = (role: StaffUser['role']): StaffUser => ({ id: '44444444-4444-4444-8444-444444444444', staffNumber: 'STF-INBOX', firstName: 'Inbox', lastName: 'Staff', email: 'inbox@example.test', role, status: 'ACTIVE' })
export const appointmentNotice: InboxNotification = {
  id: 'c7e0a15e-4471-44f3-97da-f01988183f13', type: 'DIRECT', title: 'New appointment', message: 'An appointment has been assigned to you.',
  createdAt: '2026-11-04T09:00:00.000Z', target: { type: 'APPOINTMENT', id: '33333333-3333-4333-8333-333333333333' }, readAt: null,
}
export const broadcastNotice: InboxNotification = {
  id: 'd8f1b26f-5582-45a4-a8eb-a1a99a294a24', type: 'BROADCAST', title: 'Staff briefing', message: 'Please attend the operational briefing at 14:00.\nRoom 2.',
  createdAt: '2026-11-02T08:30:00.000Z', target: null, readAt: '2026-11-02T09:00:00.000Z',
}
export const readAt = '2026-11-04T12:00:00.000Z'
export const inboxPage = (items: InboxNotification[] = [appointmentNotice, broadcastNotice], page = 1, total = items.length): NotificationPage =>
  ({ items, pagination: { page, limit: 20, total, totalPages: Math.ceil(total / 20) } })
