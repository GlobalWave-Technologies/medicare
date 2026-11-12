import { forwardRef, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { Check, Plus, Search } from 'lucide-react'
import type { MedicationOption } from '../../api/medications'

type Props = {
  id: string; options: MedicationOption[]; value: MedicationOption | null; onChange: (value: MedicationOption | null) => void
  invalid?: boolean; describedBy?: string; disabled?: boolean
  // Offered when nothing matches (Medical Officers): adds the typed medicine to the catalog.
  onAddToCatalog?: (name: string) => void
}
// A searchable medicine list (ARIA combobox with a listbox popup). The catalog is filtered in the
// browser as the Medical Officer types; nothing is fetched per keystroke. Typing never prescribes a
// medicine by itself: only choosing an entry from the list (or adding it to the catalog) does.
export const MedicationPicker = forwardRef<HTMLInputElement, Props>(function MedicationPicker({ id, options, value, onChange, invalid, describedBy, disabled, onAddToCatalog }, ref) {
  const listId = useId(), statusId = useId()
  const [query, setQuery] = useState(value?.name ?? ''), [open, setOpen] = useState(false), [active, setActive] = useState(0)
  // A medicine chosen outside the list (one just added to the catalog) is shown in the field too.
  const [shown, setShown] = useState(value?.id)
  if (value?.id !== shown) { setShown(value?.id); if (value) { setQuery(value.name); setOpen(false) } }
  const typed = query.replace(/\s+/g, ' ').trim(), needle = typed.toLowerCase()
  const matches = !needle || (value && query === value.name) ? options : options.filter((option) => option.name.toLowerCase().includes(needle))
  const current = open && matches.length ? Math.min(active, matches.length - 1) : -1
  const optionId = (index: number) => `${listId}-${index}`
  const choose = (option: MedicationOption) => { onChange(option); setQuery(option.name); setOpen(false) }
  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) { setOpen(true); setActive(event.key === 'ArrowDown' ? 0 : Math.max(matches.length - 1, 0)); return }
      setActive((index) => event.key === 'ArrowDown' ? Math.min(index + 1, matches.length - 1) : Math.max(index - 1, 0))
    } else if (event.key === 'Home' && open) { event.preventDefault(); setActive(0) }
    else if (event.key === 'End' && open) { event.preventDefault(); setActive(Math.max(matches.length - 1, 0)) }
    else if (event.key === 'Enter' && open) {
      // Enter chooses the highlighted medicine and never submits the surrounding form from here.
      event.preventDefault()
      if (current >= 0) choose(matches[current]!)
    } else if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false) }
  }
  // Nothing matches what was typed: said below the field until the text changes, so the add action
  // stays reachable with Tab after the list closes.
  const noMatch = Boolean(needle) && !matches.length
  // The message and add action appear below the field; bring them into view (clear of the record's pinned footer).
  const emptyRef = useRef<HTMLDivElement>(null)
  useEffect(() => { if (noMatch) emptyRef.current?.scrollIntoView?.({ block: 'nearest' }) }, [noMatch])
  const addLabel = typed ? `Add “${typed}” to catalog` : 'Add medication to catalog'
  const announcement = !open ? (value ? `${value.name} selected.` : '') : matches.length
    ? `${matches.length} ${matches.length === 1 ? 'medicine' : 'medicines'} found. Use the up and down arrow keys to choose.`
    : `${typed ? `No medicines match “${typed}”.` : 'The medication list is empty.'}${onAddToCatalog ? ` To add it, use ${addLabel} after this field.` : ''}`
  return <div className="medication-picker">
    <div className="medication-picker-field">
      <Search size={16} aria-hidden="true" />
      <input ref={ref} id={id} name="medication-medicine" type="text" role="combobox" autoComplete="off" spellCheck={false} disabled={disabled} value={query}
        placeholder="Search the medication list" aria-autocomplete="list" aria-expanded={open} aria-controls={listId}
        aria-activedescendant={current >= 0 ? optionId(current) : undefined} aria-invalid={invalid || undefined}
        aria-describedby={[describedBy, statusId].filter(Boolean).join(' ')}
        onChange={(event) => { setQuery(event.target.value); setActive(0); setOpen(true); if (value && event.target.value !== value.name) onChange(null) }}
        onClick={() => setOpen(true)} onBlur={() => setOpen(false)} onKeyDown={keyDown} />
    </div>
    <ul id={listId} role="listbox" aria-label="Medicines" className="medication-picker-list" hidden={!open || !matches.length}>
      {open && matches.map((option, index) => <li key={option.id} id={optionId(index)} role="option" aria-selected={index === current}
        className={index === current ? 'is-active' : undefined}
        // Choosing with the pointer keeps focus in the field.
        onMouseDown={(event) => { event.preventDefault(); choose(option) }} onMouseMove={() => setActive(index)}>
        <span>{option.name}</span>{option.id === value?.id && <Check size={16} aria-label="Currently chosen" />}
      </li>)}
    </ul>
    {(noMatch || (open && !options.length)) && <div ref={emptyRef} className="medication-picker-empty">
      <p>{typed ? <>No medicines match “{typed}”. {onAddToCatalog ? 'Check the spelling, or add it to the catalog.' : 'Check the spelling.'}</> : 'The medication list is empty.'}</p>
      {onAddToCatalog && <button type="button" className="button button-ghost medication-add-catalog" disabled={disabled}
        // Choosing with the pointer keeps focus in the field, so closing the dialog returns there.
        onMouseDown={(event) => event.preventDefault()} onClick={() => onAddToCatalog(typed)}><Plus size={17} aria-hidden="true" /><span>{addLabel}</span></button>}
    </div>}
    <span id={statusId} className="visually-hidden" role="status" aria-live="polite">{announcement}</span>
  </div>
})
