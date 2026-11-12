import { useState } from 'react'
import type { PatientSummary } from '../../api/common'
import { encountersApi, type MedicationHistoryItem, type MedicationHistoryQuery } from '../../api/encounters'
import { LoadingRows } from '../../components/ui/LoadingRows'
import { Pagination } from '../../components/ui/Pagination'
import { staffName } from '../../lib/people'
import { displayTime } from '../../lib/time'
import { useKeyedRead } from '../reports/report-utils'
import { ClinicalFeedback } from './ClinicalFeedback'
import { MedicationOrderView } from './MedicationOrderView'
import { clinicalLabels } from './clinical-utils'

type Stay = { id: string; admissionNumber: string; status?: 'ADMITTED' | 'DISCHARGED' }
type Props = { patient: PatientSummary; admission?: Stay | null; stayOnly?: boolean; revision: number; onOpenRecord?: (encounterId: string) => void }
// A patient's medication orders, newest record first, grouped by admission and clinical record.
// With an admission (the one being treated, or the one viewed), its orders come first and every
// other stay's orders follow under "Previous admissions". Opening either list is audited by the server.
export function MedicationHistory({ patient, admission, stayOnly = false, revision, onOpenRecord }: Props) {
  const current = admission?.status !== 'DISCHARGED'
  return <section className="panel clinical-workspace medication-history" aria-labelledby={`medications-${patient.id}`}>
    <h2 id={`medications-${patient.id}`}>Medication history</h2>
    {admission ? <>
      <HistorySection title={current ? `Current admission · ${admission.admissionNumber}` : `Admission ${admission.admissionNumber}`} patientId={patient.id}
        query={{ admissionId: admission.id, limit: 100 }} revision={revision} onOpenRecord={onOpenRecord} groupByAdmission={false}
        empty={current ? 'No medications prescribed in this admission yet.' : 'No medications were prescribed in this admission.'} />
      {!stayOnly && <HistorySection title={current ? 'Previous admissions' : 'Other admissions'} patientId={patient.id} paged
        query={{ excludeAdmissionId: admission.id }} revision={revision} onOpenRecord={onOpenRecord} groupByAdmission
        empty={current ? 'No medications from earlier admissions.' : 'No medications from other admissions.'} />}
    </> : <HistorySection patientId={patient.id} paged query={{}} revision={revision} onOpenRecord={onOpenRecord} groupByAdmission
      empty="No medications have been prescribed for this patient." />}
  </section>
}

type SectionProps = { title?: string; patientId: string; query: MedicationHistoryQuery; paged?: boolean; groupByAdmission: boolean; empty: string; revision: number
  onOpenRecord?: (encounterId: string) => void }
function HistorySection({ title, patientId, query, paged = false, groupByAdmission, empty, revision, onOpenRecord }: SectionProps) {
  const [page, setPage] = useState(1)
  const request = paged ? { ...query, page, limit: 20 } : { ...query, page: 1 }
  const { data, loading, error } = useKeyedRead(JSON.stringify([patientId, request, revision]), (signal) => encountersApi.medications(patientId, request, signal))
  const body = <>
    {loading && <LoadingRows label="Loading medication history…" rows={2} />}
    {error !== undefined && <ClinicalFeedback error={error} />}
    {data && (data.items.length ? groups(data.items).map((group) => groupByAdmission
      ? <section key={group.key} className="medication-stay" aria-label={group.label}><h4>{group.label}</h4><Records group={group} onOpenRecord={onOpenRecord} /></section>
      : <Records key={group.key} group={group} onOpenRecord={onOpenRecord} />) : <p className="clinical-empty">{empty}</p>)}
    {!paged && data && data.pagination.total > data.items.length && <p className="field-helper">Showing the latest {data.items.length} orders of {data.pagination.total}.</p>}
    {paged && data && <Pagination label={`${title ?? 'Medication history'} pages`} pagination={data.pagination} onPage={setPage} />}
  </>
  return title ? <section className="medication-history-section" aria-label={title}><h3>{title}</h3>{body}</section> : <div className="medication-history-section">{body}</div>
}

type Group = { key: string; label: string; records: { id: string; items: MedicationHistoryItem[] }[] }
// Groups keep the server's order (newest record first); a stay continued on the next page repeats its heading.
function groups(items: MedicationHistoryItem[]) {
  const result: Group[] = []
  for (const item of items) {
    const stay = item.encounter.admission, key = stay?.id ?? 'none'
    let group = result.find((candidate) => candidate.key === key)
    if (!group) {
      group = { key, records: [], label: stay ? `Admission ${stay.admissionNumber} · admitted ${displayTime(stay.admittedAt)}${stay.dischargedAt ? `, discharged ${displayTime(stay.dischargedAt)}` : ', still admitted'}`
        : 'Recorded before admissions' }
      result.push(group)
    }
    let record = group.records.find((candidate) => candidate.id === item.encounter.id)
    if (!record) { record = { id: item.encounter.id, items: [] }; group.records.push(record) }
    record.items.push(item)
  }
  return result
}
function Records({ group, onOpenRecord }: { group: Group; onOpenRecord?: (encounterId: string) => void }) {
  return <ol className="medication-record-list">{group.records.map(({ id, items }) => {
    const encounter = items[0]!.encounter
    return <li key={id} className="medication-record">
      <p className="clinical-history-meta">Prescribed {displayTime(encounter.occurredAt)} by {staffName(encounter.clinician)} · <span className={`clinical-status clinical-status-${encounter.status.toLowerCase()}`}>{clinicalLabels[encounter.status]}</span>
        {' · '}{onOpenRecord ? <button type="button" className="button-link" aria-label={`Open clinical record ${encounter.reference}`} onClick={() => onOpenRecord(encounter.id)}>Open record</button> : <span className="clinical-reference">{encounter.reference}</span>}</p>
      <ol className="medication-history-list">{items.map((item) => <li key={item.id}><MedicationOrderView order={item} /></li>)}</ol>
    </li>
  })}</ol>
}
