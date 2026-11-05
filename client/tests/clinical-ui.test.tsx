// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { encountersApi, type Encounter } from '../src/api/encounters'
import { ApiError } from '../src/api/client'
import { Records } from '../src/features/records/Records'
import { EncounterList } from '../src/features/records/EncounterList'
import { EncounterDetail } from '../src/features/records/EncounterDetail'
import { EncounterForm } from '../src/features/records/EncounterForm'
import { AppointmentClinicalLink } from '../src/features/records/AppointmentClinicalLink'
import { ClinicalDialog } from '../src/features/records/ClinicalDialog'
import { ClinicalCommand } from '../src/features/records/ClinicalCommands'
import { displayTime, toLocalInput } from '../src/features/appointments/appointment-time'
import { clinicalPage, doctor, eligibleAppointment, encounter, patient, reviewed } from './clinical-fixtures'
let root: Root, host: HTMLDivElement
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-01T12:00:00Z')); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  vi.spyOn(encountersApi, 'list').mockResolvedValue(clinicalPage); vi.spyOn(encountersApi, 'history').mockResolvedValue(clinicalPage); vi.spyOn(encountersApi, 'get').mockResolvedValue({ encounter })
  vi.spyOn(encountersApi, 'create').mockResolvedValue({ encounter }); vi.spyOn(encountersApi, 'updateDraft').mockResolvedValue({ encounter: { ...encounter, clinicalNotes: 'Updated clinical note' } })
  vi.spyOn(encountersApi, 'finalize').mockResolvedValue({ encounter: reviewed }); vi.spyOn(encountersApi, 'amend').mockImplementation(async (_id, input) => ({ encounter: { ...reviewed, amendments: [{ id: 'amendment-1', ...input, author: doctor, createdAt: '2026-11-01T12:00:00Z' }] } }))
  vi.spyOn(window, 'confirm').mockReturnValue(false)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals() })
