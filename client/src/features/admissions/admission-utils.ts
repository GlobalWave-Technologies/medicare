import type { BackendRole } from '../../api/auth'
import type { AdmissionStatus } from '../../api/admissions'
import { ApiError, authErrorMessage } from '../../api/client'
import { localInputToISO } from '../../lib/time'

// Mirrors the server: every role admits patients and changes rooms; only Medical Officers
// (DOCTOR_IN_CHARGE) discharge and open medical records.
export const canDischarge = (role: BackendRole) => role === 'DOCTOR_IN_CHARGE'
export const canOpenMedicalRecord = (role: BackendRole) => role === 'DOCTOR_IN_CHARGE'
export const admissionStatusLabels: Record<AdmissionStatus, string> = { ADMITTED: 'Admitted', DISCHARGED: 'Discharged' }
export const ROOM_LIMIT = 100, NOTE_LIMIT = 500, DISCHARGE_NOTE_LIMIT = 5000

const printable = (value: string, multiline: boolean) => [...value].every((character) => {
  const code = character.codePointAt(0)!
  return (multiline && [9, 10, 13].includes(code)) || (code >= 32 && (code < 127 || code > 159))
})
export function roomProblem(value: string) {
  const room = value.trim()
  if (!room) return 'Enter the room, for example Room 4 or Ward A – Bed 6.'
  if (room.length > ROOM_LIMIT) return `The room allows up to ${ROOM_LIMIT} characters.`
  if (!printable(room, false)) return 'Remove unsupported characters from the room.'
  return null
}
export function textProblem(value: string, label: string, limit: number, multiline: boolean) {
  if (value.trim().length > limit) return `The ${label} allows up to ${limit.toLocaleString()} characters.`
  if (!printable(value, multiline)) return `Remove unsupported characters from the ${label}.`
  return null
}
// A datetime-local value that exists in the local zone and is not in the future (one minute's grace).
export function timeProblem(value: string, label: string, now = Date.now()) {
  const instant = localInputToISO(value)
  if (!instant) return `Enter a valid ${label}. Some times do not exist when clocks change.`
  if (Date.parse(instant) > now + 60000) return `The ${label} cannot be in the future.`
  return null
}

const errors: Record<string, string> = {
  PATIENT_ALREADY_ADMITTED: 'This patient is already admitted.',
  PATIENT_ARCHIVED: 'This patient record is archived. Reactivate it before admitting the patient.',
  PATIENT_NOT_FOUND: 'Patient not found.',
  PATIENT_CURRENTLY_ADMITTED: 'Discharge the patient before archiving the record.',
  ADMISSION_NOT_FOUND: 'Admission not found.',
  ADMISSION_DISCHARGED: 'This admission has already been discharged. Refresh to see the latest status.',
  ADMISSION_ALREADY_DISCHARGED: 'This admission has already been discharged. Refresh to see the latest status.',
  ADMISSION_NOT_CURRENT: 'This admission has been discharged. Clinical records can only be opened on a current admission.',
  ADMISSION_HAS_DRAFT_RECORDS: 'This admission has an unfinished clinical record. Finalize or complete the draft record before discharging the patient.',
  ADMISSION_OVERLAPS_PREVIOUS: 'The admission time must be after the patient’s previous discharge.',
  INVALID_ADMISSION_TIME: 'The admission time cannot be in the future.',
  INVALID_DISCHARGE_TIME: 'The discharge time must be after the admission and the latest room change, and cannot be in the future.',
  ROOM_UNCHANGED: 'The patient is already in this room.',
  ADMISSION_NUMBER_CONFLICT: 'The admission number could not be assigned. Please try again.',
  VALIDATION_ERROR: 'Check the details and try again.',
}
export function admissionError(error: unknown) {
  if (typeof error === 'string') return error
  if (error instanceof ApiError) {
    if (error.code && errors[error.code]) return errors[error.code]!
    if (error.status === 401) return 'Your session has expired. Sign in again.'
    if (error.status === 403) return 'You do not have permission to perform this admission action.'
    if (error.status === 404) return 'Admission not found.'
  }
  return authErrorMessage(error)
}
// Admission carries an idempotency key; a repeated room change is refused as unchanged; a
// discharge can only happen once. Each message says what is safe to do next.
export const unconfirmed = {
  admit: 'The admission could not be confirmed. Select Save admission again without changing anything; the patient will not be admitted twice.',
  room: 'The room change could not be confirmed. Close this and refresh the patient record to check the current room before trying again.',
  discharge: 'The discharge could not be confirmed. Close this and refresh the patient record to check its status. A patient cannot be discharged twice.',
}
export type AdmissionMutation = keyof typeof unconfirmed
export const isUnconfirmed = (error: unknown) => typeof error !== 'string' && (!(error instanceof ApiError) || error.status >= 500)
