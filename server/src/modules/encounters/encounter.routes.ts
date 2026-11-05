import { Router } from 'express'
import type { PrismaClient } from '../../generated/prisma/client.js'
import { requireAuth, requireCsrf } from '../../middleware/authentication.js'
import { requirePermission } from '../../middleware/authorization.js'
import { authContext, auditContext } from '../auth/auth.context.js'
import { toEncounterDetail, toEncounterSummary } from './encounter.dto.js'
import { createEncounterSchema, updateEncounterSchema, encounterIdSchema, encounterQuerySchema, finalizeEncounterSchema, amendEncounterSchema } from './encounter.validation.js'
import { createEncounter, listEncounters, getEncounterById, updateEncounter, finalizeEncounter, amendEncounter, encounterFingerprint } from './encounter.service.js'
import { idempotencyScope, markReplay } from '../../shared/idempotency/idempotency.js'

export function encounterRoutes(db: PrismaClient, origin: string) {
  const router = Router()
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next() })
  router.use(requireAuth(db), requireCsrf(origin))
  router.post('/', requirePermission('CLINICAL_RECORD_CREATE'), async (req, res) => {
    const auth = authContext(req), input = createEncounterSchema.parse(req.body)
    const scope = idempotencyScope(req, auth.principal.id, 'ENCOUNTER_CREATE', encounterFingerprint(input))
    const { value, replayed } = await createEncounter(db, auth, auditContext(req), input, scope)
    markReplay(req, res, scope, replayed)
    res.status(201).json({ success: true, data: { encounter: toEncounterDetail(value) } })
  })
  router.get('/', requirePermission('CLINICAL_RECORD_READ'), async (req, res) => {
    const result = await listEncounters(db, authContext(req), auditContext(req), encounterQuerySchema.parse(req.query))
    res.json({ success: true, data: { items: result.items.map(toEncounterSummary), pagination: result.pagination } })
  })
  router.get('/:id', requirePermission('CLINICAL_RECORD_READ'), async (req, res) => {
    const value = await getEncounterById(db, authContext(req), auditContext(req), encounterIdSchema.parse(req.params).id)
    res.json({ success: true, data: { encounter: toEncounterDetail(value) } })
  })
  router.patch('/:id', requirePermission('CLINICAL_RECORD_CREATE'), async (req, res) => {
    const value = await updateEncounter(db, authContext(req), auditContext(req), encounterIdSchema.parse(req.params).id, updateEncounterSchema.parse(req.body))
    res.json({ success: true, data: { encounter: toEncounterDetail(value) } })
  })
  router.post('/:id/finalize', requirePermission('CLINICAL_RECORD_CREATE'), async (req, res) => {
    finalizeEncounterSchema.parse(req.body ?? {})
    const value = await finalizeEncounter(db, authContext(req), auditContext(req), encounterIdSchema.parse(req.params).id)
    res.json({ success: true, data: { encounter: toEncounterDetail(value) } })
  })
  router.post('/:id/amend', requirePermission('CLINICAL_RECORD_AMEND'), async (req, res) => {
    const value = await amendEncounter(db, authContext(req), auditContext(req), encounterIdSchema.parse(req.params).id, amendEncounterSchema.parse(req.body))
    res.status(201).json({ success: true, data: { encounter: toEncounterDetail(value) } })
  })
  return router
}
