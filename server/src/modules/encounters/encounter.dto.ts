import type { Prisma } from '../../generated/prisma/client.js'

const staffSelect = { id: true, staffNumber: true, firstName: true, lastName: true } as const
export const encounterSummarySelect = {
  id: true, reference: true, status: true, occurredAt: true, reviewedAt: true, createdAt: true,
  patient: { select: { id: true, patientNumber: true, firstName: true, middleName: true, lastName: true } },
  clinician: { select: staffSelect }, createdBy: { select: staffSelect },
  appointment: { select: { id: true, reference: true } },
  diagnoses: { select: { id: true, description: true, code: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
} as const satisfies Prisma.EncounterSelect
export const encounterDetailSelect = {
  ...encounterSummarySelect, clinicianId: true, createdById: true,
  roomLabel: true, historySummary: true, clinicalNotes: true, treatmentPlan: true, followUpAt: true,
  updatedAt: true, voidedAt: true, voidReason: true,
  complaints: { select: { id: true, description: true, createdAt: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
  diagnoses: { select: { id: true, description: true, code: true, notes: true, createdAt: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
  amendments: { select: { id: true, reason: true, content: true, createdAt: true, author: { select: staffSelect } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
} as const satisfies Prisma.EncounterSelect
export type EncounterSummary = Prisma.EncounterGetPayload<{ select: typeof encounterSummarySelect }>
export type EncounterDetails = Prisma.EncounterGetPayload<{ select: typeof encounterDetailSelect }>
const staff = (value: EncounterSummary['createdBy']) => ({ id: value.id, staffNumber: value.staffNumber, firstName: value.firstName, lastName: value.lastName })

export function toEncounterSummary(value: EncounterSummary) {
  return {
    id: value.id, reference: value.reference, status: value.status, occurredAt: value.occurredAt.toISOString(),
    reviewedAt: value.reviewedAt?.toISOString() ?? null, createdAt: value.createdAt.toISOString(),
    patient: { id: value.patient.id, patientNumber: value.patient.patientNumber,
      firstName: value.patient.firstName, middleName: value.patient.middleName, lastName: value.patient.lastName },
    clinician: value.clinician ? staff(value.clinician) : null, author: staff(value.createdBy),
    appointment: value.appointment ? { id: value.appointment.id, reference: value.appointment.reference } : null,
    diagnoses: value.diagnoses.map((v) => ({ id: v.id, description: v.description, code: v.code })),
  }
}
export function toEncounterDetail(value: EncounterDetails) {
  return {
    ...toEncounterSummary(value), roomLabel: value.roomLabel, historySummary: value.historySummary,
    clinicalNotes: value.clinicalNotes, treatmentPlan: value.treatmentPlan, followUpAt: value.followUpAt?.toISOString() ?? null,
    updatedAt: value.updatedAt.toISOString(), voidedAt: value.voidedAt?.toISOString() ?? null, voidReason: value.voidReason,
    complaints: value.complaints.map((v) => ({ id: v.id, description: v.description, createdAt: v.createdAt.toISOString() })),
    diagnoses: value.diagnoses.map((v) => ({ id: v.id, description: v.description, code: v.code, notes: v.notes, createdAt: v.createdAt.toISOString() })),
    amendments: value.amendments.map((v) => ({ id: v.id, reason: v.reason, content: v.content, author: staff(v.author), createdAt: v.createdAt.toISOString() })),
  }
}
