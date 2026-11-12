import type { Prisma } from '../../generated/prisma/client.js'

const staffSelect = { id: true, staffNumber: true, firstName: true, lastName: true } as const
const medicationSelect = { id: true, medicationId: true, medicine: true, strength: true, dose: true, route: true, frequency: true,
  duration: true, notes: true, createdAt: true } as const
export const encounterSummarySelect = {
  id: true, reference: true, status: true, occurredAt: true, reviewedAt: true, createdAt: true,
  patient: { select: { id: true, patientNumber: true, firstName: true, middleName: true, lastName: true } },
  clinician: { select: staffSelect }, createdBy: { select: staffSelect },
  admission: { select: { id: true, admissionNumber: true } },
  // Kept for records made before appointments were retired.
  appointment: { select: { id: true, reference: true } },
  diagnoses: { select: { id: true, description: true, code: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
} as const satisfies Prisma.EncounterSelect
export const encounterDetailSelect = {
  ...encounterSummarySelect, clinicianId: true, createdById: true,
  roomLabel: true, historySummary: true, clinicalNotes: true, treatmentPlan: true, followUpAt: true,
  updatedAt: true, voidedAt: true, voidReason: true,
  complaints: { select: { id: true, description: true, createdAt: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
  diagnoses: { select: { id: true, description: true, code: true, notes: true, createdAt: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
  medications: { select: medicationSelect, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
  amendments: { select: { id: true, reason: true, content: true, createdAt: true, author: { select: staffSelect } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
} as const satisfies Prisma.EncounterSelect
export const medicationHistorySelect = {
  ...medicationSelect,
  encounter: { select: { id: true, reference: true, status: true, occurredAt: true, reviewedAt: true, clinician: { select: staffSelect },
    admission: { select: { id: true, admissionNumber: true, status: true, admittedAt: true, dischargedAt: true } } } },
} as const satisfies Prisma.MedicationOrderSelect
export type EncounterSummary = Prisma.EncounterGetPayload<{ select: typeof encounterSummarySelect }>
export type EncounterDetails = Prisma.EncounterGetPayload<{ select: typeof encounterDetailSelect }>
export type MedicationHistoryItem = Prisma.MedicationOrderGetPayload<{ select: typeof medicationHistorySelect }>
type Medication = EncounterDetails['medications'][number]
const staff = (value: EncounterSummary['createdBy']) => ({ id: value.id, staffNumber: value.staffNumber, firstName: value.firstName, lastName: value.lastName })
// "medicine" is the name as prescribed; medicationId is null only for orders made before the catalog.
const medication = (v: Medication) => ({ id: v.id, medicationId: v.medicationId, medicine: v.medicine, strength: v.strength, dose: v.dose,
  route: v.route, frequency: v.frequency, duration: v.duration, notes: v.notes, createdAt: v.createdAt.toISOString() })

export function toEncounterSummary(value: EncounterSummary) {
  return {
    id: value.id, reference: value.reference, status: value.status, occurredAt: value.occurredAt.toISOString(),
    reviewedAt: value.reviewedAt?.toISOString() ?? null, createdAt: value.createdAt.toISOString(),
    patient: { id: value.patient.id, patientNumber: value.patient.patientNumber,
      firstName: value.patient.firstName, middleName: value.patient.middleName, lastName: value.patient.lastName },
    clinician: value.clinician ? staff(value.clinician) : null, author: staff(value.createdBy),
    admission: value.admission ? { id: value.admission.id, admissionNumber: value.admission.admissionNumber } : null,
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
    medications: value.medications.map(medication),
    amendments: value.amendments.map((v) => ({ id: v.id, reason: v.reason, content: v.content, author: staff(v.author), createdAt: v.createdAt.toISOString() })),
  }
}
export function toMedicationHistoryItem(value: MedicationHistoryItem) {
  const { encounter } = value
  return {
    ...medication(value),
    encounter: { id: encounter.id, reference: encounter.reference, status: encounter.status, occurredAt: encounter.occurredAt.toISOString(),
      reviewedAt: encounter.reviewedAt?.toISOString() ?? null, clinician: encounter.clinician ? staff(encounter.clinician) : null,
      admission: encounter.admission ? { id: encounter.admission.id, admissionNumber: encounter.admission.admissionNumber, status: encounter.admission.status,
        admittedAt: encounter.admission.admittedAt.toISOString(), dischargedAt: encounter.admission.dischargedAt?.toISOString() ?? null } : null },
  }
}
