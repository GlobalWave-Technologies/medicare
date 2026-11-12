// @vitest-environment jsdom
// Phase 19F: a Medical Officer adds a missing medicine to the catalog while prescribing, without
// leaving the clinical record; deactivating and reactivating stay with administrators.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '../src/api/client'
import { encountersApi } from '../src/api/encounters'
import { medicationsApi, type CatalogMedication } from '../src/api/medications'
import { MedicationCatalog } from '../src/features/medications/MedicationCatalog'
import { canAddToCatalog, canManageCatalog } from '../src/features/medications/catalog-utils'
import { EncounterForm } from '../src/features/records/EncounterForm'
import { MedicationPicker } from '../src/features/records/MedicationPicker'
import { admission, catalogOptions, doctor, encounter, patient } from './clinical-fixtures'

let root: Root, host: HTMLDivElement
const zinc: CatalogMedication = { id: 'catalog-zinc', name: 'Zinc sulfate', active: true, createdAt: '2026-11-12T09:00:00Z', updatedAt: '2026-11-12T09:00:00Z' }
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-12T12:00:00Z')); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  vi.spyOn(medicationsApi, 'options').mockResolvedValue({ items: catalogOptions })
  vi.spyOn(medicationsApi, 'create').mockResolvedValue({ medication: zinc })
  vi.spyOn(encountersApi, 'create').mockResolvedValue({ encounter }); vi.spyOn(encountersApi, 'updateDraft').mockResolvedValue({ encounter })
  vi.spyOn(window, 'confirm').mockReturnValue(false)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
