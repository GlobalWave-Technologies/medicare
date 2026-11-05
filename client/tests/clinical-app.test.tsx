// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { BackendRole, StaffUser } from '../src/api/auth'
import { encountersApi, type Encounter } from '../src/api/encounters'
import { appointmentsApi } from '../src/api/appointments'
import { patientsApi } from '../src/api/patients'
import { App } from '../src/app/App'
import { clinicalPage, doctor, eligibleAppointment, encounter, patient, reviewed } from './clinical-fixtures'
const identity = vi.hoisted(() => ({ role: 'DOCTOR_IN_CHARGE' as BackendRole }))
vi.mock('../src/features/auth/AuthGate', () => ({ AuthGate: ({ children }: { children: (user: StaffUser) => ReactNode }) => children({ id: '22222222-2222-4222-8222-222222222222', staffNumber: 'STF-DOCTOR', firstName: 'Grace', lastName: 'Doctor', email: 'qa@example.test', role: identity.role, status: 'ACTIVE' }) }))
let root: Root, host: HTMLDivElement, records: Encounter[]
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-01T12:00:00Z')); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host); records = []
  vi.spyOn(patientsApi, 'list').mockResolvedValue({ items: [patient], pagination: clinicalPage.pagination }); vi.spyOn(patientsApi, 'get').mockResolvedValue({ patient })
  vi.spyOn(appointmentsApi, 'list').mockResolvedValue({ items: [eligibleAppointment], pagination: clinicalPage.pagination }); vi.spyOn(appointmentsApi, 'get').mockResolvedValue({ appointment: eligibleAppointment }); vi.spyOn(appointmentsApi, 'clinicians').mockResolvedValue({ clinicians: [doctor] })
  vi.spyOn(appointmentsApi, 'changeStatus').mockResolvedValue({ appointment: { ...eligibleAppointment, status: 'COMPLETED' } })
  vi.spyOn(encountersApi, 'list').mockImplementation(async () => ({ items: records, pagination: { ...clinicalPage.pagination, total: records.length } }))
  vi.spyOn(encountersApi, 'history').mockImplementation(async () => ({ items: records, pagination: { ...clinicalPage.pagination, total: records.length } }))
  vi.spyOn(encountersApi, 'get').mockImplementation(async () => ({ encounter: records[0]! }))
  vi.spyOn(encountersApi, 'create').mockImplementation(async (input) => { records = [{ ...encounter, appointment: input.appointmentId ? encounter.appointment : null, clinicalNotes: input.clinicalNotes ?? null }]; return { encounter: records[0]! } })
  vi.spyOn(encountersApi, 'updateDraft').mockImplementation(async (_record, input) => { records = [{ ...records[0]!, clinicalNotes: input.clinicalNotes ?? records[0]!.clinicalNotes }]; return { encounter: records[0]! } })
  vi.spyOn(encountersApi, 'finalize').mockImplementation(async () => { records = [{ ...records[0]!, status: 'REVIEWED', reviewedAt: reviewed.reviewedAt }]; return { encounter: records[0]! } })
  vi.spyOn(encountersApi, 'amend').mockImplementation(async (_id, input) => { records = [{ ...records[0]!, amendments: [...records[0]!.amendments, { id: `amendment-${records[0]!.amendments.length}`, ...input, author: doctor, createdAt: '2026-11-01T12:00:00Z' }] }]; return { encounter: records[0]! } })
  vi.spyOn(Storage.prototype, 'setItem'); vi.spyOn(console, 'log'); vi.spyOn(console, 'error')
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals() })
const visible = () => Array.from(host.querySelectorAll<HTMLButtonElement>('button')).filter((button) => !button.closest('[hidden]'))
const tick = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(0) }) }
async function click(text: string) { await act(async () => visible().find((button) => button.textContent?.trim() === text)!.click()); await tick() }
async function fill(name: string, value: string) {
  await act(async () => { const input = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`)!; Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) })
}
const submit = async () => { await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); await tick() }
it.each(['ADMIN', 'RECORDS_OFFICER'] as const)('%s keeps patient/appointment access demographic-only with no clinical fetches', async (role) => {
  identity.role = role; await act(async () => root.render(<App />)); await tick()
  expect(host.querySelector('.sidebar')!.textContent).not.toContain('Medical records')
  await click('Patients'); await click('Amina Patient'); expect(host.textContent).toContain('Clinical history is not displayed'); expect(visible().some((button) => button.textContent === 'View clinical history')).toBe(false)
  await click('Appointments'); await click('APT-SERVER'); expect(host.textContent).toContain('Clinical documentation for this visit is kept in Medical Records'); expect(visible().some((button) => /Start clinical|Open clinical/.test(button.textContent ?? ''))).toBe(false)
  expect(encountersApi.list).not.toHaveBeenCalled(); expect(encountersApi.history).not.toHaveBeenCalled(); expect(encountersApi.get).not.toHaveBeenCalled()
})
it('doctor explicitly enters patient history, saves, edits, finalizes and appends two immutable corrections', async () => {
  identity.role = 'DOCTOR_IN_CHARGE'; await act(async () => root.render(<App />)); await click('Patients'); await click('Amina Patient')
  expect(encountersApi.history).not.toHaveBeenCalled(); await click('View clinical history'); expect(encountersApi.history).toHaveBeenCalledWith(patient.id, expect.anything(), expect.any(AbortSignal))
  await click('New encounter for this patient'); await fill('clinicalNotes', 'Entered clinical text'); await submit(); expect(host.querySelector('.clinical-detail')!.textContent).toContain('Draft saved'); expect(encountersApi.get).not.toHaveBeenCalled()
  await click('Edit draft'); await fill('clinicalNotes', 'Original finalized clinical text'); await submit(); await click('Refresh clinical record'); expect(encountersApi.get).toHaveBeenCalledWith(encounter.id, expect.any(AbortSignal))
  await click('Finalize record'); await submit(); expect(visible().some((button) => button.textContent === 'Edit draft')).toBe(false)
  for (const index of [1, 2]) { await click('Add amendment'); await fill('amendmentReason', `Reason ${index}`); await fill('amendmentContent', `Correction ${index}`); await submit() }
  expect(host.querySelector('.clinical-original')!.textContent).toContain('Original finalized clinical text'); expect(host.querySelector('.clinical-original')!.textContent).not.toContain('Correction')
  expect(host.querySelectorAll('.clinical-amendments article')).toHaveLength(2)
  expect(Storage.prototype.setItem).not.toHaveBeenCalled(); expect(console.log).not.toHaveBeenCalled(); expect(console.error).not.toHaveBeenCalled()
  await click('Back to patient'); expect(host.querySelector('.patient-detail')!.textContent).toContain('Amina Patient')
})
it('doctor starts from an eligible appointment and subsequently opens its existing record', async () => {
  identity.role = 'DOCTOR_IN_CHARGE'; await act(async () => root.render(<App />)); await click('Appointments'); await click('APT-SERVER'); await click('Start clinical encounter')
  await fill('clinicalNotes', 'Appointment clinical note'); await submit(); expect(encountersApi.create).toHaveBeenCalledWith(expect.objectContaining({ patientId: patient.id, appointmentId: eligibleAppointment.id }), expect.stringMatching(/^[0-9a-f-]{36}$/))
  await click('Back to appointment'); await click('Open clinical record'); expect(encountersApi.get).toHaveBeenCalledWith(encounter.id, expect.any(AbortSignal)); expect(host.querySelector('.clinical-detail')!.textContent).toContain('Appointment clinical note')
  expect(encountersApi.create).toHaveBeenCalledOnce()
})
it('appointment completion remains separate from encounter creation', async () => {
  identity.role = 'DOCTOR_IN_CHARGE'; await act(async () => root.render(<App />)); await click('Appointments'); await click('APT-SERVER'); await click('Complete')
  expect(appointmentsApi.changeStatus).toHaveBeenCalledWith(eligibleAppointment.id, 'COMPLETED'); expect(encountersApi.create).not.toHaveBeenCalled(); expect(visible().some((button) => button.textContent === 'Start clinical encounter')).toBe(true)
})
it('standalone clinical list reads other authors without edit controls', async () => {
  identity.role = 'DOCTOR_IN_CHARGE'; records = [{ ...encounter, author: { ...doctor, id: 'other' }, clinician: { ...doctor, id: 'other' } }]
  await act(async () => root.render(<App />)); await click('Medical Records'); await click('MR-SERVER')
  expect(host.querySelector('.clinical-detail')!.textContent).toContain('Original clinical notes'); expect(visible().some((button) => /Edit draft|Finalize record|Add amendment/.test(button.textContent ?? ''))).toBe(false)
})
