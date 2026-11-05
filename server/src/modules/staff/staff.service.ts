import { createHash } from 'node:crypto'
import type { z } from 'zod'
import { Prisma, type PrismaClient, type StaffStatus } from '../../generated/prisma/client.js'
import { hashPassword } from '../../shared/security/password.js'
import { appendAuditEvent } from '../../shared/audit/audit.js'
import { AppError } from '../../shared/errors/AppError.js'
import type { AuthContext, AuditContext } from '../auth/auth.context.js'
import { securityTransaction, assertCurrentActor } from '../auth/security.transaction.js'
import { revokeAllUserSessions } from '../auth/session.service.js'
import { staffSelect, type AuthPrincipal } from './staff.dto.js'
import { idempotent, type IdempotencyScope, type IdempotentResult } from '../../shared/idempotency/idempotency.js'
import { paginationWindow } from '../../shared/utils/pagination.js'
import type { createStaffSchema, roleSchema, staffQuerySchema, statusSchema } from './staff.validation.js'

const missing = () => new AppError(404, 'STAFF_NOT_FOUND', 'Staff account not found')
export const statusTransitions: Record<StaffStatus, readonly StaffStatus[]> = {
  PENDING: ['ACTIVE', 'DISABLED'], ACTIVE: ['SUSPENDED', 'DISABLED'],
  SUSPENDED: ['ACTIVE', 'DISABLED'], DISABLED: [],
}

// The retry fingerprint covers every accepted field, but only a digest of the password: the
// stored request hash is an HMAC keyed by the raw Idempotency-Key, which is never stored.
export function staffFingerprint(input: z.infer<typeof createStaffSchema>) {
  const { password, ...identity } = input
  return { ...identity, passwordDigest: createHash('sha256').update(password).digest('hex') }
}

export async function createStaff(db: PrismaClient, auth: AuthContext, context: AuditContext, input: z.infer<typeof createStaffSchema>,
  idempotency?: IdempotencyScope): Promise<IdempotentResult<AuthPrincipal>> {
  const { password, ...identity } = input
  const passwordHash = await hashPassword(password)
  try {
    return await securityTransaction(db, async (tx) => {
      await assertCurrentActor(tx, auth, true)
      return idempotent(tx, idempotency,
        // A resent creation returns the account it created, before the duplicate checks would refuse it.
        (stored) => tx.staffUser.findUniqueOrThrow({ where: { id: stored.staffUserId! }, select: staffSelect }),
        async () => {
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
          return { value: user, resource: { staffUserId: user.id } }
        })
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

// An administrator sets new credentials without learning the old password. Every session the
// account holds is signed out. A pending account keeps its status: activation stays a separate step.
export async function resetStaffPassword(db: PrismaClient, auth: AuthContext, context: AuditContext, id: string, password: string) {
  if (id === auth.principal.id) {
    throw new AppError(409, 'SELF_PASSWORD_RESET', 'Use Change password to change your own password')
  }
  const passwordHash = await hashPassword(password)
  return securityTransaction(db, async (tx) => {
    await assertCurrentActor(tx, auth, true)
    const user = await tx.staffUser.findUnique({ where: { id }, select: { status: true } })
    if (!user) throw missing()
    if (user.status === 'DISABLED') {
      throw new AppError(409, 'ACCOUNT_DISABLED', 'A disabled account cannot be given new credentials')
    }
    const updated = await tx.staffUser.update({ where: { id }, data: { passwordHash, passwordChangedAt: new Date() }, select: staffSelect })
    await revokeAllUserSessions(tx, id)
    await appendAuditEvent(tx, { ...context, actorId: auth.principal.id, action: 'PASSWORD_RESET',
      entityType: 'STAFF_USER', entityId: id, metadata: { source: 'API' } })
    return updated
  })
}
