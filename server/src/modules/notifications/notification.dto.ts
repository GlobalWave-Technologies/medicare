import type { Prisma } from '../../generated/prisma/client.js'

export const notificationSelect = {
  id: true, type: true, title: true, message: true, createdAt: true, appointmentId: true,
} as const satisfies Prisma.NotificationSelect
export const deliverySelect = { readAt: true, notification: { select: notificationSelect } } as const satisfies Prisma.NotificationRecipientSelect
export type NotificationContent = Prisma.NotificationGetPayload<{ select: typeof notificationSelect }>
export function toNotificationContent(value: NotificationContent) {
  return { id: value.id, type: value.type, title: value.title, message: value.message,
    createdAt: value.createdAt.toISOString(),
    target: value.appointmentId ? { type: 'APPOINTMENT' as const, id: value.appointmentId } : null }
}
export function toInboxNotification(value: Prisma.NotificationRecipientGetPayload<{ select: typeof deliverySelect }>) {
  return { ...toNotificationContent(value.notification), readAt: value.readAt?.toISOString() ?? null }
}
