import { z } from 'zod'
import { NotificationType, StaffRole } from '../../generated/prisma/enums.js'
import { paginationFields } from '../../shared/utils/pagination.js'

// Plain text only. Reject angle brackets instead of attempting HTML sanitization.
const plainText = (max: number) => z.string().max(max).refine((value) => !/[<>]/u.test(value)
  && [...value].every((c) => [9, 10, 13].includes(c.codePointAt(0)!)
    || (c.codePointAt(0)! >= 32 && (c.codePointAt(0)! < 127 || c.codePointAt(0)! > 159)))).trim().min(1)
export const broadcastSchema = z.object({
  title: plainText(150), message: plainText(2000),
  audience: z.discriminatedUnion('type', [z.object({ type: z.literal('ALL') }).strict(),
    z.object({ type: z.literal('ROLE'), role: z.enum(StaffRole) }).strict()]),
}).strict()
export const notificationQuerySchema = z.object({ ...paginationFields,
  read: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  type: z.enum(NotificationType).optional(),
}).strict()
export const notificationIdSchema = z.object({ id: z.uuid() }).strict()
export const notificationEmptySchema = z.object({}).strict()
export type BroadcastInput = z.infer<typeof broadcastSchema>
export type NotificationQuery = z.infer<typeof notificationQuerySchema>
