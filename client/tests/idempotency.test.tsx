// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, resetApiSession } from '../src/api/client'
import { newIdempotencyKey, submissionKeys } from '../src/api/idempotency'
import { patientsApi, type Patient } from '../src/api/patients'
import { encountersApi } from '../src/api/encounters'
import { notificationsApi } from '../src/api/notifications'
import { appointmentsApi } from '../src/api/appointments'
import { PatientModal } from '../src/features/patients/PatientModal'
import { EncounterForm } from '../src/features/records/EncounterForm'
import { BroadcastComposer } from '../src/features/notifications/BroadcastComposer'
import { appointment } from './appointment-fixtures'
import { doctor, eligibleAppointment, encounter, patient } from './clinical-fixtures'
import { broadcastNotice } from './notification-fixtures'

const serverPattern = /^[A-Za-z0-9_-]{16,128}$/
const ok = (data: unknown) => new Response(JSON.stringify({ success: true, data }))
const headerOf = (fetcher: ReturnType<typeof vi.fn<typeof fetch>>, index: number) => new Headers(fetcher.mock.calls[index]![1]?.headers).get('Idempotency-Key')

describe('key generation and lifecycle', () => {
  it('generates distinct UUID keys that satisfy the server contract', () => {
    const keys = new Set(Array.from({ length: 50 }, newIdempotencyKey))
    expect(keys.size).toBe(50); for (const key of keys) { expect(key).toMatch(serverPattern); expect(key).toMatch(/^[0-9a-f-]{36}$/) }
  })
  it('falls back to the cryptographic generator when randomUUID is unavailable', () => {
    const original = crypto.randomUUID
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true })
    try {
      const key = newIdempotencyKey()
      expect(key).toMatch(/^[0-9a-f]{32}$/); expect(key).toMatch(serverPattern); expect(newIdempotencyKey()).not.toBe(key)
    } finally { Object.defineProperty(crypto, 'randomUUID', { value: original, configurable: true }) }
  })
  it('keeps the key only for an unconfirmed outcome of the unchanged payload', () => {
    const keys = submissionKeys(), payload = { firstName: 'Ama', lastName: 'Mensah' }
    const first = keys.key(payload)
    keys.settle(new TypeError('Failed to fetch')); expect(keys.key({ ...payload })).toBe(first)
    keys.settle(new ApiError(503, 'Service unavailable', 'SERVICE_UNAVAILABLE')); expect(keys.key(payload)).toBe(first)
    expect(keys.key({ ...payload, lastName: 'Changed' })).not.toBe(first)
  })
  it.each([[undefined], [new ApiError(409, 'raw', 'POSSIBLE_DUPLICATE_PATIENT')], [new ApiError(400, 'raw', 'VALIDATION_ERROR')], [new ApiError(403, 'raw', 'CSRF_INVALID')]])('starts a new key after a confirmed outcome (%s)', (outcome) => {
    const keys = submissionKeys(), payload = { title: 'Same' }, first = keys.key(payload)
    keys.settle(outcome); expect(keys.key(payload)).not.toBe(first)
  })
})

describe('API layer', () => {
  const fetcher = vi.fn<typeof fetch>(), csrf = () => ok({ csrfToken: 'a'.repeat(64) })
  beforeEach(() => { resetApiSession(); fetcher.mockReset(); vi.stubGlobal('fetch', fetcher) })
  afterEach(() => { vi.unstubAllGlobals(); resetApiSession() })
  it.each([
    ['patient registration', () => patientsApi.create({ firstName: 'A', lastName: 'B' }, 'patient-key-0123456789')],
    ['encounter creation', () => encountersApi.create({ patientId: patient.id }, 'encounter-key-0123456789')],
    ['broadcast', () => notificationsApi.broadcast({ title: 'T', message: 'M', audience: { type: 'ALL' } }, 'broadcast-key-0123456789')],
  ])('sends the caller’s key with CSRF on %s', async (_label, call) => {
    fetcher.mockResolvedValueOnce(csrf()).mockResolvedValueOnce(ok({}))
    await call()
    expect(headerOf(fetcher, 1)).toMatch(/-key-0123456789$/); expect(new Headers(fetcher.mock.calls[1]![1]?.headers).get('X-CSRF-Token')).toBe('a'.repeat(64))
    expect(headerOf(fetcher, 0)).toBeNull()
  })
  it('never invents a key in the shared transport', async () => {
    fetcher.mockResolvedValueOnce(csrf()).mockImplementation(async () => ok({}))
    await patientsApi.create({ firstName: 'A', lastName: 'B' })
    await patientsApi.update(patient.id, { firstName: 'C' }); await patientsApi.archive(patient.id)
    await encountersApi.updateDraft(encounter, { clinicalNotes: 'x' }); await encountersApi.amend(encounter.id, { reason: 'r', content: 'c' })
    await appointmentsApi.cancel(appointment.id, null); await notificationsApi.markRead(broadcastNotice.id); await notificationsApi.markAllRead()
    expect(fetcher.mock.calls.slice(1).map((_call, index) => headerOf(fetcher, index + 1))).toEqual(Array(8).fill(null))
  })
})

