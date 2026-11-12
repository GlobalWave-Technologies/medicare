// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { BackendRole, StaffUser } from '../src/api/auth'
import { ApiError } from '../src/api/client'
import { admissionsApi } from '../src/api/admissions'
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
import { AdmitDialog, ChangeRoomDialog, DischargeDialog } from '../src/features/admissions/AdmissionDialogs'
import { AdmissionList } from '../src/features/admissions/AdmissionLists'
import { EncounterDetail } from '../src/features/records/EncounterDetail'
import { EncounterForm } from '../src/features/records/EncounterForm'
import { EncounterList } from '../src/features/records/EncounterList'
import { ClinicalCommand } from '../src/features/records/ClinicalCommands'
import { BroadcastComposer } from '../src/features/notifications/BroadcastComposer'
import { admission, admissionPage, admittedPatient, clinician, patient } from './admission-fixtures'
import { clinicalPage, doctor, encounter, reviewed } from './clinical-fixtures'
import { dashboardFor } from './report-fixtures'
import { contrast, hex, themeNames, tokenBlocks } from './theme-tokens'

const identity = vi.hoisted(() => ({ role: 'ADMIN' as BackendRole }))
vi.mock('../src/features/auth/AuthGate', () => ({ AuthGate: ({ children }: { children: (user: StaffUser) => ReactNode }) => children({
  id: '70000000-0000-4000-8000-000000000007', staffNumber: 'STF-POLISH', firstName: 'Pat', lastName: 'Polish', email: 'pat@example.test', status: 'ACTIVE', mustChangePassword: false, role: identity.role }) }))
