// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { BackendRole, StaffUser } from '../src/api/auth'
import { patientsApi, type Patient } from '../src/api/patients'
import { App } from '../src/app/App'

// The auth gate itself has separate real-transport lifecycle tests. Exercise the
// actual application composition using the safe identity it provides to children.
const identity = vi.hoisted(() => ({ role: 'ADMIN' as BackendRole }))
vi.mock('../src/features/auth/AuthGate', () => ({ AuthGate: ({ children }: { children: (user: StaffUser) => ReactNode }) => children({ id: 'qa', staffNumber: 'STF-QA', firstName: 'QA', lastName: 'Staff', email: 'qa@example.test', role: identity.role, status: 'ACTIVE' }) }))
let root: Root, host: HTMLDivElement, records: Patient[]
const patient: Patient = { id: 'patient-uuid', patientNumber: 'PT-SERVER-REFERENCE', firstName: 'Created', middleName: null, lastName: 'Patient', dateOfBirth: '1990-01-01', phone: null, archivedAt: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host); records = []
  vi.spyOn(patientsApi, 'list').mockImplementation(async (query) => {
    const items = records.filter((record) => query?.archived === 'all' || Boolean(record.archivedAt) === (query?.archived === 'true'))
    return { items, pagination: { page: 1, limit: 10, total: items.length, totalPages: items.length ? 1 : 0 } }
  })
  vi.spyOn(patientsApi, 'create').mockImplementation(async () => { records = [patient]; return { patient } })
  vi.spyOn(patientsApi, 'get').mockImplementation(async () => ({ patient: records[0]! }))
  vi.spyOn(patientsApi, 'update').mockImplementation(async () => { records = [{ ...patient, firstName: 'Edited' }]; return { patient: records[0]! } })
  vi.spyOn(patientsApi, 'archive').mockImplementation(async () => { records = [{ ...records[0]!, archivedAt: '2026-10-28T12:00:00Z' }]; return { patient: records[0]! } })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals() })
const visible = () => Array.from(host.querySelectorAll<HTMLButtonElement>('button')).filter((button) => !button.closest('[hidden]'))
async function click(text: string) { await act(async () => { visible().find((button) => button.textContent?.trim() === text)!.click(); await vi.advanceTimersByTimeAsync(0) }) }
async function fill(name: string, value: string) {
  await act(async () => {
    const input = host.querySelector<HTMLInputElement>(`input[name="${name}"]`)!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const submit = async () => { await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await vi.advanceTimersByTimeAsync(0) }) }
it.each(['ADMIN', 'RECORDS_OFFICER'] as const)('%s can register, view, edit and archive with list consistency', async (role) => {
  identity.role = role
  await act(async () => root.render(<App />)); await click('Patients')
  await click('Add patient'); await fill('firstName', 'Created'); await fill('lastName', 'Patient'); await submit()
  expect(host.querySelector('.patient-detail')?.textContent).toContain('PT-SERVER-REFERENCE')
  expect(patientsApi.get).not.toHaveBeenCalled()
  await click('Edit details'); await fill('firstName', 'Edited'); await submit()
  expect(host.querySelector('.patient-detail')?.textContent).toContain('Edited Patient')
  await click('Back to Patients'); expect(visible().some((button) => button.textContent === 'Edited Patient')).toBe(true)
  await click('Edited Patient'); expect(patientsApi.get).toHaveBeenCalledWith(patient.id, expect.any(AbortSignal))
  await click('Archive patient'); await click('Confirm archive'); await click('Back to Patients')
  expect(visible().some((button) => button.textContent === 'Edited Patient')).toBe(false)
  await act(async () => { const select = host.querySelector('select')!; select.value = 'true'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  await act(async () => { await vi.advanceTimersByTimeAsync(0) })
  expect(visible().some((button) => button.textContent === 'Edited Patient')).toBe(true)
})
it('keeps doctor read-only through the actual app navigation and detail composition', async () => {
  identity.role = 'DOCTOR_IN_CHARGE'; records = [patient]
  await act(async () => root.render(<App />)); await click('Patients')
  expect(visible().some((button) => /Add patient|Register patient/.test(button.textContent ?? ''))).toBe(false)
  await click('Created Patient')
  expect(host.querySelector('.patient-detail')?.textContent).toContain(patient.patientNumber)
  expect(visible().some((button) => /Edit details|Archive patient|Reactivate patient/.test(button.textContent ?? ''))).toBe(false)
})
