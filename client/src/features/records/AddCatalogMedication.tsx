import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { ApiError, authErrorMessage } from '../../api/client'
import { medicationsApi, type MedicationOption } from '../../api/medications'
import { Dialog } from '../../components/ui/Dialog'
import { nameProblem, sameMedicineName } from '../medications/catalog-utils'

export const MEDICATION_EXISTS = 'This medication already exists in the catalog.'
export const MEDICATION_INACTIVE = 'This medication already exists but is inactive. Contact an Administrator to reactivate it.'
function addError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.code === 'MEDICATION_ALREADY_EXISTS') return MEDICATION_EXISTS
    if (error.code === 'MEDICATION_EXISTS_INACTIVE') return MEDICATION_INACTIVE
    if (error.code === 'VALIDATION_ERROR') return 'Enter a name of up to 200 characters on one line.'
    if (error.code === 'FORBIDDEN') return 'Your account cannot add medicines to the catalog. Contact an Administrator.'
    if (error.status < 500) return authErrorMessage(error)
  }
  // The outcome is unknown, but a medicine is never added twice: trying again either adds it or
  // finds the entry that was added.
  return `${authErrorMessage(error)} Trying again is safe; a medicine is never added twice.`
}

type Props = { initialName: string; onClose: () => void; onChosen: (option: MedicationOption, added: boolean) => void }
// Adds a medicine that is missing from the catalog while a Medical Officer is prescribing. It opens
// on top of the clinical record dialog, outside the record's form, so nothing typed in the record
// is touched; only the medicine name is sent. Deactivating and reactivating stay with administrators.
export function AddCatalogMedication({ initialName, onClose, onChosen }: Props) {
  const id = useId(), input = useRef<HTMLInputElement>(null)
  const [name, setName] = useState(initialName), [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false)
  const [existing, setExisting] = useState<MedicationOption | null>(null)
  useEffect(() => { input.current?.focus() }, [])
  async function save(event: FormEvent) {
    // The dialog is rendered outside the record's form, but React still passes events up to it.
    event.preventDefault(); event.stopPropagation()
    if (busy) return
    const problem = nameProblem(name)
    setError(problem); setExisting(null)
    if (problem) { input.current?.focus(); return }
    setBusy(true)
    try {
      const { medication } = await medicationsApi.create(name)
      onChosen({ id: medication.id, name: medication.name }, true)
      return
    } catch (caught) {
      setError(addError(caught))
      // An active medicine of the same name (perhaps just added by a colleague) can be chosen instead.
      if (caught instanceof ApiError && caught.code === 'MEDICATION_ALREADY_EXISTS') {
        setExisting(await medicationsApi.options().then(({ items }) => items.find((item) => sameMedicineName(item.name, name)) ?? null, () => null))
      }
    }
    setBusy(false)
    requestAnimationFrame(() => input.current?.focus())
  }
  return createPortal(<Dialog title="Add medication to catalog" kind="medication-add" size="compact" busy={busy} onClose={onClose}
    closeLabel="Close add medication dialog" describedBy={`${id}-intro`}>
    <form className="medication-add-form" noValidate onSubmit={save}>
      <p id={`${id}-intro`} className="modal-lead">Add a medicine that is missing from the medication list. When saved, it is chosen for this order and every Medical Officer can prescribe it. Only an administrator can deactivate it later.</p>
      <label htmlFor={`${id}-name`}>Medication name</label>
      <input ref={input} id={`${id}-name`} name="catalog-medication-name" maxLength={200} autoComplete="off" readOnly={busy} value={name} aria-required="true"
        aria-invalid={error ? true : undefined} aria-describedby={`${id}-help${error ? ` ${id}-error` : ''}`}
        onChange={(event) => { setName(event.target.value); setError(null); setExisting(null) }} />
      <small id={`${id}-help`} className="field-helper">Use the name staff should see when prescribing, for example “Amoxicillin capsule”. Strength, dose and directions go on the order. Names cannot be changed later.</small>
      {error && <p id={`${id}-error`} className="field-error" role="alert">{error}</p>}
      {existing && <button type="button" className="button button-ghost medication-use-existing" onClick={() => onChosen(existing, false)}>Use {existing.name}</button>}
      <div className="modal-footer">
        <button type="button" className="button button-ghost" disabled={busy} onClick={onClose}>Cancel</button>
        <button className="button button-primary" disabled={busy}>{busy ? 'Saving medication…' : 'Save medication'}</button>
      </div>
    </form>
  </Dialog>, document.body)
}
