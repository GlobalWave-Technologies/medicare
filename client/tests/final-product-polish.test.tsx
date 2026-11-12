// @vitest-environment jsdom
// Phase 19E behaviour: patient numbers in lists and records, inline registration errors, the phone
// navigation drawer's sign-out and the discharge summary.
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { BackendRole, StaffUser } from '../src/api/auth'
import { admissionsApi } from '../src/api/admissions'
import { dashboardApi } from '../src/api/dashboard'
import { notificationsApi } from '../src/api/notifications'
import { patientsApi } from '../src/api/patients'
import { App } from '../src/app/App'
import { authStore } from '../src/features/auth/auth-store'
import { Patients } from '../src/features/patients/Patients'
import { PatientDetail } from '../src/features/patients/PatientDetail'
import { PatientModal } from '../src/features/patients/PatientModal'
import { DischargeDialog } from '../src/features/admissions/AdmissionDialogs'
import { admission, admissionPage, clinician, patient } from './admission-fixtures'
import { dashboardFor } from './report-fixtures'

const identity = vi.hoisted(() => ({ role: 'RECORDS_OFFICER' as BackendRole }))
vi.mock('../src/features/auth/AuthGate', () => ({ AuthGate: ({ children }: { children: (user: StaffUser) => ReactNode }) => children({
  id: '70000000-0000-4000-8000-000000000019', staffNumber: 'STF-FINAL', firstName: 'Fay', lastName: 'Final', email: 'fay@example.test', status: 'ACTIVE', mustChangePassword: false, role: identity.role }) }))
let host: HTMLDivElement, root: Root
const long = { ...patient, patientNumber: 'PT-5FD1FD28-9391-4EDD-804A-52F0300A5393' }
const user = { ...clinician, email: 'records@example.test', role: 'RECORDS_OFFICER' as const, status: 'ACTIVE' as const, mustChangePassword: false }
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-12T12:00:00Z')); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  vi.spyOn(dashboardApi, 'get').mockImplementation(async () => dashboardFor(identity.role))
  vi.spyOn(notificationsApi, 'unreadCount').mockResolvedValue({ count: 0 })
  vi.spyOn(patientsApi, 'list').mockResolvedValue({ items: [long], pagination: { page: 1, limit: 10, total: 1, totalPages: 1 } })
  vi.spyOn(patientsApi, 'get').mockResolvedValue({ patient: { ...long, dateOfBirth: '1968-09-08' } })
  vi.spyOn(patientsApi, 'create').mockResolvedValue({ patient })
  vi.spyOn(admissionsApi, 'list').mockResolvedValue(admissionPage([]))
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
const render = async (node: ReactNode) => { await act(async () => root.render(node)) }
const tick = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
const button = (name: string) => Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((item) => item.textContent?.trim() === name || item.getAttribute('aria-label') === name)

it('shows the start of a long patient number in lists, keeping the full number for screen readers and the tooltip', async () => {
  await render(<Patients role="RECORDS_OFFICER" onSelect={vi.fn()} onAdd={vi.fn()} refreshKey={0} onViewAdmission={vi.fn()} />); await tick()
  const number = host.querySelector<HTMLElement>('.patients-table .patient-number')!
  expect(number.getAttribute('title')).toBe(long.patientNumber)
  expect(number.querySelector('[aria-hidden="true"]')?.textContent).toBe('PT-5FD1FD28…')
  expect(number.querySelector('.visually-hidden')?.textContent).toBe(long.patientNumber)
  // Search still finds the patient by the full number or any part of it.
  expect(host.querySelector<HTMLInputElement>('input[aria-label="Search patients"]')?.placeholder).toBe('Search by name or patient number…')
})

it('shows the full patient number with a copy button and an unambiguous date of birth on the record', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
  await render(<PatientDetail id={patient.id} user={user} onBack={vi.fn()} onChanged={vi.fn()} />); await tick()
  expect(host.querySelector('.patient-number-full .record-id')?.textContent).toBe(`Patient number ${long.patientNumber}`)
  expect(host.textContent).toContain('8 September 1968'); expect(host.textContent).not.toContain('08/09/1968')
  await act(async () => button('Copy patient number')!.click()); await tick()
  expect(writeText).toHaveBeenCalledExactlyOnceWith(long.patientNumber)
  expect(host.querySelector('.copy-number-status')?.textContent).toBe('Patient number copied')
  await tick(3000); expect(host.querySelector('.copy-number-status')?.textContent).toBe('')
})