let host: HTMLDivElement, root: Root
const admin = { ...clinician, email: 'qa@example.test', role: 'ADMIN' as const, status: 'ACTIVE' as const, mustChangePassword: false }
const empty = { items: [], pagination: { page: 1, limit: 10, total: 0, totalPages: 0 } }
const stays = (props: Partial<Parameters<typeof AdmissionList>[0]> = {}) => <AdmissionList status="ADMITTED" role="RECORDS_OFFICER" search="" page={1} revision={0} onPage={vi.fn()} onRetry={vi.fn()} onSelectPatient={vi.fn()} onView={vi.fn()} {...props} />
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-01T12:00:00Z')); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  vi.spyOn(dashboardApi, 'get').mockImplementation(async () => dashboardFor(identity.role))
  vi.spyOn(notificationsApi, 'unreadCount').mockResolvedValue({ count: 0 })
  vi.spyOn(patientsApi, 'list').mockResolvedValue({ items: [patient], pagination: { page: 1, limit: 10, total: 1, totalPages: 1 } })
  vi.spyOn(patientsApi, 'get').mockResolvedValue({ patient })
  vi.spyOn(admissionsApi, 'list').mockResolvedValue(admissionPage()); vi.spyOn(encountersApi, 'medications').mockResolvedValue({ ...empty, pagination: { ...empty.pagination, limit: 100 } })
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
  expect(host.querySelector('h1')?.textContent).toBe('Staff & Access'); expect(host.querySelector('.breadcrumbs')).toBeNull()
  expect(host.querySelector('.desktop-sidebar .sidebar-identity')?.textContent).toBe('PPSigned in as Pat PolishAdministrator')
  expect(host.querySelector('.desktop-sidebar .brand-copy')?.textContent).toBe('MedicareHospital Records'); expect(host.querySelector('.topbar-brand .brand-copy strong')?.textContent).toBe('Medicare')
  expect(host.querySelector('.page-heading .eyebrow')).toBeNull()
})
it('shows where a detail view sits in the breadcrumb', async () => {
  identity.role = 'RECORDS_OFFICER'; await render(<App />); await tick()
  await nav('Patients'); await click('Amina Patient')
  expect(host.querySelector('.breadcrumbs')?.textContent).toBe('Patients / Patient record')
  await click('Back to Patients'); expect(host.querySelector('.breadcrumbs')).toBeNull()
})
it('returns to a workspace’s landing view when its navigation item is chosen again', async () => {
  identity.role = 'DOCTOR_IN_CHARGE'; vi.spyOn(encountersApi, 'get').mockResolvedValue({ encounter })
  await render(<App />); await tick()
  await nav('Medical Records'); expect(host.querySelector('#records-admitted-title')?.textContent).toBe('Currently admitted patients')
  await click('Medical record for Amina Patient')
  // Records are listed by when they were written; the reference stays in the accessible name.
  await act(async () => Array.from(host.querySelectorAll<HTMLButtonElement>('.clinical-open')).find((item) => item.textContent?.includes(encounter.reference))!.click()); await tick()
  expect(host.querySelector('.clinical-detail')).not.toBeNull(); expect(host.querySelector('#records-admitted-title')).toBeNull()
  expect(Array.from(host.querySelectorAll('main .button-primary')).every((item) => item.closest('.clinical-detail'))).toBe(true)
  await nav('Medical Records')
  expect(host.querySelector('.clinical-detail')).toBeNull(); expect(host.querySelector('#records-admitted-title')?.textContent).toBe('Currently admitted patients')
})
it('uses the role’s own wording for the Medical Records and Patients headers', async () => {
  identity.role = 'DOCTOR_IN_CHARGE'; await render(<App />); await tick()
  await nav('Medical Records'); expect(host.querySelector('h1')?.textContent).toBe('Medical Records'); expect(host.querySelector('.subheading')?.textContent).toBe('Document care for admitted patients: clinical records, diagnoses and medications.')
  await nav('Patients'); expect(host.querySelector('.subheading')?.textContent).toBe('Register and admit patients, change rooms and open their medical records.')
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
    <AdmitDialog key="a" patient={patient} onClose={vi.fn()} onAdmitted={vi.fn()} />,
    <ChangeRoomDialog key="r" admission={admission} onClose={vi.fn()} onSaved={vi.fn()} />,
    <DischargeDialog key="d" admission={admission} onClose={vi.fn()} onSaved={vi.fn()} />,
    <EncounterForm key="e" user={doctor} patient={patient} admission={admission} onClose={vi.fn()} onSaved={vi.fn()} />,
    <ClinicalCommand key="c" encounter={reviewed} action="amend" onClose={vi.fn()} onSaved={vi.fn()} />,
    <BroadcastComposer key="b" onClose={vi.fn()} onSent={vi.fn()} />,
  ]
  for (const form of forms) {
    await render(form); await tick()
    const missing = Array.from(host.querySelectorAll('[aria-describedby]')).flatMap((item) => item.getAttribute('aria-describedby')!.split(' ')).filter((id) => !document.getElementById(id))
    expect(missing).toEqual([])
    await render(null)
  }
  await render(<AdmitDialog patient={patient} onClose={vi.fn()} onAdmitted={vi.fn()} />)
  expect(host.querySelector('#admission-time')?.getAttribute('aria-describedby')).toBe('admission-time-help'); expect(host.querySelector('#admission-time-help')?.textContent).toContain('Defaults to now.')
  expect(dialog()!.getAttribute('aria-describedby')).toBeNull()
  await render(null); await render(<DischargeDialog admission={admission} onClose={vi.fn()} onSaved={vi.fn()} />)
  expect(document.getElementById(dialog()!.getAttribute('aria-describedby')!)?.textContent).toBe('Discharging this patient will close the current admission and remove them from Currently admitted. Their admission, room history, clinical records and medications stay in their history.')
})
it('orders every dialog footer as Cancel first and one primary or danger action last, at a size that fits the task', async () => {
  const cases: [ReactNode, [string, string][], string][] = [
    [<PatientModal key="p" role="RECORDS_OFFICER" onClose={vi.fn()} onCreated={vi.fn()} />, [['Cancel', 'button-ghost'], ['Register patient', 'button-ghost'], ['Register & admit', 'button-primary']], 'standard'],
    [<AdmitDialog key="a" patient={patient} onClose={vi.fn()} onAdmitted={vi.fn()} />, [['Cancel', 'button-ghost'], ['Save admission', 'button-primary']], 'standard'],
    [<ChangeRoomDialog key="r" admission={admission} onClose={vi.fn()} onSaved={vi.fn()} />, [['Cancel', 'button-ghost'], ['Change room', 'button-primary']], 'compact'],
    [<DischargeDialog key="d" admission={admission} onClose={vi.fn()} onSaved={vi.fn()} />, [['Cancel', 'button-ghost'], ['Discharge patient', 'button-danger']], 'standard'],
    [<EncounterForm key="e" user={doctor} patient={patient} admission={admission} onClose={vi.fn()} onSaved={vi.fn()} />, [['Cancel', 'button-ghost'], ['Save draft', 'button-primary']], 'wide'],
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
  vi.spyOn(admissionsApi, 'list').mockResolvedValue(admissionPage([]))
  await render(<PatientDetail id={patient.id} initialPatient={patient} user={{ ...admin, role: 'RECORDS_OFFICER' }} onBack={vi.fn()} onChanged={vi.fn()} />)
  await click('Archive patient')
  expect(dialog()!.classList.contains('modal-compact')).toBe(true); expect(dialog()!.querySelector('.callout.tone-warning')?.textContent).toContain('will not be deleted')
  expect(footer()).toEqual([['Cancel', 'button-ghost'], ['Confirm archive', 'button-danger']])
})
it('tells staff exactly what is safe after each kind of unconfirmed patient save', async () => {
  vi.spyOn(patientsApi, 'update').mockRejectedValueOnce(new TypeError('Failed to fetch'))
  await render(<PatientModal role="RECORDS_OFFICER" patient={patient} onClose={vi.fn()} onCreated={vi.fn()} />)
  await fill('middleName', 'Changed'); await submit()
  expect(dialog()!.querySelector('[role="alert"] p')?.textContent).toBe('The changes could not be confirmed. Select Save changes again, or close this form and check the patient record.')
  await render(null)
  vi.spyOn(patientsApi, 'archive').mockRejectedValueOnce(new ApiError(502, 'upstream', 'GATEWAY_ERROR', 'req-archive')); vi.spyOn(admissionsApi, 'list').mockResolvedValue(admissionPage([]))
  await render(<PatientDetail id={patient.id} initialPatient={patient} user={{ ...admin, role: 'RECORDS_OFFICER' }} onBack={vi.fn()} onChanged={vi.fn()} />)
  await click('Archive patient'); await click('Confirm archive')
  const alert = dialog()!.querySelector('[role="alert"]')!
  expect(alert.querySelector('p')?.textContent).toBe('The status change could not be confirmed. Close this and refresh the patient record to check its current status before trying again.')
  expect(alert.querySelector('small')?.textContent).toBe('Support reference: req-archive')
})
it('keeps a patient’s identity, archive state and clinical entry point easy to find', async () => {
  const archived = { ...patient, archivedAt: '2026-10-30T10:00:00Z' }
  vi.spyOn(admissionsApi, 'list').mockResolvedValue(admissionPage([]))
  await render(<PatientDetail id={patient.id} initialPatient={archived} user={doctor} onBack={vi.fn()} onChanged={vi.fn()} onClinical={vi.fn()} />)
  expect(host.querySelector('.detail-title h2')?.textContent).toBe('Amina Patient'); expect(host.querySelector('.detail-title .status')?.textContent).toBe('Archived record')
  expect(host.querySelector('.record-id')?.textContent).toBe(`Patient number ${patient.patientNumber}`)
  expect(host.querySelector('.patient-archived-note')?.textContent).toContain('This patient record is archived.')
  expect(host.querySelector('.patient-clinical button')?.textContent).toBe('View clinical history')
})
it('gives the current admission one primary next step and keeps discharge visibly separate', async () => {
  vi.spyOn(patientsApi, 'get').mockResolvedValue({ patient: admittedPatient })
  await render(<PatientDetail id={patient.id} user={doctor} onBack={vi.fn()} onChanged={vi.fn()} onOpenRecord={vi.fn()} />); await tick()
  expect(host.querySelector('#current-admission-title')?.textContent).toBe('Current admission')
  expect(Array.from(host.querySelectorAll('.admission-actions button')).map((item) => [item.textContent, item.className])).toEqual([
    ['Open medical record', 'button button-primary'], ['Change room', 'button button-ghost'], ['View admission', 'button button-ghost'], ['Discharge patient', 'button button-danger-quiet admission-actions-end']])
  // The actions come before the admission facts, right under the patient's name, number and room.
  const order = Array.from(host.querySelectorAll('.admission-actions, .admission-facts, #patient-identity-title')).map((item) => item.className || item.id)
  expect(order).toEqual(['patient-actions admission-actions', 'patient-demographics admission-facts', 'patient-identity-title'])
  expect(host.querySelector('.patient-room')?.textContent).toBe(`Room ${admittedPatient.currentAdmission!.roomNumber}`)
  expect(host.querySelector('.detail-title')?.textContent).toContain('Admitted')
})
it('reads a finalized record in clinical order with the product’s own status words', async () => {
  await render(<EncounterDetail user={doctor} id={reviewed.id} initial={reviewed} onBack={vi.fn()} onChanged={vi.fn()} />)
  expect(Array.from(host.querySelectorAll('.clinical-original .clinical-block h4')).map((item) => item.textContent)).toEqual(['Complaints', 'History summary', 'Clinical notes', 'Diagnoses', 'Medications', 'Treatment plan'])
  expect(host.querySelector('.detail-title .clinical-status')?.textContent).toBe('Finalized'); expect(host.textContent).not.toMatch(/REVIEWED|Reviewed/)
  expect(host.querySelector('.detail-header .clinical-actions')?.textContent).toBe('Add amendment')
  expect(host.querySelector('.clinical-readonly')?.textContent).toBe('This record is read-only. Original clinical content remains intact.')
})
it('shows the same contained loading placeholder in every directory', async () => {
  const lists: [ReactNode, string][] = [
    [<Patients key="p" role="RECORDS_OFFICER" onAdd={vi.fn()} onSelect={vi.fn()} onViewAdmission={vi.fn()} />, 'Loading patient records…'],
    [stays(), 'Loading current admissions…'],
    [<EncounterList key="e" user={doctor} revision={0} onSelect={vi.fn()} />, 'Loading clinical records…'],
  ]
  for (const [node, label] of lists) {
    await render(node)
    expect(host.querySelector('.loading-note[role="status"]')?.textContent).toBe(label); expect(host.querySelector('.loading-rows')?.getAttribute('aria-hidden')).toBe('true')
    await render(null)
  }
})
it('offers a next step from empty patient, admission and clinical lists', async () => {
  vi.mocked(patientsApi.list).mockResolvedValue(empty); vi.mocked(admissionsApi.list).mockResolvedValue(empty); vi.mocked(encountersApi.list).mockResolvedValue(empty)
  const add = vi.fn()
  await render(<Patients role="RECORDS_OFFICER" onAdd={add} onSelect={vi.fn()} onViewAdmission={vi.fn()} />); await tick()
  expect(host.querySelector('.patients-state strong')?.textContent).toBe('No patients registered yet.')
  await act(async () => host.querySelector<HTMLButtonElement>('.patients-state button')!.click()); expect(add).toHaveBeenCalledOnce()
  await render(stays()); await tick()
  expect(host.querySelector('.patients-state strong')?.textContent).toBe('No patients are currently admitted.')
  expect(host.querySelector('.patients-state p')?.textContent).toBe('Admit a patient from their record, or use Register & admit for a new patient.')
  await render(<EncounterList user={doctor} revision={0} onSelect={vi.fn()} />); await tick()
  await fill('clinicalSearch', 'MR-NONE'); await tick(300)
  expect(Array.from(host.querySelectorAll('.empty-state button')).map((item) => item.textContent)).toEqual(['Clear clinical filters'])
})
it('keeps no appointment styles, tokens or screens now that appointments are retired', () => {
  const shared = css('src/styles/App.css'), tokens = tokenBlocks(shared)
  for (const theme of themeNames) expect([theme, Object.keys(tokens[theme]).filter((name) => /^(mark-|teal|violet)/.test(name))]).toEqual([theme, []])
  for (const file of ['src/styles/App.css', 'src/features/admissions/admissions.css', 'src/features/reports/reports.css', 'src/features/dashboard/dashboard.css', 'src/features/records/records.css'])
    expect([file, /appointment|\.(status|tone)-(scheduled|confirmed|checked_in|completed|no_show|cancelled)\b/i.test(css(file))]).toEqual([file, false])
  expect(existsSync(resolve('src/features/appointments'))).toBe(false)
})
it('keeps shared colour tokens readable in both themes: text at 4.5:1 and field borders at 3:1', () => {
  const blocks = tokenBlocks(css('src/styles/App.css'))
  for (const theme of themeNames) {
    const token = (name: string) => hex(blocks[theme][name]!), ratio = (a: string, b: string) => contrast(token(a), token(b))
    for (const text of ['ink', 'deep', 'muted', 'brand', 'link', 'success', 'warning', 'danger', 'info', 'neutral']) for (const surface of ['surface', 'bg', 'surface-muted', 'surface-raised', 'surface-hover'])
      expect([theme, text, surface, ratio(text, surface) >= 4.5]).toEqual([theme, text, surface, true])
    for (const text of ['ink', 'deep', 'muted']) expect([theme, text, ratio(text, 'surface-sunken') >= 4.5]).toEqual([theme, text, true])
    for (const tone of ['success', 'warning', 'danger', 'info', 'neutral']) expect([theme, tone, ratio(tone, `${tone}-bg`) >= 4.5]).toEqual([theme, tone, true])
    for (const surface of ['surface', 'surface-muted', 'surface-raised']) expect([theme, surface, ratio('field-border', surface) >= 3]).toEqual([theme, surface, true])
    for (const text of ['muted', 'deep', 'brand-strong']) expect([theme, text, ratio(text, 'brand-soft') >= 4.5]).toEqual([theme, text, true])
  }
})
it('ships no template assets, placeholder components or third-party sign-in marks', () => {
  expect(existsSync(resolve('src/assets'))).toBe(false); expect(readdirSync(resolve('public'))).toEqual(['favicon.svg', 'icons', 'manifest.webmanifest', 'theme-init.js'])
  expect(readdirSync(resolve('public/icons'))).toEqual(['apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'])
  const favicon = readFileSync(resolve('public/favicon.svg'), 'utf8'); expect(favicon).toContain('#f97316'); expect(favicon).not.toContain('#166775'); expect(favicon).not.toMatch(/863bff|vite/i)
  expect(readFileSync(resolve('index.html'), 'utf8')).toContain('<title>Medicare – Hospital Records</title>')
  for (const file of ['src/components/ui/Unavailable.tsx', 'src/features/appointments/AppointmentPagination.tsx', 'src/features/patients/PatientPagination.tsx']) expect(existsSync(resolve(file))).toBe(false)
  expect(readFileSync(resolve('src/components/branding/BrandMarks.tsx'), 'utf8')).not.toMatch(/Google|Apple/)
})
it('pages every directory with the same pager and hides it when a list is empty', async () => {
  vi.mocked(patientsApi.list).mockResolvedValue({ items: [patient], pagination: { page: 1, limit: 10, total: 23, totalPages: 3 } })
  await render(<Patients role="RECORDS_OFFICER" onAdd={vi.fn()} onSelect={vi.fn()} onViewAdmission={vi.fn()} />); await tick()
  const pager = host.querySelector('nav.pagination[aria-label="Patient pages"]')!
  expect(pager.querySelector('span')?.textContent).toBe('23 results · Page 1 of 3'); expect(Array.from(pager.querySelectorAll('button')).map((item) => [item.textContent, item.disabled])).toEqual([['Previous', true], ['Next', false]])
  await render(null); await render(stays()); await tick()
  expect(host.querySelector('nav.pagination[aria-label="Current admission pages"]')?.textContent).toBe('1 result · Page 1 of 1'); expect(host.querySelectorAll('nav.pagination button')).toHaveLength(0)
  vi.mocked(admissionsApi.list).mockResolvedValue(empty)
  await render(null); await render(stays({ status: 'DISCHARGED' })); await tick()
  expect(host.querySelector('nav.pagination')).toBeNull(); expect(host.querySelector('.patients-state strong')?.textContent).toBe('No discharged admissions yet.')
})
it('anchors the mobile navigation drawer to the left edge, above the shared dialog layout', () => {
  const shared = css('src/styles/App.css')
  expect(shared).toMatch(/\.modal-backdrop\.navigation-modal-backdrop \{ justify-content: flex-start; align-items: stretch; padding: 0; \}/)
  expect(shared).toMatch(/\.modal\.navigation-modal \{[^}]*max-height: 100dvh/)
  for (const rule of ['.report-segments button, .report-segments label, .notification-segments button {']) expect(shared.slice(shared.indexOf(rule)).split('}')[0]).toContain('min-height: 44px')
})
it('keeps feature stylesheets free of their own field, error and focus colours', () => {
  for (const file of ['admissions/admissions.css', 'records/records.css', 'notifications/notifications.css', 'staff/staff.css', 'reports/reports.css', 'patients/patients.css', 'auth/auth.css']) {
    const text = css(`src/features/${file}`)
    expect([file, /outline: 3px solid #|#882c2c|#813333|#b45309|#428896|border: 1px solid #b9cbd4/.test(text)]).toEqual([file, false])
  }
})
