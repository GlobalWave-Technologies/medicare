import { z } from 'zod'
import type { AuditAction, AuditEntityType, Prisma } from '../../generated/prisma/client.js'

const metadataSchema = z.object({
  source: z.enum(['CLI', 'API', 'SYSTEM']),
  audience: z.enum(['ALL', 'ROLE']).optional(),
  recipientCount: z.number().int().min(1).max(10000).optional(),
  changedFields: z.array(z.enum(['role', 'status', 'demographics', 'schedule', 'clinicalRecord', 'readAt'])).max(6).optional(),
}).strict().refine((value) => (value.audience === undefined) === (value.recipientCount === undefined))

export interface AuditInput {
  actorId?: string
  action: AuditAction
  entityType: AuditEntityType
  entityId: string
  requestId?: string
  ipAddress?: string
  userAgent?: string
  metadata: z.input<typeof metadataSchema>
}

// Use inside the same transaction as the change being recorded.
export function appendAuditEvent(transaction: Prisma.TransactionClient, input: AuditInput) {
  const metadata = metadataSchema.safeParse(input.metadata)
  if (!metadata.success) throw new Error('Invalid audit metadata')
  return transaction.auditEvent.create({ data: { ...input, metadata: metadata.data } })
}
