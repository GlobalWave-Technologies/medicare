import { Router } from 'express'
import type { PrismaClient } from '../../generated/prisma/client.js'
import type { Environment } from '../../config/env.js'
import { requireAuth, requireRole, requireCsrf } from '../../middleware/authentication.js'
import { authContext, auditContext } from '../auth/auth.context.js'
import { clearSessionCookie } from '../auth/cookies.js'
import { idempotencyScope, markReplay } from '../../shared/idempotency/idempotency.js'
import { createStaffSchema, resetPasswordSchema, roleSchema, staffIdSchema, staffQuerySchema, statusSchema } from './staff.validation.js'
import { changeStaff, createStaff, getStaff, listStaff, resetStaffPassword, revokeStaffSessions, staffFingerprint } from './staff.service.js'

export function staffRoutes(db: PrismaClient, env: Pick<Environment, 'NODE_ENV' | 'CLIENT_ORIGIN'>) {
  const router = Router()
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next() })
  router.use(requireAuth(db), requireRole('ADMIN'), requireCsrf(env.CLIENT_ORIGIN))
  router.post('/', async (req, res) => {
    const auth = authContext(req), input = createStaffSchema.parse(req.body)
    const scope = idempotencyScope(req, auth.principal.id, 'STAFF_CREATE', staffFingerprint(input))
    const { value: user, replayed } = await createStaff(db, auth, auditContext(req), input, scope)
    markReplay(req, res, scope, replayed)
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
  router.post('/:id/reset-password', async (req, res) => {
    const id = staffIdSchema.parse(req.params).id
    const user = await resetStaffPassword(db, authContext(req), auditContext(req), id, resetPasswordSchema.parse(req.body).password)
    res.json({ success: true, data: { user } })
  })
  router.delete('/:id/sessions', async (req, res) => {
    const id = staffIdSchema.parse(req.params).id
    await revokeStaffSessions(db, authContext(req), auditContext(req), id)
    if (id === authContext(req).principal.id) clearSessionCookie(res, env.NODE_ENV)
    res.json({ success: true, data: { revoked: true } })
  })
  return router
}
