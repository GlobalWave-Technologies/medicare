import type { ReactNode } from 'react'
import { Pill } from 'lucide-react'
import type { Medication } from '../../api/encounters'
import { medicationTitle } from './clinical-utils'

const facts = [['dose', 'Dose'], ['route', 'Route'], ['frequency', 'Frequency'], ['duration', 'Duration']] as const
// One medication order as prescribed: the medicine name is the one recorded at prescribing time, so it
// still reads correctly after the medicine leaves the catalog.
export function MedicationOrderView({ order, children }: { order: Medication; children?: ReactNode }) {
  return <>
    <p className="medication-name"><Pill size={16} aria-hidden="true" /><strong>{medicationTitle(order)}</strong></p>
    {facts.some(([key]) => order[key]) && <dl className="medication-facts">{facts.filter(([key]) => order[key]).map(([key, label]) =>
      <div key={key}><dt>{label}</dt><dd>{order[key]}</dd></div>)}</dl>}
    {order.notes && <p className="medication-instructions"><span>Instructions</span> {order.notes}</p>}
    {children}
  </>
}
