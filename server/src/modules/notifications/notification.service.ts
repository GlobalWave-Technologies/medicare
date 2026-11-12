import { Prisma, type PrismaClient } from '../../generated/prisma/client.js'
import type { AuthContext, AuditContext } from '../auth/auth.context.js'
import { assertCurrentActor } from '../auth/security.transaction.js'
import { assertPermission, type Permission } from '../../shared/authorization/permissions.js'
import { appendAuditEvent } from '../../shared/audit/audit.js'
import { AppError } from '../../shared/errors/AppError.js'
import { paginationWindow } from '../../shared/utils/pagination.js'
import { idempotent, type IdempotencyScope } from '../../shared/idempotency/idempotency.js'
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
export function broadcastNotification(db: PrismaClient, auth: AuthContext, context: AuditContext, input: BroadcastInput, idempotency?: IdempotencyScope) {
  return write(db, auth, 'NOTIFICATION_BROADCAST', false, (tx) => idempotent(tx, idempotency, async (stored) => ({
    // Content and deliveries are immutable, so a replay reports exactly what was sent.
    notification: await tx.notification.findUniqueOrThrow({ where: { id: stored.notificationId! }, select: notificationSelect }),
    recipientCount: await tx.notificationRecipient.count({ where: { notificationId: stored.notificationId! } }),
  }), async () => {
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
    return { value: { notification: value, recipientCount: recipients.length }, resource: { notificationId: value.id } }
  }))
}
