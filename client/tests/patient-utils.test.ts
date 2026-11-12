import { describe, expect, it } from 'vitest'
import { ApiError } from '../src/api/client'
import { calculateAge, canManagePatients, canRegisterPatients, formatBirthDate, formInput, formValues, patientError, patientName, todayDate, validatePatientForm } from '../src/features/patients/patient-utils'

describe('patient calendar dates and display', () => {
  it.each([
    ['2000-05-10', '2026-05-09', '25 years'], ['2000-05-10', '2026-05-10', '26 years'],
    ['2000-05-10', '2026-05-11', '26 years'], ['2025-01-01', '2026-01-01', '1 year'],
    ['2026-01-01', '2026-01-01', '0 years'], ['2000-02-29', '2025-02-28', '24 years'],
    ['2000-02-29', '2025-03-01', '25 years'], ['2000-02-29', '2024-02-29', '24 years'],
    ['2027-01-01', '2026-10-28', 'Not recorded'], ['2001-02-29', '2026-10-28', 'Not recorded'],
    [null, '2026-10-28', 'Not recorded'], ['0000-01-01', '2026-10-28', 'Not recorded'],
  ])('calculates %s on %s as %s', (dob, date, result) => expect(calculateAge(dob, date)).toBe(result))
  it('keeps calendar dates unshifted, including instants across UTC boundaries', () => {
    expect(formatBirthDate('2000-01-01')).toBe('1 January 2000'); expect(formatBirthDate('1968-09-08')).toBe('8 September 1968')
    expect(todayDate(new Date('2026-01-01T23:30:00-08:00'))).toBe('2026-01-02')
    expect(formInput({ ...formValues(), dateOfBirth: '2000-01-01' }).dateOfBirth).toBe('2000-01-01')
  })
  it('joins names without optional-name gaps or splitting names', () => {
    expect(patientName({ firstName: ' Mary Ann ', middleName: null, lastName: 'van der Berg' })).toBe('Mary Ann van der Berg')
  })
})
describe('patient form contract and permissions', () => {
  const values = { firstName: ' Amina ', middleName: ' ', lastName: ' Yusuf ', dateOfBirth: '' }
  it('maps only the short registration fields, with no phone, and leaves unknown DOB optional', () => {
    expect(formInput(values)).toEqual({ firstName: 'Amina', middleName: null, lastName: 'Yusuf', dateOfBirth: null })
    expect(Object.keys(formValues()).sort()).toEqual(['dateOfBirth', 'firstName', 'lastName', 'middleName'])
    expect(validatePatientForm(values)).toBeNull()
  })
  it.each([
    { firstName: ' ' }, { lastName: '' }, { firstName: 'x'.repeat(101) }, { middleName: 'x\n' },
    { dateOfBirth: '2026-10-29' }, { dateOfBirth: '2001-02-29' }, { dateOfBirth: '0000-01-01' },
  ])('rejects invalid input %j', (fields) => expect(validatePatientForm({ ...values, ...fields }, '2026-10-28')).not.toBeNull())
  it.each([['ADMIN', true], ['RECORDS_OFFICER', true], ['DOCTOR_IN_CHARGE', false]] as const)('maps %s management rights; every role registers', (role, result) => {
    expect(canManagePatients(role)).toBe(result); expect(canRegisterPatients(role)).toBe(true)
  })
  it('explains that an admitted patient must be discharged before archiving', () => {
    expect(patientError(new ApiError(409, 'raw', 'PATIENT_CURRENTLY_ADMITTED'))).toBe('This patient is currently admitted. Discharge the patient before archiving the record.')
  })
  it('does not echo duplicate patient details or internal errors', () => {
    const message = patientError(new ApiError(409, 'private other patient', 'POSSIBLE_DUPLICATE_PATIENT'))
    expect(message).toContain('matching details'); expect(message).not.toContain('private')
    expect(patientError(new ApiError(500, 'Prisma stack'))).not.toContain('Prisma')
  })
})
