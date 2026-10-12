import { randomBytes, randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { PrismaClient } from '../../generated/prisma/client.js'
import { hashPassword, verifyPassword } from '../../shared/security/password.js'
import { appendAuditEvent } from '../../shared/audit/audit.js'
import { AppError } from '../../shared/errors/AppError.js'
import { emailSchema } from '../staff/staff.validation.js'
import { staffSelect } from '../staff/staff.dto.js'
import { createSession, revokeAllUserSessions, revokeSession } from './session.service.js'
import { assertCurrentActor, securityTransaction } from './security.transaction.js'
import type { AuditContext, AuthContext } from './auth.context.js'

export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(512) }).strict()
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
