import type { Prisma } from '../../generated/prisma/client.js'

export const patientSelect = {
  id: true, patientNumber: true, firstName: true, middleName: true, lastName: true,
  dateOfBirth: true, phone: true, archivedAt: true, createdAt: true, updatedAt: true,
} satisfies Prisma.PatientSelect
export type PatientDemographics = Prisma.PatientGetPayload<{ select: typeof patientSelect }>

export function toPatientResponse(patient: PatientDemographics) {
  return {
    id: patient.id, patientNumber: patient.patientNumber, firstName: patient.firstName,
    middleName: patient.middleName, lastName: patient.lastName,
    dateOfBirth: patient.dateOfBirth?.toISOString().slice(0, 10) ?? null,
    phone: patient.phone, archivedAt: patient.archivedAt?.toISOString() ?? null,
    createdAt: patient.createdAt.toISOString(), updatedAt: patient.updatedAt.toISOString(),
  }
}
