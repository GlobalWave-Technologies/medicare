import { Router } from 'express'
import type { PrismaClient } from '../../generated/prisma/client.js'
import { requireAuth, requireCsrf } from '../../middleware/authentication.js'
import { requirePermission } from '../../middleware/authorization.js'
import { authContext, auditContext } from '../auth/auth.context.js'
import { idempotencyScope, markReplay } from '../../shared/idempotency/idempotency.js'
import { toAdmissionDetail, toAdmissionSummary } from './admission.dto.js'
import { admissionIdSchema, admissionQuerySchema, changeRoomSchema, createAdmissionSchema, dischargeSchema } from './admission.validation.js'
import { admissionFingerprint, admitPatient, changeRoom, dischargeAdmission, getAdmission, listAdmissions, type AdmissionResult } from './admission.service.js'

const body = ({ value, clinical }: AdmissionResult) => ({ success: true, data: { admission: toAdmissionDetail(value, clinical) } })

export function admissionRoutes(db: PrismaClient, origin: string) {
  const router = Router()
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next() })
  router.use(requireAuth(db), requireCsrf(origin))
  router.post('/', requirePermission('ADMISSION_CREATE'), async (req, res) => {
    const auth = authContext(req), input = createAdmissionSchema.parse(req.body)
    const scope = idempotencyScope(req, auth.principal.id, 'ADMISSION_CREATE', admissionFingerprint(input))
    const { value, replayed, clinical } = await admitPatient(db, auth, auditContext(req), input, scope)
    markReplay(req, res, scope, replayed)
    res.status(201).json(body({ value, clinical }))
  })
  router.get('/', requirePermission('ADMISSION_READ'), async (req, res) => {
    const result = await listAdmissions(db, admissionQuerySchema.parse(req.query))
    res.json({ success: true, data: { items: result.items.map(toAdmissionSummary), pagination: result.pagination } })
  })
  router.get('/:id', requirePermission('ADMISSION_READ'), async (req, res) => {
    res.json(body(await getAdmission(db, authContext(req), auditContext(req), admissionIdSchema.parse(req.params).id)))
  })
  router.post('/:id/room', requirePermission('ADMISSION_UPDATE'), async (req, res) => {
    const id = admissionIdSchema.parse(req.params).id
    res.json(body(await changeRoom(db, authContext(req), auditContext(req), id, changeRoomSchema.parse(req.body))))
  })
  router.post('/:id/discharge', requirePermission('ADMISSION_DISCHARGE'), async (req, res) => {
    const id = admissionIdSchema.parse(req.params).id
    res.json(body(await dischargeAdmission(db, authContext(req), auditContext(req), id, dischargeSchema.parse(req.body ?? {}))))
  })
  return router
}
