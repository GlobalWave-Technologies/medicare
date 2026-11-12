import type { Encounter, EncounterSummary } from '../src/api/encounters'
import type { MedicationOption } from '../src/api/medications'
import { admission, admittedPatient, clinician, patient } from './admission-fixtures'
export { patient, clinician, admission, admittedPatient }
export { doctor } from './admission-fixtures'
export const encounter: Encounter = {
  id: '44444444-4444-4444-8444-444444444444', reference: 'MR-SERVER', status: 'DRAFT',
  patient: { id: patient.id, patientNumber: patient.patientNumber, firstName: patient.firstName, middleName: patient.middleName, lastName: patient.lastName },
  clinician, author: clinician, admission: { id: admission.id, admissionNumber: admission.admissionNumber }, appointment: null,
  occurredAt: '2026-11-01T10:00:23.123Z', reviewedAt: null, createdAt: '2026-11-01T10:00:23.123Z', updatedAt: '2026-11-01T10:00:23.123Z',
  roomLabel: 'Room A', historySummary: 'History\nSecond line', clinicalNotes: 'Original clinical notes', treatmentPlan: 'Original treatment plan', followUpAt: '2026-11-02T10:00:00Z', voidedAt: null, voidReason: null,
  complaints: [{ id: 'complaint-id', description: 'Example complaint', createdAt: '2026-11-01T10:00:23.123Z' }],
  diagnoses: [{ id: 'diagnosis-id', description: 'Example diagnosis', code: 'LOCAL-1', notes: 'Diagnosis note', createdAt: '2026-11-01T10:00:23.123Z' }],
  medications: [{ id: 'medication-id', medicationId: 'catalog-paracetamol', medicine: 'Paracetamol', strength: '500 mg', dose: '1 tablet', route: 'Oral', frequency: 'Twice daily',
    duration: '5 days', notes: 'After meals', createdAt: '2026-11-01T10:00:23.123Z' }],
  amendments: [],
}
// Active medicines as the prescribing dropdown receives them (a few of the seeded sixteen).
export const catalogOptions: MedicationOption[] = [
  { id: 'catalog-cetirizine', name: 'Cetirizine' }, { id: 'catalog-ibuprofen', name: 'Ibuprofen' }, { id: 'catalog-ors', name: 'ORS' },
  { id: 'catalog-oral-glucose', name: 'Oral glucose' }, { id: 'catalog-paracetamol', name: 'Paracetamol' }, { id: 'catalog-salbutamol-inhaler', name: 'Salbutamol inhaler' },
  { id: 'catalog-salbutamol-tab', name: 'Salbutamol tab' },
]
export const reviewed: Encounter = { ...encounter, status: 'REVIEWED', reviewedAt: '2026-11-01T11:00:00Z' }
export const summary: EncounterSummary = { id: encounter.id, reference: encounter.reference, status: encounter.status, patient: encounter.patient, clinician, author: clinician,
  admission: encounter.admission, appointment: null, occurredAt: encounter.occurredAt, reviewedAt: null, createdAt: encounter.createdAt, diagnoses: encounter.diagnoses.map(({ id, description, code }) => ({ id, description, code })) }
export const clinicalPage = { items: [summary], pagination: { page: 1, limit: 20, total: 1, totalPages: 1 } }
