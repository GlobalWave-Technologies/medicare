import { expect, it } from 'vitest'
import { ApiError } from '../src/api/client'
import { allowedView, navItemsByRole, toUiRole } from '../src/app/navigation'
import { canAmend, canEditDraft, clinicalError, clinicalFormValues, clinicalInput, clinicalLabels, emptyMedication, frequencyOptions, hasClinicalAccess, isClinicalAuthor, medicationSummary, medicationTitle, routeOptions, validateAmendment, validateClinical } from '../src/features/records/clinical-utils'
import { toLocalInput } from '../src/lib/time'
import { doctor, encounter, reviewed } from './clinical-fixtures'
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
it('starts a new record in the admission room and loads existing medication orders for editing', () => {
  expect(clinicalFormValues(undefined, 'Ward A - Bed 6')).toMatchObject({ roomLabel: 'Ward A - Bed 6', medications: [] })
  expect(clinicalFormValues(encounter).medications).toEqual([{ key: 1000, medicationId: 'catalog-paracetamol', medicine: 'Paracetamol', strength: '500 mg', dose: '1 tablet', route: 'Oral',
    frequency: 'Twice daily', duration: '5 days', notes: 'After meals' }])
  expect(medicationTitle(encounter.medications[0]!)).toBe('Paracetamol 500 mg')
  expect(medicationSummary(encounter.medications[0]!)).toBe('1 tablet · Oral · Twice daily · 5 days')
})
it('offers the previous system’s routes (injection split by route) and common frequencies', () => {
  expect(routeOptions).toEqual(['Oral', 'Intravenous (IV)', 'Intramuscular (IM)', 'Subcutaneous (SC)', 'Topical', 'Inhaled'])
  expect(frequencyOptions).toEqual(['Once daily', 'Twice daily', 'Three times daily', 'Four times daily', 'As needed', 'Stat'])
})
const chosen = { ...emptyMedication(7), medicationId: 'catalog-ors', medicine: 'ORS', dose: ' 1 sachet ', route: 'Oral', frequency: ' Stat ' }
it('maps orders to the catalog id and dosing only (never a typed name), trimming optional fields to null, and sends only changes', () => {
  const values = { ...clinicalFormValues(encounter), medications: [chosen] }
  expect(clinicalInput(values, encounter)).toEqual({ medications: [{ medicationId: 'catalog-ors', strength: null, dose: '1 sachet', route: 'Oral', frequency: 'Stat', duration: null, notes: null }] })
  expect(clinicalInput(clinicalFormValues(encounter), encounter)).toEqual({})
  expect(clinicalInput({ ...clinicalFormValues(encounter), medications: [] }, encounter)).toEqual({ medications: [] })
})
it('leaves an unchanged older free-text order alone, but asks for a catalog choice once the orders change', () => {
  const older = { ...encounter, medications: [{ ...encounter.medications[0]!, medicationId: null, medicine: 'Older typed medicine', strength: null }] }
  expect(clinicalInput({ ...clinicalFormValues(older), clinicalNotes: 'Changed' }, older)).toEqual({ clinicalNotes: 'Changed' })
  expect(validateClinical({ ...clinicalFormValues(older), clinicalNotes: 'Changed' }, older, now)).toBeNull()
  const added = { ...clinicalFormValues(older), medications: [...clinicalFormValues(older).medications, chosen] }
  expect(validateClinical(added, older, now)).toContain('Older typed medicine')
})
it.each([['medicationId', ''], ['dose', ''], ['dose', ' '], ['route', ''], ['frequency', ''], ['strength', 'x'.repeat(101)], ['dose', 'x'.repeat(101)], ['route', 'x'.repeat(51)],
  ['frequency', 'x'.repeat(101)], ['duration', 'x'.repeat(101)], ['notes', 'x'.repeat(2001)], ['notes', 'Note\u0000']])(
  'validates medication %s', (field, value) => {
    expect(validateClinical({ ...clinicalFormValues(encounter), medications: [{ ...chosen, [field]: value }] }, undefined, now)).not.toBeNull()
  })
it('accepts a complete catalog order', () => expect(validateClinical({ ...clinicalFormValues(encounter), medications: [chosen] }, undefined, now)).toBeNull())
it('preserves exact unchanged timestamps, multiline content and omits identities in draft differences', () => {
  const values = { ...clinicalFormValues(encounter), clinicalNotes: ' First line\nSecond line ' }
  expect(clinicalInput(values, encounter)).toEqual({ clinicalNotes: 'First line\nSecond line' })
  expect(validateClinical(values, encounter, now)).toBeNull()
})
it('clears optional fields and structured collections explicitly', () => {
  const values = { ...clinicalFormValues(encounter), roomLabel: '', followUpAt: '', complaints: [], diagnoses: [], medications: [] }
  expect(clinicalInput(values, encounter)).toEqual({ roomLabel: null, followUpAt: null, complaints: [], diagnoses: [], medications: [] })
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
it.each(['complaints', 'diagnoses', 'medications'] as const)('limits %s collection size to 30', (field) => {
  const values = { ...clinicalFormValues(encounter), [field]: Array.from({ length: 31 }, (_, key) => ({ ...chosen, key, description: `Description ${key}`, code: '', notes: '' })) }
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
it.each(['ENCOUNTER_NOT_FOUND', 'ENCOUNTER_FINALIZED', 'ENCOUNTER_NOT_EDITABLE', 'ENCOUNTER_NOT_FINALIZED', 'ENCOUNTER_AUTHOR_REQUIRED', 'DUPLICATE_AMENDMENT', 'ADMISSION_NOT_FOUND', 'ADMISSION_NOT_CURRENT', 'ENCOUNTER_REFERENCE_CONFLICT', 'EMPTY_CLINICAL_RECORD', 'INVALID_ENCOUNTER_TIME', 'PATIENT_ARCHIVED', 'PATIENT_NOT_FOUND'])('maps %s without raw sensitive error text', (code) => {
  const message = clinicalError(new ApiError(409, 'sensitive raw details', code)); expect(message).not.toContain('sensitive'); expect(message).not.toContain('Unable to contact')
})
it('uses generic unknown-resource, auth, payload-size and network errors', () => {
  expect(clinicalError(new ApiError(404, 'hidden'))).toBe('Clinical record not found.'); expect(clinicalError(new ApiError(401, 'secret'))).toContain('expired'); expect(clinicalError(new ApiError(403, 'secret'))).toContain('permission'); expect(clinicalError(new ApiError(413, 'secret'))).toContain('too long'); expect(clinicalError(new Error('secret'))).toContain('Unable to contact')
})
