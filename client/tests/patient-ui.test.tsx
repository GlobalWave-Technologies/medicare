// @vitest-environment jsdom
/// <reference types="node" />
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { BackendRole } from '../src/api/auth'
import { ApiError } from '../src/api/client'
import { patientsApi, type Patient, type PatientPage } from '../src/api/patients'
import { Patients } from '../src/features/patients/Patients'
import { PatientModal } from '../src/features/patients/PatientModal'
import { PatientDetail } from '../src/features/patients/PatientDetail'

const patient: Patient = { id: '11111111-1111-4111-8111-111111111111', patientNumber: 'PT-11111111-1111-4111-8111-111111111111', firstName: 'Amina', middleName: 'Mary Ann', lastName: 'Yusuf', dateOfBirth: '2000-05-10', phone: '+233241234567', archivedAt: null, createdAt: '2026-01-01T12:00:00Z', updatedAt: '2026-01-01T12:00:00Z' }
const page = (items = [patient], current = 1, total = items.length): PatientPage => ({ items, pagination: { page: current, limit: 10, total, totalPages: Math.ceil(total / 10) } })
let root: Root, host: HTMLDivElement
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-28T12:00:00Z'))
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  vi.spyOn(patientsApi, 'list').mockResolvedValue(page())
  vi.spyOn(patientsApi, 'get').mockResolvedValue({ patient })
  vi.spyOn(patientsApi, 'create').mockResolvedValue({ patient })
  vi.spyOn(patientsApi, 'update').mockResolvedValue({ patient: { ...patient, firstName: 'Updated' } })
  vi.spyOn(patientsApi, 'archive').mockResolvedValue({ patient: { ...patient, archivedAt: '2026-10-28T12:00:00Z' } })
  vi.spyOn(patientsApi, 'reactivate').mockResolvedValue({ patient })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals() })
const render = async (node: ReactNode) => { await act(async () => root.render(node)) }
const advance = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
const button = (text: string) => Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((item) => item.textContent === text)!
const click = async (text: string) => { await act(async () => button(text).click()) }
const field = (name: string) => host.querySelector<HTMLInputElement>(`input[name="${name}"]`)!
async function input(selector: string, value: string) {
  await act(async () => {
    const node = host.querySelector<HTMLInputElement>(selector)!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, value)
    node.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const fill = (name: string, value: string) => input(`input[name="${name}"]`, value)
const submit = async () => { await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) }) }
const directory = (role: BackendRole = 'ADMIN', select = vi.fn()) => <Patients role={role} onAdd={vi.fn()} onSelect={select} />
const detail = (role: BackendRole = 'ADMIN', initialPatient?: Patient, changed = vi.fn()) => <PatientDetail key={patient.id} id={patient.id} initialPatient={initialPatient} role={role} onBack={vi.fn()} onChanged={changed} />

