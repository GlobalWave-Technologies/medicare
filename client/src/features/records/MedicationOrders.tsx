import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { Check, Pencil, Pill, Plus, Trash2 } from 'lucide-react'
import { medicationsApi, type MedicationOption } from '../../api/medications'
import { AddCatalogMedication } from './AddCatalogMedication'
import { ClinicalFeedback } from './ClinicalFeedback'
import { MedicationPicker } from './MedicationPicker'
import { emptyMedication, frequencyOptions, medicationLimits, medicationSummary, medicationTitle, routeOptions, type MedicationValues } from './clinical-utils'

const OTHER = 'other'
type Catalog = { items?: MedicationOption[]; error?: unknown }
type CatalogState = Catalog & { retry: () => void; include: (option: MedicationOption) => void }
const byName = (a: MedicationOption, b: MedicationOption) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id)
const withOption = (items: MedicationOption[], option: MedicationOption) => items.some((item) => item.id === option.id) ? items : [...items, option].sort(byName)
// Active medicines, loaded once while the record editor is open (never stored in the browser).
function useCatalog(): CatalogState {
  const [state, setState] = useState<Catalog>({}), [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    medicationsApi.options(controller.signal).then(({ items }) => { if (!controller.signal.aborted) setState({ items }) },
      (error: unknown) => { if (!controller.signal.aborted) setState({ error }) })
    return () => controller.abort()
  }, [attempt])
  return { ...state, retry: () => { setState({}); setAttempt((n) => n + 1) },
    // A medicine just added (or found) is offered at once; the list is then reloaded quietly, without
    // interrupting the editor, to pick up anything colleagues added meanwhile.
    include: (option) => {
      setState((current) => ({ items: withOption(current.items ?? [], option) }))
      medicationsApi.options().then(({ items }) => setState({ items: withOption(items, option) }), () => undefined)
    } }
}

type Props = { orders: MedicationValues[]; nextKey: () => number; onChange: (orders: MedicationValues[]) => void; onPendingChange: (pending: boolean) => void
  canAddToCatalog?: boolean }
