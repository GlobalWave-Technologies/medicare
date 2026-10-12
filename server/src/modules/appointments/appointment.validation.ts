import { z } from 'zod'
import { AppointmentStatus, AppointmentType } from '../../generated/prisma/enums.js'
import { paginationFields } from '../../shared/utils/pagination.js'
import { timezoneTimestamp } from '../../shared/validation/timestamp.js'

// Millisecond precision matches timestamptz(3); reject offsets lacking a colon,
// ambiguous local times, leap seconds and date-only values.
export const appointmentTimestamp = timezoneTimestamp
const safeText = (max: number) => z.string().max(max).refine((value) => [...value].every((c) => {
  const n = c.codePointAt(0)!
  return n === 9 || n === 10 || n === 13 || (n >= 32 && (n < 127 || n > 159))
})).trim().transform((value) => value || null).nullable()
const editable = {
  clinicianId: z.uuid(), scheduledStart: appointmentTimestamp, scheduledEnd: appointmentTimestamp,
  type: z.enum(AppointmentType), reason: safeText(500).optional(), notes: safeText(5000).optional(),
}
export const createAppointmentSchema = z.object({ patientId: z.uuid(), ...editable }).strict()
export const updateAppointmentSchema = z.object(editable).partial().strict().refine((value) => Object.keys(value).length > 0)
export const appointmentIdSchema = z.object({ id: z.uuid() }).strict()
// Cancellation is exclusively its own permission-protected command.
export const appointmentStatusSchema = z.object({ status: z.enum(['CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'NO_SHOW']) }).strict()
export const cancelAppointmentSchema = z.object({ reason: safeText(500).optional() }).strict()
export const appointmentQuerySchema = z.object({
  ...paginationFields, status: z.enum(AppointmentStatus).optional(), type: z.enum(AppointmentType).optional(),
  patientId: z.uuid().optional(), clinicianId: z.uuid().optional(),
  dateFrom: appointmentTimestamp.optional(), dateTo: appointmentTimestamp.optional(),
  search: z.string().max(200).trim().max(100).refine((value) => [...value].every((c) => {
    const n = c.codePointAt(0)!
    return n >= 32 && (n < 127 || n > 159)
  })).optional(),
}).strict().refine((value) => !value.dateFrom || !value.dateTo || Date.parse(value.dateFrom) <= Date.parse(value.dateTo))
export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>
export type UpdateAppointmentInput = z.infer<typeof updateAppointmentSchema>
export type AppointmentQuery = z.infer<typeof appointmentQuerySchema>
export type AppointmentStatusInput = z.infer<typeof appointmentStatusSchema>['status']
