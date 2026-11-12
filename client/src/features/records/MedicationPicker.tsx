import { forwardRef, useId, useState, type KeyboardEvent } from 'react'
import { Check, Search } from 'lucide-react'
import type { MedicationOption } from '../../api/medications'

type Props = {
  id: string; options: MedicationOption[]; value: MedicationOption | null; onChange: (value: MedicationOption | null) => void
  invalid?: boolean; describedBy?: string; disabled?: boolean
}
// A searchable medicine list (ARIA combobox with a listbox popup). The catalog is filtered in the
// browser as the Medical Officer types; nothing is fetched per keystroke. Typing never prescribes a
// medicine by itself: only choosing an entry from the list does.
export const MedicationPicker = forwardRef<HTMLInputElement, Props>(function MedicationPicker({ id, options, value, onChange, invalid, describedBy, disabled }, ref) {
  const listId = useId(), statusId = useId()
  const [query, setQuery] = useState(value?.name ?? ''), [open, setOpen] = useState(false), [active, setActive] = useState(0)
  const needle = query.trim().toLowerCase()
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
  const announcement = !open ? (value ? `${value.name} selected.` : '') : matches.length
    ? `${matches.length} ${matches.length === 1 ? 'medicine' : 'medicines'} found. Use the up and down arrow keys to choose.` : `No medicines match “${query.trim()}”.`
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
    {open && !matches.length && <p className="medication-picker-empty">No medicines match “{query.trim()}”. Check the spelling, or ask an administrator to add it to the medication list.</p>}
    <span id={statusId} className="visually-hidden" role="status" aria-live="polite">{announcement}</span>
  </div>
})