it('shows loading then backend patient demographics and opens by internal ID', async () => {
  const select = vi.fn()
  await render(directory('ADMIN', select))
  expect(host.querySelector('[role="status"]')?.textContent).toContain('Loading')
  await advance()
  expect(host.textContent).toContain(patient.patientNumber)
  expect(host.textContent).toContain('26 years'); expect(host.textContent).toContain(patient.phone)
  expect(host.textContent).toContain('Active')
  await click('Amina Mary Ann Yusuf')
  expect(select).toHaveBeenCalledWith(patient.id)
})
it.each(['ADMIN', 'RECORDS_OFFICER'] as const)('%s sees registration and patient management', async (role) => {
  await render(directory(role)); await advance(); expect(button('Add patient')).toBeDefined()
  await render(detail(role)); expect(button('Edit details')).toBeDefined(); expect(button('Archive patient')).toBeDefined()
})
it('Doctor reads directory and detail but cannot open registration, edit or archival UI', async () => {
  await render(directory('DOCTOR_IN_CHARGE')); await advance()
  expect(button('Add patient')).toBeUndefined(); expect(host.textContent).toContain(patient.patientNumber)
  await render(detail('DOCTOR_IN_CHARGE')); expect(host.textContent).toContain(patient.patientNumber)
  expect(button('Edit details')).toBeUndefined(); expect(button('Archive patient')).toBeUndefined()
  await render(<PatientDetail id={patient.id} key="archived" initialPatient={{ ...patient, archivedAt: patient.createdAt }} role="DOCTOR_IN_CHARGE" onBack={vi.fn()} onChanged={vi.fn()} />)
  expect(button('Reactivate patient')).toBeUndefined()
  await render(<PatientModal role="DOCTOR_IN_CHARGE" onClose={vi.fn()} onCreated={vi.fn()} />)
  expect(host.querySelector('form')).toBeNull()
})
it('uses distinct empty/search/archived states and role-aware registration CTA', async () => {
  vi.mocked(patientsApi.list).mockResolvedValue(page([]))
  await render(directory()); await advance(); expect(host.textContent).toContain('No patients registered yet.')
  expect(button('Register patient')).toBeDefined()
  await input('[aria-label="Search patients"]', 'nobody'); await advance(300)
  expect(host.textContent).toContain('No patients match your search.'); expect(button('Register patient')).toBeUndefined()
  await input('[aria-label="Search patients"]', '')
  await act(async () => { const select = host.querySelector('select')!; select.value = 'true'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  await advance(); expect(host.textContent).toContain('No archived patients.')
  expect(patientsApi.list).toHaveBeenLastCalledWith({ page: 1, limit: 10, search: '', archived: 'true' }, expect.any(AbortSignal))
})
it('uses backend page totals and requests the next page', async () => {
  vi.mocked(patientsApi.list).mockResolvedValueOnce(page([patient], 1, 21)).mockResolvedValueOnce(page([{ ...patient, firstName: 'Page two' }], 2, 21))
  await render(directory()); await advance(); expect(host.textContent).toContain('Page 1 of 3')
  await click('Next'); await advance()
  expect(patientsApi.list).toHaveBeenLastCalledWith({ page: 2, limit: 10, search: '', archived: 'false' }, expect.any(AbortSignal))
  expect(host.textContent).toContain('Page two'); expect(host.textContent).toContain('Page 2 of 3')
})
it('aborts obsolete search and ignores a late response even if transport resolves it', async () => {
  let complete!: (value: PatientPage) => void
  vi.mocked(patientsApi.list).mockImplementationOnce(() => new Promise((resolve) => { complete = resolve }))
  await render(directory()); await advance()
  const oldSignal = vi.mocked(patientsApi.list).mock.calls[0]![1]!
  await input('[aria-label="Search patients"]', 'Current')
  expect(oldSignal.aborted).toBe(true); expect(host.textContent).toContain('Loading')
  vi.mocked(patientsApi.list).mockResolvedValueOnce(page([{ ...patient, firstName: 'Current' }]))
  await advance(299); expect(patientsApi.list).toHaveBeenCalledTimes(1)
  await advance(1); expect(host.textContent).toContain('Current Mary Ann')
  await act(async () => complete(page([{ ...patient, firstName: 'Obsolete' }])))
  expect(host.textContent).not.toContain('Obsolete'); expect(host.textContent).toContain('Current Mary Ann')
})
it('shows a safe list error with support ID and retries without a false empty state', async () => {
  vi.mocked(patientsApi.list).mockRejectedValueOnce(new ApiError(503, 'internal stack', 'INTERNAL_ERROR', 'qa-support'))
  await render(directory()); await advance()
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('qa-support')
  expect(host.textContent).not.toMatch(/internal stack|No patients registered/)
  await click('Try again'); await advance(); expect(host.textContent).toContain(patient.patientNumber)
})
it('recovers an out-of-range server page without rendering thousands of page buttons', async () => {
  vi.mocked(patientsApi.list).mockResolvedValueOnce(page([patient], 1, 100000)).mockResolvedValueOnce(page([], 2, 1))
  await render(directory()); await advance(); expect(host.querySelectorAll('button').length).toBeLessThan(10)
  await click('Next'); await advance(); expect(host.textContent).toContain('No patients on this page.')
  await click('Return to first page'); await advance()
  expect(patientsApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1 }), expect.any(AbortSignal))
})
it('renders archived status from the DTO', async () => {
  vi.mocked(patientsApi.list).mockResolvedValue(page([{ ...patient, archivedAt: patient.createdAt }]))
  await render(directory()); await advance(); expect(host.querySelector('.status')?.textContent).toBe('Archived')
})

