import type { Encounter, EncounterSummary } from '../src/api/encounters'
import { appointment, clinician, patient, user } from './appointment-fixtures'
export { patient, clinician }
export const doctor = { ...user, role: 'DOCTOR_IN_CHARGE' as const }
export const eligibleAppointment = { ...appointment, status: 'CHECKED_IN' as const }
export const encounter: Encounter = {
  id: '44444444-4444-4444-8444-444444444444', reference: 'MR-SERVER', status: 'DRAFT',
  patient: { id: patient.id, patientNumber: patient.patientNumber, firstName: patient.firstName, middleName: patient.middleName, lastName: patient.lastName },
  clinician, author: clinician, appointment: { id: appointment.id, reference: appointment.reference },
  occurredAt: '2026-11-01T10:00:23.123Z', reviewedAt: null, createdAt: '2026-11-01T10:00:23.123Z', updatedAt: '2026-11-01T10:00:23.123Z',
  roomLabel: 'Room A', historySummary: 'History\nSecond line', clinicalNotes: 'Original clinical notes', treatmentPlan: 'Original treatment plan', followUpAt: '2026-11-02T10:00:00Z', voidedAt: null, voidReason: null,
  complaints: [{ id: 'complaint-id', description: 'Example complaint', createdAt: '2026-11-01T10:00:23.123Z' }],
  diagnoses: [{ id: 'diagnosis-id', description: 'Example diagnosis', code: 'LOCAL-1', notes: 'Diagnosis note', createdAt: '2026-11-01T10:00:23.123Z' }], amendments: [],
}
export const reviewed: Encounter = { ...encounter, status: 'REVIEWED', reviewedAt: '2026-11-01T11:00:00Z' }
export const summary: EncounterSummary = { id: encounter.id, reference: encounter.reference, status: encounter.status, patient: encounter.patient, clinician, author: clinician, appointment: encounter.appointment, occurredAt: encounter.occurredAt, reviewedAt: null, createdAt: encounter.createdAt, diagnoses: encounter.diagnoses.map(({ id, description, code }) => ({ id, description, code })) }
export const clinicalPage = { items: [summary], pagination: { page: 1, limit: 20, total: 1, totalPages: 1 } }
