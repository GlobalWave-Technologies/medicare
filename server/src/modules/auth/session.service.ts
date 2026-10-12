import { createHash, randomBytes } from 'node:crypto'
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js'
import { staffSelect } from '../staff/staff.dto.js'

export const SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000
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
    createdAt, expiresAt: new Date(createdAt.getTime() + SESSION_LIFETIME_MS),
  } })
  return { token, session }
}

export async function findValidSession(db: SessionDatabase, token: string | undefined) {
  if (!token || !tokenPattern.test(token)) return null
  return db.staffSession.findFirst({
    where: { tokenHash: hashSessionToken(token), revokedAt: null, expiresAt: { gt: new Date() }, staffUser: { status: 'ACTIVE' } },
    select: { id: true, csrfToken: true, staffUser: { select: staffSelect } },
  })
}

export function revokeSession(db: Prisma.TransactionClient, id: string) {
  return db.staffSession.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } })
}

export function revokeAllUserSessions(db: Prisma.TransactionClient, staffUserId: string) {
  return db.staffSession.updateMany({ where: { staffUserId, revokedAt: null }, data: { revokedAt: new Date() } })
}
