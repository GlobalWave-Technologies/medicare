import { Router } from 'express'
import type { PrismaClient } from '../../generated/prisma/client.js'
import { requireAuth, requireCsrf, requireRole } from '../../middleware/authentication.js'
import { authContext } from '../auth/auth.context.js'
import { activeStaff, activityEvents, staffActivity } from './activity.service.js'
import { activityQuerySchema, staffActivityParamsSchema, staffActivityQuerySchema } from './activity.validation.js'

// Administrators only, enforced here on the server. Responses are never cached and carry no
// session tokens, credentials, addresses, browsers, clinical text or patient identifiers.
export function staffActivityRoutes(db: PrismaClient, origin: string) {
  const router = Router()
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next() })
  router.use(requireAuth(db), requireRole('ADMIN'), requireCsrf(origin))
  router.get('/active', async (_req, res) => res.json({ success: true, data: await activeStaff(db) }))
  router.get('/events', async (req, res) => res.json({ success: true, data: await activityEvents(db, activityQuerySchema.parse(req.query)) }))
  router.get('/staff/:id', async (req, res) => {
    const { id } = staffActivityParamsSchema.parse(req.params)
    res.json({ success: true, data: await staffActivity(db, id, staffActivityQuerySchema.parse(req.query), authContext(req).sessionId) })
  })
  return router
}
