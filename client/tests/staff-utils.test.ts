import { expect, it } from 'vitest'
import { ApiError } from '../src/api/client'
import { staffRoles, staffStatuses } from '../src/api/staff'
import {
  canAdministerStaff, canChangeRole, canRevokeSessions, initials, passwordLength, roleAccess, roleLabel, staffError, staffFormProblems,
  statusActions, statusLabels, statusMeaning, statusNotice, uncertain, type StaffForm,
} from '../src/features/staff/staff-utils'
import { disabled, doctor, officer, pending, validForm } from './staff-fixtures'

const form = (overrides: Partial<StaffForm> = {}): StaffForm => ({ ...validForm, role: 'RECORDS_OFFICER', ...overrides })

it('limits staff administration to administrators', () => {
  expect(staffRoles.filter(canAdministerStaff)).toEqual(['ADMIN'])
})
it('maps every backend role and status to a readable label without raw enums', () => {
  expect(staffRoles.map(roleLabel)).toEqual(['Admin', 'Records Officer', 'Doctor in Charge'])
  expect(staffStatuses.map((status) => statusLabels[status])).toEqual(['Pending', 'Active', 'Suspended', 'Disabled'])
  for (const text of [...Object.values(roleAccess), ...Object.values(statusMeaning)]) expect(text).not.toMatch(/[A-Z]{2,}_[A-Z]/)
})
it('describes role access from the server permission matrix', () => {
  expect(roleAccess.ADMIN).toMatch(/Staff accounts.*No access to clinical records/)
  expect(roleAccess.RECORDS_OFFICER).toMatch(/No access to clinical records or staff administration/)
  expect(roleAccess.DOCTOR_IN_CHARGE).toMatch(/clinical records\. No staff administration/)
})
it('offers exactly the status transitions the server allows', () => {
  const offered = Object.fromEntries(staffStatuses.map((status) => [status, statusActions[status].map((action) => action.to)]))
  expect(offered).toEqual({ PENDING: ['ACTIVE', 'DISABLED'], ACTIVE: ['SUSPENDED', 'DISABLED'], SUSPENDED: ['ACTIVE', 'DISABLED'], DISABLED: [] })
  expect(statusActions.PENDING.map((action) => action.label)).toEqual(['Activate account', 'Disable account'])
  expect(statusActions.ACTIVE.map((action) => action.label)).toEqual(['Suspend account', 'Disable account'])
  expect(statusActions.SUSPENDED.map((action) => action.label)).toEqual(['Reactivate account', 'Disable account'])
  for (const status of staffStatuses) expect(statusActions[status].every((action) => action.to !== status)).toBe(true)
})
it('styles actions by risk: activation positive, suspension caution, disabling danger', () => {
  const tones = Object.fromEntries(staffStatuses.flatMap((status) => statusActions[status].map((action) => [action.label, action.tone])))
  expect(tones).toEqual({ 'Activate account': 'positive', 'Reactivate account': 'positive', 'Suspend account': 'caution', 'Disable account': 'danger' })
  expect(statusMeaning.DISABLED).toMatch(/can’t be reactivated/)
})
it('offers session sign-out only for active accounts and role changes for all but disabled ones', () => {
  expect([officer, doctor, pending, disabled].map(canRevokeSessions)).toEqual([true, false, false, false])
  expect([officer, doctor, pending, disabled].map(canChangeRole)).toEqual([true, true, true, false])
})
it('announces each status result from the server-returned account', () => {
  expect(statusNotice('PENDING', { ...pending, status: 'ACTIVE' })).toBe('Account activated. Pat Pending can now sign in.')
  expect(statusNotice('SUSPENDED', { ...doctor, status: 'ACTIVE' })).toBe('Account reactivated. Dara Doctor can sign in again.')
  expect(statusNotice('ACTIVE', { ...officer, status: 'SUSPENDED' })).toMatch(/^Account suspended\. Rhea Records has been signed out/)
  expect(statusNotice('ACTIVE', { ...officer, status: 'DISABLED' })).toBe('Account disabled permanently. Rhea Records has been signed out.')
})
it('builds initials from the first character of each name, including non-Latin names', () => {
  expect(initials(officer)).toBe('RR'); expect(initials({ firstName: 'élan', lastName: '𝒵eta' })).toBe('É𝒵')
})
it('accepts a complete new-account form', () => {
  expect(staffFormProblems(form())).toEqual({})
  expect(staffFormProblems(form({ staffNumber: '  stf-abc123  ' }))).toEqual({})
})
it.each([
  ['firstName', { firstName: '   ' }, 'Enter the first name.'],
  ['lastName', { lastName: 'x'.repeat(101) }, 'The last name allows up to 100 characters.'],
  ['firstName', { firstName: 'Bad\u0007Name' }, 'Remove unsupported control characters.'],
  ['email', { email: '' }, 'Enter the work email address.'],
  ['email', { email: 'not-an-email' }, 'Enter a valid email address, for example name@hospital.org.'],
  ['staffNumber', { staffNumber: '' }, 'Enter the staff number.'],
  ['staffNumber', { staffNumber: 'EMP-123456' }, 'Use STF- followed by 6 to 32 letters or digits, for example STF-A1B2C3.'],
  ['staffNumber', { staffNumber: 'STF-12345' }, 'Use STF- followed by 6 to 32 letters or digits, for example STF-A1B2C3.'],
  ['role', { role: '' }, 'Choose a role for this account.'],
  ['password', { password: '', confirmPassword: '' }, 'Enter an initial password.'],
  ['password', { password: 'short-pass', confirmPassword: 'short-pass' }, 'Use 15 to 128 characters.'],
  ['password', { password: 'x'.repeat(129), confirmPassword: 'x'.repeat(129) }, 'Use 15 to 128 characters.'],
  ['password', { password: ' '.repeat(16), confirmPassword: ' '.repeat(16) }, 'The password can’t be only spaces.'],
  ['password', { password: `${'x'.repeat(15)}\0`, confirmPassword: `${'x'.repeat(15)}\0` }, 'Remove unsupported characters from the password.'],
  ['confirmPassword', { confirmPassword: 'correct horse battery stapl' }, 'The passwords don’t match.'],
] as const)('reports %s problems before sending: %j', (field, overrides, message) => {
  expect(staffFormProblems(form(overrides))[field]).toBe(message)
})
it('counts password length in Unicode code points like the server', () => {
  const emoji = '🔐'.repeat(15)
  expect(emoji.length).toBe(30); expect(passwordLength(emoji)).toBe(15)
  expect(staffFormProblems(form({ password: emoji, confirmPassword: emoji }))).toEqual({})
  expect(staffFormProblems(form({ password: '🔐'.repeat(14), confirmPassword: '🔐'.repeat(14) })).password).toBe('Use 15 to 128 characters.')
})
it.each([
  ['STAFF_NOT_FOUND', 404, 'This staff account was not found. Return to the staff directory and refresh it.'],
  ['EMAIL_ALREADY_EXISTS', 409, 'Another staff account already uses this email address.'],
  ['STAFF_NUMBER_ALREADY_EXISTS', 409, 'This staff number is already assigned to another account.'],
  ['STAFF_IDENTITY_CONFLICT', 409, 'This email address or staff number is already assigned to another account.'],
  ['INVALID_STATUS_TRANSITION', 409, 'This status change isn’t allowed from the account’s current status. Refresh the account to see its latest status.'],
  ['CREDENTIALS_REQUIRED', 409, 'This account has no sign-in credentials yet, so it can’t be activated here.'],
  ['LAST_ADMIN_PROTECTION', 409, 'You can’t remove the last active administrator. Make another account an active Admin first.'],
  ['FORBIDDEN', 403, 'Only administrators can manage staff accounts.'],
  ['VALIDATION_ERROR', 400, 'Check the details and try again. Some information wasn’t accepted.'],
  ['CSRF_INVALID', 403, 'Your security token needs refreshing. Please try again.'],
  ['AUTHENTICATION_REQUIRED', 401, 'Your session has expired. Sign in again.'],
  ['INTERNAL_ERROR', 500, 'Unable to contact the server. Please try again.'],
] as const)('maps %s to a safe message', (code, status, message) => {
  const text = staffError(new ApiError(status, 'Raw server text: duplicate key value violates unique constraint', code, 'req-1'))
  expect(text).toBe(message); expect(text).not.toMatch(/Raw server|constraint|req-1/)
})
it('treats network failures and server errors as uncertain, and refusals as definite', () => {
  expect([new TypeError('Failed to fetch'), new ApiError(500, 'x'), new ApiError(502, 'x', 'INVALID_RESPONSE')].map(uncertain)).toEqual([true, true, true])
  expect([new ApiError(409, 'x', 'LAST_ADMIN_PROTECTION'), new ApiError(403, 'x'), new ApiError(400, 'x')].map(uncertain)).toEqual([false, false, false])
})
