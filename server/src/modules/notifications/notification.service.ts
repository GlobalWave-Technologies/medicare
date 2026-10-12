import { Prisma, type PrismaClient } from '../../generated/prisma/client.js'
import type { AuthContext, AuditContext } from '../auth/auth.context.js'
import { assertCurrentActor } from '../auth/security.transaction.js'
import { assertPermission, type Permission } from '../../shared/authorization/permissions.js'
import { appendAuditEvent } from '../../shared/audit/audit.js'
import { AppError } from '../../shared/errors/AppError.js'
import { paginationWindow } from '../../shared/utils/pagination.js'
import { deliverySelect, notificationSelect } from './notification.dto.js'
import type { BroadcastInput, NotificationQuery } from './notification.validation.js'

const missing = () => new AppError(404, 'NOTIFICATION_NOT_FOUND', 'Notification not found')
function write<T>(db: PrismaClient, auth: AuthContext, permission: Permission, inbox: boolean,
  operation: (tx: Prisma.TransactionClient) => Promise<T>) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(1296385106, 1)`
    // Serialize read/read-all for one inbox; a hash collision only serializes two users.
    if (inbox) await tx.$executeRaw`SELECT pg_advisory_xact_lock(1296385107, hashtext(${auth.principal.id}))`
    assertPermission(await assertCurrentActor(tx, auth), permission)
    return operation(tx)
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 10000 })
}
// Reads use the freshly authenticated session, without a needless interactive transaction.
export async function listNotifications(db: PrismaClient, auth: AuthContext, query: NotificationQuery) {
  assertPermission(auth.principal.role, 'NOTIFICATION_READ_OWN')
  const where: Prisma.NotificationRecipientWhereInput = { staffUserId: auth.principal.id,
    readAt: query.read === undefined ? undefined : query.read ? { not: null } : null,
    notification: query.type ? { type: query.type } : undefined }
  const [items, total] = await Promise.all([
    db.notificationRecipient.findMany({ where, select: deliverySelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], ...paginationWindow(query) }),
    db.notificationRecipient.count({ where }),
  ])
  return { items, pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } }
}
export function unreadCount(db: PrismaClient, auth: AuthContext) {
  assertPermission(auth.principal.role, 'NOTIFICATION_READ_OWN')
  return db.notificationRecipient.count({ where: { staffUserId: auth.principal.id, readAt: null } })
}
export async function getNotification(db: PrismaClient, auth: AuthContext, id: string) {
  assertPermission(auth.principal.role, 'NOTIFICATION_READ_OWN')
  const value = await db.notificationRecipient.findUnique({
    where: { notificationId_staffUserId: { notificationId: id, staffUserId: auth.principal.id } }, select: deliverySelect })
  if (!value) throw missing()
  return value
}
async function databaseTime(tx: Prisma.TransactionClient) {
  const [value] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp()::timestamptz(3) AS now`
  return value!.now
}
export function markNotificationRead(db: PrismaClient, auth: AuthContext, id: string) {
  return write(db, auth, 'NOTIFICATION_MANAGE_OWN', true, async (tx) => {
    const where = { notificationId: id, staffUserId: auth.principal.id }
    const value = await tx.notificationRecipient.findFirst({ where, select: { createdAt: true } })
    if (!value) throw missing()
    const now = await databaseTime(tx)
    await tx.notificationRecipient.updateMany({ where: { ...where, readAt: null },
      data: { readAt: new Date(Math.max(now.getTime(), value.createdAt.getTime())) } })
    return tx.notificationRecipient.findFirstOrThrow({ where, select: deliverySelect })
  })
}
export function markAllNotificationsRead(db: PrismaClient, auth: AuthContext) {
  return write(db, auth, 'NOTIFICATION_MANAGE_OWN', true, async (tx) => {
    const now = await databaseTime(tx)
    const result = await tx.notificationRecipient.updateMany({
      where: { staffUserId: auth.principal.id, readAt: null, createdAt: { lte: now } }, data: { readAt: now } })
    return result.count
  })
}
export function broadcastNotification(db: PrismaClient, auth: AuthContext, context: AuditContext, input: BroadcastInput) {
  return write(db, auth, 'NOTIFICATION_BROADCAST', false, async (tx) => {
    // Bound synchronous fan-out without changing the chosen audience silently.
    const recipients = await tx.staffUser.findMany({ where: { status: 'ACTIVE',
      role: input.audience.type === 'ROLE' ? input.audience.role : undefined }, select: { id: true }, orderBy: { id: 'asc' }, take: 10001 })
    if (!recipients.length) throw new AppError(409, 'NO_NOTIFICATION_RECIPIENTS', 'No eligible notification recipients')
    if (recipients.length > 10000) throw new AppError(409, 'NOTIFICATION_AUDIENCE_TOO_LARGE', 'Notification audience exceeds synchronous delivery limit')
    const value = await tx.notification.create({ data: { senderId: auth.principal.id, type: 'BROADCAST',
      targetRole: input.audience.type === 'ROLE' ? input.audience.role : null, title: input.title, message: input.message,
      recipients: { createMany: { data: recipients.map(({ id }) => ({ staffUserId: id })) } },
    }, select: notificationSelect })
    await appendAuditEvent(tx, { ...context, actorId: auth.principal.id, action: 'NOTIFICATION_BROADCAST_CREATED',
      entityType: 'NOTIFICATION', entityId: value.id,
      metadata: { source: 'API', audience: input.audience.type, recipientCount: recipients.length } })
    return { notification: value, recipientCount: recipients.length }
  })
}

const appointmentMessages = {
  assigned: ['New appointment', 'An appointment has been assigned to you.'],
  rescheduled: ['Appointment rescheduled', 'An appointment assigned to you has been rescheduled.'],
  reassigned: ['Appointment reassigned', 'An appointment previously assigned to you has been reassigned.'],
  cancelled: ['Appointment cancelled', 'An appointment assigned to you has been cancelled.'],
} as const
// Called only inside the existing appointment transaction after its auth/patient locks.
// No notices for inactive/non-doctor historical assignees. Eligible delivery is required.
export async function createAppointmentNotification(tx: Prisma.TransactionClient, senderId: string, appointmentId: string,
  recipientId: string | null, event: keyof typeof appointmentMessages) {
  if (!recipientId) return
  const recipient = await tx.staffUser.findFirst({ where: { id: recipientId, status: 'ACTIVE', role: 'DOCTOR_IN_CHARGE' }, select: { id: true } })
  if (!recipient) return
  const [title, message] = appointmentMessages[event]
  await tx.notification.create({ data: { senderId, appointmentId, type: 'DIRECT', title, message,
    recipients: { create: { staffUserId: recipient.id } } }, select: { id: true } })
}
