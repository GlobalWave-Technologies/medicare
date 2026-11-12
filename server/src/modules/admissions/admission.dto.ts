import type { Prisma } from '../../generated/prisma/client.js'

const staffSelect = { id: true, staffNumber: true, firstName: true, lastName: true } as const
export const admissionSummarySelect = {
  id: true, admissionNumber: true, status: true, roomNumber: true, admittedAt: true, dischargedAt: true,
  patient: { select: { id: true, patientNumber: true, firstName: true, middleName: true, lastName: true } },
  admittedBy: { select: staffSelect }, dischargedBy: { select: staffSelect },
} as const satisfies Prisma.AdmissionSelect
export const admissionDetailSelect = {
  ...admissionSummarySelect, dischargeNotes: true, createdAt: true, updatedAt: true,
  rooms: { select: { id: true, roomNumber: true, note: true, assignedAt: true, endedAt: true, assignedBy: { select: staffSelect } },
    orderBy: [{ assignedAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] },
} as const satisfies Prisma.AdmissionSelect
export type AdmissionSummary = Prisma.AdmissionGetPayload<{ select: typeof admissionSummarySelect }>
export type AdmissionDetails = Prisma.AdmissionGetPayload<{ select: typeof admissionDetailSelect }>
type Staff = AdmissionSummary['admittedBy']
const staff = (value: Staff) => ({ id: value.id, staffNumber: value.staffNumber, firstName: value.firstName, lastName: value.lastName })

export function toAdmissionSummary(value: AdmissionSummary) {
  return {
    id: value.id, admissionNumber: value.admissionNumber, status: value.status, roomNumber: value.roomNumber,
    admittedAt: value.admittedAt.toISOString(), dischargedAt: value.dischargedAt?.toISOString() ?? null,
    patient: { id: value.patient.id, patientNumber: value.patient.patientNumber, firstName: value.patient.firstName,
      middleName: value.patient.middleName, lastName: value.patient.lastName },
    admittedBy: staff(value.admittedBy), dischargedBy: value.dischargedBy ? staff(value.dischargedBy) : null,
  }
}
// The discharge note is a clinical summary: only clinical readers receive the field at all.
export function toAdmissionDetail(value: AdmissionDetails, clinical: boolean) {
  return {
    ...toAdmissionSummary(value), createdAt: value.createdAt.toISOString(), updatedAt: value.updatedAt.toISOString(),
    rooms: value.rooms.map((room) => ({ id: room.id, roomNumber: room.roomNumber, note: room.note,
      assignedAt: room.assignedAt.toISOString(), endedAt: room.endedAt?.toISOString() ?? null, assignedBy: staff(room.assignedBy) })),
    ...(clinical ? { dischargeNotes: value.dischargeNotes } : {}),
  }
}
