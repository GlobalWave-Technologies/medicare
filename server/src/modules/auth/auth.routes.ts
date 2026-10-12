import { Router } from 'express'
import { rateLimit } from 'express-rate-limit'
import type { PrismaClient } from '../../generated/prisma/client.js'
import type { Environment } from '../../config/env.js'
import { requireAuth, requireCsrf, requireTrustedOrigin } from '../../middleware/authentication.js'
import { AppError } from '../../shared/errors/AppError.js'
import { authContext, auditContext } from './auth.context.js'
import { login, loginSchema, logout } from './auth.service.js'
import { clearSessionCookie, setSessionCookie } from './cookies.js'

export function authRoutes(db: PrismaClient, env: Pick<Environment, 'NODE_ENV' | 'CLIENT_ORIGIN'>) {
  const router = Router()
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next() })
  router.post('/login', rateLimit({
    windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false,
    // Proxy trust is explicitly validated at startup. Forwarding headers from
    // untrusted peers are deliberately ignored, not treated as configuration errors.
    validate: { xForwardedForHeader: false, forwardedHeader: false },
    handler: (_req, _res, next) => next(new AppError(429, 'LOGIN_RATE_LIMITED', 'Too many login attempts; try again later')),
  }), requireTrustedOrigin(env.CLIENT_ORIGIN), async (req, res) => {
    const result = await login(db, loginSchema.parse(req.body), auditContext(req))
    setSessionCookie(res, env.NODE_ENV, result.token, result.expiresAt)
    res.json({ success: true, data: { user: result.user } })
  })
  router.use(requireAuth(db), requireCsrf(env.CLIENT_ORIGIN))
  router.get('/me', (req, res) => res.json({ success: true, data: { user: authContext(req).principal } }))
  router.get('/csrf', (req, res) => res.json({ success: true, data: { csrfToken: authContext(req).csrfToken } }))
  for (const [path, all] of [['/logout', false], ['/logout-all', true]] as const) {
    router.post(path, async (req, res) => {
      await logout(db, authContext(req), auditContext(req), all)
      clearSessionCookie(res, env.NODE_ENV)
      res.json({ success: true, data: { loggedOut: true } })
    })
  }
  return router
}
