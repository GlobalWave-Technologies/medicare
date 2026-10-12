import { Prisma, type PrismaClient } from '../../generated/prisma/client.js'
import { hashPassword } from '../../shared/security/password.js'
import { appendAuditEvent } from '../../shared/audit/audit.js'
import { bootstrapAdminSchema } from './staff.validation.js'

export class BootstrapError extends Error {
  readonly code: string
  constructor(code: string) {
    super(code)
    this.name = 'BootstrapError'
    this.code = code
  }
}

export async function bootstrapAdmin(prisma: PrismaClient, input: unknown) {
  const parsed = bootstrapAdminSchema.safeParse(input)
  if (!parsed.success) throw new BootstrapError('INVALID_ADMIN_INPUT')
  const { password, ...identity } = parsed.data
  // Expensive hashing happens before the lock and never enters a log object.
  const passwordHash = await hashPassword(password)
  try {
    return await prisma.$transaction(async (transaction) => {
      // One shared lock serializes independent bootstrap processes. READ COMMITTED
      // ensures the loser sees the winning transaction's newly committed admin.
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(1296385106, 1)`
      if (await transaction.staffUser.findUnique({ where: { email: identity.email }, select: { id: true } })) {
        throw new BootstrapError('DUPLICATE_EMAIL')
      }
      if (await transaction.staffUser.findUnique({ where: { staffNumber: identity.staffNumber }, select: { id: true } })) {
        throw new BootstrapError('DUPLICATE_STAFF_NUMBER')
      }
      if (await transaction.staffUser.findFirst({ where: { role: 'ADMIN' }, select: { id: true } })
        || await transaction.auditEvent.findFirst({ where: { action: 'ADMIN_BOOTSTRAPPED' }, select: { id: true } })) {
        throw new BootstrapError('ADMIN_ALREADY_EXISTS')
      }
      const admin = await transaction.staffUser.create({
        data: { ...identity, passwordHash, passwordChangedAt: new Date(), role: 'ADMIN', status: 'ACTIVE' },
        select: { id: true, staffNumber: true },
      })
      await appendAuditEvent(transaction, {
        actorId: admin.id, action: 'ADMIN_BOOTSTRAPPED', entityType: 'STAFF_USER', entityId: admin.id,
        metadata: { source: 'CLI' },
      })
      return admin
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 10000 })
  } catch (error) {
    if (error instanceof BootstrapError) throw error
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new BootstrapError('DUPLICATE_IDENTITY')
    }
    throw new BootstrapError('BOOTSTRAP_FAILED')
  }
}