const render = async (node: ReactNode) => { await act(async () => root.render(node)) }
const tick = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
const buttons = () => Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
const button = (text: string) => buttons().find((item) => item.textContent?.trim() === text)!
const click = async (text: string) => { await act(async () => button(text).click()); await tick() }
async function fill(name: string, value: string) {
  await act(async () => {
    const input = host.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`[name="${name}"]`)!
    const prototype = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
}
const submit = async () => { await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) }); await tick() }
const detail = (value: Encounter = encounter, identity = doctor) => <EncounterDetail user={identity} id={value.id} initial={value} onBack={vi.fn()} onChanged={vi.fn()} />
const editor = (value?: Encounter, saved = vi.fn(), close = vi.fn()) => <EncounterForm user={doctor} patient={patient} encounter={value} appointment={eligibleAppointment} onClose={close} onSaved={saved} />
it.each(['ADMIN', 'RECORDS_OFFICER'] as const)('%s cannot mount clinical screens or cause clinical reads', async (role) => {
  const user = { ...doctor, role }
  await render(<><Records user={user} context={{ kind: 'patient', patient }} onBack={vi.fn()} onChoosePatient={vi.fn()} /><EncounterDetail user={user} id={encounter.id} onBack={vi.fn()} onChanged={vi.fn()} /><EncounterList user={user} patient={patient} revision={0} onSelect={vi.fn()} /><EncounterForm user={user} patient={patient} onClose={vi.fn()} onSaved={vi.fn()} /><AppointmentClinicalLink user={user} appointment={eligibleAppointment} onEnter={vi.fn()} /></>); await tick()
  expect(host.textContent).toBe(''); expect(encountersApi.list).not.toHaveBeenCalled(); expect(encountersApi.history).not.toHaveBeenCalled(); expect(encountersApi.get).not.toHaveBeenCalled()
})
it('loads real clinical summaries without detail-only notes or audit data', async () => {
  await render(<EncounterList user={doctor} revision={0} onSelect={vi.fn()} />); expect(host.textContent).toContain('Loading clinical records'); await tick()
  for (const value of ['MR-SERVER', 'Amina Patient', 'Grace Doctor', 'Example diagnosis', 'LOCAL-1', 'APT-SERVER', 'Draft', displayTime(encounter.occurredAt)]) expect(host.textContent).toContain(value)
  expect(host.textContent).not.toContain('Original clinical notes'); expect(encountersApi.get).not.toHaveBeenCalled()
})
it('loads archived patient history without offering creation', async () => {
  await render(<Records user={doctor} context={{ kind: 'patient', patient: { ...patient, archivedAt: '2026-11-01T10:00:00Z' } }} onBack={vi.fn()} onChoosePatient={vi.fn()} />); await tick()
  expect(encountersApi.history).toHaveBeenCalledWith(patient.id, expect.objectContaining({ page: 1, limit: 20 }), expect.any(AbortSignal)); expect(encountersApi.list).not.toHaveBeenCalled(); expect(host.textContent).toContain('Archived patient'); expect(button('New encounter for this patient')).toBeUndefined()
})
it.each(['history', 'list'] as const)('announces empty %s separately from filter emptiness', async (kind) => {
  vi.mocked(encountersApi[kind]).mockResolvedValue({ items: [], pagination: { ...clinicalPage.pagination, total: 0, totalPages: 0 } })
  await render(<EncounterList user={doctor} patient={kind === 'history' ? patient : undefined} revision={0} onSelect={vi.fn()} />); await tick()
  expect(host.textContent).toContain(kind === 'history' ? 'No clinical encounters have been recorded for this patient' : 'No clinical encounters have been recorded')
  await fill('clinicalSearch', 'MR-NONE'); await tick(300); expect(host.textContent).toContain('No clinical records match these filters')
})
it('debounces reference search and ignores aborted stale clinical results', async () => {
  let resolve!: (value: typeof clinicalPage) => void
  vi.mocked(encountersApi.list).mockImplementationOnce(() => new Promise((done) => { resolve = done }))
  await render(<EncounterList user={doctor} revision={0} onSelect={vi.fn()} />); await tick(); const signal = vi.mocked(encountersApi.list).mock.calls[0]![1]!
  await fill('clinicalSearch', 'MR-NEW'); expect(signal.aborted).toBe(true); await tick(299); expect(encountersApi.list).toHaveBeenCalledOnce(); await tick(1)
  await act(async () => resolve({ ...clinicalPage, items: [{ ...clinicalPage.items[0]!, reference: 'STALE-SECRET' }] })); expect(host.textContent).not.toContain('STALE-SECRET'); expect(host.textContent).toContain('MR-SERVER')
})
it('uses backend filters, date boundaries and bounded pagination', async () => {
  vi.mocked(encountersApi.list).mockResolvedValue({ ...clinicalPage, pagination: { ...clinicalPage.pagination, total: 10000, totalPages: 500 } })
  await render(<EncounterList user={doctor} revision={0} onSelect={vi.fn()} />); await tick(); expect(host.querySelectorAll('nav button')).toHaveLength(2)
  await click('Next'); expect(encountersApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }), expect.any(AbortSignal))
  await fill('clinicalStatus', 'REVIEWED'); await fill('clinicalScope', 'own'); await fill('clinicalFrom', '2026-10-01'); await tick(); expect(host.textContent).toContain('Enter both dates')
  await fill('clinicalTo', '2026-11-01'); await tick(); expect(encountersApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, status: 'REVIEWED', clinicianId: doctor.id, dateFrom: expect.stringMatching(/Z$/), dateTo: expect.stringMatching(/Z$/) }), expect.any(AbortSignal))
})
it('maps list failure safely and retries deliberately', async () => {
  vi.mocked(encountersApi.list).mockRejectedValueOnce(new Error('raw private payload'))
  await render(<EncounterList user={doctor} revision={0} onSelect={vi.fn()} />); await tick(); expect(host.textContent).not.toContain('raw private'); expect(host.querySelector('[role="alert"]')).not.toBeNull(); await click('Refresh clinical records'); expect(host.textContent).toContain('MR-SERVER')
})
it('loads detail by UUID and displays actual content with local timestamps', async () => {
  await render(<EncounterDetail user={doctor} id={encounter.id} onBack={vi.fn()} onChanged={vi.fn()} />)
  expect(encountersApi.get).toHaveBeenCalledWith(encounter.id, expect.any(AbortSignal))
  for (const value of ['MR-SERVER', 'Amina Patient', 'Grace Doctor', 'APT-SERVER', 'Example complaint', 'Example diagnosis', 'Diagnosis note', 'History\nSecond line', 'Original clinical notes', 'Original treatment plan', displayTime(encounter.occurredAt)]) expect(host.textContent).toContain(value)
  expect(host.textContent).not.toContain(doctor.email)
})
it('shows generic hidden/unknown detail with back navigation', async () => {
  vi.mocked(encountersApi.get).mockRejectedValue(new ApiError(404, 'hidden clinical content', 'ENCOUNTER_NOT_FOUND'))
  await render(<EncounterDetail user={doctor} id="unknown" onBack={vi.fn()} onChanged={vi.fn()} />); expect(host.textContent).toContain('Clinical record not found.'); expect(host.textContent).not.toContain('hidden clinical content'); expect(button('Back to clinical records')).toBeDefined()
})
it.each(['other-author', 'other-clinician', 'null-clinician'] as const)('keeps %s records readable without mutation controls', async (kind) => {
  const value = { ...encounter, ...(kind === 'other-author' ? { author: { ...doctor, id: 'other' } } : { clinician: kind === 'null-clinician' ? null : { ...doctor, id: 'other' } }) }
  await render(detail(value)); expect(host.textContent).toContain('Original clinical notes'); expect(button('Edit draft')).toBeUndefined(); expect(button('Finalize record')).toBeUndefined(); expect(button('Add amendment')).toBeUndefined()
})
it.each(['REVIEWED', 'VOIDED'] as const)('renders %s content read-only with no edit, delete or finalize controls', async (status) => {
  await render(detail({ ...reviewed, status })); expect(button('Edit draft')).toBeUndefined(); expect(button('Finalize record')).toBeUndefined(); expect(buttons().some((item) => /delete/i.test(item.textContent ?? ''))).toBe(false)
  expect(Boolean(button('Add amendment'))).toBe(status === 'REVIEWED'); expect(host.textContent).toContain(displayTime(reviewed.reviewedAt!))
})
it('creates a draft with real patient/appointment IDs and zoned time, using the returned DTO', async () => {
  const saved = vi.fn(); await render(editor(undefined, saved)); await fill('clinicalNotes', 'Actual entered note'); await submit()
  expect(encountersApi.create).toHaveBeenCalledWith(expect.objectContaining({ patientId: patient.id, appointmentId: eligibleAppointment.id, occurredAt: expect.stringMatching(/Z$/), clinicalNotes: 'Actual entered note' }), expect.stringMatching(/^[0-9a-f-]{36}$/))
  expect(encountersApi.create).toHaveBeenCalledWith(expect.not.objectContaining({ clinicianId: expect.anything(), status: expect.anything() }), expect.stringMatching(/^[0-9a-f-]{36}$/)); expect(saved).toHaveBeenCalledWith(encounter)
})
it('supports unlinked creation from an explicitly selected patient', async () => {
  await render(<EncounterForm user={doctor} patient={patient} onClose={vi.fn()} onSaved={vi.fn()} />); await submit()
  expect(encountersApi.create).toHaveBeenCalledWith(expect.objectContaining({ patientId: patient.id }), expect.stringMatching(/^[0-9a-f-]{36}$/)); expect(vi.mocked(encountersApi.create).mock.calls[0]![0]).not.toHaveProperty('appointmentId')
})
it('adds, edits and removes structured complaints and multiple diagnoses', async () => {
  await render(editor()); await click('Add complaint'); await submit(); expect(host.textContent).toContain('Each complaint needs')
  await fill('complaint-0', 'First complaint'); await click('Add complaint'); await fill('complaint-1', 'Remove me'); await click('Remove complaint 2')
  await click('Add diagnosis'); await fill('diagnosis-0-description', 'First diagnosis'); await fill('diagnosis-0-code', 'Optional label'); await fill('diagnosis-0-notes', 'First\nSecond'); await click('Add diagnosis'); await fill('diagnosis-1-description', 'Second diagnosis'); await submit()
  expect(encountersApi.create).toHaveBeenCalledWith(expect.objectContaining({ complaints: [{ description: 'First complaint' }], diagnoses: [{ description: 'First diagnosis', code: 'Optional label', notes: 'First\nSecond' }, { description: 'Second diagnosis', code: null, notes: null }] }), expect.stringMatching(/^[0-9a-f-]{36}$/))
})
it('blocks invalid clinical time and preserves user content', async () => {
  await render(editor()); await fill('clinicalNotes', 'Keep note'); await fill('occurredAt', toLocalInput('2026-11-02T12:00:00Z')); await submit()
  expect(encountersApi.create).not.toHaveBeenCalled(); expect(host.textContent).toContain('future'); expect((host.querySelector('[name="clinicalNotes"]') as HTMLTextAreaElement).value).toBe('Keep note')
})
it.each(['PATIENT_ARCHIVED', 'APPOINTMENT_NOT_ELIGIBLE_FOR_ENCOUNTER', 'APPOINTMENT_ALREADY_HAS_ENCOUNTER'] as const)('handles create rejection %s without losing draft text', async (code) => {
  vi.mocked(encountersApi.create).mockRejectedValue(new ApiError(409, 'raw secret', code)); await render(editor()); await fill('clinicalNotes', 'Retain draft'); await submit()
  expect(host.querySelector('[role="alert"]')).not.toBeNull(); expect(host.textContent).not.toContain('raw secret'); expect((host.querySelector('[name="clinicalNotes"]') as HTMLTextAreaElement).value).toBe('Retain draft')
})
it('offers deliberate duplicate encounter recovery without replaying creation', async () => {
  const open = vi.fn(); vi.mocked(encountersApi.create).mockRejectedValue(new ApiError(409, '', 'APPOINTMENT_ALREADY_HAS_ENCOUNTER'))
  await render(<EncounterForm user={doctor} patient={patient} appointment={eligibleAppointment} onClose={vi.fn()} onSaved={vi.fn()} onOpenExisting={open} />); await submit(); await click('Open existing clinical record')
  expect(open).toHaveBeenCalledOnce(); expect(encountersApi.create).toHaveBeenCalledOnce()
})
it('draft editing sends only changed fields with immutable context', async () => {
  await render(editor(encounter)); expect(host.querySelector('select')).toBeNull(); expect(host.textContent).toContain('cannot be changed')
  await fill('clinicalNotes', 'Updated clinical note'); await submit(); expect(encountersApi.updateDraft).toHaveBeenCalledWith(encounter, { clinicalNotes: 'Updated clinical note' })
})
it('a failed draft save keeps entered text and supports deliberate retry', async () => {
  vi.mocked(encountersApi.updateDraft).mockRejectedValueOnce(new Error('secret'))
  await render(editor(encounter)); await fill('treatmentPlan', 'Keep plan'); await submit(); expect((host.querySelector('[name="treatmentPlan"]') as HTMLTextAreaElement).value).toBe('Keep plan'); await submit(); expect(encountersApi.updateDraft).toHaveBeenCalledTimes(2)
})
it('warns before closing a dirty draft and respects the decision', async () => {
  const close = vi.fn(); await render(editor(encounter, vi.fn(), close)); await fill('clinicalNotes', 'Unsaved')
  await click('Cancel'); expect(window.confirm).toHaveBeenCalledWith('Discard unsaved clinical changes?'); expect(close).not.toHaveBeenCalled()
  vi.mocked(window.confirm).mockReturnValue(true); await click('Cancel'); expect(close).toHaveBeenCalledOnce()
})
it('blocks duplicate saves and Escape/backdrop dismissal while a draft write is pending', async () => {
  vi.mocked(encountersApi.create).mockImplementation(() => new Promise(() => {})); const close = vi.fn(); await render(editor(undefined, vi.fn(), close)); await submit(); await submit()
  expect(encountersApi.create).toHaveBeenCalledOnce(); await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))); expect(close).not.toHaveBeenCalled(); expect(host.querySelector('fieldset')?.disabled).toBe(true)
})
it('requires explicit finalization confirmation and changes to immutable presentation from response', async () => {
  await render(detail()); await click('Finalize record'); expect(encountersApi.finalize).not.toHaveBeenCalled(); expect(host.querySelector('[role="dialog"]')?.textContent).toContain('cannot be edited directly'); await submit()
  expect(encountersApi.finalize).toHaveBeenCalledWith(encounter.id); expect(button('Edit draft')).toBeUndefined(); expect(host.textContent).toContain('Original finalized record'); expect(host.textContent).toContain(displayTime(reviewed.reviewedAt!)); expect(button('Add amendment')).toBeDefined()
})
it('shows empty-record rejection without inventing clinical content or finalizing locally', async () => {
  vi.mocked(encountersApi.finalize).mockRejectedValue(new ApiError(409, 'raw', 'EMPTY_CLINICAL_RECORD')); await render(detail()); await click('Finalize record'); await submit()
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('before finalizing'); expect(host.querySelector('.clinical-status')?.textContent).toBe('Draft'); expect(encountersApi.updateDraft).not.toHaveBeenCalled()
})
it('requires amendment reason/content and retains original finalized content plus multiple amendments', async () => {
  await render(detail(reviewed)); await click('Add amendment'); expect(host.querySelector('[role="dialog"]')?.textContent).toContain('will not replace the original'); await submit(); expect(encountersApi.amend).not.toHaveBeenCalled()
  await fill('amendmentReason', ' First reason '); await fill('amendmentContent', ' First addition '); await submit()
  const original = host.querySelector('.clinical-original')!.textContent
  expect(original).toContain('Original clinical notes'); expect(original).not.toContain('First addition')
  const first = { id: 'amendment-1', reason: 'First reason', content: 'First addition', author: doctor, createdAt: '2026-11-01T12:00:00Z' }
  vi.mocked(encountersApi.amend).mockResolvedValueOnce({ encounter: { ...reviewed, amendments: [first, { ...first, id: 'amendment-2', reason: 'Second reason', content: 'Second addition' }] } })
  await click('Add amendment'); await fill('amendmentReason', 'Second reason'); await fill('amendmentContent', 'Second addition'); await submit()
  expect(host.querySelector('.clinical-original')!.textContent).toBe(original)
  const articles = host.querySelectorAll('.clinical-amendments article'); expect(articles).toHaveLength(2); expect(articles[0]!.textContent).toContain('First addition'); expect(articles[1]!.textContent).toContain('Second addition'); expect(host.querySelector('.clinical-amendments button')).toBeNull()
})
it('clears an earlier success notice before a later amendment whose result cannot be confirmed', async () => {
  await render(detail(reviewed)); await click('Add amendment'); await fill('amendmentReason', 'First reason'); await fill('amendmentContent', 'First addition'); await submit()
  expect(host.querySelector('.clinical-detail')!.textContent).toContain('Amendment added to permanent history.')
  vi.mocked(encountersApi.amend).mockRejectedValueOnce(new TypeError('Failed to fetch'))
  await click('Add amendment'); expect(host.querySelector('.clinical-detail')!.textContent).not.toContain('Amendment added to permanent history.')
  await fill('amendmentReason', 'Second reason'); await fill('amendmentContent', 'Second addition'); await submit()
  expect(host.querySelector('[role="dialog"] .clinical-error')!.textContent).toContain('The amendment could not be confirmed. Select Add permanent amendment again without changing anything')
  expect(Array.from(host.querySelectorAll('[role="status"]')).some((item) => item.textContent?.includes('Amendment added'))).toBe(false)
  expect(encountersApi.amend).toHaveBeenCalledTimes(2)
})
it('keeps amendment input on server rejection and never overwrites the original', async () => {
  vi.mocked(encountersApi.amend).mockRejectedValue(new ApiError(403, 'raw', 'ENCOUNTER_AUTHOR_REQUIRED')); await render(detail(reviewed)); await click('Add amendment'); await fill('amendmentReason', 'Reason'); await fill('amendmentContent', 'Keep correction'); await submit()
  expect((host.querySelector('[name="amendmentContent"]') as HTMLTextAreaElement).value).toBe('Keep correction'); expect(host.querySelector('.clinical-original')!.textContent).toContain('Original clinical notes')
})
it.each(['CHECKED_IN', 'COMPLETED'] as const)('offers linked creation for own %s appointment only after lookup confirms absence', async (status) => {
  vi.mocked(encountersApi.list).mockResolvedValue({ items: [], pagination: clinicalPage.pagination }); const enter = vi.fn()
  await render(<AppointmentClinicalLink user={doctor} appointment={{ ...eligibleAppointment, status }} onEnter={enter} />)
  expect(encountersApi.list).toHaveBeenCalledWith({ appointmentId: eligibleAppointment.id, page: 1, limit: 1 }, expect.any(AbortSignal)); await click('Start clinical encounter'); expect(enter).toHaveBeenCalledWith({ ...eligibleAppointment, status }); expect(encountersApi.create).not.toHaveBeenCalled()
})
it('offers opening the existing clinical record instead of creating again', async () => {
  const enter = vi.fn(); await render(<AppointmentClinicalLink user={doctor} appointment={eligibleAppointment} onEnter={enter} />); expect(button('Start clinical encounter')).toBeUndefined(); await click('Open clinical record'); expect(enter).toHaveBeenCalledWith(eligibleAppointment, encounter.id)
})
it.each(['SCHEDULED', 'CONFIRMED', 'CANCELLED', 'NO_SHOW'] as const)('does not offer creation for %s appointments', async (status) => {
  vi.mocked(encountersApi.list).mockResolvedValue({ items: [], pagination: clinicalPage.pagination }); await render(<AppointmentClinicalLink user={doctor} appointment={{ ...eligibleAppointment, status }} onEnter={vi.fn()} />); expect(button('Start clinical encounter')).toBeUndefined()
})
it('does not discover clinical content through another doctor assignment', async () => {
  await render(<AppointmentClinicalLink user={{ ...doctor, id: 'other' }} appointment={eligibleAppointment} onEnter={vi.fn()} />); expect(encountersApi.list).not.toHaveBeenCalled(); expect(host.textContent).toBe('')
})
it('does not offer creation after failed linked lookup', async () => {
  vi.mocked(encountersApi.list).mockRejectedValueOnce(new Error('unavailable')); await render(<AppointmentClinicalLink user={doctor} appointment={eligibleAppointment} onEnter={vi.fn()} />); expect(button('Start clinical encounter')).toBeUndefined(); expect(host.querySelector('[role="alert"]')).not.toBeNull(); await click('Refresh linked record'); expect(button('Open clinical record')).toBeDefined()
})
it('focuses, traps textarea keyboard navigation and restores focus for clinical confirmations', async () => {
  const opener = document.createElement('button'); document.body.append(opener); opener.focus(); const close = vi.fn()
  await render(<ClinicalDialog title="Clinical confirmation" busy={false} onClose={close}><textarea /><button>Last</button></ClinicalDialog>)
  expect(document.activeElement).toBe(host.querySelector('[role="dialog"]')); button('Last').focus()
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))); expect(document.activeElement?.getAttribute('aria-label')).toBe('Close clinical dialog')
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))); expect(close).toHaveBeenCalledOnce(); await render(null); expect(document.activeElement).toBe(opener); opener.remove()
})

