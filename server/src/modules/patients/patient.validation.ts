import { z } from 'zod'
import { paginationFields } from '../../shared/utils/pagination.js'

const noControls = (value: string) => [...value].every((character) => {
  const code = character.codePointAt(0)!
  return code >= 32 && (code < 127 || code > 159)
})
const name = z.string().max(300).refine(noControls).trim().min(1).max(100)
const optionalName = z.union([name, z.string().max(300).refine(noControls).trim().length(0).transform(() => null), z.null()])

// Formatting only; never infer a country code or remove national leading zeroes.
export function normalizePhone(value: string) {
  const compact = value.replace(/[ ().-]/g, '')
  return compact.startsWith('00') ? `+${compact.slice(2)}` : compact
}

export const phoneSchema = z.string().max(64).trim().refine((value) => /^[+0-9 ().-]*$/.test(value))
  .transform((value) => value === '' ? null : normalizePhone(value))
  .refine((value) => value === null || /^(?:\+[1-9]\d{6,14}|\d{7,15})$/.test(value))

export const dateOfBirthSchema = z.string().trim().refine((value) => {
  if (value === '') return true
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    && value <= new Date().toISOString().slice(0, 10)
}).transform((value) => value || null).nullable()

export const createPatientSchema = z.object({
  firstName: name, middleName: optionalName.optional(), lastName: name,
  dateOfBirth: dateOfBirthSchema.optional(), phone: phoneSchema.nullable().optional(),
}).strict()
export const updatePatientSchema = createPatientSchema.partial().refine((value) => Object.keys(value).length > 0)
export const patientIdSchema = z.object({ id: z.uuid() }).strict()
export const patientCommandSchema = z.object({}).strict()
export const patientQuerySchema = z.object({
  ...paginationFields,
  search: z.string().max(200).refine(noControls).trim().max(100).optional(),
  archived: z.enum(['false', 'true', 'all']).default('false'),
}).strict()

export type CreatePatientInput = z.infer<typeof createPatientSchema>
export type UpdatePatientInput = z.infer<typeof updatePatientSchema>
export type PatientQuery = z.infer<typeof patientQuerySchema>
