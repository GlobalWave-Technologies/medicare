// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '../src/api/client'
import { encountersApi, type Encounter, type MedicationHistoryItem } from '../src/api/encounters'
import { medicationsApi, type CatalogMedication } from '../src/api/medications'
import { allowedView, navItemsByRole, toUiRole, viewLabels } from '../src/app/navigation'
import { MedicationCatalog } from '../src/features/medications/MedicationCatalog'
import { EncounterDetail } from '../src/features/records/EncounterDetail'
import { EncounterForm } from '../src/features/records/EncounterForm'
import { MedicationHistory } from '../src/features/records/MedicationHistory'
import { admission, catalogOptions, doctor, encounter, patient, reviewed } from './clinical-fixtures'

// Phase 19B prescribing: a searchable medicine list, dosing fields, draft-only editing, history by
// admission, and the Admin-only catalog.
let root: Root, host: HTMLDivElement
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-01T12:00:00Z')); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  vi.spyOn(medicationsApi, 'options').mockResolvedValue({ items: catalogOptions })
  vi.spyOn(encountersApi, 'create').mockResolvedValue({ encounter }); vi.spyOn(encountersApi, 'updateDraft').mockResolvedValue({ encounter })
  vi.spyOn(window, 'confirm').mockReturnValue(false)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
