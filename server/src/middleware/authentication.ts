import { timingSafeEqual } from 'node:crypto'
import type { RequestHandler } from 'express'
import type { PrismaClient, StaffRole } from '../generated/prisma/client.js'
import { findValidSession, tokenPattern } from '../modules/auth/session.service.js'
import { readSessionCookie } from '../modules/auth/cookies.js'
import { authContext, authenticationRequired } from '../modules/auth/auth.context.js'
import { AppError } from '../shared/errors/AppError.js'

export function requireAuth(db: PrismaClient): RequestHandler {
  return async (req, _res, next) => {
    const session = await findValidSession(db, readSessionCookie(req))
    if (!session) throw authenticationRequired()
    req.auth = { principal: session.staffUser, sessionId: session.id, csrfToken: session.csrfToken }
    next()
  }
}

export function requireRole(...roles: StaffRole[]): RequestHandler {
  return (req, _res, next) => {
    if (!roles.includes(authContext(req).principal.role)) throw new AppError(403, 'FORBIDDEN', 'Permission denied')
    next()
  }
}

export function requireTrustedOrigin(origin: string): RequestHandler {
  return (req, _res, next) => {
    if (req.get('origin') !== origin) throw new AppError(403, 'ORIGIN_NOT_ALLOWED', 'Trusted Origin header is required')
    next()
  }
}

export function requireCsrf(origin: string): RequestHandler {
  return (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) { next(); return }
    requireTrustedOrigin(origin)(req, res, () => {
      const provided = req.get('x-csrf-token')
      if (!provided || !tokenPattern.test(provided)
        || !timingSafeEqual(Buffer.from(provided), Buffer.from(authContext(req).csrfToken))) {
        throw new AppError(403, 'CSRF_INVALID', 'CSRF token is invalid')
      }
      next()
    })
  }
}
