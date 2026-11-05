import { z } from 'zod'
import { passwordSchema } from '../../shared/security/passwordPolicy.js'
import { StaffRole, StaffStatus } from '../../generated/prisma/client.js'
import { paginationFields } from '../../shared/utils/pagination.js'

export const staffNumberSchema = z.string().trim().toUpperCase().regex(/^STF-[A-Z0-9]{6,32}$/)
const name = z.string().trim().min(1).max(100).refine((value) =>
  [...value].every((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127))
export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email())

export const bootstrapAdminSchema = z.object({
  firstName: name,
  lastName: name,
  email: emailSchema,
  staffNumber: staffNumberSchema,
  password: passwordSchema,
}).strict()

export const createStaffSchema = bootstrapAdminSchema.extend({ role: z.enum(StaffRole) }).strict()
export const roleSchema = z.object({ role: z.enum(StaffRole) }).strict()
export const statusSchema = z.object({ status: z.enum(StaffStatus) }).strict()
export const staffIdSchema = z.object({ id: z.uuid() }).strict()
export const resetPasswordSchema = z.object({ password: passwordSchema }).strict()
export const staffQuerySchema = z.object({
  ...paginationFields,
  role: z.enum(StaffRole).optional(), status: z.enum(StaffStatus).optional(),
}).strict()
