// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { BackendRole, StaffUser } from '../src/api/auth'
import { ApiError } from '../src/api/client'
import { appointmentsApi } from '../src/api/appointments'
import { dashboardApi } from '../src/api/dashboard'
import { encountersApi } from '../src/api/encounters'
import { notificationsApi } from '../src/api/notifications'
import { patientsApi } from '../src/api/patients'
import { App } from '../src/app/App'
import { ErrorBoundary } from '../src/components/ui/ErrorBoundary'
import { Login } from '../src/features/auth/Login'
import { PatientModal } from '../src/features/patients/PatientModal'
import { PatientDetail } from '../src/features/patients/PatientDetail'
import { Patients } from '../src/features/patients/Patients'
import { Appointments } from '../src/features/appointments/Appointments'
import { AppointmentDetail } from '../src/features/appointments/AppointmentDetail'
import { AppointmentForm } from '../src/features/appointments/AppointmentForm'
import { AppointmentCancellation } from '../src/features/appointments/AppointmentCancellation'
import { EncounterDetail } from '../src/features/records/EncounterDetail'
import { EncounterForm } from '../src/features/records/EncounterForm'
import { EncounterList } from '../src/features/records/EncounterList'
import { ClinicalCommand } from '../src/features/records/ClinicalCommands'
import { BroadcastComposer } from '../src/features/notifications/BroadcastComposer'
import { appointment, clinician, page, patient } from './appointment-fixtures'
import { clinicalPage, doctor, encounter, reviewed } from './clinical-fixtures'
import { dashboardFor } from './report-fixtures'

const identity = vi.hoisted(() => ({ role: 'ADMIN' as BackendRole }))
vi.mock('../src/features/auth/AuthGate', () => ({ AuthGate: ({ children }: { children: (user: StaffUser) => ReactNode }) => children({
  id: '70000000-0000-4000-8000-000000000007', staffNumber: 'STF-POLISH', firstName: 'Pat', lastName: 'Polish', email: 'pat@example.test', status: 'ACTIVE', role: identity.role }) }))
let host: HTMLDivElement, root: Root
const admin = { ...clinician, email: 'qa@example.test', role: 'ADMIN' as const, status: 'ACTIVE' as const }
const empty = { items: [], pagination: { ...page.pagination, total: 0, totalPages: 0 } }
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-01T12:00:00Z')); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  vi.spyOn(dashboardApi, 'get').mockImplementation(async () => dashboardFor(identity.role))
  vi.spyOn(notificationsApi, 'unreadCount').mockResolvedValue({ count: 0 })
  vi.spyOn(patientsApi, 'list').mockResolvedValue({ items: [patient], pagination: { page: 1, limit: 10, total: 1, totalPages: 1 } })
  vi.spyOn(patientsApi, 'get').mockResolvedValue({ patient })
  vi.spyOn(appointmentsApi, 'list').mockResolvedValue(page); vi.spyOn(appointmentsApi, 'clinicians').mockResolvedValue({ clinicians: [clinician] })
  vi.spyOn(encountersApi, 'list').mockResolvedValue(clinicalPage); vi.spyOn(encountersApi, 'history').mockResolvedValue(clinicalPage)
  vi.spyOn(window, 'confirm').mockReturnValue(false)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
