import { Router } from 'express'
import type { PrismaClient } from '../../generated/prisma/client.js'
import type { Environment } from '../../config/env.js'
import { requireAuth, requireRole, requireCsrf } from '../../middleware/authentication.js'
import { authContext, auditContext } from '../auth/auth.context.js'
import { clearSessionCookie } from '../auth/cookies.js'
import { createStaffSchema, roleSchema, staffIdSchema, staffQuerySchema, statusSchema } from './staff.validation.js'
import { changeStaff, createStaff, getStaff, listStaff, revokeStaffSessions } from './staff.service.js'

export function staffRoutes(db: PrismaClient, env: Pick<Environment, 'NODE_ENV' | 'CLIENT_ORIGIN'>) {
  const router = Router()
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next() })
  router.use(requireAuth(db), requireRole('ADMIN'), requireCsrf(env.CLIENT_ORIGIN))
  router.post('/', async (req, res) => {
    const user = await createStaff(db, authContext(req), auditContext(req), createStaffSchema.parse(req.body))
    res.status(201).json({ success: true, data: { user } })
  })
  router.get('/', async (req, res) => res.json({ success: true, data: await listStaff(db, staffQuerySchema.parse(req.query)) }))
  router.get('/:id', async (req, res) => res.json({ success: true,
    data: { user: await getStaff(db, staffIdSchema.parse(req.params).id) } }))
  for (const [path, schema] of [['role', roleSchema], ['status', statusSchema]] as const) {
    router.patch(`/:id/${path}`, async (req, res) => {
      const id = staffIdSchema.parse(req.params).id
      const user = await changeStaff(db, authContext(req), auditContext(req), id, schema.parse(req.body))
      if (id === authContext(req).principal.id) clearSessionCookie(res, env.NODE_ENV)
      res.json({ success: true, data: { user } })
    })
  }
  router.delete('/:id/sessions', async (req, res) => {
    const id = staffIdSchema.parse(req.params).id
    await revokeStaffSessions(db, authContext(req), auditContext(req), id)
    if (id === authContext(req).principal.id) clearSessionCookie(res, env.NODE_ENV)
    res.json({ success: true, data: { revoked: true } })
  })
  return router
}
