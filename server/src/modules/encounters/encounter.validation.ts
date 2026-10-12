import { z } from 'zod'
import { EncounterStatus } from '../../generated/prisma/enums.js'
import { paginationFields } from '../../shared/utils/pagination.js'
import { timezoneTimestamp } from '../../shared/validation/timestamp.js'

const text = (max: number) => z.string().max(max).refine((value) => [...value].every((c) => {
  const n = c.codePointAt(0)!
  return [9, 10, 13].includes(n) || (n >= 32 && (n < 127 || n > 159))
})).trim()
const optionalText = (max: number) => text(max).transform((value) => value || null).nullable().optional()
export const complaintSchema = z.object({ description: text(200).min(1) }).strict()
export const diagnosisSchema = z.object({ description: text(500).min(1), code: optionalText(64), notes: optionalText(5000) }).strict()
const editable = {
  occurredAt: timezoneTimestamp.optional(), roomLabel: optionalText(100), historySummary: optionalText(20000),
  clinicalNotes: optionalText(20000), treatmentPlan: optionalText(20000), followUpAt: timezoneTimestamp.nullable().optional(),
  complaints: z.array(complaintSchema).max(30).refine((values) => new Set(values.map((v) => v.description)).size === values.length).optional(),
  diagnoses: z.array(diagnosisSchema).max(30).optional(),
}
export const createEncounterSchema = z.object({ patientId: z.uuid(), appointmentId: z.uuid().nullable().optional(), ...editable }).strict()
export const updateEncounterSchema = z.object(editable).strict().refine((value) => Object.keys(value).length > 0)
export const encounterIdSchema = z.object({ id: z.uuid() }).strict()
export const encounterHistoryParamsSchema = z.object({ patientId: z.uuid() }).strict()
export const finalizeEncounterSchema = z.object({}).strict()
export const amendEncounterSchema = z.object({ reason: text(1000).min(1), content: text(20000).min(1) }).strict()
const queryFields = {
  ...paginationFields, clinicianId: z.uuid().optional(), appointmentId: z.uuid().optional(), status: z.enum(EncounterStatus).optional(),
  dateFrom: timezoneTimestamp.optional(), dateTo: timezoneTimestamp.optional(), search: text(100).optional(),
}
const ordered = (value: { dateFrom?: string; dateTo?: string }) => !value.dateFrom || !value.dateTo || Date.parse(value.dateFrom) <= Date.parse(value.dateTo)
export const encounterQuerySchema = z.object({ patientId: z.uuid().optional(), ...queryFields }).strict().refine(ordered)
export const encounterHistoryQuerySchema = z.object(queryFields).strict().refine(ordered)
export type CreateEncounterInput = z.infer<typeof createEncounterSchema>
export type UpdateEncounterInput = z.infer<typeof updateEncounterSchema>
export type EncounterQuery = z.infer<typeof encounterQuerySchema>
export type AmendmentInput = z.infer<typeof amendEncounterSchema>