it('registers only supported fields and returns the server identity without storage writes', async () => {
  const created = vi.fn(), closed = vi.fn(), storage = vi.spyOn(Storage.prototype, 'setItem')
  await render(<PatientModal role="ADMIN" onCreated={created} onClose={closed} />)
  for (const name of ['firstName', 'middleName', 'lastName', 'dateOfBirth', 'phone']) expect(field(name).labels?.length).toBe(1)
  expect(host.querySelector('[role="dialog"]')?.getAttribute('aria-labelledby')).toBeTruthy()
  await fill('firstName', ' Test '); await fill('lastName', ' Person '); await fill('dateOfBirth', '2000-01-01'); await submit()
  expect(patientsApi.create).toHaveBeenCalledExactlyOnceWith({ firstName: 'Test', middleName: null, lastName: 'Person', dateOfBirth: '2000-01-01', phone: null }, expect.stringMatching(/^[0-9a-f-]{36}$/))
  expect(created).toHaveBeenCalledWith(patient); expect(closed).toHaveBeenCalledOnce(); expect(storage).not.toHaveBeenCalled()
})
it('blocks future DOB and invalid required names before API submission', async () => {
  await render(<PatientModal role="ADMIN" onCreated={vi.fn()} onClose={vi.fn()} />)
  await submit(); expect(host.textContent).toContain('First and last names are required')
  await fill('firstName', 'Test'); await fill('lastName', 'Person'); await fill('dateOfBirth', '2026-10-29'); await submit()
  expect(host.textContent).toContain('valid date of birth'); expect(patientsApi.create).not.toHaveBeenCalled()
  expect(field('dateOfBirth').max).toBe('2026-10-28')
})
it.each([
  ['POSSIBLE_DUPLICATE_PATIENT', 409, 'matching details'], ['VALIDATION_ERROR', 400, 'check the patient details'],
  ['FORBIDDEN', 403, 'permission'], ['CSRF_INVALID', 403, 'security token'],
] as const)('shows safe %s feedback and retains form values without replay', async (code, status, message) => {
  vi.mocked(patientsApi.create).mockRejectedValueOnce(new ApiError(status, 'another patient private data', code, 'qa-form'))
  await render(<PatientModal role="RECORDS_OFFICER" onCreated={vi.fn()} onClose={vi.fn()} />)
  await fill('firstName', 'Test'); await fill('lastName', 'Person'); await submit()
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(message)
  expect(host.textContent).toContain('qa-form'); expect(host.textContent).not.toContain('private data')
  expect(field('firstName').value).toBe('Test'); expect(patientsApi.create).toHaveBeenCalledTimes(1)
})
it.each([new TypeError('Failed to fetch'), new ApiError(503, 'upstream detail', 'SERVICE_UNAVAILABLE')])('asks staff to resubmit the unchanged form when a registration result is unconfirmed (%s)', async (failure) => {
  vi.mocked(patientsApi.create).mockRejectedValueOnce(failure)
  await render(<PatientModal role="RECORDS_OFFICER" onCreated={vi.fn()} onClose={vi.fn()} />)
  await fill('firstName', 'Test'); await fill('lastName', 'Person'); await submit()
  const alert = host.querySelector('[role="alert"]')!.textContent!
  expect(alert).toContain('could not be confirmed'); expect(alert).toContain('Select Register patient again without changing anything'); expect(alert).not.toContain('Please try again')
  expect(field('firstName').value).toBe('Test'); expect(patientsApi.create).toHaveBeenCalledTimes(1)
})
it('keeps validation messages unchanged for form-level problems', async () => {
  await render(<PatientModal role="RECORDS_OFFICER" onCreated={vi.fn()} onClose={vi.fn()} />)
  await fill('firstName', 'Test'); await submit()
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('First and last names are required.'); expect(patientsApi.create).not.toHaveBeenCalled()
})
it('prevents duplicate submits and closing during an in-flight mutation', async () => {
  let complete!: (value: { patient: Patient }) => void
  vi.mocked(patientsApi.create).mockImplementationOnce(() => new Promise((resolve) => { complete = resolve }))
  const close = vi.fn()
  await render(<PatientModal role="ADMIN" onCreated={vi.fn()} onClose={close} />)
  await fill('firstName', 'Test'); await fill('lastName', 'Person'); await submit(); await submit()
  expect(patientsApi.create).toHaveBeenCalledTimes(1); expect(field('firstName').closest('fieldset')?.disabled).toBe(true)
  await act(async () => { host.querySelector('[role="dialog"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); host.querySelector<HTMLDivElement>('.modal-backdrop')!.click() })
  expect(close).not.toHaveBeenCalled()
  await act(async () => complete({ patient })); expect(close).toHaveBeenCalledOnce()
})
it('focuses dialog, traps Tab and restores focus to its trigger', async () => {
  const trigger = document.createElement('button'); document.body.append(trigger); trigger.focus()
  const close = vi.fn()
  await render(<PatientModal role="ADMIN" onCreated={vi.fn()} onClose={close} />)
  expect(document.activeElement).toBe(host.querySelector('[role="dialog"]'))
  await act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })) })
  expect(document.activeElement).toBe(button('Register patient'))
  await act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })) })
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Close patient dialog')
  await act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
  expect(close).toHaveBeenCalledOnce()
  await render(null); expect(document.activeElement).toBe(trigger); trigger.remove()
})

