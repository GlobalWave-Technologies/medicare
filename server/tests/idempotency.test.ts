import { createHash, createHmac } from 'node:crypto'
import { Writable } from 'node:stream'
import type { Request } from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { createLogger } from '../src/shared/logger/logger.js'
import { idempotencyScope, IDEMPOTENCY_RETENTION_MS } from '../src/shared/idempotency/idempotency.js'
import { patientFingerprint } from '../src/modules/patients/patient.service.js'
import { encounterFingerprint } from '../src/modules/encounters/encounter.service.js'
import { createPatientSchema } from '../src/modules/patients/patient.validation.js'
import { createEncounterSchema } from '../src/modules/encounters/encounter.validation.js'
import { broadcastSchema } from '../src/modules/notifications/notification.validation.js'

const principal = '11111111-1111-4111-8111-111111111111', key = '3f6c2a9e-8d1b-4c7e-9a52-0b6e4d8f1c37'
const withHeader = (value?: string) => ({ get: (name: string) => name.toLowerCase() === 'idempotency-key' ? value : undefined }) as unknown as Request
const scope = (accepted: object, value = key, who = principal) => idempotencyScope(withHeader(value), who, 'PATIENT_CREATE', accepted)!

describe('Idempotency-Key header', () => {
  it('is optional for backward compatibility', () => expect(idempotencyScope(withHeader(), principal, 'PATIENT_CREATE', {})).toBeUndefined())
  it.each(['', 'short-key-15chr', 'x'.repeat(129), 'has space in the key', 'comma,separated,key-value', `"${key}"`, `${key}\n`, 'ключ-ключ-ключ-ключ'])('rejects %j with a stable error', (value) => {
    expect(() => scope({}, value)).toThrow(expect.objectContaining({ status: 400, code: 'INVALID_IDEMPOTENCY_KEY' }))
  })
  it.each([key, 'A'.repeat(16), 'z'.repeat(128), 'opaque_KEY-0123456789'])('accepts %j', (value) => expect(scope({}, value).keyHash).toMatch(/^[0-9a-f]{64}$/))
  it('stores only a SHA-256 key digest and a request digest keyed by the raw key', () => {
    const value = scope({ firstName: 'Ama' })
    expect(value.keyHash).toBe(createHash('sha256').update(key).digest('hex'))
    expect(value.requestHash).toBe(createHmac('sha256', key).update('{"firstName":"Ama"}').digest('hex'))
    expect(JSON.stringify(value)).not.toContain(key); expect(JSON.stringify(value)).not.toContain('Ama')
    expect(value.requestHash).not.toBe(createHash('sha256').update('{"firstName":"Ama"}').digest('hex'))
  })
  it('fingerprints independent of property order and omitted values, but sensitive to content and array order', () => {
    const base = scope({ a: 1, b: { c: [1, 2], d: 'x' } }).requestHash
    expect(scope({ b: { d: 'x', c: [1, 2] }, a: 1, e: undefined }).requestHash).toBe(base)
    expect(scope({ a: 1, b: { c: [2, 1], d: 'x' } }).requestHash).not.toBe(base)
    expect(scope({ a: 2, b: { c: [1, 2], d: 'x' } }).requestHash).not.toBe(base)
    expect(scope({ a: 1, b: { c: [1, 2], d: 'x' } }, 'another-opaque-key-value').requestHash).not.toBe(base)
  })
  it('keeps the same digests for another principal but scopes the record by principal', () => {
    const other = scope({ a: 1 }, key, '22222222-2222-4222-8222-222222222222')
    expect(other.principalId).not.toBe(principal); expect(other.keyHash).toBe(scope({ a: 1 }).keyHash)
  })
  it('uses a 24-hour replay window', () => expect(IDEMPOTENCY_RETENTION_MS).toBe(86400000))
})