const render = async (node: ReactNode) => { await act(async () => root.render(node)) }
const tick = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
const button = (text: string) => Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((item) => item.textContent?.trim() === text)
const click = async (text: string) => { await act(async () => button(text)!.click()); await tick() }
const nav = async (label: string) => { await act(async () => Array.from(host.querySelectorAll<HTMLButtonElement>('.desktop-sidebar nav button')).find((item) => item.querySelector('span')?.textContent === label)!.click()); await tick() }
async function fill(name: string, value: string) {
  await act(async () => {
    const input = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`)!
    Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const submit = async () => { await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) }); await tick() }
const dialog = () => host.querySelector<HTMLElement>('[role="dialog"]')
const footer = () => Array.from(dialog()!.querySelectorAll<HTMLButtonElement>('.modal-footer button')).map((item) => [item.textContent, item.className.replace('button ', '')])
const css = (file: string) => readFileSync(resolve(file), 'utf8')

it('names each workspace the same way in navigation, breadcrumb and heading, and shows who is signed in', async () => {
  identity.role = 'ADMIN'; await render(<App />); await tick()
  await nav('Staff & Access')
  expect(host.querySelector('[aria-current="page"]')?.textContent).toBe('Staff & Access')
  expect(host.querySelector('h1')?.textContent).toBe('Staff & Access'); expect(host.querySelector('.breadcrumbs')?.textContent).toBe('Medicare / Staff & Access')
  expect(host.querySelector('.desktop-sidebar .sidebar-identity')?.textContent).toBe('PPSigned in as Pat PolishAdministrator')
  expect(host.querySelector('.desktop-sidebar .brand-copy')?.textContent).toBe('MedicareHospital Records'); expect(host.querySelector('.topbar-brand .brand-copy strong')?.textContent).toBe('Medicare')
  expect(host.querySelector('.page-heading .eyebrow')).toBeNull()
})
it('shows where a detail view sits in the breadcrumb', async () => {
  identity.role = 'RECORDS_OFFICER'; await render(<App />); await tick()
  await nav('Patients'); await click('Amina Patient')
  expect(host.querySelector('.breadcrumbs')?.textContent).toBe('Patients / Patient record')
  await click('Back to Patients'); expect(host.querySelector('.breadcrumbs')?.textContent).toBe('Medicare / Patients')
})
it('returns to a workspace’s landing view when its navigation item is chosen again', async () => {
  identity.role = 'DOCTOR_IN_CHARGE'; vi.spyOn(encountersApi, 'get').mockResolvedValue({ encounter })
  await render(<App />); await tick()
  await nav('Medical Records'); await click(encounter.reference)
  expect(host.querySelector('.clinical-detail')).not.toBeNull(); expect(host.querySelector('.clinical-history')?.closest('[hidden]')).not.toBeNull()
  expect(button('Choose patient for new encounter')).toBeUndefined(); expect(Array.from(host.querySelectorAll('main .button-primary')).every((item) => item.closest('.clinical-detail'))).toBe(true)
  await nav('Medical Records')
  expect(host.querySelector('.clinical-detail')).toBeNull(); expect(host.querySelector('.clinical-history')?.closest('[hidden]')).toBeNull()
  expect(button('Choose patient for new encounter')).toBeDefined()
})
it('uses the role’s own wording for the Medical Records and Patients headers', async () => {
  identity.role = 'DOCTOR_IN_CHARGE'; await render(<App />); await tick()
  await nav('Medical Records'); expect(host.querySelector('h1')?.textContent).toBe('Medical Records'); expect(host.querySelector('.subheading')?.textContent).toBe('Document and review clinical encounters.')
  await nav('Patients'); expect(host.querySelector('.subheading')?.textContent).toBe('Find patients and open their clinical history.')
})
it('gives the sign-in screen one page heading, the product wordmark and a plain sign-in action', async () => {
  await render(<Login onLogin={vi.fn()} />)
  expect(Array.from(host.querySelectorAll('h1')).map((item) => item.textContent)).toEqual(['Sign in to your workspace'])
  expect(host.querySelector('.brand-copy strong')?.textContent).toBe('Medicare'); expect(host.textContent).toContain('© 2026 Medicare Hospital Records')
  const action = host.querySelector<HTMLButtonElement>('button[type="submit"]')!
  expect(action.textContent).toBe('Sign in'); expect(action.querySelector('svg')).toBeNull()
  expect(host.querySelector('[style]')).toBeNull()
})
it('brands the recovery screen like the rest of the product', async () => {
  const Broken = () => { throw new Error('render failure') }
  vi.spyOn(console, 'error').mockImplementation(() => {})
  await render(<ErrorBoundary><Broken /></ErrorBoundary>)
  expect(host.querySelector('.brand-copy strong')?.textContent).toBe('Medicare'); expect(host.querySelector('h1')?.textContent).toBe('Something went wrong')
})
it('links every field description it announces to text that exists', async () => {
  const forms: ReactNode[] = [
    <PatientModal key="p" role="RECORDS_OFFICER" onClose={vi.fn()} onCreated={vi.fn()} />,
    <AppointmentForm key="a" role="RECORDS_OFFICER" onClose={vi.fn()} onSaved={vi.fn()} />,
    <EncounterForm key="e" user={doctor} patient={patient} onClose={vi.fn()} onSaved={vi.fn()} />,
    <ClinicalCommand key="c" encounter={reviewed} action="amend" onClose={vi.fn()} onSaved={vi.fn()} />,
    <BroadcastComposer key="b" onClose={vi.fn()} onSent={vi.fn()} />,
  ]
  for (const form of forms) {
    await render(form); await tick()
    const missing = Array.from(host.querySelectorAll('[aria-describedby]')).flatMap((item) => item.getAttribute('aria-describedby')!.split(' ')).filter((id) => !document.getElementById(id))
    expect(missing).toEqual([])
    await render(null)
  }
  await render(<PatientModal role="RECORDS_OFFICER" onClose={vi.fn()} onCreated={vi.fn()} />)
  expect(host.querySelector('#patient-phone')?.getAttribute('aria-describedby')).toBe('patient-phone-help'); expect(host.querySelector('#patient-phone-help')?.textContent).toContain('7–15 digits')
})
it('orders every dialog footer as Cancel, then one primary or danger action, at a size that fits the task', async () => {
  const cases: [ReactNode, [string, string][], string][] = [
    [<PatientModal key="p" role="RECORDS_OFFICER" onClose={vi.fn()} onCreated={vi.fn()} />, [['Cancel', 'button-ghost'], ['Register patient', 'button-primary']], 'standard'],
    [<AppointmentForm key="a" role="RECORDS_OFFICER" onClose={vi.fn()} onSaved={vi.fn()} />, [['Cancel', 'button-ghost'], ['Book appointment', 'button-primary']], 'standard'],
    [<AppointmentCancellation key="c" appointment={appointment} onClose={vi.fn()} onSaved={vi.fn()} />, [['Keep appointment', 'button-ghost'], ['Confirm cancellation', 'button-danger']], 'compact'],
    [<EncounterForm key="e" user={doctor} patient={patient} onClose={vi.fn()} onSaved={vi.fn()} />, [['Cancel', 'button-ghost'], ['Save draft', 'button-primary']], 'wide'],
    [<ClinicalCommand key="f" encounter={encounter} action="finalize" onClose={vi.fn()} onSaved={vi.fn()} />, [['Cancel', 'button-ghost'], ['Confirm finalization', 'button-primary']], 'compact'],
    [<ClinicalCommand key="m" encounter={reviewed} action="amend" onClose={vi.fn()} onSaved={vi.fn()} />, [['Cancel', 'button-ghost'], ['Add permanent amendment', 'button-primary']], 'standard'],
    [<BroadcastComposer key="b" onClose={vi.fn()} onSent={vi.fn()} />, [['Cancel', 'button-ghost'], ['Send broadcast', 'button-primary']], 'standard'],
  ]
  for (const [node, buttons, size] of cases) {
    await render(node); await tick()
    expect(footer()).toEqual(buttons)
    expect(['compact', 'wide'].find((name) => dialog()!.classList.contains(`modal-${name}`)) ?? 'standard').toBe(size)
    await render(null)
  }
})
it('uses a compact warning dialog to confirm an archive', async () => {
  await render(<PatientDetail id={patient.id} initialPatient={patient} role="RECORDS_OFFICER" onBack={vi.fn()} onChanged={vi.fn()} />)
  await click('Archive patient')
  expect(dialog()!.classList.contains('modal-compact')).toBe(true); expect(dialog()!.querySelector('.callout.tone-warning')?.textContent).toContain('will not be deleted')
  expect(footer()).toEqual([['Cancel', 'button-ghost'], ['Confirm archive', 'button-danger']])
})
it('tells staff exactly what is safe after each kind of unconfirmed patient save', async () => {
  vi.spyOn(patientsApi, 'update').mockRejectedValueOnce(new TypeError('Failed to fetch'))
  await render(<PatientModal role="RECORDS_OFFICER" patient={patient} onClose={vi.fn()} onCreated={vi.fn()} />)
  await fill('phone', '+15550100999'); await submit()
  expect(dialog()!.querySelector('[role="alert"] p')?.textContent).toBe('The changes could not be confirmed. Select Save changes again, or close this form and check the patient record.')
  await render(null)
  vi.spyOn(patientsApi, 'archive').mockRejectedValueOnce(new ApiError(502, 'upstream', 'GATEWAY_ERROR', 'req-archive'))
  await render(<PatientDetail id={patient.id} initialPatient={patient} role="RECORDS_OFFICER" onBack={vi.fn()} onChanged={vi.fn()} />)
  await click('Archive patient'); await click('Confirm archive')
  const alert = dialog()!.querySelector('[role="alert"]')!
  expect(alert.querySelector('p')?.textContent).toBe('The status change could not be confirmed. Close this and refresh the patient record to check its current status before trying again.')
  expect(alert.querySelector('small')?.textContent).toBe('Support reference: req-archive')
})
it('keeps a patient’s identity, archive state and clinical entry point easy to find', async () => {
  const archived = { ...patient, archivedAt: '2026-10-30T10:00:00Z' }
  await render(<PatientDetail id={patient.id} initialPatient={archived} role="DOCTOR_IN_CHARGE" onBack={vi.fn()} onChanged={vi.fn()} onClinical={vi.fn()} />)
  expect(host.querySelector('.detail-title h2')?.textContent).toBe('Amina Patient'); expect(host.querySelector('.detail-title .status')?.textContent).toBe('Archived')
  expect(host.querySelector('.record-id')?.textContent).toBe(`Patient number ${patient.patientNumber}`)
  expect(host.querySelector('.patient-archived-note')?.textContent).toContain('This patient is archived.')
  expect(host.querySelector('.patient-clinical .button-primary')?.textContent).toBe('View clinical history')
})
it('separates the next lifecycle step from booking changes on an appointment', async () => {
  await render(<AppointmentDetail id={appointment.id} initialAppointment={{ ...appointment, status: 'CONFIRMED' }} user={admin} onBack={vi.fn()} onChanged={vi.fn()} />)
  const step = host.querySelector('.appointment-step')!, manage = host.querySelector('.appointment-manage')!
  expect(step.querySelector('h3')?.textContent).toBe('Next step')
  expect(Array.from(step.querySelectorAll('button')).map((item) => [item.textContent, item.className])).toEqual([['Check in', 'button button-primary'], ['Mark no-show', 'button button-danger-quiet']])
  expect(Array.from(manage.querySelectorAll('button')).map((item) => [item.textContent, item.className])).toEqual([['Edit / reschedule', 'button button-ghost'], ['Cancel appointment', 'button button-danger-quiet']])
  expect(manage.querySelector('.button-primary')).toBeNull()
  expect(host.querySelector('.appointment-detail h2')?.textContent).toBe(appointment.reference)
  expect(host.querySelector('.appointment-detail .notice')?.textContent).toBe('Appointment booked.')
})
it('reads a finalized record in clinical order with the product’s own status words', async () => {
  await render(<EncounterDetail user={doctor} id={reviewed.id} initial={reviewed} onBack={vi.fn()} onChanged={vi.fn()} />)
  expect(Array.from(host.querySelectorAll('.clinical-original .clinical-block h4')).map((item) => item.textContent)).toEqual(['Complaints', 'History summary', 'Clinical notes', 'Diagnoses', 'Treatment plan'])
  expect(host.querySelector('.detail-title .clinical-status')?.textContent).toBe('Finalized'); expect(host.textContent).not.toMatch(/REVIEWED|Reviewed/)
  expect(host.querySelector('.detail-header .clinical-actions')?.textContent).toBe('Add amendment')
  expect(host.querySelector('.clinical-readonly')?.textContent).toBe('This record is read-only. Original clinical content remains intact.')
})
it('shows the same contained loading placeholder in every directory', async () => {
  const lists: [ReactNode, string][] = [
    [<Patients key="p" role="RECORDS_OFFICER" onAdd={vi.fn()} onSelect={vi.fn()} />, 'Loading patient records…'],
    [<Appointments key="a" user={admin} onBook={vi.fn()} onSelect={vi.fn()} />, 'Loading appointments…'],
    [<EncounterList key="e" user={doctor} revision={0} onSelect={vi.fn()} />, 'Loading clinical records…'],
  ]
  for (const [node, label] of lists) {
    await render(node)
    expect(host.querySelector('.loading-note[role="status"]')?.textContent).toBe(label); expect(host.querySelector('.loading-rows')?.getAttribute('aria-hidden')).toBe('true')
    await render(null)
  }
})
it('offers a next action from empty appointment and clinical lists', async () => {
  vi.mocked(appointmentsApi.list).mockResolvedValue(empty); vi.mocked(encountersApi.list).mockResolvedValue(empty)
  const book = vi.fn()
  await render(<Appointments user={admin} onBook={book} onSelect={vi.fn()} />); await tick()
  expect(host.querySelector('.empty-state strong')?.textContent).toBe('No appointments in this view.')
  await act(async () => host.querySelector<HTMLButtonElement>('.empty-state button')!.click()); expect(book).toHaveBeenCalledOnce()
  await render(<EncounterList user={doctor} revision={0} onSelect={vi.fn()} />); await tick()
  await fill('clinicalSearch', 'MR-NONE'); await tick(300)
  expect(Array.from(host.querySelectorAll('.empty-state button')).map((item) => item.textContent)).toEqual(['Clear clinical filters'])
})
it('keeps the doctor reload control in the booking form but out of the schedule filters unless it is needed', async () => {
  await render(<Appointments user={admin} onBook={vi.fn()} onSelect={vi.fn()} />); await tick()
  expect(button('Reload doctors')).toBeUndefined()
  vi.mocked(appointmentsApi.clinicians).mockResolvedValue({ clinicians: [] })
  await render(null); await render(<Appointments user={admin} onBook={vi.fn()} onSelect={vi.fn()} />); await tick()
  expect(button('Reload doctors')?.className).toBe('button-link')
  vi.mocked(appointmentsApi.clinicians).mockResolvedValue({ clinicians: [clinician] })
  await render(null); await render(<AppointmentForm role="RECORDS_OFFICER" onClose={vi.fn()} onSaved={vi.fn()} />); await tick()
  expect(button('Reload doctors')).toBeDefined()
})
it('styles each appointment status the same way in badges and in report markers, with six distinct tones', () => {
  const shared = css('src/styles/App.css')
  const tones = ['scheduled', 'confirmed', 'checked_in', 'completed', 'no_show', 'cancelled'].map((status) => {
    const badge = new RegExp(`\\.status-${status}[ ,][^{]*\\{[^}]*--tone: (#[0-9a-f]{6})`).exec(shared)?.[1] ?? new RegExp(`[ ,]\\.status-${status} \\{ --tone: (#[0-9a-f]{6})`).exec(shared)?.[1]
    const marker = new RegExp(`\\.tone-${status} \\{ --tone: (#[0-9a-f]{6})`).exec(shared)?.[1]
    return [status, badge, marker]
  })
  for (const [status, badge, marker] of tones) expect([status, badge]).toEqual([status, marker])
  expect(new Set(tones.map(([, badge]) => badge)).size).toBe(6)
  for (const file of ['src/features/appointments/appointments.css', 'src/features/reports/reports.css']) expect(css(file)).not.toMatch(/\.(status|tone)-(scheduled|confirmed|checked_in|completed|no_show|cancelled)\s*\{/)
})
it('keeps shared colour tokens readable: text at 4.5:1 and field borders at 3:1', () => {
  const shared = css('src/styles/App.css'), token = (name: string) => { const hex = new RegExp(`--${name}: #([0-9a-f]{6}|[0-9a-f]{3});`).exec(shared)![1]!; return `#${hex.length === 3 ? hex.replace(/./g, '$&$&') : hex}` }
  const luminance = (hex: string) => { const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255).map((c) => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4); return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! }
  const ratio = (a: string, b: string) => { const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m); return (x! + 0.05) / (y! + 0.05) }
  for (const text of ['ink', 'deep', 'muted', 'brand', 'link', 'success', 'warning', 'danger', 'info', 'neutral']) for (const surface of ['surface', 'bg', 'surface-muted']) expect([text, surface, ratio(token(text), token(surface)) >= 4.5]).toEqual([text, surface, true])
  for (const tone of ['success', 'warning', 'danger', 'info', 'neutral']) expect([tone, ratio(token(tone), token(`${tone}-bg`)) >= 4.5]).toEqual([tone, true])
  expect(ratio(token('field-border'), token('surface'))).toBeGreaterThanOrEqual(3)
  expect(ratio(token('muted'), token('brand-soft'))).toBeGreaterThanOrEqual(4.5)
})
it('ships no template assets, placeholder components or third-party sign-in marks', () => {
  expect(existsSync(resolve('src/assets'))).toBe(false); expect(readdirSync(resolve('public'))).toEqual(['favicon.svg'])
  const favicon = readFileSync(resolve('public/favicon.svg'), 'utf8'); expect(favicon).toContain('#166775'); expect(favicon).not.toMatch(/863bff|vite/i)
  expect(readFileSync(resolve('index.html'), 'utf8')).toContain('<title>Medicare – Hospital Records</title>')
  for (const file of ['src/components/ui/Unavailable.tsx', 'src/features/appointments/AppointmentPagination.tsx', 'src/features/patients/PatientPagination.tsx']) expect(existsSync(resolve(file))).toBe(false)
  expect(readFileSync(resolve('src/components/branding/BrandMarks.tsx'), 'utf8')).not.toMatch(/Google|Apple/)
})
it('pages every directory with the same pager and hides it when a list is empty', async () => {
  vi.mocked(patientsApi.list).mockResolvedValue({ items: [patient], pagination: { page: 1, limit: 10, total: 23, totalPages: 3 } })
  await render(<Patients role="RECORDS_OFFICER" onAdd={vi.fn()} onSelect={vi.fn()} />); await tick()
  const pager = host.querySelector('nav.pagination[aria-label="Patient pages"]')!
  expect(pager.querySelector('span')?.textContent).toBe('23 results · Page 1 of 3'); expect(Array.from(pager.querySelectorAll('button')).map((item) => [item.textContent, item.disabled])).toEqual([['Previous', true], ['Next', false]])
  vi.mocked(appointmentsApi.list).mockResolvedValue({ ...page, pagination: { ...page.pagination, total: 1, totalPages: 1 } })
  await render(<Appointments user={admin} onBook={vi.fn()} onSelect={vi.fn()} />); await tick()
  expect(host.querySelector('nav.pagination')?.textContent).toBe('1 result · Page 1 of 1'); expect(host.querySelectorAll('nav.pagination button')).toHaveLength(0)
  vi.mocked(appointmentsApi.list).mockResolvedValue(empty)
  await render(null); await render(<Appointments user={admin} onBook={vi.fn()} onSelect={vi.fn()} />); await tick()
  expect(host.querySelector('nav.pagination')).toBeNull(); expect(host.querySelector('.empty-state')).not.toBeNull()
})
it('anchors the mobile navigation drawer to the left edge, above the shared dialog layout', () => {
  const shared = css('src/styles/App.css')
  expect(shared).toMatch(/\.modal-backdrop\.navigation-modal-backdrop \{ justify-content: flex-start; align-items: stretch; padding: 0; \}/)
  expect(shared).toMatch(/\.modal\.navigation-modal \{[^}]*max-height: 100dvh/)
  for (const rule of ['.report-segments button, .report-segments label, .notification-segments button {']) expect(shared.slice(shared.indexOf(rule)).split('}')[0]).toContain('min-height: 44px')
})
it('keeps feature stylesheets free of their own field, error and focus colours', () => {
  for (const file of ['appointments/appointments.css', 'records/records.css', 'notifications/notifications.css', 'staff/staff.css', 'reports/reports.css', 'patients/patients.css', 'auth/auth.css']) {
    const text = css(`src/features/${file}`)
    expect([file, /outline: 3px solid #|#882c2c|#813333|#b45309|#428896|border: 1px solid #b9cbd4/.test(text)]).toEqual([file, false])
  }
})
