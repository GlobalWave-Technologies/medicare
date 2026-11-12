import { Router } from 'express'
import type { PrismaClient } from '../../generated/prisma/client.js'
import { requireAuth } from '../../middleware/authentication.js'
import { requirePermission } from '../../middleware/authorization.js'
import { authContext } from '../auth/auth.context.js'
import { dashboardQuerySchema, reportQuerySchema } from './report.validation.js'
import { getDashboardForPrincipal, getPatientReport, getAdmissionReport } from './report.service.js'

function authenticatedRouter(db: PrismaClient) {
  const router = Router()
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next() })
  router.use(requireAuth(db))
  return router
}
export function dashboardRoutes(db: PrismaClient) {
  const router = authenticatedRouter(db)
  router.get('/', async (req, res) => {
    res.json({ success: true, data: await getDashboardForPrincipal(db, authContext(req), dashboardQuerySchema.parse(req.query)) })
  })
  return router
}
export function reportRoutes(db: PrismaClient) {
  const router = authenticatedRouter(db)
  router.get('/patients', requirePermission('REPORT_OPERATIONAL_VIEW'), async (req, res) => {
    res.json({ success: true, data: await getPatientReport(db, authContext(req), reportQuerySchema.parse(req.query)) })
  })
  router.get('/admissions', requirePermission('REPORT_OPERATIONAL_VIEW'), async (req, res) => {
    res.json({ success: true, data: await getAdmissionReport(db, authContext(req), reportQuerySchema.parse(req.query)) })
  })
  return router
}
