import type { PrismaClient } from '../../generated/prisma/client.js'

export function listEligibleAppointmentClinicians(
  db: PrismaClient,
) {
  return db.staffUser.findMany({
    where: {
      role: 'DOCTOR_IN_CHARGE',
      status: 'ACTIVE',
    },

    select: {
      id: true,
      staffNumber: true,
      firstName: true,
      lastName: true,
    },

    orderBy: [
      {
        lastName: 'asc',
      },
      {
        firstName: 'asc',
      },
      {
        id: 'asc',
      },
    ],
  })
}