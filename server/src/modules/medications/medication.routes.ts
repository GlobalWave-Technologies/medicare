import { Router } from 'express'
import { z } from 'zod'
import type { PrismaClient } from '../../generated/prisma/client.js'
import { requireAuth, requireCsrf } from '../../middleware/authentication.js'
import { requirePermission } from '../../middleware/authorization.js'
import { authContext, auditContext } from '../auth/auth.context.js'
import { toMedication, toMedicationOption } from './medication.dto.js'
import { createMedicationSchema, medicationIdSchema, medicationQuerySchema } from './medication.validation.js'
import { createMedication, deactivateMedication, listMedicationOptions, listMedications, reactivateMedication } from './medication.service.js'

const commandSchema = z.object({}).strict()

// The medication catalog. Reading it lists names only; prescriptions live in clinical records.
export function medicationRoutes(db: PrismaClient, origin: string) {
  const router = Router()
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next() })
  router.use(requireAuth(db), requireCsrf(origin))
  router.get('/', requirePermission('MEDICATION_CATALOG_READ'), async (req, res) => {
    const result = await listMedications(db, medicationQuerySchema.parse(req.query))
    res.json({ success: true, data: { items: result.items.map(toMedication), pagination: result.pagination } })
  })
  // Every active medicine, for the prescribing dropdown.
  router.get('/options', requirePermission('MEDICATION_CATALOG_READ'), async (_req, res) => {
    res.json({ success: true, data: { items: (await listMedicationOptions(db)).map(toMedicationOption) } })
  })
  router.post('/', requirePermission('MEDICATION_CATALOG_MANAGE'), async (req, res) => {
    const value = await createMedication(db, authContext(req), auditContext(req), createMedicationSchema.parse(req.body))
    res.status(201).json({ success: true, data: { medication: toMedication(value) } })
  })
  for (const [path, command] of [['deactivate', deactivateMedication], ['reactivate', reactivateMedication]] as const) {
    router.post(`/:id/${path}`, requirePermission('MEDICATION_CATALOG_MANAGE'), async (req, res) => {
      commandSchema.parse(req.body ?? {})
      const value = await command(db, authContext(req), auditContext(req), medicationIdSchema.parse(req.params).id)
      res.json({ success: true, data: { medication: toMedication(value) } })
    })
  }
  return router
}
