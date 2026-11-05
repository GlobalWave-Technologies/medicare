import { createHash, createHmac } from 'node:crypto'
import type { Request, Response } from 'express'
import type { IdempotentOperation, Prisma, PrismaClient } from '../../generated/prisma/client.js'
import { AppError } from '../errors/AppError.js'

export const IDEMPOTENCY_HEADER = 'Idempotency-Key'
export const IDEMPOTENCY_RETENTION_MS = 24 * 60 * 60 * 1000
const keyPattern = /^[A-Za-z0-9_-]{16,128}$/

export interface IdempotencyScope {
  principalId: string
  operation: IdempotentOperation
  keyHash: string
  requestHash: string
}
export type IdempotentResource = { patientId: string } | { encounterId: string } | { notificationId: string }
export type StoredResource = { patientId: string | null; encounterId: string | null; notificationId: string | null }
export interface IdempotentResult<T> { value: T; replayed: boolean }

// Sorted keys and dropped undefined values make the fingerprint independent of
// JSON property order and of fields the server treats as absent.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value instanceof Date) return value.toISOString()
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([key, item]) => [key, canonical(item)]))
  }
  return value
}

// Absent header: the request runs unprotected, as before. A supplied header must be valid.
// `accepted` must be the validated, normalized input the service will actually write.
export function idempotencyScope(req: Request, principalId: string, operation: IdempotentOperation, accepted: object): IdempotencyScope | undefined {
  const key = req.get(IDEMPOTENCY_HEADER)
  if (key === undefined) return undefined
  if (!keyPattern.test(key)) {
    throw new AppError(400, 'INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key must be 16 to 128 letters, digits, hyphens or underscores')
  }
  return {
    principalId, operation,
    keyHash: createHash('sha256').update(key).digest('hex'),
    // Keyed by the raw key, which is never stored, so a stored digest cannot be
    // matched against guessed patient, clinical or broadcast content.
    requestHash: createHmac('sha256', key).update(JSON.stringify(canonical(accepted))).digest('hex'),
  }
}

// Run inside the mutation's transaction after the actor and permission checks, so a
// replay never bypasses current authentication, authorization or CSRF.
export async function idempotent<T>(tx: Prisma.TransactionClient, scope: IdempotencyScope | undefined,
  replay: (stored: StoredResource) => Promise<T>, create: () => Promise<{ value: T; resource: IdempotentResource }>): Promise<IdempotentResult<T>> {
  if (scope) {
    // A concurrent request with the same scope waits here until the first commits or rolls back.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(1296385108, hashtext(${`${scope.principalId}:${scope.operation}:${scope.keyHash}`}))`
    const stored = await tx.idempotencyRecord.findUnique({
      where: { principalId_operation_keyHash: { principalId: scope.principalId, operation: scope.operation, keyHash: scope.keyHash } },
      select: { id: true, requestHash: true, expiresAt: true, patientId: true, encounterId: true, notificationId: true },
    })
    if (stored && stored.expiresAt > new Date()) {
      if (stored.requestHash !== scope.requestHash) {
        throw new AppError(409, 'IDEMPOTENCY_KEY_REUSED', 'This request key has already been used for a different operation.')
      }
      return { value: await replay(stored), replayed: true }
    }
    if (stored) await tx.idempotencyRecord.delete({ where: { id: stored.id } })
  }
  const { value, resource } = await create()
  if (scope) {
    await tx.idempotencyRecord.create({ data: { principalId: scope.principalId, operation: scope.operation,
      keyHash: scope.keyHash, requestHash: scope.requestHash, ...resource,
      expiresAt: new Date(Date.now() + IDEMPOTENCY_RETENTION_MS) }, select: { id: true } })
  }
  return { value, replayed: false }
}

export function markReplay(req: Request, res: Response, scope: IdempotencyScope | undefined, replayed: boolean) {
  if (!scope || !replayed) return
  res.setHeader('Idempotency-Replayed', 'true')
  req.log.info({ requestId: req.id, operation: scope.operation, idempotencyReplayed: true }, 'Idempotent request replayed')
}

export async function pruneExpiredIdempotencyRecords(db: PrismaClient, now = new Date()) {
  return (await db.idempotencyRecord.deleteMany({ where: { expiresAt: { lte: now } } })).count
}
