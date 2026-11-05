import type { BackendRole } from '../../api/auth'
import { ApiError } from '../../api/client'
import type { CreatePatientInput, Patient } from '../../api/patients'

export const canManagePatients = (role: BackendRole) => role === 'ADMIN' || role === 'RECORDS_OFFICER'
export const patientName = (patient: Pick<Patient, 'firstName' | 'middleName' | 'lastName'>) =>
  [patient.firstName, patient.middleName, patient.lastName].map((part) => part?.trim()).filter(Boolean).join(' ')
// Backend validation uses the current UTC calendar date. DOB itself is never shifted.
export const todayDate = (now = new Date()) => now.toISOString().slice(0, 10)
export function isCalendarDate(value: string) {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value) || value.startsWith('0000')) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}
export function calculateAge(dob: string | null, today = todayDate()): string {
  if (!dob || !isCalendarDate(dob) || !isCalendarDate(today) || dob > today) return 'Not recorded'
  // A leap-day birthday advances on March 1 in non-leap years.
  const age = Number(today.slice(0, 4)) - Number(dob.slice(0, 4)) - (today.slice(5) < dob.slice(5) ? 1 : 0)
  return `${age} ${age === 1 ? 'year' : 'years'}`
}
export const formatBirthDate = (dob: string | null) => dob && isCalendarDate(dob)
  ? `${dob.slice(8, 10)}/${dob.slice(5, 7)}/${dob.slice(0, 4)}` : 'Not recorded'
export const formatTimestamp = (value: string) => new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(value))
export type PatientFormValues = { firstName: string; middleName: string; lastName: string; dateOfBirth: string; phone: string }
export const formValues = (patient?: Patient): PatientFormValues => ({
  firstName: patient?.firstName ?? '', middleName: patient?.middleName ?? '', lastName: patient?.lastName ?? '',
  dateOfBirth: patient?.dateOfBirth ?? '', phone: patient?.phone ?? '',
})
export const formInput = (values: PatientFormValues): CreatePatientInput => ({
  firstName: values.firstName.trim(), middleName: values.middleName.trim() || null,
  lastName: values.lastName.trim(), dateOfBirth: values.dateOfBirth || null, phone: values.phone.trim() || null,
})
// Send only fields edited in this form so a stale form cannot revert another user's change.
export function changedInput(values: PatientFormValues, initial: PatientFormValues): Partial<CreatePatientInput> {
  const next = formInput(values), previous = formInput(initial)
  return Object.fromEntries((Object.keys(next) as (keyof CreatePatientInput)[]).filter((key) => next[key] !== previous[key]).map((key) => [key, next[key]]))
}
export function validatePatientForm(values: PatientFormValues, maximumDate = todayDate()) {
  if (!values.firstName.trim() || !values.lastName.trim()) return 'First and last names are required.'
  if ([values.firstName, values.middleName, values.lastName].some((name) => name.trim().length > 100 || [...name].some((character) => {
    const code = character.codePointAt(0)!
    return code < 32 || (code >= 127 && code <= 159)
  }))) return 'Names must be at most 100 characters without control characters.'
  // DOB is optional in the real API; never invent a date for an existing patient.
  if (values.dateOfBirth && (!isCalendarDate(values.dateOfBirth) || values.dateOfBirth > maximumDate)) return 'Enter a valid date of birth on or before the allowed date.'
  const phone = values.phone.trim()
  const compact = phone.replace(/[ ().-]/g, '').replace(/^00/, '+')
  if (phone && (phone.length > 64 || !/^[+0-9 ().-]+$/.test(phone) || !/^(?:\+[1-9]\d{6,14}|\d{7,15})$/.test(compact))) return 'Enter a phone number with 7–15 digits and an optional international prefix.'
  return null
}
export function patientError(error: unknown): string {
  if (typeof error === 'string') return error
  if (!(error instanceof ApiError)) return 'Unable to contact the server. Please try again.'
  if (error.code === 'POSSIBLE_DUPLICATE_PATIENT') return 'A patient with matching details may already exist. Search all patient records, including archived patients, before registering or reactivating another patient.'
  if (error.status === 401) return 'Your session has expired. Please sign in again.'
  if (error.code === 'CSRF_INVALID') return 'Your security token needs refreshing. Please try again.'
  if (error.status === 403) return 'You do not have permission to perform this patient action.'
  if (error.status === 404) return 'Patient not found.'
  if (error.code === 'PATIENT_ARCHIVED') return 'This patient is archived. Reactivate the record before editing.'
  if (error.code === 'VALIDATION_ERROR' || error.code === 'INVALID_PATIENT_DATA') return 'Please check the patient details, including the date of birth and phone number.'
  if (error.code === 'PATIENT_IDENTIFIER_CONFLICT') return 'The patient number could not be assigned. Please try again.'
  return 'The patient request could not be completed. Please try again.'
}
