import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { hasPermission, permissions } from '../src/shared/authorization/permissions.js'
import { appointmentTimestamp, createAppointmentSchema, updateAppointmentSchema, appointmentQuerySchema, appointmentStatusSchema, cancelAppointmentSchema } from '../src/modules/appointments/appointment.validation.js'
import { validateSchedule, appointmentTransitions } from '../src/modules/appointments/appointment.service.js'

const input = { patientId: randomUUID(), clinicianId: randomUUID(), scheduledStart: '2035-10-15T09:00:00Z', scheduledEnd: '2035-10-15T09:30:00Z', type: 'CONSULTATION' }
describe('appointment permissions', () => {
  for (const role of ['ADMIN', 'RECORDS_OFFICER', 'DOCTOR_IN_CHARGE'] as const) {
    it.each(permissions.filter((p) => p.startsWith('APPOINTMENT_')))(`${role}: %s`, (permission) => {
      expect(hasPermission(role, permission)).toBe(role !== 'DOCTOR_IN_CHARGE' || ['APPOINTMENT_READ', 'APPOINTMENT_STATUS_UPDATE'].includes(permission))
    })
  }
})
describe('appointment input boundaries', () => {
  it.each(['2030-01-01', '2030-01-01 10:00', '2030-01-01T10:00:00', '2030-01-01T10:00:00+0000',
    '2030-02-30T10:00:00Z', '2030-13-01T10:00:00Z', '2030-01-01T24:00:00Z', '2030-01-01T10:60:00Z',
    '2030-01-01T10:00:60Z', '2030-01-01T10:00:00.1234Z', '0000-01-01T10:00:00Z', 'not-time'])(
    'rejects ambiguous/invalid timestamp %s', (value) => expect(appointmentTimestamp.safeParse(value).success).toBe(false))
  it.each(['2030-01-01T10:00:00Z', '2030-01-01T10:00:00+00:00', '2030-01-01T10:00:00.123-04:30', '2032-02-29T10:00:00+05:30'])(
    'accepts aware timestamp %s', (value) => expect(appointmentTimestamp.parse(value)).toBe(value))
  it.each([0, -10, 4.999, 721])('rejects duration %s minutes', (duration) => {
    const start = new Date(Date.now() + 60000)
    expect(() => validateSchedule(start, new Date(start.getTime() + duration * 60000))).toThrow()
  })
  it.each([5, 30, 720])('accepts duration %s minutes', (duration) => {
    const start = new Date(Date.now() + 60000)
    expect(() => validateSchedule(start, new Date(start.getTime() + duration * 60000))).not.toThrow()
  })
  it('permits small clock skew but rejects historical booking', () => {
    expect(() => validateSchedule(new Date(Date.now() - 30000), new Date(Date.now() + 600000))).not.toThrow()
    expect(() => validateSchedule(new Date(Date.now() - 120000), new Date(Date.now() + 600000))).toThrow('past')
  })
  it.each(['id', 'reference', 'appointmentReference', 'patientId', 'createdById', 'createdBy', 'status', 'cancelledAt', 'cancelledById', 'cancellationReason', 'createdAt', 'updatedAt', 'encounter', 'role'])(
    'protects PATCH field %s', (field) => expect(updateAppointmentSchema.safeParse({ notes: 'Text', [field]: 'injected' }).success).toBe(false))
  it.each(['reference', 'appointmentReference', 'createdById', 'status', 'cancelledAt', 'cancelledById', 'cancellationReason', 'createdAt', 'updatedAt', 'role'])(
    'rejects injected creation field %s', (field) => expect(createAppointmentSchema.safeParse({ ...input, [field]: 'injected' }).success).toBe(false))
  it.each([{}, { clinicianId: null }, { type: 'bogus' }, { reason: 'a'.repeat(501) }, { notes: 'a'.repeat(5001) }, { notes: '\u0000' }])(
    'rejects invalid patch %j', (body) => expect(updateAppointmentSchema.safeParse(body).success).toBe(false))
  it('normalizes blank optional text while preserving Unicode and newlines', () => {
    expect(createAppointmentSchema.parse({ ...input, reason: '  ', notes: '  Ési\nFollow-up  ' })).toMatchObject({ reason: null, notes: 'Ési\nFollow-up' })
    expect(updateAppointmentSchema.parse({ notes: null })).toEqual({ notes: null })
  })
  it.each([{ limit: 101 }, { page: 0 }, { page: 1.5 }, { sort: 'notes' }, { order: 'desc' }, { patientId: 'x' },
    { clinicianId: 'x' }, { status: 'ACTIVE' }, { type: 'x' }, { dateFrom: '2030-01-01' },
    { dateFrom: '2030-02-01T00:00:00Z', dateTo: '2030-01-01T00:00:00Z' }, { search: '\u0000' }, { search: 'x'.repeat(101) }])(
    'rejects invalid filters %j', (query) => expect(appointmentQuerySchema.safeParse(query).success).toBe(false))
  it('compares range instants across offsets and defaults pagination', () => {
    expect(appointmentQuerySchema.parse({ dateFrom: '2030-01-01T09:00:00+02:00', dateTo: '2030-01-01T08:00:00Z' })).toMatchObject({ page: 1, limit: 20 })
  })
  it.each(['SCHEDULED', 'CANCELLED', 'unknown'])('rejects status command %s', (status) => expect(appointmentStatusSchema.safeParse({ status }).success).toBe(false))
  it('rejects cancellation metadata and overlong reason', () => {
    expect(cancelAppointmentSchema.safeParse({ cancelledAt: new Date().toISOString() }).success).toBe(false)
    expect(cancelAppointmentSchema.safeParse({ reason: 'x'.repeat(501) }).success).toBe(false)
  })
  it.each(['COMPLETED', 'CANCELLED', 'NO_SHOW'] as const)('keeps %s terminal', (status) => expect(appointmentTransitions[status]).toEqual([]))
})
