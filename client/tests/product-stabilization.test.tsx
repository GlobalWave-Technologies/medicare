// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { App } from '../src/app/App'
import { Dialog } from '../src/components/ui/Dialog'
import { ErrorBoundary } from '../src/components/ui/ErrorBoundary'
import { reportRenderFailure } from '../src/components/ui/reportRenderFailure'
import { PatientModal } from '../src/features/patients/PatientModal'
import { PatientDetail } from '../src/features/patients/PatientDetail'
import { AppointmentForm } from '../src/features/appointments/AppointmentForm'
import { AppointmentDetail } from '../src/features/appointments/AppointmentDetail'
import { PatientPicker } from '../src/features/appointments/AppointmentPickers'
import { Records } from '../src/features/records/Records'
import { Patients } from '../src/features/patients/Patients'
import { Appointments } from '../src/features/appointments/Appointments'
import { EncounterList } from '../src/features/records/EncounterList'
import { ClinicalCommand } from '../src/features/records/ClinicalCommands'
import { patientsApi } from '../src/api/patients'
import { appointmentsApi } from '../src/api/appointments'
import { encountersApi } from '../src/api/encounters'
import { notificationsApi } from '../src/api/notifications'
import { staffApi } from '../src/api/staff'
import { dashboardApi } from '../src/api/dashboard'
import { reportsApi } from '../src/api/reports'
import { appointmentReport, clinicalReport, dashboardFor, patientReport } from './report-fixtures'
import { authStore } from '../src/features/auth/auth-store'
import type { BackendRole, StaffUser } from '../src/api/auth'
import { doctor, eligibleAppointment, reviewed as finalized } from './clinical-fixtures'
import { patient, appointment, clinician, page } from './appointment-fixtures'

const identity = vi.hoisted(() => ({ role: 'ADMIN' as BackendRole }))
vi.mock('../src/features/auth/AuthGate', () => ({ AuthGate: ({ children }: { children: (user: StaffUser) => ReactNode }) => children({ id: '22222222-2222-4222-8222-222222222222', firstName: 'Audit', lastName: 'Staff', email: 'audit@example.test', staffNumber: 'STF-AUDIT', status: 'ACTIVE', role: identity.role }) }))
let host: HTMLDivElement, root: Root
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-01T12:00:00Z')); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host, { onCaughtError: () => {} })
  vi.spyOn(patientsApi, 'list').mockResolvedValue({ items: [], pagination: { ...page.pagination, total: 0 } })
  vi.spyOn(patientsApi, 'get').mockResolvedValue({ patient })
  vi.spyOn(appointmentsApi, 'list').mockResolvedValue({ items: [], pagination: { ...page.pagination, total: 0 } })
  vi.spyOn(appointmentsApi, 'clinicians').mockResolvedValue({ clinicians: [clinician] })
  vi.spyOn(encountersApi, 'list').mockResolvedValue({ items: [], pagination: { ...page.pagination, total: 0 } })
  vi.spyOn(notificationsApi, 'unreadCount').mockResolvedValue({ count: 0 })
  vi.spyOn(notificationsApi, 'list').mockResolvedValue({ items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } })
  vi.spyOn(staffApi, 'list').mockResolvedValue({ users: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } })
  vi.spyOn(dashboardApi, 'get').mockImplementation(async () => dashboardFor(identity.role))
  vi.spyOn(reportsApi, 'patients').mockResolvedValue(patientReport)
  vi.spyOn(reportsApi, 'appointments').mockResolvedValue(appointmentReport)
  vi.spyOn(reportsApi, 'clinicalActivity').mockResolvedValue(clinicalReport)
  vi.spyOn(window, 'confirm').mockReturnValue(false)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals() })
