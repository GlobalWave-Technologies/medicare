import { timingSafeEqual } from 'node:crypto'
import type { RequestHandler } from 'express'
import type { PrismaClient, StaffRole } from '../generated/prisma/client.js'
import { findValidSession, recordActivity, tokenPattern } from '../modules/auth/session.service.js'
import { readSessionCookie } from '../modules/auth/cookies.js'
import { authContext, authenticationRequired } from '../modules/auth/auth.context.js'
import { AppError } from '../shared/errors/AppError.js'

// Pages that refresh themselves mark those requests, so an open but unattended screen does not
// make its user look active. The header only lowers what is recorded; it grants nothing.
export const BACKGROUND_HEADER = 'x-background-refresh'

// Every protected route refuses a session whose account still holds a temporary
// (administrator-issued) password. Only the account's own auth routes opt in, so a new router
// is restricted by default and the requirement cannot be bypassed by calling the API directly.
export function requireAuth(db: PrismaClient, { allowTemporaryPassword = false }: { allowTemporaryPassword?: boolean } = {}): RequestHandler {
  return async (req, _res, next) => {
    const session = await findValidSession(db, readSessionCookie(req))
    if (!session) throw authenticationRequired()
    req.auth = { principal: session.staffUser, sessionId: session.id, csrfToken: session.csrfToken }
    if (session.staffUser.mustChangePassword && !allowTemporaryPassword) {
      throw new AppError(403, 'PASSWORD_CHANGE_REQUIRED', 'Change your temporary password to continue')
    }
    // Recording activity is best effort: it must never refuse or delay the person's own request.
    if (req.get(BACKGROUND_HEADER) !== '1') {
      await recordActivity(db, session).catch(() => req.log?.warn({ code: 'ACTIVITY_NOT_RECORDED', requestId: req.id }, 'Staff activity was not recorded'))
    }
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
