import { describe, expect, it } from 'vitest'
import { hasPermission, permissions } from '../src/shared/authorization/permissions.js'
import { createPatientSchema, updatePatientSchema, patientQuerySchema, dateOfBirthSchema, phoneSchema } from '../src/modules/patients/patient.validation.js'

describe('domain permission policy', () => {
  for (const role of ['ADMIN', 'RECORDS_OFFICER', 'DOCTOR_IN_CHARGE'] as const) {
    it.each(permissions.filter((permission) => !permission.startsWith('APPOINTMENT_')))(`${role}: %s`, (permission) => {
      const reportPermissions = {
        DASHBOARD_VIEW_ADMIN: role === 'ADMIN', DASHBOARD_VIEW_RECORDS: role === 'RECORDS_OFFICER',
        DASHBOARD_VIEW_CLINICAL: role === 'DOCTOR_IN_CHARGE', REPORT_OPERATIONAL_VIEW: role !== 'DOCTOR_IN_CHARGE',
        REPORT_CLINICAL_AGGREGATE_VIEW: role === 'DOCTOR_IN_CHARGE',
      }
      const expected = permission in reportPermissions ? reportPermissions[permission as keyof typeof reportPermissions] : permission.startsWith('NOTIFICATION_')
        ? permission !== 'NOTIFICATION_BROADCAST' || role === 'ADMIN'
        : role === 'DOCTOR_IN_CHARGE' ? permission === 'PATIENT_READ' || permission.startsWith('CLINICAL_RECORD_')
          : permission.startsWith('PATIENT_')
      expect(hasPermission(role, permission)).toBe(expected)
    })
  }
})

describe('patient validation', () => {
  it.each(['2025-02-29', '2026-02-30', '2026-04-31', '2026-13-01', '2026-00-01', '0000-01-01',
    '1990-1-1', '1990-01-01T00:00:00Z', 'not-date', '9999-01-01'])('rejects invalid DOB %s', (value) => {
    expect(dateOfBirthSchema.safeParse(value).success).toBe(false)
  })
  it.each(['2000-02-29', '0001-01-01', '1880-01-01', new Date().toISOString().slice(0, 10)])('accepts calendar DOB %s', (value) => {
    expect(dateOfBirthSchema.parse(value)).toBe(value)
  })
  it.each([['+233 (24) 123-4567', '+233241234567'], ['00233 24 1234567', '+233241234567'],
    ['024 123 4567', '0241234567'], ['+44 20 7946 0958', '+442079460958'], ['+1 (212) 555-0123', '+12125550123']])(
    'normalizes phone %s without country guessing', (value, expected) => expect(phoneSchema.parse(value)).toBe(expected))
  it.each(['123', '+0123456789', '+233+241234567', 'phone12345678', '1234567890123456', '01234567 ext 2', '()', '---'])('rejects malformed phone %s', (value) => {
    expect(phoneSchema.safeParse(value).success).toBe(false)
  })
  it('preserves legitimate name spelling and internal spacing', () => {
    expect(createPatientSchema.parse({ firstName: '  Ési  Ama ', middleName: ' 李 ', lastName: " O’Neill-Ababio " }))
      .toEqual({ firstName: 'Ési  Ama', middleName: '李', lastName: 'O’Neill-Ababio' })
  })
  it.each(['', '   ', null])('normalizes empty optional fields %j to null', (value) => {
    expect(createPatientSchema.parse({ firstName: 'Ama', lastName: 'Synthetic', middleName: value, dateOfBirth: value, phone: value }))
      .toMatchObject({ middleName: null, dateOfBirth: null, phone: null })
  })
  it('preserves omitted update fields and rejects an empty PATCH', () => {
    expect(updatePatientSchema.parse({ phone: '' })).toEqual({ phone: null })
    expect(updatePatientSchema.safeParse({}).success).toBe(false)
  })
  it.each(['email', 'sex', 'bloodGroup', 'residentialAddress', 'age', 'createdBy', 'createdById', 'patientNumber', 'archivedAt', 'id', 'updatedAt', 'createdAt', 'encounters'])('rejects unmodeled/immutable field %s', (field) => {
    expect(createPatientSchema.safeParse({ firstName: 'Ama', lastName: 'Synthetic', [field]: 'injected' }).success).toBe(false)
    expect(updatePatientSchema.safeParse({ [field]: 'injected' }).success).toBe(false)
  })
  it.each(['', ' '.repeat(3), 'A'.repeat(101), 'Name\nInjected', 'Name\u0000Injected', 'Name\u0085Injected'])('rejects invalid required names %j', (value) => {
    expect(createPatientSchema.safeParse({ firstName: value, lastName: 'Synthetic' }).success).toBe(false)
  })
  it.each([{ page: '0' }, { limit: '101' }, { page: '1.5' }, { archived: 'yes' }, { sort: 'passwordHash' },
    { search: { contains: 'x' } }, { search: 'a'.repeat(101) }, { role: 'ADMIN' }])('rejects unsafe list query %j', (value) => {
    expect(patientQuerySchema.safeParse(value).success).toBe(false)
  })
})
