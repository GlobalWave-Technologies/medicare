import { Router } from 'express'
import type { PrismaClient } from '../../generated/prisma/client.js'
import { requireAuth } from '../../middleware/authentication.js'
import { requirePermission } from '../../middleware/authorization.js'
import { authContext, auditContext } from '../auth/auth.context.js'
import { dashboardQuerySchema, reportQuerySchema } from './report.validation.js'
import { getDashboardForPrincipal, getPatientReport, getAppointmentReport, getClinicalActivityReport } from './report.service.js'

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
  router.get('/appointments', requirePermission('REPORT_OPERATIONAL_VIEW'), async (req, res) => {
    res.json({ success: true, data: await getAppointmentReport(db, authContext(req), reportQuerySchema.parse(req.query)) })
  })
  router.get('/clinical-activity', requirePermission('REPORT_CLINICAL_AGGREGATE_VIEW'), async (req, res) => {
    res.json({ success: true, data: await getClinicalActivityReport(db, authContext(req), auditContext(req), reportQuerySchema.parse(req.query)) })
  })
  return router
}
