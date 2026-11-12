import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createEncounterSchema, updateEncounterSchema, complaintSchema, diagnosisSchema, medicationSchema, amendEncounterSchema, encounterQuerySchema, encounterHistoryQuerySchema, finalizeEncounterSchema, medicationHistoryQuerySchema } from '../src/modules/encounters/encounter.validation.js'
import { validateEncounterTime } from '../src/modules/encounters/encounter.service.js'
import { hasPermission } from '../src/shared/authorization/permissions.js'

const input = { admissionId: randomUUID(), clinicalNotes: 'Clinical narrative' }
describe('clinical validation and authorization', () => {
  for (const role of ['ADMIN', 'RECORDS_OFFICER', 'DOCTOR_IN_CHARGE'] as const) {
    it.each(['CLINICAL_RECORD_READ', 'CLINICAL_RECORD_CREATE', 'CLINICAL_RECORD_AMEND'] as const)(`${role} %s`, (permission) => {
      expect(hasPermission(role, permission)).toBe(role === 'DOCTOR_IN_CHARGE')
    })
  }
  it.each(['id', 'reference', 'recordReference', 'patientId', 'appointmentId', 'clinicianId', 'createdById', 'receivedById', 'author', 'status', 'reviewedAt', 'finalizedAt', 'createdAt', 'updatedAt', 'voidedAt', 'voidReason', 'amendments', 'patient', 'clinician', 'admission'])(
    'rejects injected creation field %s', (field) => expect(createEncounterSchema.safeParse({ ...input, [field]: 'injected' }).success).toBe(false))
  it.each(['patientId', 'appointmentId', 'admissionId', 'clinicianId', 'createdById', 'receivedById', 'id', 'reference', 'status', 'reviewedAt', 'createdAt', 'updatedAt', 'voidReason', 'amendments'])(
    'rejects protected draft field %s', (field) => expect(updateEncounterSchema.safeParse({ [field]: 'injected' }).success).toBe(false))
  it.each(['2030-01-01', '2030-01-01T10:00:00', '2030-02-30T10:00:00Z', 'not-time'])(
    'rejects invalid timestamp %s', (occurredAt) => expect(createEncounterSchema.safeParse({ ...input, occurredAt }).success).toBe(false))
  it('accepts aware times, Unicode, line breaks and empty optional arrays', () => {
    expect(createEncounterSchema.parse({ ...input, occurredAt: '2020-01-01T10:00:00+02:00', clinicalNotes: '  Ési\nFollow-up  ', complaints: [], diagnoses: [] }))
      .toMatchObject({ clinicalNotes: 'Ési\nFollow-up', complaints: [], diagnoses: [] })
    expect(updateEncounterSchema.parse({ historySummary: '  ', treatmentPlan: null, followUpAt: null })).toEqual({ historySummary: null, treatmentPlan: null, followUpAt: null })
  })
  it.each([{}, { clinicalNotes: 'x'.repeat(20001) }, { historySummary: 'x'.repeat(20001) }, { treatmentPlan: 'x'.repeat(20001) },
    { roomLabel: 'x'.repeat(101) }, { clinicalNotes: '\u0000' }, { complaints: [{ description: 'Same' }, { description: ' Same ' }] },
    { complaints: Array.from({ length: 31 }, (_, i) => ({ description: String(i) })) }, { diagnoses: Array(31).fill({ description: 'Finding' }) }])(
    'rejects invalid draft %j', (body) => expect(updateEncounterSchema.safeParse(body).success).toBe(false))
  it.each([{ description: '' }, { description: ' ' }, { description: 'x'.repeat(201) }, { description: 'Valid', severity: 5 }])(
    'validates complaints %j', (body) => expect(complaintSchema.safeParse(body).success).toBe(false))
  it.each([{ description: '' }, { description: 'x'.repeat(501) }, { description: 'Finding', code: 'x'.repeat(65) },
    { description: 'Finding', notes: 'x'.repeat(5001) }, { description: 'Finding', encounterId: randomUUID() }])(
    'validates diagnoses %j', (body) => expect(diagnosisSchema.safeParse(body).success).toBe(false))
  const order = { medicationId: randomUUID(), dose: '1 tablet', route: 'Oral', frequency: 'Twice daily' }
  it.each([{}, { ...order, medicationId: 'not-a-uuid' }, { ...order, medicationId: undefined }, { ...order, dose: '' }, { ...order, dose: ' ' },
    { ...order, route: '' }, { ...order, frequency: ' ' }, { ...order, dose: undefined }, { ...order, route: undefined }, { ...order, frequency: undefined },
    { ...order, strength: 'x'.repeat(101) }, { ...order, dose: 'x'.repeat(101) }, { ...order, route: 'x'.repeat(51) }, { ...order, frequency: 'x'.repeat(101) },
    { ...order, duration: 'x'.repeat(101) }, { ...order, notes: 'x'.repeat(2001) }, { ...order, encounterId: randomUUID() },
    { ...order, prescribedBy: randomUUID() }, { ...order, medicine: 'Typed name' }])(
    'validates medication orders %j', (body) => expect(medicationSchema.safeParse(body).success).toBe(false))
  it('accepts a catalog order with dose, route and frequency, trimming optional fields to null', () => {
    expect(medicationSchema.parse({ ...order, strength: ' 500 mg ', dose: ' 1 tablet ', frequency: ' Twice daily ', duration: '', notes: '  ' }))
      .toEqual({ ...order, strength: '500 mg', dose: '1 tablet', frequency: 'Twice daily', duration: null, notes: null })
    expect(updateEncounterSchema.safeParse({ medications: Array(31).fill(order) }).success).toBe(false)
    expect(updateEncounterSchema.safeParse({ medications: Array(30).fill(order) }).success).toBe(true)
    expect(createEncounterSchema.parse({ ...input, medications: [] })).toMatchObject({ medications: [] })
  })
  it('requires an admission for every new clinical record', () => {
    expect(createEncounterSchema.safeParse({ clinicalNotes: 'No admission' }).success).toBe(false)
    expect(createEncounterSchema.safeParse({ ...input, admissionId: 'not-a-uuid' }).success).toBe(false)
  })
  it('accepts descriptive diagnosis and optional opaque code without pretending ICD validation', () => {
    expect(diagnosisSchema.parse({ description: '  Clinical finding, provisional  ', code: ' Local: A/1 ', notes: '' }))
      .toEqual({ description: 'Clinical finding, provisional', code: 'Local: A/1', notes: null })
  })
  it.each([{}, { reason: '', content: 'Correction' }, { reason: 'Explanation', content: '' }, { content: 'Correction' },
    { reason: 'x'.repeat(1001), content: 'Correction' }, { reason: 'Explanation', content: 'x'.repeat(20001) },
    { reason: 'Explanation', content: 'Correction', authorId: randomUUID() }])(
    'rejects invalid amendment %j', (body) => expect(amendEncounterSchema.safeParse(body).success).toBe(false))
  it.each([{ limit: 101 }, { page: 0 }, { status: 'FINALIZED' }, { patientId: 'x' }, { clinicianId: 'x' }, { admissionId: 'x' }, { appointmentId: randomUUID() },
    { dateFrom: '2020-01-01' }, { dateFrom: '2021-01-01T00:00:00Z', dateTo: '2020-01-01T00:00:00Z' }, { search: 'x'.repeat(101) }, { clinicalNotes: 'query' }, { sort: 'notes' }])(
    'rejects invalid query %j', (query) => expect(encounterQuerySchema.safeParse(query).success).toBe(false))
  it('prevents overriding patient history scope and finalization metadata', () => {
    expect(encounterHistoryQuerySchema.safeParse({ patientId: randomUUID() }).success).toBe(false)
    expect(finalizeEncounterSchema.safeParse({ reviewedAt: new Date().toISOString() }).success).toBe(false)
    expect(encounterQuerySchema.parse({})).toEqual({ page: 1, limit: 20 })
    expect(medicationHistoryQuerySchema.safeParse({ patientId: randomUUID() }).success).toBe(false)
    expect(medicationHistoryQuerySchema.parse({})).toEqual({ page: 1, limit: 20 })
    const admissionId = randomUUID()
    expect(medicationHistoryQuerySchema.parse({ admissionId })).toEqual({ page: 1, limit: 20, admissionId })
    expect(medicationHistoryQuerySchema.parse({ excludeAdmissionId: admissionId })).toEqual({ page: 1, limit: 20, excludeAdmissionId: admissionId })
    expect(medicationHistoryQuerySchema.safeParse({ admissionId, excludeAdmissionId: randomUUID() }).success).toBe(false)
    expect(medicationHistoryQuerySchema.safeParse({ admissionId: 'AD-000001' }).success).toBe(false)
  })
  it('permits late entry and small clock tolerance, rejects distant future and reversed follow-up', () => {
    expect(() => validateEncounterTime(new Date('2000-01-01'), null)).not.toThrow()
    expect(() => validateEncounterTime(new Date(Date.now() + 30000), null)).not.toThrow()
    expect(() => validateEncounterTime(new Date(Date.now() + 120000), null)).toThrow()
    expect(() => validateEncounterTime(new Date('2020-01-02'), new Date('2020-01-01'))).toThrow()
  })
})
