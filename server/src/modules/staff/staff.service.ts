import type { z } from 'zod'
import { Prisma, type PrismaClient, type StaffStatus } from '../../generated/prisma/client.js'
import { hashPassword } from '../../shared/security/password.js'
import { appendAuditEvent } from '../../shared/audit/audit.js'
import { AppError } from '../../shared/errors/AppError.js'
import type { AuthContext, AuditContext } from '../auth/auth.context.js'
import { securityTransaction, assertCurrentActor } from '../auth/security.transaction.js'
import { revokeAllUserSessions } from '../auth/session.service.js'
import { staffSelect } from './staff.dto.js'
import { paginationWindow } from '../../shared/utils/pagination.js'
import type { createStaffSchema, roleSchema, staffQuerySchema, statusSchema } from './staff.validation.js'

const missing = () => new AppError(404, 'STAFF_NOT_FOUND', 'Staff account not found')
export const statusTransitions: Record<StaffStatus, readonly StaffStatus[]> = {
  PENDING: ['ACTIVE', 'DISABLED'], ACTIVE: ['SUSPENDED', 'DISABLED'],
  SUSPENDED: ['ACTIVE', 'DISABLED'], DISABLED: [],
}

export async function createStaff(db: PrismaClient, auth: AuthContext, context: AuditContext, input: z.infer<typeof createStaffSchema>) {
  const { password, ...identity } = input
  const passwordHash = await hashPassword(password)
  try {
    return await securityTransaction(db, async (tx) => {
      await assertCurrentActor(tx, auth, true)
      if (await tx.staffUser.findUnique({ where: { email: identity.email }, select: { id: true } })) {
        throw new AppError(409, 'EMAIL_ALREADY_EXISTS', 'Email is already assigned')
      }
      if (await tx.staffUser.findUnique({ where: { staffNumber: identity.staffNumber }, select: { id: true } })) {
        throw new AppError(409, 'STAFF_NUMBER_ALREADY_EXISTS', 'Staff number is already assigned')
      }
      const user = await tx.staffUser.create({ data: { ...identity, passwordHash,
        passwordChangedAt: new Date(), status: 'ACTIVE' }, select: staffSelect })
      await appendAuditEvent(tx, { ...context, actorId: auth.principal.id, action: 'STAFF_CREATED',
        entityType: 'STAFF_USER', entityId: user.id, metadata: { source: 'API' } })
      return user
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new AppError(409, 'STAFF_IDENTITY_CONFLICT', 'Staff identity is already assigned')
    }
    throw error
  }
}

export async function listStaff(db: PrismaClient, query: z.infer<typeof staffQuerySchema>) {
  const where = { role: query.role, status: query.status }
  const [users, total] = await Promise.all([
    db.staffUser.findMany({ where, select: staffSelect, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      ...paginationWindow(query) }), db.staffUser.count({ where }),
  ])
  return { users, pagination: { page: query.page, limit: query.limit, total } }
}

export async function getStaff(db: PrismaClient, id: string) {
  const user = await db.staffUser.findUnique({ where: { id }, select: staffSelect })
  if (!user) throw missing()
  return user
}

type StaffChange = z.infer<typeof roleSchema> | z.infer<typeof statusSchema>
export function changeStaff(db: PrismaClient, auth: AuthContext, context: AuditContext, id: string, change: StaffChange) {
  return securityTransaction(db, async (tx) => {
    await assertCurrentActor(tx, auth, true)
    const user = await tx.staffUser.findUnique({ where: { id } })
    if (!user) throw missing()
    if ('status' in change) {
      if (!statusTransitions[user.status].includes(change.status)) {
        throw new AppError(409, 'INVALID_STATUS_TRANSITION', 'Account status transition is not allowed')
      }
      if (change.status === 'ACTIVE' && !user.passwordHash) {
        throw new AppError(409, 'CREDENTIALS_REQUIRED', 'Account credentials must be provisioned before activation')
      }
    }
    const removesAdmin = ('role' in change && change.role !== 'ADMIN') || ('status' in change && change.status !== 'ACTIVE')
    if (user.role === 'ADMIN' && user.status === 'ACTIVE' && removesAdmin
      && await tx.staffUser.count({ where: { role: 'ADMIN', status: 'ACTIVE' } }) <= 1) {
      throw new AppError(409, 'LAST_ADMIN_PROTECTION', 'At least one active administrator must remain')
    }
    const updated = await tx.staffUser.update({ where: { id }, data: change, select: staffSelect })
    await revokeAllUserSessions(tx, id)
    await appendAuditEvent(tx, { ...context, actorId: auth.principal.id,
      action: 'role' in change ? 'STAFF_ROLE_CHANGED' : 'STAFF_STATUS_CHANGED',
      entityType: 'STAFF_USER', entityId: id,
      metadata: { source: 'API', changedFields: ['role' in change ? 'role' : 'status'] } })
    return updated
  })
}

export function revokeStaffSessions(db: PrismaClient, auth: AuthContext, context: AuditContext, id: string) {
  return securityTransaction(db, async (tx) => {
    await assertCurrentActor(tx, auth, true)
    if (!await tx.staffUser.findUnique({ where: { id }, select: { id: true } })) throw missing()
    await revokeAllUserSessions(tx, id)
    await appendAuditEvent(tx, { ...context, actorId: auth.principal.id, action: 'SESSION_REVOKED',
      entityType: 'STAFF_USER', entityId: id, metadata: { source: 'API' } })
  })
}
