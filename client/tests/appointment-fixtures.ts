import type { Appointment } from '../src/api/appointments'
import type { StaffUser } from '../src/api/auth'
import type { Patient } from '../src/api/patients'
export const clinician = { id: '22222222-2222-4222-8222-222222222222', staffNumber: 'STF-DOCTOR', firstName: 'Grace', lastName: 'Doctor' }
export const user: StaffUser = { ...clinician, email: 'qa@example.test', role: 'ADMIN', status: 'ACTIVE' }
export const patient: Patient = { id: '11111111-1111-4111-8111-111111111111', patientNumber: 'PT-REAL', firstName: 'Amina', middleName: null, lastName: 'Patient', dateOfBirth: null, phone: null, archivedAt: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }
export const appointment: Appointment = { id: '33333333-3333-4333-8333-333333333333', reference: 'APT-SERVER', patient, clinician, scheduledStart: '2026-10-29T12:30:00.000Z', scheduledEnd: '2026-10-29T13:00:00.000Z', type: 'CONSULTATION', status: 'SCHEDULED', reason: 'Review', notes: 'Scheduling only', cancelledAt: null, cancellationReason: null, createdAt: '2026-10-28T10:00:00Z', updatedAt: '2026-10-28T10:00:00Z' }
export const page = { items: [appointment], pagination: { page: 1, limit: 10, total: 1, totalPages: 1 } }
