import { z } from 'zod'
import { AdmissionStatus } from '../../generated/prisma/enums.js'
import { paginationFields } from '../../shared/utils/pagination.js'
import { timezoneTimestamp } from '../../shared/validation/timestamp.js'

const printable = (multiline: boolean) => (value: string) => [...value].every((character) => {
  const code = character.codePointAt(0)!
  return (multiline && [9, 10, 13].includes(code)) || (code >= 32 && (code < 127 || code > 159))
})
// A room is a short free-text label such as "Room 4" or "Ward A – Bed 6"; no ward structure is imposed.
export const roomSchema = z.string().max(300).refine(printable(false)).trim().min(1).max(100)
const optionalText = (max: number, multiline: boolean) => z.string().max(max * 3).refine(printable(multiline)).trim().max(max)
  .transform((value) => value || null).nullable().optional()

export const createAdmissionSchema = z.object({
  patientId: z.uuid(), roomNumber: roomSchema, admittedAt: timezoneTimestamp.optional(),
}).strict()
export const changeRoomSchema = z.object({ roomNumber: roomSchema, note: optionalText(500, false) }).strict()
export const dischargeSchema = z.object({ dischargedAt: timezoneTimestamp.optional(), dischargeNotes: optionalText(5000, true) }).strict()
export const admissionIdSchema = z.object({ id: z.uuid() }).strict()
export const admissionQuerySchema = z.object({
  ...paginationFields, status: z.enum(AdmissionStatus).optional(), patientId: z.uuid().optional(),
  search: z.string().max(200).refine(printable(false)).trim().max(100).optional(),
}).strict()

export type CreateAdmissionInput = z.infer<typeof createAdmissionSchema>
export type ChangeRoomInput = z.infer<typeof changeRoomSchema>
export type DischargeInput = z.infer<typeof dischargeSchema>
export type AdmissionQuery = z.infer<typeof admissionQuerySchema>
