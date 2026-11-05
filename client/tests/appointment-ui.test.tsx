// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { appointmentsApi, type Appointment } from '../src/api/appointments'
import { patientsApi } from '../src/api/patients'
import { ApiError } from '../src/api/client'
import { Appointments } from '../src/features/appointments/Appointments'
import { AppointmentDetail } from '../src/features/appointments/AppointmentDetail'
import { AppointmentForm } from '../src/features/appointments/AppointmentForm'
import { AppointmentDialog } from '../src/features/appointments/AppointmentDialog'
import { PatientPicker, ClinicianPicker } from '../src/features/appointments/AppointmentPickers'
import { displayTime, toLocalInput } from '../src/features/appointments/appointment-utils'
import { appointment, clinician, page, patient, user } from './appointment-fixtures'
let root: Root, host: HTMLDivElement
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-29T12:00:00Z')); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  vi.spyOn(appointmentsApi, 'list').mockResolvedValue(page)
  vi.spyOn(appointmentsApi, 'get').mockResolvedValue({ appointment })
  vi.spyOn(appointmentsApi, 'clinicians').mockResolvedValue({ clinicians: [clinician] })
  vi.spyOn(patientsApi, 'list').mockResolvedValue({ items: [patient], pagination: page.pagination })
  vi.spyOn(appointmentsApi, 'create').mockResolvedValue({ appointment })
  vi.spyOn(appointmentsApi, 'update').mockResolvedValue({ appointment: { ...appointment, notes: 'Updated' } })
  vi.spyOn(appointmentsApi, 'changeStatus').mockImplementation(async (_id, status) => ({ appointment: { ...appointment, status } }))
  vi.spyOn(appointmentsApi, 'cancel').mockResolvedValue({ appointment: { ...appointment, status: 'CANCELLED', cancelledAt: '2026-10-29T12:01:00Z', cancellationReason: 'Original server reason' } })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals() })
const render = async (node: ReactNode) => { await act(async () => root.render(node)) }
const tick = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
const buttons = () => Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
const button = (label: string) => buttons().find((item) => item.textContent?.trim() === label)!
const click = async (label: string) => { await act(async () => button(label).click()); await tick() }
async function fill(name: string, value: string) {
  await act(async () => {
    const input = host.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`[name="${name}"]`)!
    const prototype = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
}
const submit = async () => { await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) }); await tick() }
const list = (role = user.role) => <Appointments user={{ ...user, role }} onBook={vi.fn()} onSelect={vi.fn()} />
const detail = (value: Appointment | undefined = appointment, role = user.role, changed = vi.fn()) => <AppointmentDetail id={appointment.id} initialAppointment={value} user={{ ...user, role }} onBack={vi.fn()} onChanged={changed} />
const form = (value?: Appointment, saved = vi.fn()) => <AppointmentForm role="ADMIN" appointment={value} onClose={vi.fn()} onSaved={saved} />
async function selectBooking() { await tick(); await click('Amina Patient PT-REAL'); await fill('clinicianId', clinician.id) }

