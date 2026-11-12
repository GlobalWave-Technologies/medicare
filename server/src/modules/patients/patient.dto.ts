import type { Prisma } from '../../generated/prisma/client.js'

export const patientSelect = {
  id: true, patientNumber: true, firstName: true, middleName: true, lastName: true,
  dateOfBirth: true, phone: true, archivedAt: true, createdAt: true, updatedAt: true,
  // At most one stay is current (database rule); it is shown wherever the patient is listed.
  admissions: { where: { status: 'ADMITTED' }, select: { id: true, admissionNumber: true, roomNumber: true, admittedAt: true }, take: 1 },
} satisfies Prisma.PatientSelect
export type PatientDemographics = Prisma.PatientGetPayload<{ select: typeof patientSelect }>

export function toPatientResponse(patient: PatientDemographics) {
  const current = patient.admissions[0]
  return {
    id: patient.id, patientNumber: patient.patientNumber, firstName: patient.firstName,
    middleName: patient.middleName, lastName: patient.lastName,
    dateOfBirth: patient.dateOfBirth?.toISOString().slice(0, 10) ?? null,
    phone: patient.phone, archivedAt: patient.archivedAt?.toISOString() ?? null,
    createdAt: patient.createdAt.toISOString(), updatedAt: patient.updatedAt.toISOString(),
    currentAdmission: current ? { id: current.id, admissionNumber: current.admissionNumber, roomNumber: current.roomNumber,
      admittedAt: current.admittedAt.toISOString() } : null,
  }
}
