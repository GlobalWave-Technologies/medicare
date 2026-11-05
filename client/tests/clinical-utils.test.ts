import { expect, it } from 'vitest'
import { ApiError } from '../src/api/client'
import { allowedView, navItemsByRole, toUiRole } from '../src/app/navigation'
import { canAmend, canEditDraft, canStartLinked, clinicalError, clinicalFormValues, clinicalInput, clinicalLabels, hasClinicalAccess, isClinicalAuthor, validateAmendment, validateClinical } from '../src/features/records/clinical-utils'
import { toLocalInput } from '../src/features/appointments/appointment-time'
import { doctor, eligibleAppointment, encounter, reviewed } from './clinical-fixtures'
const now = Date.parse('2026-11-01T12:00:00Z')
it.each(['ADMIN', 'RECORDS_OFFICER', 'DOCTOR_IN_CHARGE'] as const)('enforces clinical %s navigation and authored actions', (role) => {
  expect(hasClinicalAccess(role)).toBe(role === 'DOCTOR_IN_CHARGE')
  expect(navItemsByRole[toUiRole(role)].some((item) => item.label === 'Medical records')).toBe(role === 'DOCTOR_IN_CHARGE')
  expect(allowedView(role, 'Medical records') === 'Medical records').toBe(role === 'DOCTOR_IN_CHARGE')
  expect(canEditDraft({ ...doctor, role }, encounter)).toBe(role === 'DOCTOR_IN_CHARGE'); expect(canAmend({ ...doctor, role }, reviewed)).toBe(role === 'DOCTOR_IN_CHARGE')
})
it.each(['DRAFT', 'REVIEWED', 'VOIDED'] as const)('uses the actual %s status for action availability', (status) => {
  const value = { ...encounter, status }
  expect(canEditDraft(doctor, value)).toBe(status === 'DRAFT'); expect(canAmend(doctor, value)).toBe(status === 'REVIEWED'); expect(clinicalLabels[status]).toBe({ DRAFT: 'Draft', REVIEWED: 'Finalized', VOIDED: 'Voided' }[status])
})
it.each(['clinician', 'author'] as const)('requires matching %s as well as the other authorship identity', (field) => {
  const value = { ...encounter, [field]: { ...doctor, id: 'other' } }
  expect(isClinicalAuthor(doctor, value)).toBe(false)
  expect(isClinicalAuthor(doctor, { ...encounter, clinician: null })).toBe(false)
})
it.each(['SCHEDULED', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'NO_SHOW'] as const)('derives linked creation eligibility for %s', (status) => {
  expect(canStartLinked(doctor, { ...eligibleAppointment, status })).toBe(['CHECKED_IN', 'COMPLETED'].includes(status))
  expect(canStartLinked({ ...doctor, id: 'other' }, { ...eligibleAppointment, status })).toBe(false)
})
it('preserves exact unchanged timestamps, multiline content and omits identities in draft differences', () => {
  const values = { ...clinicalFormValues(encounter), clinicalNotes: ' First line\nSecond line ' }
  expect(clinicalInput(values, encounter)).toEqual({ clinicalNotes: 'First line\nSecond line' })
  expect(validateClinical(values, encounter, now)).toBeNull()
})
it('clears optional fields and structured collections explicitly', () => {
  const values = { ...clinicalFormValues(encounter), roomLabel: '', followUpAt: '', complaints: [], diagnoses: [] }
  expect(clinicalInput(values, encounter)).toEqual({ roomLabel: null, followUpAt: null, complaints: [], diagnoses: [] })
})
it('maps multiple complaints/diagnoses without client child IDs', () => {
  const values = { ...clinicalFormValues(encounter), complaints: [{ key: 42, description: ' New complaint ' }], diagnoses: [{ key: 43, description: ' New diagnosis ', code: '', notes: 'Multiline\nnote' }, { key: 44, description: 'Second diagnosis', code: 'Opaque label', notes: '' }] }
  expect(clinicalInput(values, encounter)).toEqual({ complaints: [{ description: 'New complaint' }], diagnoses: [{ description: 'New diagnosis', code: null, notes: 'Multiline\nnote' }, { description: 'Second diagnosis', code: 'Opaque label', notes: null }] })
})
it.each([['occurredAt', ''], ['occurredAt', '2026-02-30T12:00'], ['followUpAt', '2026-13-01T12:00']])('rejects invalid local %s value %s', (field, value) => expect(validateClinical({ ...clinicalFormValues(encounter), [field]: value }, encounter, now)).toContain('valid local'))
it('permits historical entries, gates future occurrence and orders follow-up', () => {
  expect(validateClinical({ ...clinicalFormValues(encounter), occurredAt: toLocalInput('2020-01-01T12:00:00Z') }, undefined, now)).toBeNull()
  expect(validateClinical({ ...clinicalFormValues(encounter), occurredAt: toLocalInput('2026-11-01T12:02:00Z') }, undefined, now)).toContain('future')
  expect(validateClinical({ ...clinicalFormValues(encounter), followUpAt: toLocalInput('2020-01-01T12:00:00Z') }, undefined, now)).toContain('at or after')
})
it.each([['roomLabel', 100], ['historySummary', 20000], ['clinicalNotes', 20000], ['treatmentPlan', 20000]] as const)('enforces %s length boundaries', (field, max) => {
  expect(validateClinical({ ...clinicalFormValues(encounter), [field]: 'x'.repeat(max) }, undefined, now)).toBeNull()
  expect(validateClinical({ ...clinicalFormValues(encounter), [field]: 'x'.repeat(max + 1) }, undefined, now)).not.toBeNull()
})
it.each(['', ' ', 'x'.repeat(201)])('rejects an empty or oversized complaint (%s)', (description) => expect(validateClinical({ ...clinicalFormValues(encounter), complaints: [{ key: 1, description }] }, undefined, now)).toContain('complaint'))
it('rejects duplicate complaints but permits Unicode medical terminology', () => {
  const values = { ...clinicalFormValues(encounter), complaints: [{ key: 1, description: ' β-test ' }, { key: 2, description: 'β-test' }] }
  expect(validateClinical(values, undefined, now)).toContain('duplicate')
  expect(validateClinical({ ...values, complaints: values.complaints.slice(0, 1) }, undefined, now)).toBeNull()
})
it.each(['complaints', 'diagnoses'] as const)('limits %s collection size to 30', (field) => {
  const values = { ...clinicalFormValues(encounter), [field]: Array.from({ length: 31 }, (_, key) => ({ key, description: `Description ${key}`, code: '', notes: '' })) }
  expect(validateClinical(values, undefined, now)).toContain('30')
})
it.each([['description', ''], ['description', 'x'.repeat(501)], ['code', 'x'.repeat(65)], ['notes', 'x'.repeat(5001)]])('validates diagnosis %s', (field, value) => {
  expect(validateClinical({ ...clinicalFormValues(encounter), diagnoses: [{ key: 1, description: 'Diagnosis', code: '', notes: '', [field]: value }] }, undefined, now)).toContain('diagnosis')
})
it('rejects unsafe controls and oversized aggregate requests without logging clinical text', () => {
  expect(validateClinical({ ...clinicalFormValues(encounter), clinicalNotes: 'Note\u0080' }, undefined, now)).toContain('control')
  expect(validateClinical({ ...clinicalFormValues(encounter), clinicalNotes: '界'.repeat(20000), historySummary: '界'.repeat(20000) }, undefined, now)).toContain('too long to save')
  expect(validateClinical(clinicalFormValues(encounter), encounter, now)).toBe('No changes to save.')
})
it.each([{ reason: '', content: 'Text' }, { reason: 'Reason', content: ' ' }, { reason: 'x'.repeat(1001), content: 'Text' }, { reason: 'Reason', content: 'x'.repeat(20001) }, { reason: 'Reason', content: '\u0000' }])('rejects invalid amendment fields %#', (input) => expect(validateAmendment(input)).not.toBeNull())
it('accepts meaningful multiline amendments without rewriting content', () => expect(validateAmendment({ reason: 'Correction', content: 'First line\nSecond line' })).toBeNull())
it.each(['ENCOUNTER_NOT_FOUND', 'ENCOUNTER_FINALIZED', 'ENCOUNTER_NOT_EDITABLE', 'ENCOUNTER_NOT_FINALIZED', 'ENCOUNTER_AUTHOR_REQUIRED', 'DUPLICATE_AMENDMENT', 'APPOINTMENT_NOT_ELIGIBLE_FOR_ENCOUNTER', 'APPOINTMENT_ALREADY_HAS_ENCOUNTER', 'ENCOUNTER_REFERENCE_CONFLICT', 'EMPTY_CLINICAL_RECORD', 'INVALID_ENCOUNTER_TIME', 'PATIENT_ARCHIVED', 'PATIENT_NOT_FOUND', 'APPOINTMENT_NOT_FOUND'])('maps %s without raw sensitive error text', (code) => {
  const message = clinicalError(new ApiError(409, 'sensitive raw details', code)); expect(message).not.toContain('sensitive'); expect(message).not.toContain('Unable to contact')
})
it('uses generic unknown-resource, auth, payload-size and network errors', () => {
  expect(clinicalError(new ApiError(404, 'hidden'))).toBe('Clinical record not found.'); expect(clinicalError(new ApiError(401, 'secret'))).toContain('expired'); expect(clinicalError(new ApiError(403, 'secret'))).toContain('permission'); expect(clinicalError(new ApiError(413, 'secret'))).toContain('too long'); expect(clinicalError(new Error('secret'))).toContain('Unable to contact')
})