describe('forms', () => {
  let root: Root, host: HTMLDivElement
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-01T12:00:00Z')); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    host = document.createElement('div'); document.body.append(host); root = createRoot(host)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals() })
  const tick = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(0) }) }
  const render = async (node: ReactNode) => { await act(async () => root.render(node)); await tick() }
  const submit = async () => { await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) }); await tick() }
  async function fill(name: string, value: string) {
    await act(async () => {
      const element = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`)!
      Object.getOwnPropertyDescriptor(element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(element, value)
      element.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  const keyOf = (mock: { mock: { calls: unknown[][] } }, index: number) => mock.mock.calls[index]![1] as string | undefined
  const created: Patient = { id: 'patient-id', patientNumber: 'PT-1', firstName: 'Ama', middleName: null, lastName: 'Mensah', dateOfBirth: null, phone: null, archivedAt: null, createdAt: '2026-11-01T12:00:00Z', updatedAt: '2026-11-01T12:00:00Z' }

  it('reuses the patient key for a deliberate retry after an unconfirmed save, and changes it with the form', async () => {
    const create = vi.spyOn(patientsApi, 'create').mockRejectedValueOnce(new TypeError('Failed to fetch')).mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue({ patient: created })
    const setItem = vi.spyOn(Storage.prototype, 'setItem'), onCreated = vi.fn()
    await render(<PatientModal role="RECORDS_OFFICER" onClose={vi.fn()} onCreated={onCreated} />)
    await fill('firstName', 'Ama'); await fill('lastName', 'Mensah'); await submit(); await submit()
    expect(keyOf(create, 0)).toMatch(serverPattern); expect(keyOf(create, 1)).toBe(keyOf(create, 0))
    await fill('lastName', 'Mensah-Owusu'); await submit()
    expect(keyOf(create, 2)).not.toBe(keyOf(create, 0)); expect(onCreated).toHaveBeenCalledOnce()
    expect(setItem).not.toHaveBeenCalled(); expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain(keyOf(create, 0)!)
  })
  it('uses a new patient key after a definite refusal and sends none for edits', async () => {
    const create = vi.spyOn(patientsApi, 'create').mockRejectedValueOnce(new ApiError(409, 'raw', 'POSSIBLE_DUPLICATE_PATIENT')).mockResolvedValue({ patient: created })
    await render(<PatientModal role="ADMIN" onClose={vi.fn()} onCreated={vi.fn()} />)
    await fill('firstName', 'Ama'); await fill('lastName', 'Mensah'); await submit(); await submit()
    expect(keyOf(create, 1)).not.toBe(keyOf(create, 0))
    const update = vi.spyOn(patientsApi, 'update').mockResolvedValue({ patient: created })
    await render(<PatientModal key="edit" role="ADMIN" patient={created} onClose={vi.fn()} onCreated={vi.fn()} />)
    await fill('firstName', 'Amma'); await submit()
    expect(update).toHaveBeenCalledExactlyOnceWith(created.id, { firstName: 'Amma' })
  })
  it('reuses the broadcast key only while the trimmed broadcast is unchanged', async () => {
    const broadcast = vi.spyOn(notificationsApi, 'broadcast').mockRejectedValueOnce(new TypeError('Failed to fetch')).mockRejectedValueOnce(new ApiError(502, 'raw', 'BAD_GATEWAY'))
      .mockResolvedValue({ notification: broadcastNotice, recipientCount: 4 })
    const sent = vi.fn()
    await render(<BroadcastComposer onClose={vi.fn()} onSent={sent} />)
    await fill('broadcastTitle', 'Briefing'); await fill('broadcastMessage', 'Room 2'); await submit()
    await fill('broadcastMessage', 'Room 2 '); await submit()
    expect(keyOf(broadcast, 1)).toBe(keyOf(broadcast, 0))
    await fill('broadcastMessage', 'Room 3'); await submit()
    expect(keyOf(broadcast, 2)).not.toBe(keyOf(broadcast, 0)); expect(sent).toHaveBeenCalledOnce()
    expect(broadcast).toHaveBeenCalledTimes(3)
  })
  it('sends a key for walk-in encounter creation and reuses it after an unconfirmed save', async () => {
    const create = vi.spyOn(encountersApi, 'create').mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue({ encounter })
    await render(<EncounterForm user={doctor} patient={patient} onClose={vi.fn()} onSaved={vi.fn()} />)
    await fill('clinicalNotes', 'Walk-in note'); await submit(); await submit()
    expect(create.mock.calls[0]![0]).not.toHaveProperty('appointmentId')
    expect(keyOf(create, 0)).toMatch(serverPattern); expect(keyOf(create, 1)).toBe(keyOf(create, 0))
  })
  it('sends a key for linked creation and keeps the existing-record recovery', async () => {
    const create = vi.spyOn(encountersApi, 'create').mockRejectedValueOnce(new ApiError(409, 'raw', 'APPOINTMENT_ALREADY_HAS_ENCOUNTER')).mockResolvedValue({ encounter })
    const openExisting = vi.fn()
    await render(<EncounterForm user={doctor} patient={patient} appointment={eligibleAppointment} onOpenExisting={openExisting} onClose={vi.fn()} onSaved={vi.fn()} />)
    await fill('clinicalNotes', 'Linked note'); await submit()
    expect(create.mock.calls[0]![0]).toMatchObject({ appointmentId: eligibleAppointment.id }); expect(keyOf(create, 0)).toMatch(serverPattern)
    expect(Array.from(host.querySelectorAll('button')).some((item) => item.textContent === 'Open existing clinical record')).toBe(true)
    await submit(); expect(keyOf(create, 1)).not.toBe(keyOf(create, 0))
  })
  it('sends no key when saving an existing draft', async () => {
    const update = vi.spyOn(encountersApi, 'updateDraft').mockResolvedValue({ encounter })
    await render(<EncounterForm user={doctor} patient={patient} encounter={encounter} onClose={vi.fn()} onSaved={vi.fn()} />)
    await fill('clinicalNotes', 'Edited note'); await submit()
    expect(update).toHaveBeenCalledOnce(); expect(update.mock.calls[0]).toHaveLength(2)
  })
})
