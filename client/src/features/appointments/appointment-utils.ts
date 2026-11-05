import type { BackendRole, StaffUser } from '../../api/auth'
import type { Appointment, AppointmentStatus, AppointmentStatusUpdate, AppointmentType, UpdateAppointmentInput } from '../../api/appointments'
import { ApiError, authErrorMessage } from '../../api/client'

export const statusLabels: Record<AppointmentStatus, string> = { SCHEDULED: 'Scheduled', CONFIRMED: 'Confirmed', CHECKED_IN: 'Checked in', COMPLETED: 'Completed', CANCELLED: 'Cancelled', NO_SHOW: 'No-show' }
export const typeLabels: Record<AppointmentType, string> = { CONSULTATION: 'Consultation', FOLLOW_UP: 'Follow-up', ROUTINE_CHECKUP: 'Routine check-up', EMERGENCY_REVIEW: 'Emergency review' }
export const canManageAppointments = (role: BackendRole) => role === 'ADMIN' || role === 'RECORDS_OFFICER'
export const isEditable = (appointment: Appointment) => ['SCHEDULED', 'CONFIRMED'].includes(appointment.status)
export const canChangeStatus = (user: StaffUser, appointment: Appointment) => canManageAppointments(user.role) || appointment.clinician?.id === user.id
export const patientName = (patient: Appointment['patient']) => [patient.firstName, patient.middleName, patient.lastName].filter(Boolean).join(' ')
export const clinicianName = (clinician: Appointment['clinician']) => clinician ? `${clinician.firstName} ${clinician.lastName}` : 'Unassigned'
export * from './appointment-time'
import { toLocalInput, localInputToISO } from './appointment-time'
export type AppointmentFormValues = { clinicianId: string; start: string; end: string; type: AppointmentType; reason: string; notes: string }
export function formValues(appointment?: Appointment): AppointmentFormValues {
  const start = new Date(Math.ceil((Date.now() + 60000) / 900000) * 900000).toISOString()
  return { clinicianId: appointment?.clinician?.id ?? '', start: toLocalInput(appointment?.scheduledStart ?? start),
    end: toLocalInput(appointment?.scheduledEnd ?? new Date(Date.parse(start) + 1800000).toISOString()),
    type: appointment?.type ?? 'CONSULTATION', reason: appointment?.reason ?? '', notes: appointment?.notes ?? '' }
}
export function formInput(values: AppointmentFormValues, appointment?: Appointment): UpdateAppointmentInput {
  const input: UpdateAppointmentInput = {}
  if (!appointment || values.clinicianId !== appointment.clinician?.id) input.clinicianId = values.clinicianId
  if (!appointment || values.start !== toLocalInput(appointment.scheduledStart)) input.scheduledStart = localInputToISO(values.start) ?? ''
  if (!appointment || values.end !== toLocalInput(appointment.scheduledEnd)) input.scheduledEnd = localInputToISO(values.end) ?? ''
  if (!appointment || values.type !== appointment.type) input.type = values.type
  if (!appointment || (values.reason.trim() || null) !== appointment.reason) input.reason = values.reason.trim() || null
  if (!appointment || (values.notes.trim() || null) !== appointment.notes) input.notes = values.notes.trim() || null
  return input
}
export function validateForm(values: AppointmentFormValues, appointment?: Appointment, now = Date.now()): string | null {
  if (!values.clinicianId) return 'Select an active doctor.'
  const input = formInput(values, appointment)
  // Preserve exact server instants when a minute-precision input is unchanged,
  // including milliseconds and the later occurrence of a fall-back time.
  const start = input.scheduledStart ?? appointment?.scheduledStart, end = input.scheduledEnd ?? appointment?.scheduledEnd
  if (!start || !end) return 'Enter valid local start and end times. Some times do not exist when clocks change.'
  const duration = Date.parse(end) - Date.parse(start)
  if (!Number.isFinite(duration) || duration < 300000 || duration > 43200000) return 'Appointment duration must be between 5 minutes and 12 hours.'
  if ((!appointment || input.scheduledStart !== undefined || input.scheduledEnd !== undefined || input.clinicianId !== undefined) && Date.parse(start) < now - 60000) return 'Choose a start time that is not in the past.'
  if (values.reason.trim().length > 500 || values.notes.trim().length > 5000) return 'Reason allows 500 characters; scheduling notes allow 5,000.'
  if (Array.from(values.reason + values.notes).some((character) => { const code = character.charCodeAt(0); return code === 127 || (code < 32 && ![9, 10, 13].includes(code)) })) return 'Remove unsupported control characters from the text.'
  if (appointment && !Object.keys(input).length) return 'No changes to save.'
  return null
}
export function statusActions(appointment: Appointment, now: number): { status: AppointmentStatusUpdate; label: string; disabledReason?: string }[] {
  const start = Date.parse(appointment.scheduledStart)
  const noShow = { status: 'NO_SHOW' as const, label: 'Mark no-show', disabledReason: now < start ? 'Available at the scheduled start time.' : undefined }
  switch (appointment.status) {
    case 'SCHEDULED': return [{ status: 'CONFIRMED', label: 'Confirm' }, noShow]
    case 'CONFIRMED': return [{ status: 'CHECKED_IN', label: 'Check in', disabledReason: now < start - 3600000 ? 'Check-in opens 60 minutes before the start.' : undefined }, noShow]
    case 'CHECKED_IN': return [{ status: 'COMPLETED', label: 'Complete' }]
    default: return []
  }
}
const errors: Record<string, string> = {
  APPOINTMENT_NOT_FOUND: 'Appointment not found.',
  APPOINTMENT_CONFLICT: 'This time slot conflicts with another active appointment. Choose a different time or clinician. If a previous attempt to save this booking was interrupted, refresh the schedule first; it may already be booked.',
  APPOINTMENT_IN_PAST: 'This start time has already passed. Choose a later start.',
  INVALID_APPOINTMENT_TIME: 'Appointment duration must be between 5 minutes and 12 hours.',
  INVALID_APPOINTMENT_STATUS_TRANSITION: 'This action is not available for the appointment’s current status or time. Refresh the appointment and check its start time.',
  APPOINTMENT_NOT_EDITABLE: 'This appointment can no longer be edited. Refresh to see its current status.',
  APPOINTMENT_REFERENCE_CONFLICT: 'The booking reference could not be allocated. Please try again.',
  PATIENT_NOT_FOUND: 'The selected patient is no longer available. Select another active patient.',
  PATIENT_ARCHIVED: 'This patient is archived and cannot receive a new appointment. Reactivate the patient first.',
  CLINICIAN_NOT_FOUND: 'The selected clinician is no longer available. Reload doctors and select an active doctor.',
  CLINICIAN_NOT_ACTIVE: 'The selected clinician is no longer active. Reload doctors and select an active doctor.',
  INVALID_CLINICIAN_ROLE: 'The selected staff member is not an eligible doctor. Reload doctors and select an active doctor.',
}
export function appointmentError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.code && errors[error.code]) return errors[error.code]
    if (error.status === 404) return 'Appointment not found.'
    if (error.status === 401) return 'Your session has expired. Sign in again.'
  }
  return authErrorMessage(error)
}

