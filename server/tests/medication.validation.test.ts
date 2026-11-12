import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createMedicationSchema, medicationIdSchema, medicationNameSchema, medicationQuerySchema } from '../src/modules/medications/medication.validation.js'
import { toMedication, toMedicationOption } from '../src/modules/medications/medication.dto.js'

describe('medication catalog validation', () => {
  it('tidies names: trims and makes runs of spaces single, keeping the capitals as typed', () => {
    expect(medicationNameSchema.parse('  Amoxicillin   capsule ')).toBe('Amoxicillin capsule')
    expect(medicationNameSchema.parse('Vitamin\tC tab')).toBe('Vitamin C tab')
    expect(medicationNameSchema.parse('ORS')).toBe('ORS')
    expect(medicationNameSchema.parse('Mebendazole (dewormer) – 100 mg')).toBe('Mebendazole (dewormer) – 100 mg')
    expect(medicationNameSchema.parse('x'.repeat(200))).toHaveLength(200)
  })
  it.each(['', '   ', 'x'.repeat(201), 'Line\nbreak', 'Carriage\rreturn', 'Bell\u0007', 'Escape\u009b', 42, null])('refuses the name %j', (name) => {
    expect(medicationNameSchema.safeParse(name).success).toBe(false)
  })
  it('accepts only a name when adding, and only a UUID as an id', () => {
    expect(createMedicationSchema.parse({ name: ' Paracetamol ' })).toEqual({ name: 'Paracetamol' })
    for (const body of [{}, { name: 'Paracetamol', active: false }, { name: 'Paracetamol', id: randomUUID() }, { name: 'Paracetamol', createdAt: 'now' }]) {
      expect(createMedicationSchema.safeParse(body).success).toBe(false)
    }
    expect(medicationIdSchema.safeParse({ id: 'Paracetamol' }).success).toBe(false)
    expect(medicationIdSchema.parse({ id: '89f788fb-b4c5-4437-a8e2-a3d16adcc5a0' }).id).toBe('89f788fb-b4c5-4437-a8e2-a3d16adcc5a0')
  })
  it('defaults the list to active medicines and bounds every filter', () => {
    expect(medicationQuerySchema.parse({})).toEqual({ page: 1, limit: 20, status: 'active' })
    expect(medicationQuerySchema.parse({ status: 'all', search: '  para  cet ', page: '2', limit: '50' })).toEqual({ page: 2, limit: 50, status: 'all', search: 'para cet' })
    for (const query of [{ status: 'deleted' }, { limit: '101' }, { page: '0' }, { search: 'x'.repeat(101) }, { search: 'a\nb' }, { active: 'true' }, { patientId: randomUUID() }]) {
      expect(medicationQuerySchema.safeParse(query).success).toBe(false)
    }
  })
  it('returns catalog entries as names and status only', () => {
    const row = { id: randomUUID(), name: 'Paracetamol', active: true, createdAt: new Date('2026-11-11T09:00:00Z'), updatedAt: new Date('2026-11-11T10:00:00Z') }
    expect(toMedication(row)).toEqual({ id: row.id, name: 'Paracetamol', active: true, createdAt: '2026-11-11T09:00:00.000Z', updatedAt: '2026-11-11T10:00:00.000Z' })
    expect(toMedicationOption({ ...row, orders: ['private'] } as typeof row)).toEqual({ id: row.id, name: 'Paracetamol' })
  })
})
