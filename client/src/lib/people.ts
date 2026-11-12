import type { PatientSummary, StaffSummary } from '../api/common'

export const personName = (person: Pick<PatientSummary, 'firstName' | 'middleName' | 'lastName'>) =>
  [person.firstName, person.middleName, person.lastName].map((part) => part?.trim()).filter(Boolean).join(' ')
export const staffName = (staff: Pick<StaffSummary, 'firstName' | 'lastName'> | null | undefined) => staff ? `${staff.firstName} ${staff.lastName}` : 'Unassigned'
