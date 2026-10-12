import type { Prisma } from '../../generated/prisma/client.js'

export const staffSelect = {
  id: true, staffNumber: true, firstName: true, lastName: true,
  email: true, role: true, status: true,
} satisfies Prisma.StaffUserSelect

export type AuthPrincipal = Prisma.StaffUserGetPayload<{ select: typeof staffSelect }>
