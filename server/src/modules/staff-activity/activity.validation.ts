import { z } from 'zod'
import { StaffRole } from '../../generated/prisma/enums.js'
import { activityCategories } from './activity.labels.js'

const plain = (value: string) => [...value].every((character) => { const code = character.codePointAt(0)!; return code >= 32 && (code < 127 || code > 159) })
// At most 50 events per page: the browser never receives the audit log in bulk.
export const ACTIVITY_PAGE_LIMIT = 50
const page = z.coerce.number().int().min(1).max(10000).default(1)
const limit = z.coerce.number().int().min(1).max(ACTIVITY_PAGE_LIMIT).default(25)
export const activityPeriods = ['today', 'last7', 'last30'] as const
export type ActivityPeriod = typeof activityPeriods[number]
export const activityQuerySchema = z.object({
  page, limit,
  period: z.enum(activityPeriods).default('today'),
  category: z.enum(['all', ...activityCategories]).default('all'),
  // Staff name or staff number, of the person who acted.
  search: z.string().max(200).refine(plain).trim().max(100).optional(),
  role: z.enum(StaffRole).optional(),
}).strict()
export const staffActivityParamsSchema = z.object({ id: z.uuid() }).strict()
export const staffActivityQuerySchema = z.object({ page, limit: z.coerce.number().int().min(1).max(ACTIVITY_PAGE_LIMIT).default(20) }).strict()
export const sessionParamsSchema = z.object({ id: z.uuid(), sessionId: z.uuid() }).strict()
export const emptyCommandSchema = z.object({}).strict()
export type ActivityQuery = z.infer<typeof activityQuerySchema>
