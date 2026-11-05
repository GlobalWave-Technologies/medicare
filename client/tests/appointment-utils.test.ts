import { expect, it } from 'vitest'
import { ApiError } from '../src/api/client'
import { appointment, user } from './appointment-fixtures'
import { appointmentError, canChangeStatus, canManageAppointments, displayTime, durationLabel, formInput, formValues, isEditable, localDateRange, localInputToISO, presetRange, statusActions, toLocalInput, validateForm } from '../src/features/appointments/appointment-utils'
import { scopedQuery } from '../src/features/appointments/useAppointments'
const now = Date.parse('2026-10-29T12:00:00Z')
it.each(['ADMIN', 'RECORDS_OFFICER', 'DOCTOR_IN_CHARGE'] as const)('applies %s permissions and doctor scope', (role) => {
  expect(canManageAppointments(role)).toBe(role !== 'DOCTOR_IN_CHARGE')
  expect(canChangeStatus({ ...user, role }, appointment)).toBe(true)
  expect(canChangeStatus({ ...user, id: 'someone-else', role }, appointment)).toBe(role !== 'DOCTOR_IN_CHARGE')
  expect(scopedQuery({ clinicianId: 'other', status: 'CONFIRMED' }, role)).toEqual(role === 'DOCTOR_IN_CHARGE' ? { status: 'CONFIRMED' } : { clinicianId: 'other', status: 'CONFIRMED' })
})
it.each(['SCHEDULED', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'NO_SHOW'] as const)('offers only valid %s transitions and edit state', (status) => {
  const expected = { SCHEDULED: ['CONFIRMED', 'NO_SHOW'], CONFIRMED: ['CHECKED_IN', 'NO_SHOW'], CHECKED_IN: ['COMPLETED'], COMPLETED: [], CANCELLED: [], NO_SHOW: [] }
  expect(statusActions({ ...appointment, status }, now).map((action) => action.status)).toEqual(expected[status])
  expect(isEditable({ ...appointment, status })).toBe(['SCHEDULED', 'CONFIRMED'].includes(status))
})
it.each([-1, 0, 1])('gates no-show exactly at start (%s ms)', (offset) => expect(Boolean(statusActions(appointment, Date.parse(appointment.scheduledStart) + offset)[1]!.disabledReason)).toBe(offset < 0))
it.each([-1, 0, 1])('gates check-in exactly 60 minutes before start (%s ms)', (offset) => expect(Boolean(statusActions({ ...appointment, status: 'CONFIRMED' }, Date.parse(appointment.scheduledStart) - 3600000 + offset)[0]!.disabledReason)).toBe(offset < 0))
it('formats local display and converts a local input to a zoned API instant', () => {
  expect(displayTime(appointment.scheduledStart)).toBe(new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(appointment.scheduledStart)))
  expect(localInputToISO(toLocalInput(appointment.scheduledStart))).toBe(appointment.scheduledStart)
  expect(durationLabel(appointment.scheduledStart, appointment.scheduledEnd)).toBe('30 minutes')
})
it.each(['', '2026-02-30T12:00', '2026-13-01T12:00', '2026-10-29T25:00', '2026-10-29', '2026-10-29T12:00Z'])('rejects invalid local input %s', (input) => expect(localInputToISO(input)).toBeNull())
it('uses inclusive local calendar boundaries and Monday-based week', () => {
  const range = localDateRange('2026-10-29', '2026-10-29')!
  expect(toLocalInput(range.dateFrom)).toBe('2026-10-29T00:00')
  expect(toLocalInput(range.dateTo)).toBe('2026-10-29T23:59')
  expect(range.dateTo.endsWith('59.999Z')).toBe(true)
  expect(localDateRange('2026-10-30', '2026-10-29')).toBeNull()
  expect(presetRange('all', now)).toEqual({})
  expect(toLocalInput(presetRange('week', now).dateFrom!).slice(0, 10)).toBe('2026-10-26')
  expect(presetRange('today', now)).toEqual(range)
})
it.each([4, 5, 720, 721])('enforces duration boundary %s minutes', (minutes) => {
  const values = formValues({ ...appointment, scheduledEnd: new Date(Date.parse(appointment.scheduledStart) + minutes * 60000).toISOString() })
  expect(validateForm(values, undefined, now) === null).toBe(minutes >= 5 && minutes <= 720)
})
it('keeps exact unchanged timestamps and only sends text changes for past edits', () => {
  const old = { ...appointment, scheduledStart: '2026-01-01T10:00:23.456Z', scheduledEnd: '2026-01-01T10:30:23.456Z' }
  const values = { ...formValues(old), notes: 'Correction' }
  expect(formInput(values, old)).toEqual({ notes: 'Correction' })
  expect(validateForm(values, old, now)).toBeNull()
  expect(validateForm({ ...values, clinicianId: 'another' }, old, now)).toContain('past')
})
it('blocks missing clinician, reversed time, past booking, oversized text and empty patch', () => {
  const values = formValues(appointment)
  expect(validateForm({ ...values, clinicianId: '' }, undefined, now)).toContain('doctor')
  expect(validateForm({ ...values, end: values.start }, undefined, now)).toContain('duration')
  expect(validateForm(values, undefined, now + 86400000)).toContain('past')
  expect(validateForm({ ...values, notes: 'x'.repeat(5001) }, undefined, now)).toContain('5,000')
  expect(validateForm(values, appointment, now)).toBe('No changes to save.')
})
it.each(['APPOINTMENT_NOT_FOUND', 'APPOINTMENT_CONFLICT', 'APPOINTMENT_IN_PAST', 'INVALID_APPOINTMENT_TIME', 'INVALID_APPOINTMENT_STATUS_TRANSITION', 'APPOINTMENT_NOT_EDITABLE', 'APPOINTMENT_REFERENCE_CONFLICT', 'PATIENT_ARCHIVED', 'PATIENT_NOT_FOUND', 'CLINICIAN_NOT_FOUND', 'CLINICIAN_NOT_ACTIVE', 'INVALID_CLINICIAN_ROLE'])('maps %s safely without raw backend information', (code) => {
  const message = appointmentError(new ApiError(409, 'SECRET backend detail', code))
  expect(message).not.toContain('SECRET'); expect(message).not.toContain('Unable to contact')
})
it('has safe 401, 403, hidden 404 and network feedback', () => {
  expect(appointmentError(new ApiError(401, 'raw'))).toContain('expired')
  expect(appointmentError(new ApiError(403, 'raw'))).toContain('permission')
  expect(appointmentError(new ApiError(404, 'other doctor'))).toBe('Appointment not found.')
  expect(appointmentError(new Error('internal'))).toContain('Unable to contact')
})
