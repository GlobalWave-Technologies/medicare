import { Router } from 'express'
import type { PrismaClient } from '../../generated/prisma/client.js'
import {
  requireAuth,
  requireCsrf,
} from '../../middleware/authentication.js'
import { requirePermission } from '../../middleware/authorization.js'
import {
  authContext,
  auditContext,
} from '../auth/auth.context.js'
import { toAppointmentResponse } from './appointment.dto.js'
import {
  appointmentIdSchema,
  appointmentQuerySchema,
  appointmentStatusSchema,
  cancelAppointmentSchema,
  createAppointmentSchema,
  updateAppointmentSchema,
} from './appointment.validation.js'
import {
  cancelAppointment,
  changeAppointmentStatus,
  createAppointment,
  getAppointmentById,
  listAppointments,
  updateAppointment,
} from './appointment.service.js'
import { listEligibleAppointmentClinicians } from './appointment.lookup.js'

export function appointmentRoutes(
  db: PrismaClient,
  origin: string,
) {
  const router = Router()

  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store')
    next()
  })

  router.use(
    requireAuth(db),
    requireCsrf(origin),
  )

  /**
   * Appointment booking lookup.
   *
   * This intentionally exposes only active
   * DOCTOR_IN_CHARGE staff required by the
   * appointment booking workflow.
   *
   * IMPORTANT:
   * Keep this route above "/:id".
   */
  router.get(
    '/clinicians',
    requirePermission('APPOINTMENT_CREATE'),
    async (_req, res) => {
      const clinicians =
        await listEligibleAppointmentClinicians(db)

      res.json({
        success: true,
        data: {
          clinicians,
        },
      })
    },
  )

  router.post(
    '/',
    requirePermission('APPOINTMENT_CREATE'),
    async (req, res) => {
      const value =
        await createAppointment(
          db,
          authContext(req),
          auditContext(req),
          createAppointmentSchema.parse(
            req.body,
          ),
        )

      res.status(201).json({
        success: true,
        data: {
          appointment:
            toAppointmentResponse(
              value,
            ),
        },
      })
    },
  )

  router.get(
    '/',
    requirePermission('APPOINTMENT_READ'),
    async (req, res) => {
      const result =
        await listAppointments(
          db,
          authContext(req),
          appointmentQuerySchema.parse(
            req.query,
          ),
        )

      res.json({
        success: true,
        data: {
          items:
            result.items.map(
              toAppointmentResponse,
            ),
          pagination:
            result.pagination,
        },
      })
    },
  )

  router.get(
    '/:id',
    requirePermission('APPOINTMENT_READ'),
    async (req, res) => {
      const value =
        await getAppointmentById(
          db,
          authContext(req),
          auditContext(req),
          appointmentIdSchema.parse(
            req.params,
          ).id,
        )

      res.json({
        success: true,
        data: {
          appointment:
            toAppointmentResponse(
              value,
            ),
        },
      })
    },
  )

  router.patch(
    '/:id',
    requirePermission('APPOINTMENT_UPDATE'),
    async (req, res) => {
      const value =
        await updateAppointment(
          db,
          authContext(req),
          auditContext(req),
          appointmentIdSchema.parse(
            req.params,
          ).id,
          updateAppointmentSchema.parse(
            req.body,
          ),
        )

      res.json({
        success: true,
        data: {
          appointment:
            toAppointmentResponse(
              value,
            ),
        },
      })
    },
  )

  router.patch(
    '/:id/status',
    requirePermission(
      'APPOINTMENT_STATUS_UPDATE',
    ),
    async (req, res) => {
      const value =
        await changeAppointmentStatus(
          db,
          authContext(req),
          auditContext(req),
          appointmentIdSchema.parse(
            req.params,
          ).id,
          appointmentStatusSchema.parse(
            req.body,
          ).status,
        )

      res.json({
        success: true,
        data: {
          appointment:
            toAppointmentResponse(
              value,
            ),
        },
      })
    },
  )

  router.post(
    '/:id/cancel',
    requirePermission('APPOINTMENT_CANCEL'),
    async (req, res) => {
      const value =
        await cancelAppointment(
          db,
          authContext(req),
          auditContext(req),
          appointmentIdSchema.parse(
            req.params,
          ).id,
          cancelAppointmentSchema.parse(
            req.body ?? {},
          ).reason,
        )

      res.json({
        success: true,
        data: {
          appointment:
            toAppointmentResponse(
              value,
            ),
        },
      })
    },
  )

  return router
}