// Medication orders on a draft: each one is a medicine chosen from the catalog with its dosing.
// Orders are added, edited and removed here and saved with the draft; finalizing locks them.
export function MedicationOrders({ orders, nextKey, onChange, onPendingChange, canAddToCatalog = false }: Props) {
  const catalog = useCatalog()
  const [editing, setEditing] = useState<{ key: number; isNew: boolean } | null>(null)
  const addButton = useRef<HTMLButtonElement>(null), editButtons = useRef(new Map<number, HTMLButtonElement>())
  const counts = new Map<string, number>()
  for (const order of orders) if (order.medicationId) counts.set(order.medicationId, (counts.get(order.medicationId) ?? 0) + 1)
  const close = (focusKey?: number) => {
    setEditing(null); onPendingChange(false)
    // Focus returns to the order's Edit button, or to Add medication.
    requestAnimationFrame(() => {
      const target = focusKey !== undefined ? editButtons.current.get(focusKey) : undefined
      if (target) target.focus()
      else addButton.current?.focus()
    })
  }
  const start = (key: number, isNew: boolean) => { setEditing({ key, isNew }); onPendingChange(true) }
  const current = editing && (editing.isNew ? emptyMedication(editing.key) : orders.find((order) => order.key === editing.key))
  return <section aria-labelledby="clinical-medications" className="medication-orders">
    <h3 id="clinical-medications" tabIndex={-1}>Medications</h3>
    <p id="medication-help">Choose each medicine from the medication list{canAddToCatalog ? ' (a missing medicine can be added to it)' : ''}, then its dose, route and frequency. Orders can be changed until the record is finalized; after that they are permanent.</p>
    {orders.length ? <ol className="medication-order-list" aria-label="Medication orders on this record">{orders.map((order, index) => {
      const title = medicationTitle(order) || 'Medicine not chosen', label = `${title} (order ${index + 1})`
      return <li key={order.key} className={`medication-order-card${editing?.key === order.key ? ' is-editing' : ''}`}>
        <div className="medication-order-text">
          <p className="medication-name"><Pill size={16} aria-hidden="true" /><strong>{title}</strong></p>
          {medicationSummary(order) && <p className="medication-order-summary">{medicationSummary(order)}</p>}
          {order.notes.trim() && <p className="medication-order-notes">{order.notes}</p>}
          {!order.medicationId && <p className="medication-order-flag">Entered before the medication list. Edit it to choose the medicine from the list, or remove it.</p>}
          {order.medicationId && (counts.get(order.medicationId) ?? 0) > 1 && <p className="medication-order-flag">Ordered more than once on this record.</p>}
        </div>
        <div className="medication-order-actions">
          <button type="button" className="button button-ghost" aria-label={`Edit ${label}`} disabled={Boolean(editing)}
            ref={(element) => { if (element) editButtons.current.set(order.key, element); else editButtons.current.delete(order.key) }}
            onClick={() => start(order.key, false)}><Pencil size={16} aria-hidden="true" />Edit</button>
          <button type="button" className="button button-ghost" aria-label={`Remove ${label}`} disabled={Boolean(editing)}
            onClick={() => { onChange(orders.filter((item) => item.key !== order.key)); requestAnimationFrame(() => addButton.current?.focus()) }}><Trash2 size={16} aria-hidden="true" />Remove</button>
        </div>
      </li>
    })}</ol> : !editing && <p className="clinical-empty">No medications on this record yet.</p>}
    {current && editing && <OrderEditor key={editing.key} initial={current} isNew={editing.isNew} catalog={catalog} canAddToCatalog={canAddToCatalog}
      others={orders.filter((order) => order.key !== editing.key)}
      onCancel={() => close(editing.isNew ? undefined : editing.key)}
      onSave={(order) => {
        onChange(editing.isNew ? [...orders, order] : orders.map((item) => item.key === order.key ? order : item))
        close(order.key)
      }} />}
    {!editing && <button ref={addButton} type="button" className="button button-ghost" disabled={orders.length >= 30}
      onClick={() => start(nextKey(), true)}><Plus size={17} aria-hidden="true" />Add medication</button>}
    {orders.length >= 30 && <p className="field-helper">A record allows up to 30 medication orders.</p>}
  </section>
}

type Errors = Partial<Record<'medicine' | 'strength' | 'dose' | 'route' | 'frequency' | 'duration' | 'notes', string>>
const control = (value: string) => Array.from(value).some((character) => { const code = character.codePointAt(0)!; return code < 32 && code !== 9 || (code >= 127 && code <= 159) })
function validateOrder(values: MedicationValues, customRoute: boolean, customFrequency: boolean): Errors {
  const errors: Errors = {}
  if (!values.medicationId) errors.medicine = values.medicine && !values.medicationId ? 'Choose this medicine from the list.' : 'Choose a medicine from the list.'
  if (!values.dose.trim()) errors.dose = 'Enter the dose, for example 1 tablet.'
  if (!values.route.trim()) errors.route = customRoute ? 'Type the route.' : 'Choose the route.'
  if (!values.frequency.trim()) errors.frequency = customFrequency ? 'Type the frequency.' : 'Choose the frequency.'
  for (const key of ['strength', 'dose', 'route', 'frequency', 'duration', 'notes'] as const) {
    if (values[key].trim().length > medicationLimits[key]) errors[key] = `Use up to ${medicationLimits[key].toLocaleString()} characters.`
    else if (control(values[key].replace(/[\r\n]/g, key === 'notes' ? '' : '\u0000'))) errors[key] = 'Remove unsupported characters.'
  }
  return errors
}

type EditorProps = { initial: MedicationValues; isNew: boolean; catalog: CatalogState; canAddToCatalog: boolean; others: MedicationValues[]
  onSave: (order: MedicationValues) => void; onCancel: () => void }
