import { z } from 'zod'
import { paginationFields } from '../../shared/utils/pagination.js'

const singleLine = (value: string) => [...value].every((character) => {
  const code = character.codePointAt(0)!
  return code === 9 || (code >= 32 && (code < 127 || code > 159))
})
// A medicine name as staff see it in the dropdown: trimmed, runs of spaces made single. Case is kept
// as typed; uniqueness ignores it ("paracetamol" and "Paracetamol" are the same medicine).
export const medicationNameSchema = z.string().max(600).refine(singleLine)
  .transform((value) => value.replace(/\s+/g, ' ').trim()).pipe(z.string().min(1).max(200))

export const createMedicationSchema = z.object({ name: medicationNameSchema }).strict()
export const medicationIdSchema = z.object({ id: z.uuid() }).strict()
export const medicationQuerySchema = z.object({
  ...paginationFields,
  status: z.enum(['active', 'inactive', 'all']).default('active'),
  search: z.string().max(300).refine(singleLine).transform((value) => value.replace(/\s+/g, ' ').trim()).pipe(z.string().max(100)).optional(),
}).strict()

export type CreateMedicationInput = z.infer<typeof createMedicationSchema>
export type MedicationQuery = z.infer<typeof medicationQuerySchema>
