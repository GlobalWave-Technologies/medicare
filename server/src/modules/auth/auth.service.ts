import { randomBytes, randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { PrismaClient } from '../../generated/prisma/client.js'
import { hashPassword, verifyPassword } from '../../shared/security/password.js'
import { appendAuditEvent } from '../../shared/audit/audit.js'
import { AppError } from '../../shared/errors/AppError.js'
import { emailSchema } from '../staff/staff.validation.js'
import { passwordSchema } from '../../shared/security/passwordPolicy.js'
import { staffSelect } from '../staff/staff.dto.js'
import { createSession, revokeAllUserSessions, revokeSession } from './session.service.js'
import { assertCurrentActor, securityTransaction } from './security.transaction.js'
import type { AuditContext, AuthContext } from './auth.context.js'

export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(512) }).strict()
// The current password is checked as typed; the new one must meet the same policy as every password.
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(512), newPassword: passwordSchema }).strict()
let dummyHash: Promise<string> | undefined

export async function login(db: PrismaClient, input: z.infer<typeof loginSchema>, context: AuditContext) {
  // Comparable password work for unknown users and inactive accounts. Never use
  // a hardcoded shared password; the dummy hash cannot authenticate any account.
  dummyHash ??= hashPassword(randomBytes(32).toString('hex'))
  const dummy = await dummyHash
  const candidate = await db.staffUser.findUnique({ where: { email: input.email }, select: { id: true, passwordHash: true } })
  const validPassword = await verifyPassword(input.password, candidate?.passwordHash ?? dummy)
  const result = await securityTransaction(db, async (tx) => {
    const current = candidate ? await tx.staffUser.findUnique({ where: { id: candidate.id },
      select: { ...staffSelect, passwordHash: true } }) : null
    if (!validPassword || !current || current.status !== 'ACTIVE' || current.passwordHash !== candidate?.passwordHash) {
      // A random attempt identifier avoids persisting attempted email and avoids
      // falsely attributing an unauthenticated attempt to a real staff actor.
      await appendAuditEvent(tx, { ...context, action: 'LOGIN_FAILED', entityType: 'AUTH_ATTEMPT',
        entityId: randomUUID(), metadata: { source: 'API' } })
      return null
    }
    const user = await tx.staffUser.update({ where: { id: current.id }, data: { lastLoginAt: new Date() }, select: staffSelect })
    const { token, session } = await createSession(tx, user.id)
    await appendAuditEvent(tx, { ...context, actorId: user.id, action: 'LOGIN_SUCCEEDED',
      entityType: 'STAFF_USER', entityId: user.id, metadata: { source: 'API' } })
    return { user, token, expiresAt: session.expiresAt }
  })
  if (!result) throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password')
  return result
}

export function logout(db: PrismaClient, auth: AuthContext, context: AuditContext, all: boolean) {
  return securityTransaction(db, async (tx) => {
    await assertCurrentActor(tx, auth)
    if (all) await revokeAllUserSessions(tx, auth.principal.id)
    else await revokeSession(tx, auth.sessionId)
    await appendAuditEvent(tx, { ...context, actorId: auth.principal.id,
      action: all ? 'SESSION_REVOKED' : 'LOGOUT', entityType: 'STAFF_USER',
      entityId: auth.principal.id, metadata: { source: 'API' } })
  })
}

// A signed-in staff member changes their own password. Every session is signed out, including
// this one, so the new password is needed straight away. Passwords are never stored or logged.
export async function changePassword(db: PrismaClient, auth: AuthContext, context: AuditContext, input: z.infer<typeof changePasswordSchema>) {
  if (input.currentPassword === input.newPassword) {
    throw new AppError(400, 'PASSWORD_UNCHANGED', 'The new password must be different from the current password')
  }
  const stored = await db.staffUser.findUnique({ where: { id: auth.principal.id }, select: { passwordHash: true } })
  if (!stored?.passwordHash || !await verifyPassword(input.currentPassword, stored.passwordHash)) {
    throw new AppError(400, 'CURRENT_PASSWORD_INVALID', 'The current password is incorrect')
  }
  const passwordHash = await hashPassword(input.newPassword)
  await securityTransaction(db, async (tx) => {
    await assertCurrentActor(tx, auth)
    const current = await tx.staffUser.findUnique({ where: { id: auth.principal.id }, select: { passwordHash: true } })
    // A change or reset since the check above means the verified password is no longer current.
    if (current?.passwordHash !== stored.passwordHash) {
      throw new AppError(409, 'PASSWORD_CHANGED_ELSEWHERE', 'The password was changed elsewhere')
    }
    await tx.staffUser.update({ where: { id: auth.principal.id }, data: { passwordHash, passwordChangedAt: new Date() }, select: { id: true } })
    await revokeAllUserSessions(tx, auth.principal.id)
    await appendAuditEvent(tx, { ...context, actorId: auth.principal.id, action: 'PASSWORD_CHANGED',
      entityType: 'STAFF_USER', entityId: auth.principal.id, metadata: { source: 'API' } })
  })
}