function OrderEditor({ initial, isNew, catalog, canAddToCatalog, others, onSave, onCancel }: EditorProps) {
  const id = useId(), picker = useRef<HTMLInputElement>(null), fields = useRef(new Map<string, HTMLElement | null>())
  const [values, setValues] = useState(initial)
  const [customRoute, setCustomRoute] = useState(Boolean(initial.route) && !routeOptions.includes(initial.route))
  const [customFrequency, setCustomFrequency] = useState(Boolean(initial.frequency) && !frequencyOptions.includes(initial.frequency))
  const [errors, setErrors] = useState<Errors>({})
  // The name being added to the catalog (its dialog is open), and the result once chosen.
  const [adding, setAdding] = useState<string | null>(null), [added, setAdded] = useState('')
  useEffect(() => { picker.current?.focus() }, [])
  // Prescribing continues with the order's details. This runs after the closed dialog has handed
  // focus back (React cleans up a removed component before running new effects), so it wins.
  const [continueAt, setContinueAt] = useState(0)
  useEffect(() => { if (continueAt) fields.current.get('strength')?.focus() }, [continueAt])
  function chosen(option: MedicationOption, created: boolean) {
    catalog.include(option)
    set({ medicationId: option.id, medicine: option.name })
    setErrors((current) => ({ ...current, medicine: undefined }))
    setAdded(created ? `${option.name} was added to the catalog and chosen for this order.` : `${option.name} was already in the catalog and is now chosen for this order.`)
    setAdding(null); setContinueAt((count) => count + 1)
  }
  const inCatalog = catalog.items?.some((option) => option.id === values.medicationId) ?? true
  const duplicate = values.medicationId && others.some((order) => order.medicationId === values.medicationId)
  const set = (patch: Partial<MedicationValues>) => setValues((current) => ({ ...current, ...patch }))
  function save() {
    const trimmed = { ...values, strength: values.strength.trim(), dose: values.dose.trim(), route: values.route.trim(), frequency: values.frequency.trim(),
      duration: values.duration.trim(), notes: values.notes.trim() }
    const problems = validateOrder(trimmed, customRoute, customFrequency)
    setErrors(problems)
    const first = (['medicine', 'strength', 'dose', 'route', 'frequency', 'duration', 'notes'] as const).find((key) => problems[key])
    if (first) { (first === 'medicine' ? picker.current : fields.current.get(first))?.focus(); return }
    onSave(trimmed)
  }
  // Enter in a single-line field saves this order rather than the whole draft. Keys typed in the
  // add-to-catalog dialog reach here through React but belong to that dialog.
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.target as Node)) return
    if (event.key === 'Enter' && !event.defaultPrevented && event.target instanceof HTMLInputElement) { event.preventDefault(); save() }
  }
  const field = (key: 'strength' | 'dose' | 'duration', label: string, placeholder: string, required = false) => <label className="medication-field">
    {label}{!required && <span className="field-optional"> (optional)</span>}
    <input ref={(element) => { fields.current.set(key, element) }} name={`medication-${key}`} maxLength={medicationLimits[key]} autoComplete="off" placeholder={placeholder}
      aria-required={required || undefined} aria-invalid={errors[key] ? true : undefined} aria-describedby={errors[key] ? `${id}-${key}-error` : undefined}
      value={values[key]} onChange={(event) => set({ [key]: event.target.value })} />
    {errors[key] && <span id={`${id}-${key}-error`} className="field-error">{errors[key]}</span>}
  </label>
  const choice = (key: 'route' | 'frequency', label: string, list: string[], custom: boolean, setCustom: (value: boolean) => void) => <div className="medication-field">
    <label htmlFor={`${id}-${key}`}>{label}</label>
    <select id={`${id}-${key}`} ref={(element) => { if (!custom) fields.current.set(key, element) }} name={`medication-${key}`} aria-required="true"
      aria-invalid={errors[key] && !custom ? true : undefined} aria-describedby={errors[key] && !custom ? `${id}-${key}-error` : undefined}
      value={custom ? OTHER : values[key]} onChange={(event) => {
        const other = event.target.value === OTHER
        setCustom(other); set({ [key]: other ? '' : event.target.value })
        if (other) requestAnimationFrame(() => fields.current.get(key)?.focus())
      }}>
      <option value="">Choose {label.toLowerCase()}</option>
      {list.map((option) => <option key={option} value={option}>{option}</option>)}
      <option value={OTHER}>Other (type it)</option>
    </select>
    {custom && <input ref={(element) => { fields.current.set(key, element) }} name={`medication-${key}-other`} aria-label={`${label} (other)`} aria-required="true"
      maxLength={medicationLimits[key]} autoComplete="off" aria-invalid={errors[key] ? true : undefined} aria-describedby={errors[key] ? `${id}-${key}-error` : undefined}
      value={values[key]} onChange={(event) => set({ [key]: event.target.value })} />}
    {errors[key] && <span id={`${id}-${key}-error`} className="field-error">{errors[key]}</span>}
  </div>
  return <div className="medication-editor" role="group" aria-labelledby={`${id}-title`} onKeyDown={keyDown}>
    <h4 id={`${id}-title`}>{isNew ? 'Add medication' : `Edit ${values.medicine || 'medication'}`}</h4>
    <div className="medication-field medication-wide">
      <label htmlFor={`${id}-medicine`}>Medicine</label>
      {catalog.error !== undefined ? <><ClinicalFeedback error={catalog.error} /><button type="button" className="button button-ghost" onClick={catalog.retry}>Retry loading the medication list</button></>
        : !catalog.items ? <p role="status" className="loading-note">Loading the medication list…</p>
        : <MedicationPicker ref={picker} id={`${id}-medicine`} options={catalog.items} invalid={Boolean(errors.medicine)}
          describedBy={[errors.medicine ? `${id}-medicine-error` : '', `${id}-medicine-help`].filter(Boolean).join(' ')}
          value={values.medicationId ? { id: values.medicationId, name: values.medicine } : null}
          onAddToCatalog={canAddToCatalog ? (name) => { setAdded(''); setAdding(name) } : undefined}
          onChange={(option) => { setAdded(''); set(option ? { medicationId: option.id, medicine: option.name } : { medicationId: '' }) }} />}
      {errors.medicine && <span id={`${id}-medicine-error`} className="field-error">{errors.medicine}</span>}
      <span id={`${id}-medicine-help`} className="field-helper">
        {!values.medicationId && initial.medicine && !initial.medicationId ? `Entered before the medication list as “${initial.medicine}”. Choose the matching medicine from the list.`
          : values.medicationId && !inCatalog ? 'This medicine is no longer on the medication list. It stays on this draft, but cannot be added again once removed.'
          : 'Type part of the name, then choose it from the list.'}
      </span>
      {added && <p className="notice medication-added" role="status"><Check size={16} aria-hidden="true" />{added}</p>}
    </div>
    {duplicate && <p className="callout tone-warning medication-duplicate" role="status">{values.medicine} is already ordered on this record. Add it again only for a separate dosing plan.</p>}
    <div className="medication-grid">
      {field('strength', 'Strength', 'e.g. 500 mg')}
      {field('dose', 'Dose', 'e.g. 1 tablet', true)}
      {choice('route', 'Route', routeOptions, customRoute, setCustomRoute)}
      {choice('frequency', 'Frequency', frequencyOptions, customFrequency, setCustomFrequency)}
      {field('duration', 'Duration', 'e.g. 5 days')}
      <label className="medication-field medication-wide">Instructions<span className="field-optional"> (optional)</span>
        <textarea ref={(element) => { fields.current.set('notes', element) }} name="medication-notes" rows={2} maxLength={medicationLimits.notes}
          placeholder="e.g. Take after meals" aria-invalid={errors.notes ? true : undefined} aria-describedby={errors.notes ? `${id}-notes-error` : undefined}
          value={values.notes} onChange={(event) => set({ notes: event.target.value })} />
        {errors.notes && <span id={`${id}-notes-error`} className="field-error">{errors.notes}</span>}
      </label>
    </div>
    <div className="medication-editor-actions">
      <button type="button" className="button button-ghost" onClick={onCancel}>Cancel</button>
      <button type="button" className="button button-primary" disabled={!catalog.items} onClick={save}>{isNew ? 'Add to record' : 'Update medication'}</button>
    </div>
    {adding !== null && <AddCatalogMedication initialName={adding} onClose={() => setAdding(null)} onChosen={chosen} />}
  </div>
}