const tick = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
const render = async (node: ReactNode) => { await act(async () => root.render(node)); await tick() }
// The add dialog is rendered over the record dialog, outside it, so look in the whole document.
const button = (text: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((item) => item.textContent?.trim() === text || item.getAttribute('aria-label') === text)
async function click(text: string) { const target = button(text); expect(target, text).toBeDefined(); await act(async () => target!.click()); await tick() }
const field = <T extends HTMLElement = HTMLInputElement>(name: string) => document.querySelector<T>(`[name="${name}"]`)!
async function fill(name: string, value: string) {
  await act(async () => {
    const input = field<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(name)
    const prototype = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
}
const picker = () => field('medication-medicine')
const key = async (target: Element, value: string, init: KeyboardEventInit = {}) => { await act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...init })) }); await tick(20) }
const addDialog = () => document.querySelector<HTMLElement>('[role="dialog"].medication-add-modal')
const nameField = () => field('catalog-medication-name')
const submitAdd = async () => { await act(async () => { addDialog()!.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) }); await tick(20) }
const describedText = (element: Element) => (element.getAttribute('aria-describedby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent ?? '').join(' ')
const editor = (user = doctor) => <EncounterForm user={user} patient={patient} admission={admission} onClose={vi.fn()} onSaved={vi.fn()} />
async function searchMissing(text = 'zinc sulfate') { await click('Add medication'); await fill('medication-medicine', text) }

it('offers to add a medicine that is not in the list, brings it into view and keeps it reachable after the list closes', async () => {
  const scrolled = vi.fn()
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: function (this: Element, options: unknown) { scrolled(this.className, options) } })
  await render(editor()); await searchMissing()
  expect(scrolled).toHaveBeenCalledWith('medication-picker-empty', { block: 'nearest' })
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
  expect(host.querySelector('.medication-picker-empty p')?.textContent).toBe('No medicines match “zinc sulfate”. Check the spelling, or add it to the catalog.')
  const action = button('Add “zinc sulfate” to catalog')!
  expect(action.type).toBe('button'); expect(action.disabled).toBe(false)
  // Leaving the field (Tab) closes the list, but the message and the action stay for the keyboard.
  await act(async () => { picker().dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
  expect(picker().getAttribute('aria-expanded')).toBe('false'); expect(button('Add “zinc sulfate” to catalog')).toBeDefined()
  // Extra spaces do not hide a medicine that is in the list, and a match offers no add action.
  await fill('medication-medicine', 'salbutamol   inh'); expect(button('Add “salbutamol inh” to catalog')).toBeUndefined()
  expect(Array.from(host.querySelectorAll('[role="option"]')).map((option) => option.textContent)).toEqual(['Salbutamol inhaler'])
})

it('adds the medicine, chooses it for the order and keeps the whole draft, including earlier orders', async () => {
  await render(editor())
  await click('Add complaint'); await fill('complaint-0', 'Fever for two days (synthetic)')
  await fill('clinicalNotes', 'Synthetic clinical note'); await fill('treatmentPlan', 'Oral fluids')
  await click('Add diagnosis'); await fill('diagnosis-0-description', 'Synthetic diagnosis')
  await click('Add medication'); await fill('medication-medicine', 'para'); await key(picker(), 'Enter')
  await fill('medication-dose', '1 tablet'); await fill('medication-route', 'Oral'); await fill('medication-frequency', 'Three times daily'); await click('Add to record')

  vi.mocked(medicationsApi.options).mockResolvedValue({ items: [...catalogOptions, { id: zinc.id, name: zinc.name }] })
  await searchMissing(); await click('Add “zinc sulfate” to catalog')
  const dialog = addDialog()!
  expect(dialog.getAttribute('aria-modal')).toBe('true'); expect(dialog.classList).toContain('modal-compact')
  expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent).toBe('Add medication to catalog')
  expect(describedText(dialog)).toContain('Only an administrator can deactivate it later.')
  // Outside the record's form, so nothing in the record is submitted or reset with it.
  expect(host.contains(dialog)).toBe(false); expect(dialog.closest('form.clinical-form')).toBeNull()
  expect(document.querySelector(`label[for="${nameField().id}"]`)?.textContent).toBe('Medication name')
  expect(nameField().value).toBe('zinc sulfate'); expect(document.activeElement).toBe(nameField())

  await fill('catalog-medication-name', 'Zinc sulfate'); await submitAdd()
  expect(medicationsApi.create).toHaveBeenCalledExactlyOnceWith('Zinc sulfate'); expect(encountersApi.create).not.toHaveBeenCalled()
  expect(addDialog()).toBeNull(); expect(picker().value).toBe('Zinc sulfate')
  expect(host.querySelector('.medication-added[role="status"]')?.textContent).toBe('Zinc sulfate was added to the catalog and chosen for this order.')
  expect(document.activeElement).toBe(field('medication-strength'))
  // Nothing typed in the record was lost.
  expect([field('complaint-0').value, field('clinicalNotes').value, field('treatmentPlan').value, field('diagnosis-0-description').value])
    .toEqual(['Fever for two days (synthetic)', 'Synthetic clinical note', 'Oral fluids', 'Synthetic diagnosis'])
  expect(host.querySelectorAll('.medication-order-card')).toHaveLength(1)

  await fill('medication-strength', '20 mg'); await fill('medication-dose', '1 tablet'); await fill('medication-route', 'Oral'); await fill('medication-frequency', 'Once daily')
  await click('Add to record')
  expect(Array.from(host.querySelectorAll('.medication-order-card strong')).map((item) => item.textContent)).toEqual(['Paracetamol', 'Zinc sulfate 20 mg'])
  // Available straight away for the next order too.
  await click('Add medication'); await fill('medication-medicine', 'zinc')
  expect(Array.from(host.querySelectorAll('[role="option"]')).map((option) => option.textContent)).toEqual(['Zinc sulfate'])
  await click('Cancel')
  await act(async () => { host.querySelector('form.clinical-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) }); await tick()
  const sent = vi.mocked(encountersApi.create).mock.calls[0]![0]
  expect(sent).toMatchObject({ clinicalNotes: 'Synthetic clinical note', treatmentPlan: 'Oral fluids', admissionId: admission.id })
  expect(JSON.stringify(sent)).toContain('Fever for two days (synthetic)'); expect(JSON.stringify(sent)).toContain('Synthetic diagnosis')
  expect(sent.medications?.map((item) => [item.medicationId, item.strength])).toEqual([['catalog-paracetamol', null], ['catalog-zinc', '20 mg']])
})

it('works from the keyboard: Enter saves only the medicine, Escape closes the dialog alone and returns focus', async () => {
  await render(editor()); await searchMissing()
  const action = button('Add “zinc sulfate” to catalog')!
  await act(async () => { action.focus(); action.click() }); await tick()
  expect(document.activeElement).toBe(nameField())
  // Tab stays inside the add dialog, not the record dialog behind it.
  await act(async () => { button('Save medication')!.focus() }); await key(button('Save medication')!, 'Tab')
  expect(addDialog()!.contains(document.activeElement)).toBe(true)
  // Escape closes the add dialog only: the record stays open and asks nothing.
  await key(nameField(), 'Escape')
  expect(addDialog()).toBeNull(); expect(window.confirm).not.toHaveBeenCalled(); expect(host.querySelector('form.clinical-form')).not.toBeNull()
  expect(document.activeElement).toBe(action); expect(document.body.style.overflow).toBe('hidden')
  // Enter in the dialog's field neither saves the order nor the record.
  await act(async () => action.click()); await tick()
  await key(nameField(), 'Enter')
  expect(host.querySelector('.medication-editor')?.textContent).not.toContain('Choose a medicine from the list.')
  await submitAdd()
  expect(medicationsApi.create).toHaveBeenCalledOnce(); expect(encountersApi.create).not.toHaveBeenCalled()
  expect(host.querySelectorAll('.medication-order-card')).toHaveLength(0); expect(host.querySelector('.medication-editor')).not.toBeNull()
})

it('says an inactive medicine must be reactivated by an Administrator, and never reactivates it', async () => {
  const reactivate = vi.spyOn(medicationsApi, 'reactivate')
  vi.mocked(medicationsApi.create).mockRejectedValue(new ApiError(409, 'A medicine with this name is already in the catalog but is inactive', 'MEDICATION_EXISTS_INACTIVE'))
  await render(editor()); await searchMissing('old remedy'); await click('Add “old remedy” to catalog'); await submitAdd()
  expect(addDialog()).not.toBeNull(); expect(nameField().getAttribute('aria-invalid')).toBe('true')
  expect(describedText(nameField())).toContain('This medication already exists but is inactive. Contact an Administrator to reactivate it.')
  expect(button('Use old remedy')).toBeUndefined(); expect(reactivate).not.toHaveBeenCalled(); expect(picker().value).toBe('old remedy')
  const cancel = Array.from(addDialog()!.querySelectorAll('button')).find((item) => item.textContent === 'Cancel')!
  await act(async () => cancel.click()); await tick()
  expect(addDialog()).toBeNull(); expect(host.querySelector('.medication-editor')).not.toBeNull()
})

it('offers an existing active medicine of the same name instead of a duplicate', async () => {
  vi.mocked(medicationsApi.create).mockRejectedValue(new ApiError(409, 'A medicine with this name is already in the catalog', 'MEDICATION_ALREADY_EXISTS'))
  await render(editor()); await searchMissing('panadol'); await click('Add “panadol” to catalog')
  await fill('catalog-medication-name', '  PARACETAMOL '); await submitAdd()
  expect(describedText(nameField())).toContain('This medication already exists in the catalog.')
  await click('Use Paracetamol')
  expect(addDialog()).toBeNull(); expect(picker().value).toBe('Paracetamol')
  expect(host.querySelector('.medication-added')?.textContent).toBe('Paracetamol was already in the catalog and is now chosen for this order.')
})

it.each([
  ['an empty name', null, 'Enter the medicine name.'],
  ['permission denied', new ApiError(403, 'Permission denied', 'FORBIDDEN'), 'Your account cannot add medicines to the catalog. Contact an Administrator.'],
  ['a network failure', new TypeError('Failed to fetch'), 'Unable to contact the server. Please try again. Trying again is safe; a medicine is never added twice.'],
  ['a server failure', new ApiError(500, 'PrismaClientKnownRequestError: raw database detail', 'INTERNAL_ERROR'), 'Medicare could not complete this just now. Please try again in a moment. Trying again is safe; a medicine is never added twice.'],
])('explains %s on the name field without raw details', async (_label, failure, message) => {
  if (failure) vi.mocked(medicationsApi.create).mockRejectedValue(failure)
  await render(editor()); await searchMissing(); await click('Add “zinc sulfate” to catalog')
  if (!failure) await fill('catalog-medication-name', '   ')
  await submitAdd()
  expect(describedText(nameField())).toContain(message); expect(addDialog()!.textContent).not.toMatch(/Prisma|raw database/)
  expect(nameField().getAttribute('aria-invalid')).toBe('true'); expect(document.activeElement).toBe(nameField())
  expect(medicationsApi.create).toHaveBeenCalledTimes(failure ? 1 : 0)
})

it('gives the Records Officer no prescribing form and no add action; only Admin manages the catalog', async () => {
  await render(editor({ ...doctor, role: 'RECORDS_OFFICER' }))
  expect(host.innerHTML).toBe(''); expect(medicationsApi.options).not.toHaveBeenCalled()
  await render(<MedicationPicker id="plain-picker" options={catalogOptions} value={null} onChange={vi.fn()} />)
  await fill('medication-medicine', 'zinc')
  expect(host.querySelector('.medication-picker-empty p')?.textContent).toBe('No medicines match “zinc”. Check the spelling.')
  expect(host.querySelector('.medication-add-catalog')).toBeNull()
  expect((['ADMIN', 'DOCTOR_IN_CHARGE', 'RECORDS_OFFICER'] as const).map((role) => [canAddToCatalog(role), canManageCatalog(role)]))
    .toEqual([[true, true], [true, false], [false, false]])
})

it('keeps the administrator’s catalog management unchanged and explains an inactive duplicate there', async () => {
  const item = (name: string, active = true): CatalogMedication => ({ ...zinc, id: `id-${name}`, name, active })
  vi.spyOn(medicationsApi, 'list').mockResolvedValue({ items: [item('Paracetamol'), item('Old remedy', false)], pagination: { page: 1, limit: 20, total: 2, totalPages: 1 } })
  vi.mocked(medicationsApi.create).mockRejectedValue(new ApiError(409, 'Inactive', 'MEDICATION_EXISTS_INACTIVE'))
  await render(<MedicationCatalog role="ADMIN" />)
  expect(button('Deactivate Paracetamol')).toBeDefined(); expect(button('Reactivate Old remedy')).toBeDefined()
  expect(host.querySelector('.form-intro')?.textContent).toContain('can add a missing medicine while prescribing. Only administrators deactivate or reactivate medicines.')
  await fill('medicationName', 'OLD REMEDY'); await act(async () => { host.querySelector('form.catalog-add')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) }); await tick(400)
  expect(host.querySelector('.field-error')?.textContent).toBe('This medicine is already in the list but inactive. Find it under Inactive and reactivate it.')
  expect(medicationsApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'all', search: 'OLD REMEDY' }), expect.any(AbortSignal))
})

it('lays the add action and dialog out for phones with theme tokens only', () => {
  const records = readFileSync(resolve('src/features/records/records.css'), 'utf8'), shared = readFileSync(resolve('src/styles/App.css'), 'utf8')
  expect(records).toContain('.medication-add-catalog span { min-width: 0; overflow-wrap: anywhere; }')
  // Fields and the add action scrolled into view clear the clinical form's pinned footer.
  expect(records).toContain('.modal.clinical-modal { scroll-padding-bottom: 96px; }')
  expect(records).toMatch(/@media \(max-width: 600px\) \{\s*\.medication-add-catalog, \.medication-use-existing \{ width: 100%; \}/)
  expect(shared).toContain('.modal.modal-compact { width: min(540px, 100%); }')
  expect(shared).toContain('.modal-backdrop { padding: 8px; } .modal { padding: 18px; max-height: calc(100dvh - 16px); }')
  const added = records.slice(records.indexOf('.medication-picker-empty {'), records.indexOf('/* Medication history'))
  expect(added).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i)
})
