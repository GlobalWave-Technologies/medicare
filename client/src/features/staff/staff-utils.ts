import type { BackendRole } from '../../api/auth'
import { ApiError, authErrorMessage } from '../../api/client'
import type { CreateStaffInput, StaffMember, StaffStatus } from '../../api/staff'
import { toUiRole } from '../../app/navigation'
import { passwordProblem } from '../../lib/password'
export { PASSWORD_MAX, PASSWORD_MIN, passwordLength } from '../../lib/password'

export const canAdministerStaff = (role: BackendRole) => role === 'ADMIN'
export const roleLabel = (role: BackendRole): string => toUiRole(role)
export const staffName = (member: Pick<StaffMember, 'firstName' | 'lastName'>) => `${member.firstName} ${member.lastName}`
export const initials = (member: Pick<StaffMember, 'firstName' | 'lastName'>) =>
  `${[...member.firstName][0] ?? ''}${[...member.lastName][0] ?? ''}`.toUpperCase()

// Mirrors the server permission matrix so administrators can see what a role change means.
export const roleAccess: Record<BackendRole, string> = {
  ADMIN: 'Staff accounts and access, patient registration, appointment scheduling and staff broadcasts. No access to clinical records.',
  RECORDS_OFFICER: 'Patient registration and appointment scheduling. No access to clinical records or staff administration.',
  DOCTOR_IN_CHARGE: 'Patient lookup, assigned appointments and clinical records. No staff administration.',
}
export const statusLabels: Record<StaffStatus, string> = { PENDING: 'Pending', ACTIVE: 'Active', SUSPENDED: 'Suspended', DISABLED: 'Disabled' }
export const statusMeaning: Record<StaffStatus, string> = {
  PENDING: 'Set up but not yet activated. This account can’t sign in until an administrator activates it.',
  ACTIVE: 'Can sign in and use the areas this role allows.',
  SUSPENDED: 'Temporarily blocked from signing in. An administrator can reactivate it.',
  DISABLED: 'Permanently blocked. Under the current system policy a disabled account can’t be reactivated.',
}

export type StatusAction = { to: StaffStatus; label: string; tone: 'positive' | 'caution' | 'danger' }
const activate: StatusAction = { to: 'ACTIVE', label: 'Activate account', tone: 'positive' }
const disable: StatusAction = { to: 'DISABLED', label: 'Disable account', tone: 'danger' }
// The same transitions the server allows; anything else is never offered.
export const statusActions: Record<StaffStatus, readonly StatusAction[]> = {
  PENDING: [activate, disable],
  ACTIVE: [{ to: 'SUSPENDED', label: 'Suspend account', tone: 'caution' }, disable],
  SUSPENDED: [{ ...activate, label: 'Reactivate account' }, disable],
  DISABLED: [],
}
// Only an ACTIVE account can hold a usable session; status changes already sign the others out.
export const canRevokeSessions = (member: StaffMember) => member.status === 'ACTIVE'
export const canChangeRole = (member: StaffMember) => member.status !== 'DISABLED'

export function statusNotice(from: StaffStatus, member: StaffMember) {
  const name = staffName(member)
  if (member.status === 'ACTIVE') return from === 'SUSPENDED' ? `Account reactivated. ${name} can sign in again.` : `Account activated. ${name} can now sign in.`
  if (member.status === 'SUSPENDED') return `Account suspended. ${name} has been signed out and can’t sign in until the account is reactivated.`
  if (member.status === 'DISABLED') return `Account disabled permanently. ${name} has been signed out.`
  return `Account status is now ${statusLabels[member.status]}.`
}

export const NAME_LIMIT = 100
export const EMAIL_LIMIT = 254
export type StaffField = keyof CreateStaffInput | 'confirmPassword'
export type StaffForm = Record<keyof CreateStaffInput, string> & { confirmPassword: string }
const printable = (value: string) => [...value].every((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
export const normalizeStaffNumber = (value: string) => value.trim().toUpperCase()

// Assists the administrator before sending; the server applies the same rules and remains authoritative.
export function staffFormProblems(form: StaffForm): Partial<Record<StaffField, string>> {
  const problems: Partial<Record<StaffField, string>> = {}
  for (const [field, label] of [['firstName', 'first name'], ['lastName', 'last name']] as const) {
    const value = form[field].trim()
    if (!value) problems[field] = `Enter the ${label}.`
    else if (value.length > NAME_LIMIT) problems[field] = `The ${label} allows up to ${NAME_LIMIT} characters.`
    else if (!printable(value)) problems[field] = 'Remove unsupported control characters.'
  }
  const email = form.email.trim()
  if (!email) problems.email = 'Enter the work email address.'
  else if (email.length > EMAIL_LIMIT || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) problems.email = 'Enter a valid email address, for example name@hospital.org.'
  if (!normalizeStaffNumber(form.staffNumber)) problems.staffNumber = 'Enter the staff number.'
  else if (!/^STF-[A-Z0-9]{6,32}$/u.test(normalizeStaffNumber(form.staffNumber))) problems.staffNumber = 'Use STF- followed by 6 to 32 letters or digits, for example STF-A1B2C3.'
  if (!form.role) problems.role = 'Choose a role for this account.'
  const password = passwordProblem(form.password, 'Enter an initial password.')
  if (password) problems.password = password
  if (!problems.password && form.confirmPassword !== form.password) problems.confirmPassword = 'The passwords don’t match.'
  return problems
}

const errors: Record<string, string> = {
  STAFF_NOT_FOUND: 'This staff account was not found. Return to the staff directory and refresh it.',
  EMAIL_ALREADY_EXISTS: 'Another staff account already uses this email address.',
  STAFF_NUMBER_ALREADY_EXISTS: 'This staff number is already assigned to another account.',
  STAFF_IDENTITY_CONFLICT: 'This email address or staff number is already assigned to another account.',
  INVALID_STATUS_TRANSITION: 'This status change isn’t allowed from the account’s current status. Refresh the account to see its latest status.',
  CREDENTIALS_REQUIRED: 'This account has no password yet. Set a password first, then activate the account.',
  ACCOUNT_DISABLED: 'A disabled account can’t be given a new password.',
  SELF_PASSWORD_RESET: 'To change your own password, use Change password in the menu. It asks for your current password.',
  IDEMPOTENCY_KEY_REUSED: 'These details changed after an unconfirmed attempt. Check the staff directory before creating the account.',
  LAST_ADMIN_PROTECTION: 'You can’t remove the last active administrator. Make another account an active Admin first.',
  FORBIDDEN: 'Only administrators can manage staff accounts.',
}
export function staffError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.code && errors[error.code]) return errors[error.code]
    if (error.status === 404) return errors.STAFF_NOT_FOUND
    if (error.status === 401) return 'Your session has expired. Sign in again.'
    if (error.code === 'VALIDATION_ERROR') return 'Check the details and try again. Some information wasn’t accepted.'
  }
  return authErrorMessage(error)
}
// Network failures and server errors leave the outcome unknown; a definite refusal does not.
export const uncertain = (error: unknown) => !(error instanceof ApiError) || error.status >= 500
