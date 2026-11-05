// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { BackendRole, StaffUser } from '../src/api/auth'
import { appointmentsApi, type Appointment } from '../src/api/appointments'
import { patientsApi } from '../src/api/patients'
import { App } from '../src/app/App'
import { appointment, clinician, page, patient } from './appointment-fixtures'
const identity = vi.hoisted(() => ({ role: 'ADMIN' as BackendRole }))
vi.mock('../src/features/auth/AuthGate', () => ({ AuthGate: ({ children }: { children: (user: StaffUser) => ReactNode }) => children({ id: '22222222-2222-4222-8222-222222222222', staffNumber: 'STF-DOCTOR', firstName: 'QA', lastName: 'Staff', email: 'qa@example.test', role: identity.role, status: 'ACTIVE' }) }))
let root: Root, host: HTMLDivElement, records: Appointment[]
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-29T12:00:00Z')); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host); records = []
  vi.spyOn(appointmentsApi, 'list').mockImplementation(async () => ({ items: records, pagination: { ...page.pagination, total: records.length } }))
  vi.spyOn(appointmentsApi, 'clinicians').mockResolvedValue({ clinicians: [clinician] })
  vi.spyOn(patientsApi, 'list').mockResolvedValue({ items: [patient], pagination: page.pagination })
  vi.spyOn(appointmentsApi, 'create').mockImplementation(async () => { records = [appointment]; return { appointment } })
  vi.spyOn(appointmentsApi, 'get').mockImplementation(async () => ({ appointment: records[0]! }))
  vi.spyOn(appointmentsApi, 'update').mockImplementation(async () => { records = [{ ...records[0]!, notes: 'Updated scheduling note' }]; return { appointment: records[0]! } })
  vi.spyOn(appointmentsApi, 'changeStatus').mockImplementation(async (_id, status) => { records = [{ ...records[0]!, status }]; return { appointment: records[0]! } })
  vi.spyOn(appointmentsApi, 'cancel').mockImplementation(async () => { records = [{ ...records[0]!, status: 'CANCELLED', cancelledAt: '2026-10-29T12:05:00Z', cancellationReason: 'Original reason' }]; return { appointment: records[0]! } })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals() })
const visible = () => Array.from(host.querySelectorAll<HTMLButtonElement>('button')).filter((button) => !button.closest('[hidden]'))
const tick = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(0) }) }
async function click(text: string) { await act(async () => { visible().find((button) => button.textContent?.trim() === text)!.click() }); await tick() }
async function fill(name: string, value: string) {
  await act(async () => {
    const input = host.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`[name="${name}"]`)!
    const prototype = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
}
const submit = async () => { await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) }); await tick() }
it.each(['ADMIN', 'RECORDS_OFFICER'] as const)('%s completes booking, detail, editing, status and cancellation with list consistency', async (role) => {
  identity.role = role; await act(async () => root.render(<App />)); await click('Appointments')
  await click('Book appointment'); await click('Amina Patient PT-REAL')
  // The list filter and form have separate controls; choose the one in the dialog.
  await act(async () => { const select = host.querySelector<HTMLSelectElement>('[role="dialog"] select[name="clinicianId"]')!; select.value = clinician.id; select.dispatchEvent(new Event('change', { bubbles: true })) })
  await submit(); expect(host.querySelector('.appointment-detail')?.textContent).toContain('APT-SERVER'); expect(appointmentsApi.get).not.toHaveBeenCalled()
  await click('Edit / reschedule'); await fill('notes', 'Updated scheduling note'); await submit()
  expect(host.querySelector('.appointment-detail')?.textContent).toContain('Updated scheduling note')
  await click('Confirm'); await click('Back to Appointments'); expect(host.querySelector('table')?.textContent).toContain('Confirmed')
  await click('APT-SERVER'); expect(appointmentsApi.get).toHaveBeenCalledWith(appointment.id, expect.any(AbortSignal))
  await click('Cancel appointment'); await fill('cancellationReason', 'Original reason'); await submit()
  expect(host.querySelector('.appointment-detail')?.textContent).toContain('Original reason'); await click('Back to Appointments')
  expect(host.querySelector('table')?.textContent).toContain('Cancelled')
  expect(host.querySelector('.sidebar nav button.active b')).toBeNull()
})
it('keeps doctor navigation scoped and permits the assigned status lifecycle only', async () => {
  identity.role = 'DOCTOR_IN_CHARGE'; records = [appointment]
  await act(async () => root.render(<App />)); await click('Appointments')
  expect(host.textContent).toContain('My appointments'); expect(visible().some((button) => button.textContent?.includes('Book appointment'))).toBe(false)
  await click('APT-SERVER'); expect(visible().some((button) => /Edit \/ reschedule|Cancel appointment/.test(button.textContent ?? ''))).toBe(false)
  await click('Confirm'); await click('Check in'); await click('Complete'); await click('Back to Appointments')
  expect(host.querySelector('table')?.textContent).toContain('Completed')
  expect(appointmentsApi.clinicians).not.toHaveBeenCalled(); expect(appointmentsApi.create).not.toHaveBeenCalled()
})
