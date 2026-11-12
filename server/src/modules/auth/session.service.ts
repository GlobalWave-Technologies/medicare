import { createHash, randomBytes } from 'node:crypto'
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js'
import { PRUNE_BATCH_SIZE } from '../../shared/utils/prune.js'
import { principalSelect } from '../staff/staff.dto.js'

export const SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000
// Activity is written at most once a minute per session, so ordinary use costs one small update a
// minute, not one per request. "Active now" and "Recently active" are measured from it.
export const ACTIVITY_WRITE_INTERVAL_MS = 60 * 1000
export const tokenPattern = /^[a-f0-9]{64}$/
type SessionDatabase = PrismaClient | Prisma.TransactionClient

export function hashSessionToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

export async function createSession(db: Prisma.TransactionClient, staffUserId: string) {
  const token = randomBytes(32).toString('hex')
  const createdAt = new Date()
  const session = await db.staffSession.create({ data: {
    staffUserId, tokenHash: hashSessionToken(token), csrfToken: randomBytes(32).toString('hex'),
    createdAt, lastActivityAt: createdAt, expiresAt: new Date(createdAt.getTime() + SESSION_LIFETIME_MS),
  } })
  return { token, session }
}

export async function findValidSession(db: SessionDatabase, token: string | undefined) {
  if (!token || !tokenPattern.test(token)) return null
  return db.staffSession.findFirst({
    where: { tokenHash: hashSessionToken(token), revokedAt: null, expiresAt: { gt: new Date() }, staffUser: { status: 'ACTIVE' } },
    select: { id: true, csrfToken: true, lastActivityAt: true, staffUser: { select: principalSelect } },
  })
}

// Records that a signed-in person used the system: the session's and the staff member's last
// activity, in one statement, only when the stored time is at least a minute old and the session
// is still valid. Only the time is stored, never what was requested.
export async function recordActivity(db: SessionDatabase, session: { id: string; lastActivityAt: Date }, now = new Date()) {
  if (now.getTime() - session.lastActivityAt.getTime() < ACTIVITY_WRITE_INTERVAL_MS) return false
  const at = now.toISOString(), due = new Date(now.getTime() - ACTIVITY_WRITE_INTERVAL_MS).toISOString()
  const changed = await db.$executeRaw`
    WITH touched AS (
      UPDATE "StaffSession" SET "lastActivityAt" = ${at}::timestamptz
      WHERE "id" = ${session.id}::uuid AND "revokedAt" IS NULL AND "expiresAt" > ${at}::timestamptz AND "lastActivityAt" <= ${due}::timestamptz
      RETURNING "staffUserId")
    UPDATE "StaffUser" SET "lastActivityAt" = ${at}::timestamptz FROM touched
    WHERE "StaffUser"."id" = touched."staffUserId" AND ("StaffUser"."lastActivityAt" IS NULL OR "StaffUser"."lastActivityAt" < ${at}::timestamptz)`
  return changed > 0
}

export function revokeSession(db: Prisma.TransactionClient, id: string) {
  return db.staffSession.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } })
}

export function revokeAllUserSessions(db: Prisma.TransactionClient, staffUserId: string) {
  return db.staffSession.updateMany({ where: { staffUserId, revokedAt: null }, data: { revokedAt: new Date() } })
}

// Removes sessions whose expiry has passed. An expired session can never authenticate again,
// and every session expires within eight hours, so revoked sessions follow shortly after their
// revocation. Active (unexpired) sessions are never touched. Bounded batches keep each statement
// short; rerunning is safe.
export async function pruneExpiredSessions(db: PrismaClient, now = new Date()) {
  let removed = 0
  for (;;) {
    const batch = await db.staffSession.findMany({ where: { expiresAt: { lte: now } }, select: { id: true }, take: PRUNE_BATCH_SIZE })
    if (!batch.length) return removed
    removed += (await db.staffSession.deleteMany({ where: { id: { in: batch.map(({ id }) => id) }, expiresAt: { lte: now } } })).count
  }
}
