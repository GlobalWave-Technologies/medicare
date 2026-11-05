import { Router } from 'express'
import type { PrismaClient } from '../../generated/prisma/client.js'
import { requireAuth, requireCsrf } from '../../middleware/authentication.js'
import { requirePermission } from '../../middleware/authorization.js'
import { authContext, auditContext } from '../auth/auth.context.js'
import { toPatientResponse } from './patient.dto.js'
import { createPatientSchema, updatePatientSchema, patientIdSchema, patientQuerySchema, patientCommandSchema } from './patient.validation.js'
import { createPatient, listPatients, getPatientById, updatePatient, archivePatient, reactivatePatient, patientFingerprint } from './patient.service.js'
import { idempotencyScope, markReplay } from '../../shared/idempotency/idempotency.js'

import { encounterHistoryParamsSchema, encounterHistoryQuerySchema } from '../encounters/encounter.validation.js'
import { listEncounters } from '../encounters/encounter.service.js'
import { toEncounterSummary } from '../encounters/encounter.dto.js'

export function patientRoutes(db: PrismaClient, origin: string) {
  const router = Router()
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next() })
  router.use(requireAuth(db), requireCsrf(origin))
  router.get('/:patientId/encounters', requirePermission('CLINICAL_RECORD_READ'), async (req, res) => {
    const result = await listEncounters(db, authContext(req), auditContext(req), encounterHistoryQuerySchema.parse(req.query),
      encounterHistoryParamsSchema.parse(req.params).patientId)
    res.json({ success: true, data: { items: result.items.map(toEncounterSummary), pagination: result.pagination } })
  })
  router.post('/', requirePermission('PATIENT_CREATE'), async (req, res) => {
    const auth = authContext(req), input = createPatientSchema.parse(req.body)
    const scope = idempotencyScope(req, auth.principal.id, 'PATIENT_CREATE', patientFingerprint(input))
    const { value, replayed } = await createPatient(db, auth, auditContext(req), input, scope)
    markReplay(req, res, scope, replayed)
    res.status(201).json({ success: true, data: { patient: toPatientResponse(value) } })
  })
  router.get('/', requirePermission('PATIENT_READ'), async (req, res) => {
    const result = await listPatients(db, patientQuerySchema.parse(req.query))
    res.json({ success: true, data: { items: result.items.map(toPatientResponse), pagination: result.pagination } })
  })
  router.get('/:id', requirePermission('PATIENT_READ'), async (req, res) => {
    const patient = await getPatientById(db, authContext(req), auditContext(req), patientIdSchema.parse(req.params).id)
    res.json({ success: true, data: { patient: toPatientResponse(patient) } })
  })
  router.patch('/:id', requirePermission('PATIENT_UPDATE'), async (req, res) => {
    const patient = await updatePatient(db, authContext(req), auditContext(req), patientIdSchema.parse(req.params).id, updatePatientSchema.parse(req.body))
    res.json({ success: true, data: { patient: toPatientResponse(patient) } })
  })
  for (const [path, command] of [['archive', archivePatient], ['reactivate', reactivatePatient]] as const) {
    router.post(`/:id/${path}`, requirePermission('PATIENT_ARCHIVE'), async (req, res) => {
      patientCommandSchema.parse(req.body ?? {})
      const patient = await command(db, authContext(req), auditContext(req), patientIdSchema.parse(req.params).id)
      res.json({ success: true, data: { patient: toPatientResponse(patient) } })
    })
  }
  return router
}
