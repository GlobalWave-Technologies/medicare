import { Prisma, type PrismaClient } from '../../generated/prisma/client.js'
import type { AuthContext } from './auth.context.js'
import { authenticationRequired } from './auth.context.js'
import { AppError } from '../../shared/errors/AppError.js'

// Same lock as bootstrap. All authentication/security writes cooperate, including
// login, logout and provisioning. Recheck the actor AFTER waiting for the lock.
export function securityTransaction<T>(db: PrismaClient, operation: (tx: Prisma.TransactionClient) => Promise<T>) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(1296385106, 1)`
    return operation(tx)
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 10000 })
}

export async function assertCurrentActor(tx: Prisma.TransactionClient, auth: AuthContext, admin = false) {
  const session = await tx.staffSession.findFirst({
    where: { id: auth.sessionId, staffUserId: auth.principal.id, revokedAt: null,
      expiresAt: { gt: new Date() }, staffUser: { status: 'ACTIVE' } },
    select: { staffUser: { select: { role: true } } },
  })
  if (!session) throw authenticationRequired()
  if (admin && session.staffUser.role !== 'ADMIN') throw new AppError(403, 'FORBIDDEN', 'Permission denied')
  return session.staffUser.role
}
