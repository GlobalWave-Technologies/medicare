import type { Prisma } from '../../generated/prisma/client.js'

export const appointmentSelect = {
  id: true, reference: true, scheduledStart: true, scheduledEnd: true, type: true, status: true,
  reason: true, notes: true, cancelledAt: true, cancellationReason: true, createdAt: true, updatedAt: true,
  patient: { select: { id: true, patientNumber: true, firstName: true, middleName: true, lastName: true } },
  clinician: { select: { id: true, staffNumber: true, firstName: true, lastName: true } },
} as const satisfies Prisma.AppointmentSelect
export type AppointmentDetails = Prisma.AppointmentGetPayload<{ select: typeof appointmentSelect }>

export function toAppointmentResponse(value: AppointmentDetails) {
  return {
    id: value.id, reference: value.reference,
    patient: { id: value.patient.id, patientNumber: value.patient.patientNumber, firstName: value.patient.firstName,
      middleName: value.patient.middleName, lastName: value.patient.lastName },
    clinician: value.clinician ? { id: value.clinician.id, staffNumber: value.clinician.staffNumber,
      firstName: value.clinician.firstName, lastName: value.clinician.lastName } : null,
    scheduledStart: value.scheduledStart.toISOString(), scheduledEnd: value.scheduledEnd.toISOString(),
    type: value.type, status: value.status, reason: value.reason, notes: value.notes,
    cancelledAt: value.cancelledAt?.toISOString() ?? null, cancellationReason: value.cancellationReason,
    createdAt: value.createdAt.toISOString(), updatedAt: value.updatedAt.toISOString(),
  }
}