describe('operation fingerprints use accepted, normalized values', () => {
  it('normalizes patient whitespace, phone formatting and empty middle names', () => {
    const a = patientFingerprint(createPatientSchema.parse({ firstName: ' Ama ', lastName: 'Mensah', middleName: '', phone: '+233 (24) 123-4567' }))
    const b = patientFingerprint(createPatientSchema.parse({ lastName: 'Mensah', firstName: 'Ama', phone: '00233241234567', dateOfBirth: '' }))
    expect(a).toEqual(b); expect(a).toEqual({ firstName: 'Ama', middleName: null, lastName: 'Mensah', dateOfBirth: null, phone: '+233241234567' })
  })
  it('compares encounter instants, not their offset spelling, and keeps entry order', () => {
    const input = { patientId: principal, occurredAt: '2026-11-04T09:00:00Z', complaints: [{ description: 'First' }, { description: 'Second' }] }
    const same = encounterFingerprint(createEncounterSchema.parse({ ...input, occurredAt: '2026-11-04T10:00:00+01:00', roomLabel: '' }))
    expect(encounterFingerprint(createEncounterSchema.parse(input))).toEqual(same)
    expect(same.occurredAt).toBe('2026-11-04T09:00:00.000Z')
    expect(encounterFingerprint(createEncounterSchema.parse({ ...input, complaints: [...input.complaints].reverse() }))).not.toEqual(same)
    expect(encounterFingerprint(createEncounterSchema.parse({ ...input, appointmentId: null }))).toEqual(encounterFingerprint(createEncounterSchema.parse(input)))
  })
  it('uses the trimmed broadcast and its exact audience', () => {
    const a = broadcastSchema.parse({ title: ' Briefing ', message: 'Room 2 ', audience: { type: 'ROLE', role: 'ADMIN' } })
    expect(scope(a).requestHash).toBe(scope(broadcastSchema.parse({ audience: { role: 'ADMIN', type: 'ROLE' }, message: 'Room 2', title: 'Briefing' })).requestHash)
    expect(scope(a).requestHash).not.toBe(scope(broadcastSchema.parse({ title: 'Briefing', message: 'Room 2', audience: { type: 'ALL' } })).requestHash)
  })
})

describe('HTTP boundary', () => {
  const app = createApp({ env: { NODE_ENV: 'production', CLIENT_ORIGIN: 'https://client.example.test' }, logger: createLogger('silent'), checkDatabase: async () => {} })
  it('allows the Idempotency-Key header only for the exact trusted origin, with credentials', async () => {
    const allowed = await request(app).options('/api/v1/patients').set('Origin', 'https://client.example.test')
      .set('Access-Control-Request-Method', 'POST').set('Access-Control-Request-Headers', 'Content-Type, X-CSRF-Token, Idempotency-Key').expect(204)
    expect(allowed.headers['access-control-allow-origin']).toBe('https://client.example.test')
    expect(allowed.headers['access-control-allow-credentials']).toBe('true')
    expect(allowed.headers['access-control-allow-headers']).toBe('Content-Type,X-Request-Id,X-CSRF-Token,Idempotency-Key')
    for (const origin of ['https://untrusted.example.test', 'null', '*']) {
      const blocked = await request(app).options('/api/v1/patients').set('Origin', origin)
        .set('Access-Control-Request-Method', 'POST').set('Access-Control-Request-Headers', 'Idempotency-Key')
      expect(blocked.status).toBe(403); expect(blocked.headers['access-control-allow-origin']).toBeUndefined()
    }
  })
  it('redacts any key that reaches a log object', () => {
    let output = ''
    const logger = createLogger('info', new Writable({ write(chunk: Buffer, _encoding, callback) { output += chunk.toString(); callback() } }))
    logger.info({ idempotencyKey: 'raw-key-secret', request: { idempotencyKey: 'nested-key-secret' }, req: { headers: { 'idempotency-key': 'header-key-secret' } } })
    expect(output).not.toMatch(/raw-key-secret|nested-key-secret|header-key-secret/)
  })
})