it.each(['finalize', 'amend'] as const)('requires history verification after an ambiguous %s response without replaying the write', async action => {
  vi.mocked(encountersApi[action]).mockRejectedValueOnce(new ApiError(502, 'internal upstream text', 'GATEWAY_ERROR', 'release-uncertain'))
  const saved = vi.fn()
  await render(<ClinicalCommand encounter={action === 'finalize' ? encounter : reviewed} action={action} onClose={vi.fn()} onSaved={saved} />)
  if (action === 'amend') { await fill('amendmentReason', 'Correction'); await fill('amendmentContent', 'Permanent addition') }
  await submit()
  expect(host.textContent).toContain(action === 'finalize' ? 'refresh the clinical record to check its status. A record cannot be finalized twice.' : 'an identical amendment is never added twice')
  expect(host.textContent).toContain('Support reference: release-uncertain')
  expect(host.textContent).not.toContain('internal upstream text')
  expect(encountersApi[action]).toHaveBeenCalledOnce(); expect(saved).not.toHaveBeenCalled()
  await tick(1000); expect(encountersApi[action]).toHaveBeenCalledOnce()
})
it('keeps an uncertain draft save recoverable without claiming success or replaying it', async () => {
  vi.mocked(encountersApi.create).mockRejectedValueOnce(new TypeError('private transport failure'))
  const saved = vi.fn(); await render(editor(undefined, saved)); await fill('clinicalNotes', 'Unsaved clinical input'); await submit()
  expect(host.querySelector('[role="dialog"] .clinical-error')?.textContent).toBe('The draft could not be confirmed. Select Save draft again without changing anything; the draft will not be saved twice.')
  expect(host.querySelector<HTMLTextAreaElement>('[name="clinicalNotes"]')!.value).toBe('Unsaved clinical input')
  expect(saved).not.toHaveBeenCalled(); expect(encountersApi.create).toHaveBeenCalledOnce()
})
