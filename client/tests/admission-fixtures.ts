import type { Admission, AdmissionSummary } from '../src/api/admissions'
import type { StaffUser } from '../src/api/auth'
import type { Patient } from '../src/api/patients'

// Synthetic people and stays for the client tests.
export const clinician = { id: '22222222-2222-4222-8222-222222222222', staffNumber: 'STF-DOCTOR', firstName: 'Grace', lastName: 'Doctor' }
export const user: StaffUser = { ...clinician, email: 'qa@example.test', role: 'ADMIN', status: 'ACTIVE', mustChangePassword: false }
export const doctor: StaffUser = { ...user, role: 'DOCTOR_IN_CHARGE' }
export const records: StaffUser = { ...user, role: 'RECORDS_OFFICER' }
export const patient: Patient = { id: '11111111-1111-4111-8111-111111111111', patientNumber: 'PT-REAL', firstName: 'Amina', middleName: null, lastName: 'Patient',
  dateOfBirth: null, phone: null, archivedAt: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', currentAdmission: null }
const patientSummary = { id: patient.id, patientNumber: patient.patientNumber, firstName: patient.firstName, middleName: patient.middleName, lastName: patient.lastName }
export const admission: AdmissionSummary = {
  id: '33333333-3333-4333-8333-333333333333', admissionNumber: 'AD-000042', status: 'ADMITTED', roomNumber: 'Ward A - Bed 6',
  admittedAt: '2026-10-29T12:30:00.000Z', dischargedAt: null, patient: patientSummary, admittedBy: clinician, dischargedBy: null,
}
export const admittedPatient: Patient = { ...patient, currentAdmission: { id: admission.id, admissionNumber: admission.admissionNumber, roomNumber: admission.roomNumber, admittedAt: admission.admittedAt } }
export const admissionDetail: Admission = { ...admission, createdAt: admission.admittedAt, updatedAt: admission.admittedAt,
  rooms: [{ id: 'room-1', roomNumber: admission.roomNumber, note: null, assignedAt: admission.admittedAt, endedAt: null, assignedBy: clinician }] }
export const discharged: AdmissionSummary = { ...admission, id: '55555555-5555-4555-8555-555555555555', admissionNumber: 'AD-000017', status: 'DISCHARGED',
  roomNumber: 'Room 4', admittedAt: '2026-09-01T08:00:00.000Z', dischargedAt: '2026-09-04T10:00:00.000Z', dischargedBy: clinician }
export const dischargedDetail: Admission = { ...discharged, createdAt: discharged.admittedAt, updatedAt: discharged.dischargedAt!, dischargeNotes: 'Synthetic discharge summary',
  rooms: [{ id: 'room-2', roomNumber: 'Room 2', note: null, assignedAt: discharged.admittedAt, endedAt: '2026-09-02T09:00:00.000Z', assignedBy: clinician },
    { id: 'room-3', roomNumber: 'Room 4', note: 'Synthetic transfer note', assignedAt: '2026-09-02T09:00:00.000Z', endedAt: discharged.dischargedAt, assignedBy: clinician }] }
export const admissionPage = (items: AdmissionSummary[] = [admission]) => ({ items, pagination: { page: 1, limit: 10, total: items.length, totalPages: items.length ? 1 : 0 } })