const render = async (node: ReactNode) => { await act(async () => root.render(node)); await tick() }
const tick = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(300) }) }
const button = (text: string) => Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(b => b.textContent?.trim() === text && !b.closest('[hidden]'))!
const click = async (text: string) => { await act(async () => button(text).click()); await tick() }
async function fill(name: string, value: string) {
  await act(async () => {
    const el = host.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`[name="${name}"]`)!
    const prototype = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
}

it.each(['ADMIN', 'RECORDS_OFFICER', 'DOCTOR_IN_CHARGE'] as const)('%s sees no fake metrics, unread badges, broadcasts or unauthorized controls', async role => {
  identity.role = role; await render(<App />)
  expect(host.textContent).not.toMatch(/2,048|1,279|12.5%|LIVE OVERVIEW|Broadcast alert|Settings|Bed update/)
  expect(host.querySelector('.sidebar b, .notification, .nav-badge')).toBeNull()
  expect(Boolean(button('Medical Records'))).toBe(role === 'DOCTOR_IN_CHARGE')
  expect(Boolean(button('Staff & Access'))).toBe(role === 'ADMIN')
  await click('Notifications'); expect(host.textContent).toContain('You’re all caught up'); expect(host.textContent).not.toContain('not available yet')
  expect(host.textContent).not.toMatch(/Staff briefing|Send broadcast/); expect(Boolean(button('New broadcast'))).toBe(role === 'ADMIN')
  await click('Reports'); expect(host.textContent).not.toMatch(/being prepared|not available|Export|Download|Print|Updated today|Top diagnoses|complaint/i)
  expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent ?? host.querySelector('#report-title')?.textContent).toBe(role === 'DOCTOR_IN_CHARGE' ? 'My clinical activity' : 'Patient activity')
  expect(encountersApi.list).not.toHaveBeenCalled()
})
it('makes admin task cards navigate and opens the real staff workspace', async () => {
  identity.role = 'ADMIN'; await render(<App />)
  const card = Array.from(host.querySelectorAll<HTMLButtonElement>('.workflow-card')).find(b => b.textContent?.includes('Patient directory'))!
  await act(async () => card.click()); await tick(); expect(host.querySelector('h2')?.textContent).toBe('Patient directory')
  await click('Staff & Access'); expect(host.querySelector('h2')?.textContent).toBe('Staff directory')
  expect(host.textContent).not.toMatch(/not available|NOT YET AVAILABLE/); expect(staffApi.list).toHaveBeenCalled()
  expect(host.querySelector('[aria-current="page"]')?.textContent).toBe('Staff & Access')
})
it('opens/closes navigation with focus, inert background and Escape restoration', async () => {
  identity.role = 'ADMIN'; await render(<App />)
  const trigger = host.querySelector<HTMLButtonElement>('[aria-label="Open navigation"]')!; trigger.focus()
  await act(async () => trigger.click())
  expect(trigger.getAttribute('aria-expanded')).toBe('true')
  expect(host.querySelector('main')!.inert).toBe(true)
  expect(document.activeElement).toBe(host.querySelector('[role="dialog"]'))
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(host.querySelector('[role="dialog"]')).toBeNull(); expect(document.activeElement).toBe(trigger); expect(host.querySelector('main')!.inert).not.toBe(true)
})
it('traps modal focus, includes textareas and links, freezes dismissal and restores scroll', async () => {
  const close = vi.fn(); document.body.style.overflow = 'auto'
  await render(<><button>Outside</button><Dialog title="Test dialog" busy onClose={close}><textarea aria-label="Note" /><a href="#test">Section</a></Dialog></>)
  expect(document.body.style.overflow).toBe('hidden'); expect(button('Outside').inert).toBe(true)
  button('Outside').focus(); expect(document.activeElement).toBe(host.querySelector('[role="dialog"]'))
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true })))
  expect(document.activeElement?.textContent).toBe('Section')
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(close).not.toHaveBeenCalled()
  await render(<p>Closed</p>); expect(document.body.style.overflow).toBe('auto'); document.body.style.overflow = ''
})
it('restores focus to the page heading when a mutation removes its opener', async () => {
  const title = document.createElement('h1'); title.tabIndex = -1; title.dataset.pageTitle = ''; document.body.append(title)
  await render(<Dialog title="Finalize" onClose={vi.fn()}><button>Confirm</button></Dialog>)
  await render(<p>Finalized</p>); expect(document.activeElement).toBe(title); title.remove()
})
it('guards dirty patient close and page unload without sending a mutation', async () => {
  const close = vi.fn(), create = vi.spyOn(patientsApi, 'create')
  await render(<PatientModal role="ADMIN" onClose={close} onCreated={vi.fn()} />); await fill('firstName', 'Unsaved')
  await click('Cancel'); expect(close).not.toHaveBeenCalled()
  const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true)
  vi.mocked(window.confirm).mockReturnValue(true); await click('Cancel'); expect(close).toHaveBeenCalledOnce(); expect(create).not.toHaveBeenCalled()
})
it('guards dirty appointment close without losing the selected fields', async () => {
  const close = vi.fn(); await render(<AppointmentForm role="ADMIN" appointment={appointment} onClose={close} onSaved={vi.fn()} />)
  await fill('notes', 'Unsaved schedule'); await click('Cancel'); expect(close).not.toHaveBeenCalled()
  expect(host.querySelector<HTMLTextAreaElement>('[name="notes"]')!.value).toBe('Unsaved schedule')
  vi.mocked(window.confirm).mockReturnValue(true); await click('Cancel'); expect(close).toHaveBeenCalledOnce()
})
it('protects an unsaved amendment against page unload', async () => {
  await render(<ClinicalCommand encounter={finalized} action="amend" onClose={vi.fn()} onSaved={vi.fn()} />)
  await fill('amendmentContent', 'Unsaved correction')
  const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true)
})
it('refreshes patient detail from the server after initial registration', async () => {
  await render(<PatientDetail id={patient.id} initialPatient={patient} role="ADMIN" onBack={vi.fn()} onChanged={vi.fn()} />)
  expect(patientsApi.get).not.toHaveBeenCalled(); await click('Refresh patient'); expect(patientsApi.get).toHaveBeenCalledWith(patient.id, expect.any(AbortSignal))
})
it('renders semantic patient columns with long identities and a clear empty recovery', async () => {
  vi.mocked(patientsApi.list).mockResolvedValue({ items: [{ ...patient, lastName: 'Very-long-name-'.repeat(12) }], pagination: page.pagination })
  await render(<Patients role="ADMIN" onAdd={vi.fn()} onSelect={vi.fn()} />)
  expect(host.querySelectorAll('th[scope="col"]')).toHaveLength(5)
  expect(host.querySelector('tbody')?.textContent).toContain('Very-long-name-'.repeat(12))
  const search = host.querySelector<HTMLInputElement>('[aria-label="Search patients"]')!; search.name = 'search'; await fill('search', 'missing'); await tick()
  await click('Clear patient filters'); expect(search.value).toBe('')
})
it('stops unused patient lookup requests after a patient is selected', async () => {
  await render(<PatientPicker selected={patient} onSelect={vi.fn()} />); expect(patientsApi.list).not.toHaveBeenCalled()
  await render(<PatientPicker selected={null} onSelect={vi.fn()} />); expect(patientsApi.list).toHaveBeenCalledOnce()
})
it('confirms booking and gives the next appointment step without exposing clinical data to admin', async () => {
  await render(<AppointmentDetail id={appointment.id} initialAppointment={appointment} user={{ ...doctor, role: 'ADMIN' }} onBack={vi.fn()} onChanged={vi.fn()} />)
  expect(host.querySelector('.appointment-detail .notice')?.textContent).toBe('Appointment booked.'); expect(host.textContent).toContain('Confirm the visit before checking')
  expect(button('Mark no-show').className).toContain('button-danger-quiet'); expect(encountersApi.list).not.toHaveBeenCalled()
})
it('resets appointment filters to a fresh first-page query', async () => {
  await render(<Appointments user={doctor} onBook={vi.fn()} onSelect={vi.fn()} />)
  await fill('status', 'CANCELLED'); await tick(); await click('Reset appointment filters')
  expect(appointmentsApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1 }), expect.any(AbortSignal))
  expect(vi.mocked(appointmentsApi.list).mock.calls.at(-1)![0]!.status).toBeUndefined()
})
it('clears clinical filters using a fresh bounded server query', async () => {
  await render(<EncounterList user={doctor} revision={0} onSelect={vi.fn()} />)
  await fill('clinicalStatus', 'REVIEWED'); await tick(); await click('Clear clinical filters')
  expect(encountersApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, limit: 20 }), expect.any(AbortSignal))
  expect(vi.mocked(encountersApi.list).mock.calls.at(-1)![0]!.status).toBeUndefined()
})
it('recovers cancelled linked creation through discovery and opens a record created elsewhere', async () => {
  await render(<Records user={doctor} context={{ kind: 'appointment', appointment: eligibleAppointment }} onBack={vi.fn()} onChoosePatient={vi.fn()} />)
  await click('Cancel'); expect(button('Start clinical encounter')).toBeDefined()
  vi.mocked(encountersApi.list).mockResolvedValue({ items: [finalized], pagination: page.pagination })
  vi.spyOn(encountersApi, 'get').mockResolvedValue({ encounter: finalized })
  await click('Refresh linked record'); await click('Open clinical record')
  expect(host.textContent).toContain('Original finalized record'); expect(host.querySelector('form')).toBeNull()
})
it('keeps a failed sign-out visible and prevents duplicate pending sign-out calls', async () => {
  identity.role = 'ADMIN'; let fail!: (error: Error) => void
  const logout = vi.spyOn(authStore, 'logout').mockImplementation(() => new Promise((_resolve, reject) => { fail = reject }))
  await render(<App />); await click('Sign out'); expect(logout).toHaveBeenCalledOnce()
  expect(host.querySelector('[aria-label="Signing out"]')?.hasAttribute('disabled')).toBe(true)
  await act(async () => fail(new Error('private internal error')))
  expect(host.textContent).toContain('Sign-out could not be confirmed'); expect(host.textContent).not.toContain('private internal error')
})
it('offers a safe render recovery without displaying raw error details', async () => {
  let fail = true
  function Broken() { if (fail) throw new Error('sensitive clinical narrative'); return <p>Recovered screen</p> }
  await render(<ErrorBoundary><Broken /></ErrorBoundary>); expect(host.textContent).toContain('Something went wrong'); expect(host.textContent).not.toContain('sensitive clinical narrative')
  fail = false; await click('Try again'); expect(host.textContent).toContain('Recovered screen')
})

it('reports render failures without serializing clinical error objects', () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  const handler: (error: Error, info: { componentStack: string }) => void = reportRenderFailure
  handler(new Error('sensitive clinical narrative'), { componentStack: 'private details' })
  expect(log).toHaveBeenCalledExactlyOnceWith('A screen could not be displayed. Use the recovery screen to continue.')
})