const render = async (node: ReactNode) => { await act(async () => root.render(node)); await tick() }
const tick = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
const buttons = () => Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
const button = (text: string) => buttons().find((item) => item.textContent?.trim() === text || item.getAttribute('aria-label') === text)
async function click(text: string) { const target = button(text); expect(target, text).toBeDefined(); await act(async () => target!.click()); await tick() }
const field = <T extends HTMLElement = HTMLInputElement>(name: string) => host.querySelector<T>(`[name="${name}"]`)!
async function fill(name: string, value: string) {
  await act(async () => {
    const input = field<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(name)
    const prototype = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
}
const picker = () => field('medication-medicine')
const press = async (key: string) => { await act(async () => { picker().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })) }) }
const optionNames = () => Array.from(host.querySelectorAll('[role="option"]')).map((option) => option.textContent)
const status = () => document.getElementById(picker().getAttribute('aria-describedby')!.split(' ').at(-1)!)!.textContent
const submit = async () => { await act(async () => { host.querySelector('form.clinical-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) }); await tick() }
const editor = (value?: Encounter) => <EncounterForm user={doctor} patient={patient} encounter={value} admission={value ? value.admission : admission} onClose={vi.fn()} onSaved={vi.fn()} />
async function choose(search: string) { await fill('medication-medicine', search); await press('Enter') }
async function addOrder(search: string, details: Record<string, string>) {
  await click('Add medication'); await choose(search)
  for (const [name, value] of Object.entries(details)) await fill(`medication-${name}`, value)
  await click('Add to record')
}

it('offers a labelled, searchable medicine list loaded once, filtering as the Medical Officer types', async () => {
  await render(editor()); await click('Add medication')
  const input = picker()
  expect(host.querySelector(`label[for="${input.id}"]`)?.textContent).toBe('Medicine')
  expect(input.getAttribute('role')).toBe('combobox'); expect(input.getAttribute('aria-expanded')).toBe('false')
  await fill('medication-medicine', 'sal')
  expect(input.getAttribute('aria-expanded')).toBe('true'); expect(optionNames()).toEqual(['Salbutamol inhaler', 'Salbutamol tab'])
  expect(host.querySelector('[role="listbox"]')?.getAttribute('aria-label')).toBe('Medicines'); expect(status()).toContain('2 medicines found')
  await fill('medication-medicine', 'SALBUTAMOL I'); expect(optionNames()).toEqual(['Salbutamol inhaler'])
  expect(medicationsApi.options).toHaveBeenCalledOnce()
})
it('chooses with the keyboard and announces the choice', async () => {
  await render(editor()); await click('Add medication'); await fill('medication-medicine', 'sal')
  const options = () => Array.from(host.querySelectorAll('[role="option"]'))
  expect(picker().getAttribute('aria-activedescendant')).toBe(options()[0]!.id)
  await press('ArrowDown'); expect(picker().getAttribute('aria-activedescendant')).toBe(options()[1]!.id); expect(options()[1]!.getAttribute('aria-selected')).toBe('true')
  await press('ArrowUp'); await press('End'); expect(options()[1]!.getAttribute('aria-selected')).toBe('true')
  await press('Enter')
  expect(picker().value).toBe('Salbutamol tab'); expect(picker().getAttribute('aria-expanded')).toBe('false'); expect(status()).toBe('Salbutamol tab selected.')
  await press('ArrowDown'); expect(optionNames()).toContain('Paracetamol'); await press('Escape'); expect(picker().getAttribute('aria-expanded')).toBe('false')
  expect(encountersApi.create).not.toHaveBeenCalled()
})
it('says clearly when nothing matches, and Enter then neither chooses nor saves', async () => {
  await render(editor()); await click('Add medication'); await fill('medication-medicine', 'zzz')
  expect(optionNames()).toEqual([]); expect(host.querySelector('.medication-picker-empty')?.textContent).toContain('No medicines match “zzz”')
  // Phase 19F: a Medical Officer adds a missing medicine instead of asking an administrator.
  expect(host.querySelector('.medication-picker-empty')?.textContent).not.toContain('administrator'); expect(button('Add “zzz” to catalog')).toBeDefined()
  expect(status()).toBe('No medicines match “zzz”. To add it, use Add “zzz” to catalog after this field.')
  await press('Enter'); expect(encountersApi.create).not.toHaveBeenCalled(); expect(host.querySelector('.medication-editor')).not.toBeNull()
})
it('adds two medicines with their dosing, edits one, removes another, and saves catalog ids only', async () => {
  await render(editor())
  await addOrder('para', { strength: '500 mg', dose: '1 tablet', route: 'Oral', frequency: 'Three times daily', duration: '5 days' })
  const cards = () => Array.from(host.querySelectorAll('.medication-order-card')).map((card) => card.querySelector('.medication-order-text')!.textContent)
  expect(cards()).toEqual(['Paracetamol 500 mg1 tablet · Oral · Three times daily · 5 days'])
  await click('Add medication'); await choose('ibu'); await fill('medication-strength', '400 mg'); await fill('medication-dose', '1 tablet'); await fill('medication-route', 'Oral')
  await fill('medication-frequency', 'other'); await fill('medication-frequency-other', 'Every 8 hours'); await fill('medication-notes', 'After meals'); await click('Add to record')
  await click('Edit Paracetamol 500 mg (order 1)'); expect(picker().value).toBe('Paracetamol'); await fill('medication-dose', '2 tablets'); await click('Update medication')
  await addOrder('ORS', { dose: '1 sachet', route: 'Oral', frequency: 'Stat' }); expect(cards()).toHaveLength(3)
  await click('Remove ORS (order 3)'); expect(cards()).toHaveLength(2)
  await submit()
  const sent = vi.mocked(encountersApi.create).mock.calls[0]![0].medications
  expect(sent).toEqual([{ medicationId: 'catalog-paracetamol', strength: '500 mg', dose: '2 tablets', route: 'Oral', frequency: 'Three times daily', duration: '5 days', notes: null },
    { medicationId: 'catalog-ibuprofen', strength: '400 mg', dose: '1 tablet', route: 'Oral', frequency: 'Every 8 hours', duration: null, notes: 'After meals' }])
  expect(JSON.stringify(sent)).not.toContain('medicine')
})
it('requires a medicine chosen from the list plus dose, route and frequency, with errors on their fields', async () => {
  await render(editor()); await click('Add medication'); await click('Add to record')
  const input = picker(), error = (element: Element) => element.getAttribute('aria-describedby')!.split(' ').map((id) => document.getElementById(id)?.textContent).join(' ')
  expect(input.getAttribute('aria-invalid')).toBe('true'); expect(error(input)).toContain('Choose a medicine from the list.'); expect(document.activeElement).toBe(input)
  for (const name of ['medication-dose', 'medication-route', 'medication-frequency']) expect(field(name).getAttribute('aria-invalid')).toBe('true')
  expect(error(field('medication-route'))).toContain('Choose the route.')
  // Typing the exact name is not a choice: only selecting from the list prescribes.
  await fill('medication-medicine', 'Paracetamol'); await fill('medication-dose', '1 tablet'); await fill('medication-route', 'Oral'); await fill('medication-frequency', 'Stat')
  await click('Add to record'); expect(error(picker())).toContain('Choose a medicine from the list.'); expect(host.querySelectorAll('.medication-order-card')).toHaveLength(0)
})
it('keeps the draft unsaved while a medication is half-entered', async () => {
  await render(editor()); await click('Add medication'); await submit()
  expect(host.querySelector('.clinical-error')?.textContent).toContain('Finish the medication you are entering first'); expect(encountersApi.create).not.toHaveBeenCalled()
  await click('Cancel'); expect(host.querySelector('.medication-editor')).toBeNull(); expect(button('Add medication')).toBeDefined()
})
it('warns, without blocking, when the same medicine is added twice', async () => {
  await render(editor())
  await addOrder('para', { dose: '1 tablet', route: 'Oral', frequency: 'Three times daily' })
  await click('Add medication'); await choose('para')
  expect(host.querySelector('.medication-duplicate')?.textContent).toBe('Paracetamol is already ordered on this record. Add it again only for a separate dosing plan.')
  await fill('medication-dose', '2 tablets'); await fill('medication-route', 'Oral'); await fill('medication-frequency', 'As needed'); await click('Add to record')
  expect(host.querySelectorAll('.medication-order-card')).toHaveLength(2); expect(host.textContent).toContain('Ordered more than once on this record.')
})
it('never offers an inactive medicine, but keeps one already on the draft and saves changes to it', async () => {
  vi.mocked(medicationsApi.options).mockResolvedValue({ items: catalogOptions.filter((option) => option.name !== 'Paracetamol') })
  await render(editor(encounter))
  expect(host.querySelector('.medication-order-card')?.textContent).toContain('Paracetamol 500 mg')
  await click('Edit Paracetamol 500 mg (order 1)')
  expect(host.querySelector('.medication-editor')?.textContent).toContain('no longer on the medication list')
  await fill('medication-medicine', 'Paracetamo'); expect(optionNames()).toEqual([])
  await fill('medication-medicine', 'Paracetamol'); await press('Escape')
  await click('Cancel'); await click('Edit Paracetamol 500 mg (order 1)'); await fill('medication-dose', '2 tablets'); await click('Update medication'); await submit()
  expect(encountersApi.updateDraft).toHaveBeenCalledWith(encounter, { medications: [{ medicationId: 'catalog-paracetamol', strength: '500 mg', dose: '2 tablets', route: 'Oral',
    frequency: 'Twice daily', duration: '5 days', notes: 'After meals' }] })
})
it('asks for an older free-text order to be chosen from the list before medications are saved', async () => {
  const older = { ...encounter, medications: [{ ...encounter.medications[0]!, medicationId: null, medicine: 'Older typed medicine', strength: null }] }
  await render(editor(older))
  expect(host.textContent).toContain('Entered before the medication list. Edit it to choose the medicine from the list, or remove it.')
  await click('Edit Older typed medicine (order 1)')
  expect(host.querySelector('.medication-editor')?.textContent).toContain('Entered before the medication list as “Older typed medicine”')
  await click('Update medication'); expect(host.querySelector('.medication-editor')).not.toBeNull()
  await choose('ORS'); await click('Update medication'); await submit()
  expect(vi.mocked(encountersApi.updateDraft).mock.calls[0]![1].medications).toEqual([expect.objectContaining({ medicationId: 'catalog-ors', dose: '1 tablet' })])
})
it('shows finalized medications read-only with no way to change them, without loading the catalog', async () => {
  await render(<EncounterDetail user={doctor} id={reviewed.id} initial={reviewed} onBack={vi.fn()} onChanged={vi.fn()} />)
  const block = Array.from(host.querySelectorAll('.clinical-block')).find((item) => item.querySelector('h4')?.textContent === 'Medications')!
  expect(block.textContent).toContain('Locked when the record was finalized. Corrections are added as amendments.')
  expect(block.querySelector('.medication-list')?.getAttribute('aria-label')).toBe('Medication orders')
  for (const value of ['Paracetamol 500 mg', 'Dose1 tablet', 'RouteOral', 'FrequencyTwice daily', 'Duration5 days', 'Instructions After meals']) expect(block.textContent).toContain(value)
  expect(block.querySelectorAll('button')).toHaveLength(0); expect(button('Edit draft')).toBeUndefined(); expect(medicationsApi.options).not.toHaveBeenCalled()
})

const order = (id: string, medicine: string, record: { id: string; reference: string; status: 'DRAFT' | 'REVIEWED' }, stay: MedicationHistoryItem['encounter']['admission']): MedicationHistoryItem => ({
  ...encounter.medications[0]!, id, medicine, medicationId: null,
  encounter: { id: record.id, reference: record.reference, status: record.status, occurredAt: '2026-10-20T09:00:00Z', reviewedAt: null, clinician: doctor, admission: stay } })
const current = { id: admission.id, admissionNumber: admission.admissionNumber, status: 'ADMITTED' as const, admittedAt: '2026-10-30T08:00:00Z', dischargedAt: null }
const earlier = { id: 'stay-7', admissionNumber: 'AD-000007', status: 'DISCHARGED' as const, admittedAt: '2026-09-01T08:00:00Z', dischargedAt: '2026-09-05T08:00:00Z' }
it('separates the current admission’s medications from earlier stays, grouped by admission and record', async () => {
  const page = (items: MedicationHistoryItem[]) => ({ items, pagination: { page: 1, limit: 20, total: items.length, totalPages: 1 } })
  vi.spyOn(encountersApi, 'medications').mockImplementation(async (_patient, query) => query?.admissionId
    ? page([order('o1', 'Salbutamol inhaler', { id: 'r1', reference: 'MR-CURRENT', status: 'DRAFT' }, current)])
    : page([order('o2', 'Paracetamol', { id: 'r2', reference: 'MR-EARLIER', status: 'REVIEWED' }, earlier), order('o3', 'Ibuprofen', { id: 'r2', reference: 'MR-EARLIER', status: 'REVIEWED' }, earlier),
      order('o4', 'Older typed medicine', { id: 'r3', reference: 'MR-LEGACY', status: 'REVIEWED' }, null)]))
  const open = vi.fn()
  await render(<MedicationHistory patient={patient} admission={{ id: admission.id, admissionNumber: admission.admissionNumber, status: 'ADMITTED' }} revision={0} onOpenRecord={open} />)
  expect(encountersApi.medications).toHaveBeenCalledWith(patient.id, { admissionId: admission.id, limit: 100, page: 1 }, expect.any(AbortSignal))
  expect(encountersApi.medications).toHaveBeenCalledWith(patient.id, { excludeAdmissionId: admission.id, page: 1, limit: 20 }, expect.any(AbortSignal))
  const sections = Array.from(host.querySelectorAll('.medication-history-section > h3')).map((heading) => heading.textContent)
  expect(sections).toEqual([`Current admission · ${admission.admissionNumber}`, 'Previous admissions'])
  const groups = Array.from(host.querySelectorAll('.medication-stay > h4')).map((heading) => heading.textContent)
  expect(groups[0]).toMatch(/^Admission AD-000007 · admitted .+, discharged .+$/); expect(groups[1]).toBe('Recorded before admissions')
  const earlierGroup = host.querySelectorAll('.medication-stay')[0]!
  expect(earlierGroup.querySelectorAll('.medication-record')).toHaveLength(1); expect(earlierGroup.textContent).toContain('Paracetamol'); expect(earlierGroup.textContent).toContain('Ibuprofen')
  expect(earlierGroup.querySelector('.clinical-history-meta')?.textContent).toMatch(/^Prescribed .+ by Grace Doctor · Finalized · Open record$/)
  await click('Open clinical record MR-EARLIER'); expect(open).toHaveBeenCalledWith('r2')
})
it('shows only one stay’s medications in a read-only stay view', async () => {
  vi.spyOn(encountersApi, 'medications').mockResolvedValue({ items: [order('o2', 'Paracetamol', { id: 'r2', reference: 'MR-EARLIER', status: 'REVIEWED' }, earlier)], pagination: { page: 1, limit: 100, total: 1, totalPages: 1 } })
  await render(<MedicationHistory patient={patient} admission={{ id: earlier.id, admissionNumber: earlier.admissionNumber, status: 'DISCHARGED' }} stayOnly revision={0} />)
  expect(encountersApi.medications).toHaveBeenCalledOnce()
  expect(Array.from(host.querySelectorAll('.medication-history-section > h3')).map((heading) => heading.textContent)).toEqual(['Admission AD-000007'])
  expect(host.textContent).toContain('Paracetamol'); expect(host.querySelectorAll('button')).toHaveLength(0)
})

const catalogItem = (name: string, active = true): CatalogMedication => ({ id: `id-${name}`, name, active, createdAt: '2026-11-01T09:00:00Z', updatedAt: '2026-11-01T09:00:00Z' })
const catalogPage = (items: CatalogMedication[]) => ({ items, pagination: { page: 1, limit: 20, total: items.length, totalPages: 1 } })
it('lets an administrator add, search, filter, deactivate and reactivate medicines, with status in words', async () => {
  vi.spyOn(medicationsApi, 'list').mockResolvedValue(catalogPage([catalogItem('Paracetamol'), catalogItem('Old remedy', false)]))
  vi.spyOn(medicationsApi, 'deactivate').mockResolvedValue({ medication: catalogItem('Paracetamol', false) })
  vi.spyOn(medicationsApi, 'reactivate').mockResolvedValue({ medication: catalogItem('Old remedy') })
  vi.spyOn(medicationsApi, 'create').mockResolvedValue({ medication: catalogItem('Amoxicillin capsule') })
  await render(<MedicationCatalog role="ADMIN" />)
  expect(medicationsApi.list).toHaveBeenCalledWith({ page: 1, limit: 20, status: 'active', search: '' }, expect.any(AbortSignal))
  const rows = Array.from(host.querySelectorAll('.catalog-item')).map((row) => [row.querySelector('.catalog-name')?.textContent, row.querySelector('.status')?.textContent])
  expect(rows).toEqual([['Paracetamol', 'Active'], ['Old remedy', 'Inactive']])
  // One marker per status (the badge's dot), not a second icon beside it.
  expect(host.querySelectorAll('.catalog-item .status svg')).toHaveLength(0)
  await click('Deactivate Paracetamol')
  const dialog = host.querySelector('[role="dialog"]')!
  expect(document.getElementById(dialog.getAttribute('aria-describedby')!)?.textContent).toContain('will no longer appear when Medical Officers prescribe')
  await act(async () => Array.from(dialog.querySelectorAll('button')).find((item) => item.textContent === 'Deactivate')!.click()); await tick()
  expect(medicationsApi.deactivate).toHaveBeenCalledWith('id-Paracetamol'); expect(host.querySelector('.notice')?.textContent).toContain('Paracetamol deactivated')
  await click('Reactivate Old remedy'); expect(medicationsApi.reactivate).toHaveBeenCalledWith('id-Old remedy')
  await fill('medicationName', '  Amoxicillin capsule '); await act(async () => { host.querySelector('form.catalog-add')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) }); await tick()
  expect(medicationsApi.create).toHaveBeenCalledWith('  Amoxicillin capsule '); expect(host.querySelector('.notice')?.textContent).toContain('Amoxicillin capsule added')
  await act(async () => button('Inactive')!.click()); await tick(400)
  expect(medicationsApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'inactive' }), expect.any(AbortSignal))
  await act(async () => { const search = host.querySelector<HTMLInputElement>('input[aria-label="Search medicines"]')!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'para'); search.dispatchEvent(new Event('input', { bubbles: true })) })
  await tick(400); expect(medicationsApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'para', page: 1 }), expect.any(AbortSignal))
})
it('explains a duplicate name on the field and shows the existing medicine', async () => {
  vi.spyOn(medicationsApi, 'list').mockResolvedValue(catalogPage([]))
  vi.spyOn(medicationsApi, 'create').mockRejectedValue(new ApiError(409, 'A medicine with this name is already in the catalog', 'MEDICATION_ALREADY_EXISTS'))
  await render(<MedicationCatalog role="ADMIN" />)
  await act(async () => { host.querySelector('form.catalog-add')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) }); await tick()
  expect(field('medicationName').getAttribute('aria-invalid')).toBe('true'); expect(host.textContent).toContain('Enter the medicine name.'); expect(medicationsApi.create).not.toHaveBeenCalled()
  await fill('medicationName', 'PARACETAMOL'); await act(async () => { host.querySelector('form.catalog-add')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) }); await tick(400)
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('already in the list'); expect(field('medicationName').getAttribute('aria-invalid')).toBe('true')
  expect(medicationsApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'all', search: 'PARACETAMOL' }), expect.any(AbortSignal))
})
it.each(['RECORDS_OFFICER', 'DOCTOR_IN_CHARGE'] as const)('gives %s no catalog controls and sends no catalog request', async (role) => {
  const list = vi.spyOn(medicationsApi, 'list')
  await render(<MedicationCatalog role={role} />)
  expect(host.textContent).toContain('Administrator access required'); expect(host.querySelectorAll('button, input')).toHaveLength(0); expect(list).not.toHaveBeenCalled()
  expect(navItemsByRole[toUiRole(role)].some((item) => item.label === 'Medicines')).toBe(false); expect(allowedView(role, 'Medicines')).toBe('Overview')
})
it('adds the Medication Catalog to the administrator’s menu only', () => {
  expect(navItemsByRole.Admin.map((item) => viewLabels[item.label])).toEqual(['Overview', 'Patients', 'Staff & Access', 'Staff Activity', 'Medication Catalog', 'Notifications', 'Reports'])
  expect(allowedView('ADMIN', 'Medicines')).toBe('Medicines')
})
it('lays the prescribing controls out for phones and both themes with tokens only', () => {
  const records = readFileSync(resolve('src/features/records/records.css'), 'utf8'), catalog = readFileSync(resolve('src/features/medications/medications.css'), 'utf8')
  const block = (css: string, selector: string) => css.slice(css.indexOf(`${selector} {`), css.indexOf('}', css.indexOf(`${selector} {`)))
  expect(block(records, '.medication-picker-list')).toContain('max-height: min(18rem, 45vh)'); expect(block(records, '.medication-picker-list')).toContain('right: 0; left: 0')
  expect(block(records, '.medication-picker-list li')).toContain('min-height: 44px')
  expect(block(records, '.medication-grid')).toContain('minmax(min(100%, 170px), 1fr)'); expect(catalog).toContain('@media (max-width: 560px)')
  const medicationCss = records.slice(records.indexOf('/* Medication orders in the record editor')) + catalog
  expect(medicationCss).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i)
  const theme = readFileSync(resolve('src/styles/App.css'), 'utf8')
  const dark = theme.slice(theme.indexOf('[data-theme="dark"]'))
  for (const token of ['--surface-raised', '--brand-soft', '--success-bg', '--neutral-bg', '--warning', '--danger-bg']) { expect(theme).toContain(`${token}:`); expect(dark).toContain(`${token}:`) }
  expect(block(catalog, '.status.catalog-active')).not.toContain('--brand'); expect(block(catalog, '.status.catalog-inactive')).not.toContain('--brand')
})
