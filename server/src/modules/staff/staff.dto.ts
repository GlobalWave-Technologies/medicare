import type { Prisma } from '../../generated/prisma/client.js'

export const staffSelect = {
  id: true, staffNumber: true, firstName: true, lastName: true,
  email: true, role: true, status: true,
} satisfies Prisma.StaffUserSelect

// The signed-in identity adds one safe credential-state flag. Staff administration responses
// never carry it, and no other credential metadata is ever selected for a principal.
export const principalSelect = { ...staffSelect, mustChangePassword: true } satisfies Prisma.StaffUserSelect

// Staff & Access also shows when each person last signed in and last used the system.
export const staffDirectorySelect = { ...staffSelect, lastLoginAt: true, lastActivityAt: true } satisfies Prisma.StaffUserSelect

export type StaffRecord = Prisma.StaffUserGetPayload<{ select: typeof staffSelect }>
export type AuthPrincipal = Prisma.StaffUserGetPayload<{ select: typeof principalSelect }>