it('says how to copy by hand when the clipboard is unavailable', async () => {
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } })
  await render(<PatientDetail id={patient.id} user={user} onBack={vi.fn()} onChanged={vi.fn()} />); await tick()
  await act(async () => button('Copy patient number')!.click()); await tick()
  expect(host.querySelector('[role="status"].copy-number-status')?.textContent).toBe('Copying isn’t available here; select the number to copy it.')
})

it('marks missing names on the fields in the app’s own style instead of browser bubbles', async () => {
  await render(<PatientModal role="DOCTOR_IN_CHARGE" onClose={vi.fn()} onCreated={vi.fn()} />)
  expect(host.querySelector('form')?.noValidate).toBe(true)
  expect(host.querySelector('.register-choices')?.textContent).toBe('Register patient saves the patient record only.Register & admit saves it, then asks for the room to admit them now.')
  await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) }); await tick()
  const first = host.querySelector<HTMLInputElement>('#patient-first-name')!, last = host.querySelector<HTMLInputElement>('#patient-last-name')!
  expect([first.getAttribute('aria-invalid'), last.getAttribute('aria-invalid')]).toEqual(['true', 'true'])
  expect(document.activeElement).toBe(first)
  expect(document.getElementById(first.getAttribute('aria-describedby')!)?.textContent).toBe('Enter the first name.')
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('First and last names are required.')
  expect(patientsApi.create).not.toHaveBeenCalled()
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(first, 'Ama')
    first.dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(first.getAttribute('aria-invalid')).toBeNull(); expect(last.getAttribute('aria-invalid')).toBe('true')
})

it('summarises the patient, admission and room before discharge and says what stays in the history', async () => {
  await render(<DischargeDialog admission={admission} onClose={vi.fn()} onSaved={vi.fn()} />)
  const summary = Array.from(host.querySelectorAll('.stay-summary > div')).map((item) => [item.querySelector('dt')?.textContent, item.querySelector('dd')?.textContent])
  expect(summary.map(([label]) => label)).toEqual(['Patient', 'Admission', 'Room'])
  expect(summary[1]![1]).toBe(admission.admissionNumber); expect(summary[2]![1]).toBe(admission.roomNumber)
  const describedBy = host.querySelector('[role="dialog"]')!.getAttribute('aria-describedby')!
  expect(document.getElementById(describedBy)?.textContent).toContain('stay in their history')
})

it('offers Sign out inside the phone navigation drawer and closes the drawer when it is chosen', async () => {
  identity.role = 'RECORDS_OFFICER'
  const logout = vi.spyOn(authStore, 'logout').mockResolvedValue(undefined)
  await render(<App />); await tick()
  await act(async () => button('Open navigation')!.click())
  const drawer = host.querySelector<HTMLElement>('[role="dialog"]')!
  const signOut = Array.from(drawer.querySelectorAll('button')).find((item) => item.textContent === 'Sign out')!
  expect(signOut.className).toContain('drawer-signout')
  await act(async () => signOut.click()); await tick()
  expect(logout).toHaveBeenCalledOnce(); expect(host.querySelector('[role="dialog"]')).toBeNull()
})

it('keeps search boxes on one row (icon beside the input) even inside the clinical pages’ stacked-label layout', () => {
  const shared = readFileSync(resolve('src/styles/App.css'), 'utf8'), patients = readFileSync(resolve('src/features/patients/patients.css'), 'utf8')
  expect(shared).toMatch(/\.clinical-workspace label:not\(\.patients-search\)/)
  expect(shared).not.toMatch(/\.clinical-workspace label,/)
  expect(patients).toMatch(/\.patients-search \{ display: flex; align-items: center;/)
  const records = readFileSync(resolve('src/features/records/Records.tsx'), 'utf8')
  expect(records).toContain('placeholder="Search name, number or room…"')
})

it('keeps the clinical form’s actions in reach and segment controls on one row on phones', () => {
  const records = readFileSync(resolve('src/features/records/records.css'), 'utf8'), shared = readFileSync(resolve('src/styles/App.css'), 'utf8')
  expect(records).toMatch(/\.clinical-form > \.modal-footer \{ position: sticky; bottom: -24px;/)
  expect(shared).toMatch(/\.report-segments, \.notification-segments \{ display: flex; flex-wrap: nowrap; width: 100%; \}/)
  expect(shared).toMatch(/fieldset \{ min-width: 0; margin: 0; padding: 0; border: 0; \}/)
})