it('announces loading, renders real summaries, local dates, type and status', async () => {
  await render(list()); expect(host.textContent).toContain('Loading appointments'); await tick()
  for (const value of ['APT-SERVER', 'Amina Patient', 'PT-REAL', 'Grace Doctor', 'STF-DOCTOR', 'Consultation', 'Scheduled', displayTime(appointment.scheduledStart)]) expect(host.textContent).toContain(value)
})
it.each(['ADMIN', 'RECORDS_OFFICER'] as const)('%s sees booking and clinician filter', async (role) => { await render(list(role)); await tick(); expect(button('Book appointment')).toBeDefined(); expect(host.querySelector('[name="clinicianId"]')).not.toBeNull() })
it('doctor list states own scope, hides booking and never loads the clinician lookup', async () => {
  await render(list('DOCTOR_IN_CHARGE')); await tick()
  expect(host.textContent).toContain('My appointments'); expect(button('Book appointment')).toBeUndefined()
  expect(appointmentsApi.clinicians).not.toHaveBeenCalled()
  expect(appointmentsApi.list).toHaveBeenCalledWith(expect.not.objectContaining({ clinicianId: expect.anything() }), expect.any(AbortSignal))
})
it('uses server pagination metadata with bounded controls', async () => {
  vi.mocked(appointmentsApi.list).mockResolvedValue({ ...page, pagination: { page: 1, limit: 10, total: 99999, totalPages: 10000 } })
  await render(list()); await tick(); expect(host.querySelectorAll('nav button')).toHaveLength(2)
  expect(button('Previous').disabled).toBe(true); await click('Next')
  expect(appointmentsApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }), expect.any(AbortSignal))
})
it('debounces search, aborts old requests and ignores late results', async () => {
  let resolve!: (value: typeof page) => void
  vi.mocked(appointmentsApi.list).mockImplementationOnce(() => new Promise((done) => { resolve = done }))
  await render(list()); await tick(); const signal = vi.mocked(appointmentsApi.list).mock.calls[0]![1]!
  await fill('appointmentSearch', 'new'); expect(signal.aborted).toBe(true)
  await tick(299); expect(appointmentsApi.list).toHaveBeenCalledTimes(1); await tick(1)
  await act(async () => resolve({ ...page, items: [{ ...appointment, reference: 'STALE' }] }))
  expect(host.textContent).not.toContain('STALE'); expect(host.textContent).toContain('APT-SERVER')
})
it.each(['', 'Missing'])('shows empty state for search "%s"', async (search) => {
  vi.mocked(appointmentsApi.list).mockResolvedValue({ items: [], pagination: { ...page.pagination, total: 0, totalPages: 0 } })
  await render(list()); if (search) await fill('appointmentSearch', search); await tick(300)
  expect(host.textContent).toContain(search ? 'No appointments match your search' : 'No appointments in this view')
})
it('sends actual status, type, clinician and today filters', async () => {
  await render(list()); await tick(); await fill('status', 'CHECKED_IN'); await fill('type', 'FOLLOW_UP'); await fill('clinicianId', clinician.id); await fill('range', 'today'); await tick()
  expect(appointmentsApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, status: 'CHECKED_IN', type: 'FOLLOW_UP', clinicianId: clinician.id, dateFrom: expect.stringMatching(/Z$/), dateTo: expect.stringMatching(/Z$/) }), expect.any(AbortSignal))
})
it('blocks invalid custom range without fetching and accepts a valid range', async () => {
  await render(list()); await tick(); await fill('range', 'custom'); const count = vi.mocked(appointmentsApi.list).mock.calls.length; await tick()
  expect(host.textContent).toContain('Choose valid'); expect(appointmentsApi.list).toHaveBeenCalledTimes(count)
  await fill('from', '2026-10-29'); await fill('to', '2026-10-30'); await tick()
  expect(appointmentsApi.list).toHaveBeenCalledTimes(count + 1)
})
it('shows safe list errors with a deliberate retry', async () => {
  vi.mocked(appointmentsApi.list).mockRejectedValueOnce(new Error('internal'))
  await render(list()); await tick(); expect(host.querySelector('[role="alert"]')?.textContent).toContain('Unable to contact'); await click('Refresh appointments'); expect(host.textContent).toContain('APT-SERVER')
})
it('patient picker searches active backend records, pages and returns UUID summaries', async () => {
  const selected = vi.fn()
  vi.mocked(patientsApi.list).mockResolvedValue({ items: [patient, { ...patient, id: 'archived', firstName: 'Archived', archivedAt: '2026-01-01' }], pagination: { ...page.pagination, total: 11, totalPages: 2 } })
  await render(<PatientPicker selected={null} onSelect={selected} />); await tick()
  expect(host.textContent).not.toContain('Archived'); await fill('patientSearch', 'Amina'); await tick(300)
  expect(patientsApi.list).toHaveBeenLastCalledWith({ page: 1, limit: 10, search: 'Amina', archived: 'false' }, expect.any(AbortSignal))
  await click('Next'); await tick(300); expect(patientsApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }), expect.any(AbortSignal))
  await click('Amina Patient PT-REAL'); expect(selected).toHaveBeenCalledWith(patient)
  await render(<PatientPicker selected={patient} onSelect={selected} />); await click('Clear patient selection'); expect(selected).toHaveBeenLastCalledWith(null)
})
it('patient picker announces empty/error results and ignores a cancelled request', async () => {
  let resolve!: (value: Awaited<ReturnType<typeof patientsApi.list>>) => void
  vi.mocked(patientsApi.list).mockImplementationOnce(() => new Promise((done) => { resolve = done })).mockResolvedValueOnce({ items: [], pagination: page.pagination })
  await render(<PatientPicker selected={null} onSelect={vi.fn()} />); await tick(); const signal = vi.mocked(patientsApi.list).mock.calls[0]![1]!
  await fill('patientSearch', 'none'); await tick(300); await act(async () => resolve({ items: [patient], pagination: page.pagination }))
  expect(signal.aborted).toBe(true); expect(host.textContent).toContain('No active patients found'); expect(host.textContent).not.toContain('Amina')
  vi.mocked(patientsApi.list).mockRejectedValueOnce(new Error('network')); await fill('patientSearch', 'retry'); await tick(300); expect(host.querySelector('[role="alert"]')).not.toBeNull()
})
it('clinician picker uses only the dedicated active-doctor lookup and keeps UUID values', async () => {
  const change = vi.fn(); await render(<ClinicianPicker value="" onChange={change} />)
  expect(appointmentsApi.clinicians).toHaveBeenCalledWith(expect.any(AbortSignal)); expect(host.querySelector('option[value="22222222-2222-4222-8222-222222222222"]')?.textContent).toBe('Grace Doctor · STF-DOCTOR')
  expect(host.textContent).not.toContain('@'); await fill('clinicianId', clinician.id); expect(change).toHaveBeenCalledWith(clinician.id)
})
it('clinician picker handles loading, failure and empty lookup', async () => {
  vi.mocked(appointmentsApi.clinicians).mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ clinicians: [] })
  await render(<ClinicianPicker value="" onChange={vi.fn()} />); expect(host.querySelector('[role="alert"]')).not.toBeNull()
  await click('Reload doctors'); expect(host.textContent).toContain('No active doctors')
})
it('create requires selection and sends real IDs and zoned times, then uses returned DTO', async () => {
  const saved = vi.fn(); await render(form(undefined, saved)); await tick(); await submit(); expect(appointmentsApi.create).not.toHaveBeenCalled()
  await selectBooking(); expect(button('Clear patient selection')).toBe(document.activeElement)
  await click('Clear patient selection'); expect(document.activeElement?.getAttribute('name')).toBe('patientSearch')
  await selectBooking(); await submit()
  expect(appointmentsApi.create).toHaveBeenCalledWith(expect.objectContaining({ patientId: patient.id, clinicianId: clinician.id, scheduledStart: expect.stringMatching(/Z$/), scheduledEnd: expect.stringMatching(/Z$/) }))
  expect(saved).toHaveBeenCalledWith(appointment)
})
it('blocks invalid and past schedules without a mutation', async () => {
  await render(form()); await selectBooking(); await fill('end', toLocalInput('2026-10-29T10:00:00Z')); await submit(); expect(host.textContent).toContain('duration')
  await fill('start', toLocalInput('2026-10-28T12:00:00Z')); await fill('end', toLocalInput('2026-10-28T12:30:00Z')); await submit(); expect(host.textContent).toContain('past'); expect(appointmentsApi.create).not.toHaveBeenCalled()
})
it.each([['APPOINTMENT_CONFLICT', 'conflicts'], ['PATIENT_ARCHIVED', 'archived'], ['CLINICIAN_NOT_ACTIVE', 'no longer active'], ['INVALID_CLINICIAN_ROLE', 'eligible doctor'], ['CLINICIAN_NOT_FOUND', 'no longer available']] as const)('preserves create values and maps %s', async (code, message) => {
  vi.mocked(appointmentsApi.create).mockRejectedValue(new ApiError(409, 'secret', code))
  await render(form()); await selectBooking(); await fill('notes', 'Keep this'); await submit()
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(message)
  expect((host.querySelector('[name="notes"]') as HTMLTextAreaElement).value).toBe('Keep this')
  if (code.includes('CLINICIAN')) expect((host.querySelector('[name="clinicianId"]') as HTMLSelectElement).value).toBe('')
})
it('asks staff to refresh the schedule before retrying when a booking result is unconfirmed', async () => {
  vi.mocked(appointmentsApi.create).mockRejectedValueOnce(new TypeError('Failed to fetch'))
  await render(form()); await selectBooking(); await fill('notes', 'Keep this'); await submit()
  const alert = host.querySelector('[role="alert"]')!.textContent!
  expect(alert).toContain('could not be confirmed'); expect(alert).toContain('refresh the schedule'); expect(alert).not.toContain('Unable to contact')
  expect((host.querySelector('[name="notes"]') as HTMLTextAreaElement).value).toBe('Keep this'); expect(appointmentsApi.create).toHaveBeenCalledTimes(1)
})
it('loads detail by UUID and shows only scheduling information', async () => {
  await render(<AppointmentDetail id={appointment.id} user={user} onBack={vi.fn()} onChanged={vi.fn()} />)
  expect(appointmentsApi.get).toHaveBeenCalledWith(appointment.id, expect.any(AbortSignal))
  expect(host.textContent).toContain('Clinical documentation for this visit is kept in Medical Records'); expect(host.textContent).toContain('Scheduling only')
})
it('uses generic hidden-resource not-found with back navigation', async () => {
  vi.mocked(appointmentsApi.get).mockRejectedValue(new ApiError(404, 'belongs to other doctor', 'APPOINTMENT_NOT_FOUND'))
  await render(<AppointmentDetail id="hidden" user={{ ...user, role: 'DOCTOR_IN_CHARGE' }} onBack={vi.fn()} onChanged={vi.fn()} />)
  expect(host.textContent).toContain('Appointment not found'); expect(host.textContent).not.toContain('other doctor'); expect(button('Back to Appointments')).toBeDefined()
})
it.each(['ADMIN', 'RECORDS_OFFICER'] as const)('%s sees edit, cancel and allowed lifecycle controls', async (role) => {
  await render(detail(appointment, role)); expect(button('Edit / reschedule')).toBeDefined(); expect(button('Cancel appointment')).toBeDefined(); expect(button('Confirm')).toBeDefined(); expect(button('Mark no-show').disabled).toBe(true)
})
it('doctor can confirm own assignment, with no administrative controls', async () => {
  const changed = vi.fn(); await render(detail(appointment, 'DOCTOR_IN_CHARGE', changed))
  expect(button('Edit / reschedule')).toBeUndefined(); expect(button('Cancel appointment')).toBeUndefined(); await click('Confirm')
  expect(appointmentsApi.changeStatus).toHaveBeenCalledWith(appointment.id, 'CONFIRMED'); expect(changed).toHaveBeenCalledOnce(); expect(button('Check in')).toBeDefined()
})
it('does not offer doctor actions on an unassigned or different-doctor DTO', async () => {
  await render(detail({ ...appointment, clinician: null }, 'DOCTOR_IN_CHARGE')); expect(button('Confirm')).toBeUndefined()
})
it.each(['CHECKED_IN', 'COMPLETED', 'CANCELLED', 'NO_SHOW'] as const)('hides edit and cancellation for %s', async (status) => {
  await render(detail({ ...appointment, status })); expect(button('Edit / reschedule')).toBeUndefined(); expect(button('Cancel appointment')).toBeUndefined()
})
it('reschedules using only editable differences and preserves text on conflict', async () => {
  vi.mocked(appointmentsApi.update).mockRejectedValueOnce(new ApiError(409, 'raw', 'APPOINTMENT_CONFLICT'))
  await render(form(appointment)); await fill('start', toLocalInput('2026-10-29T14:00:00Z')); await fill('end', toLocalInput('2026-10-29T14:30:00Z')); await fill('notes', 'Keep edit'); await submit()
  expect(appointmentsApi.update).toHaveBeenLastCalledWith(appointment.id, { scheduledStart: '2026-10-29T14:00:00.000Z', scheduledEnd: '2026-10-29T14:30:00.000Z', notes: 'Keep edit' })
  expect(host.textContent).toContain('conflicts'); expect((host.querySelector('[name="notes"]') as HTMLTextAreaElement).value).toBe('Keep edit'); expect(host.querySelector('[name="patientSearch"]')).toBeNull()
})
it.each([['CONFIRMED', 'Check in', 'CHECKED_IN'], ['CHECKED_IN', 'Complete', 'COMPLETED']] as const)('executes %s lifecycle without creating clinical records', async (status, label, target) => {
  await render(detail({ ...appointment, status })); await click(label)
  expect(appointmentsApi.changeStatus).toHaveBeenCalledWith(appointment.id, target); expect(appointmentsApi.create).not.toHaveBeenCalled()
})
it('updates timing gates as actual current time advances', async () => {
  await render(detail({ ...appointment, scheduledStart: '2026-10-29T14:00:00Z', status: 'CONFIRMED' }))
  expect(button('Check in').disabled).toBe(true); await tick(3600000); expect(button('Check in').disabled).toBe(false)
})
it('handles server timing/state rejection and leaves the current status unchanged', async () => {
  vi.mocked(appointmentsApi.changeStatus).mockRejectedValue(new ApiError(409, 'raw', 'INVALID_APPOINTMENT_STATUS_TRANSITION'))
  await render(detail()); await click('Confirm'); expect(host.textContent).toContain('current status or time'); expect(button('Confirm')).toBeDefined()
})
it('requires cancellation confirmation and renders the original server cancellation response', async () => {
  await render(detail()); await click('Cancel appointment'); expect(appointmentsApi.cancel).not.toHaveBeenCalled()
  expect(host.querySelector('[role="dialog"]')?.textContent).toContain('history remains'); expect(host.querySelector('[role="dialog"]')?.textContent).not.toMatch(/delete/i)
  await fill('cancellationReason', ' My reason '); await submit(); expect(appointmentsApi.cancel).toHaveBeenCalledWith(appointment.id, 'My reason')
  expect(host.textContent).toContain('Original server reason'); expect(host.textContent).toContain(displayTime('2026-10-29T12:01:00Z')); expect(button('Cancel appointment')).toBeUndefined()
})
it('traps textarea focus, handles Escape and restores focus', async () => {
  const opener = document.createElement('button'); document.body.append(opener); opener.focus(); const close = vi.fn()
  await render(<AppointmentDialog title="Test" busy={false} onClose={close}><textarea /><button>Last</button></AppointmentDialog>)
  const dialog = host.querySelector<HTMLElement>('[role="dialog"]')!; expect(document.activeElement).toBe(dialog)
  button('Last').focus(); await act(async () => dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })))
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Close appointment dialog')
  opener.focus()
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })))
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Close appointment dialog')
  await act(async () => dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))); expect(close).toHaveBeenCalledOnce()
  await render(null); expect(document.activeElement).toBe(opener); opener.remove()
})
it('blocks duplicate submit and dismissal while a booking is pending', async () => {
  vi.mocked(appointmentsApi.create).mockImplementation(() => new Promise(() => {}))
  const close = vi.fn(); await render(<AppointmentForm role="ADMIN" onClose={close} onSaved={vi.fn()} />); await selectBooking(); await submit(); await submit()
  expect(appointmentsApi.create).toHaveBeenCalledOnce()
  const dialog = host.querySelector<HTMLElement>('[role="dialog"]')!; await act(async () => dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(close).not.toHaveBeenCalled(); expect(host.querySelector('fieldset')?.disabled).toBe(true)
})