it('loads detail by backend ID and displays demographics without mock clinical history', async () => {
  await render(detail())
  expect(patientsApi.get).toHaveBeenCalledWith(patient.id, expect.any(AbortSignal))
  expect(host.textContent).toContain('10/05/2000'); expect(host.textContent).toContain(patient.phone)
  expect(host.textContent).toContain('Clinical history is not displayed')
  expect(host.textContent).not.toMatch(/Allergic Reaction|Dr\. Okafor|MR-7842/)
})
it('uses the returned created patient without a duplicate detail GET', async () => {
  await render(detail('ADMIN', patient)); expect(patientsApi.get).not.toHaveBeenCalled()
  expect(host.querySelector('.patient-success')?.textContent).toBe('Patient registered.'); expect(host.textContent).toContain(patient.patientNumber)
})
it('shows clean not-found state and back navigation', async () => {
  vi.mocked(patientsApi.get).mockRejectedValueOnce(new ApiError(404, 'missing', 'PATIENT_NOT_FOUND'))
  await render(detail()); expect(host.textContent).toContain('Patient not found.')
  expect(button('Back to Patients')).toBeDefined(); expect(button('Edit details')).toBeUndefined()
})
it('allows detail retry after network error', async () => {
  vi.mocked(patientsApi.get).mockRejectedValueOnce(new TypeError('network'))
  await render(detail()); await click('Try again'); expect(host.textContent).toContain(patient.patientNumber)
})
it('aborts a detail read on unmount', async () => {
  vi.mocked(patientsApi.get).mockImplementationOnce(() => new Promise(() => {}))
  await render(detail()); expect(host.textContent).toContain('Loading patient details')
  const signal = vi.mocked(patientsApi.get).mock.calls[0]![1]!
  await render(null); expect(signal.aborted).toBe(true)
})
it('edits supported demographics and uses the response to refresh the displayed record', async () => {
  const changed = vi.fn()
  await render(detail('ADMIN', undefined, changed)); await click('Edit details')
  expect(field('firstName').value).toBe('Amina'); expect(field('middleName').value).toBe('Mary Ann')
  expect(host.querySelector('input[name="patientNumber"], input[name="id"]')).toBeNull()
  await fill('firstName', 'Updated'); await submit()
  expect(patientsApi.update).toHaveBeenCalledExactlyOnceWith(patient.id, { firstName: 'Updated' })
  expect(host.textContent).toContain('Updated Mary Ann Yusuf'); expect(changed).toHaveBeenCalledOnce()
  expect(host.querySelector('[role="dialog"]')).toBeNull()
})
it('sends only edited demographics so a stale form cannot revert another user’s change', async () => {
  await render(detail('ADMIN', patient)); await click('Edit details')
  await fill('middleName', ''); await fill('phone', '+233200000001'); await submit()
  expect(patientsApi.update).toHaveBeenCalledExactlyOnceWith(patient.id, { middleName: null, phone: '+233200000001' })
})
it('does not send an edit when nothing changed', async () => {
  await render(detail('ADMIN', patient)); await click('Edit details'); await submit()
  expect(patientsApi.update).not.toHaveBeenCalled(); expect(host.querySelector('[role="alert"]')?.textContent).toContain('No changes to save.')
})
it('preserves edited values on a failed update', async () => {
  vi.mocked(patientsApi.update).mockRejectedValueOnce(new ApiError(409, 'private', 'POSSIBLE_DUPLICATE_PATIENT'))
  await render(detail()); await click('Edit details'); await fill('firstName', 'Changed'); await submit()
  expect(field('firstName').value).toBe('Changed'); expect(host.textContent).toContain('matching details')
})
it('requires confirmation, archives and reactivates with server-returned state', async () => {
  const changed = vi.fn()
  await render(detail('RECORDS_OFFICER', undefined, changed)); await click('Archive patient')
  expect(host.textContent).toContain('will not be deleted'); expect(patientsApi.archive).not.toHaveBeenCalled()
  await click('Cancel'); expect(patientsApi.archive).not.toHaveBeenCalled()
  await click('Archive patient'); await click('Confirm archive')
  expect(patientsApi.archive).toHaveBeenCalledExactlyOnceWith(patient.id)
  expect(host.querySelector('.status')?.textContent).toBe('Archived'); expect(button('Edit details')).toBeUndefined()
  await click('Reactivate patient'); await click('Confirm reactivation')
  expect(patientsApi.reactivate).toHaveBeenCalledExactlyOnceWith(patient.id)
  expect(host.querySelector('.status')?.textContent).toBe('Active'); expect(button('Edit details')).toBeDefined()
  expect(changed).toHaveBeenCalledTimes(2)
  expect(Array.from(host.querySelectorAll('button')).some((item) => /delete/i.test(item.textContent ?? ''))).toBe(false)
})
it('keeps archival state stable and shows duplicate reactivation feedback', async () => {
  vi.mocked(patientsApi.reactivate).mockRejectedValueOnce(new ApiError(409, 'private details', 'POSSIBLE_DUPLICATE_PATIENT'))
  await render(detail('ADMIN', { ...patient, archivedAt: patient.createdAt }))
  await click('Reactivate patient'); await click('Confirm reactivation')
  expect(host.textContent).toContain('matching details'); expect(host.querySelector('.status')?.textContent).toBe('Archived')
  expect(patientsApi.reactivate).toHaveBeenCalledTimes(1)
})
it('keeps the patient workspace free of mock data modules', () => {
  expect(existsSync(resolve('src/mocks'))).toBe(false)
  expect(readdirSync(resolve('src/features/patients')).map((name) => readFileSync(resolve('src/features/patients', name), 'utf8')).join('\n')).not.toMatch(/mocks\//)
})
