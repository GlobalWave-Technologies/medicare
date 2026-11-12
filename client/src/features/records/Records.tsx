import { PatientNumber } from '../../components/ui/PatientNumber'
import { useState } from 'react'
import { ArrowLeft, BedDouble, Plus, Search } from 'lucide-react'
import type { StaffUser } from '../../api/auth'
import type { AdmissionSummary } from '../../api/admissions'
import type { Patient } from '../../api/patients'
import type { Encounter } from '../../api/encounters'
import { personName, staffName } from '../../lib/people'
import { displayTime } from '../../lib/time'
import { AdmissionList } from '../admissions/AdmissionLists'
import { DischargeDialog } from '../admissions/AdmissionDialogs'
import { admissionStatusLabels, canDischarge } from '../admissions/admission-utils'
import { hasClinicalAccess } from './clinical-utils'
import { EncounterList } from './EncounterList'
import { EncounterDetail } from './EncounterDetail'
import { EncounterForm } from './EncounterForm'
import { MedicationHistory } from './MedicationHistory'
import './records.css'

// An admission's medical record, or a patient's whole clinical history. New records are only opened
// on a current admission; discharged stays are read-only apart from amendments.
export type ClinicalContext = { kind: 'patient'; patient: Patient } | { kind: 'admission'; admission: AdmissionSummary }
type Props = { user: StaffUser; context?: ClinicalContext; onBack: () => void; onOpenPatient: (patientId: string) => void; onAdmissionsChanged?: () => void }
export function Records(props: Props) { return hasClinicalAccess(props.user.role) ? <Workspace {...props} /> : null }
function Workspace({ user, context: initialContext, onBack, onOpenPatient, onAdmissionsChanged }: Props) {
  const [context, setContext] = useState(initialContext)
  const [selection, setSelection] = useState<{ id: string; initial?: Encounter } | null>(null)
  const [creating, setCreating] = useState(false), [discharging, setDischarging] = useState(false)
  const [revision, setRevision] = useState(0), [notice, setNotice] = useState('')
  const [search, setSearch] = useState(''), [page, setPage] = useState(1)
  const stay = context?.kind === 'admission' ? context.admission : undefined
  const patient = context?.kind === 'admission' ? context.admission.patient : context?.patient
  // From a patient's history, a new record goes on their current admission when there is one.
  const target = stay ? (stay.status === 'ADMITTED' ? { id: stay.id, admissionNumber: stay.admissionNumber, roomNumber: stay.roomNumber } : null)
    : context?.kind === 'patient' && context.patient.currentAdmission && !context.patient.archivedAt ? context.patient.currentAdmission : null
  const openAdmission = (admission: AdmissionSummary) => { setContext({ kind: 'admission', admission }); setSelection(null); setNotice('') }
  if (selection) return <EncounterDetail key={selection.id} user={user} id={selection.id} initial={selection.initial} onBack={() => setSelection(null)} onChanged={() => setRevision((n) => n + 1)}
    backLabel={stay ? `Back to ${stay.admissionNumber}` : patient ? 'Back to clinical history' : 'Back to medical records'} />
  return <div className="clinical-module">
    <div className="clinical-actions">
      {(context || initialContext) && <button className="button button-ghost" disabled={creating} onClick={() => { if (context && !initialContext) setContext(undefined); else onBack() }}>
        <ArrowLeft size={17} aria-hidden="true" />{context && !initialContext ? 'Back to medical records' : 'Back to patient'}</button>}
      {target && <button className="button button-primary" onClick={() => setCreating(true)}><Plus size={17} aria-hidden="true" />New clinical record</button>}
      {stay?.status === 'ADMITTED' && canDischarge(user.role) && <button className="button button-danger-quiet clinical-actions-end" onClick={() => setDischarging(true)}>Discharge patient</button>}
    </div>
    {notice && <p role="status" className="notice">{notice}</p>}
    {!context && <section className="panel clinical-workspace" aria-labelledby="records-admitted-title">
      <h2 id="records-admitted-title">Currently admitted patients</h2>
      <p>Open a patient’s medical record to write clinical records, prescribe and review history. Find patients who are not admitted in Patients.</p>
      <label className="patients-search records-search"><Search size={17} aria-hidden="true" /><input aria-label="Search admitted patients" maxLength={100} value={search}
        placeholder="Search name, number or room…" onChange={(event) => { setSearch(event.target.value); setPage(1) }} /></label>
      <AdmissionList status="ADMITTED" role={user.role} search={search} page={page} revision={revision} onPage={setPage} onRetry={() => setRevision((n) => n + 1)}
        onSelectPatient={onOpenPatient} onView={openAdmission} onOpenRecord={openAdmission} />
    </section>}
    {stay && <section className="panel admission-banner" aria-labelledby="record-admission-title">
      <div><p className="eyebrow">Medical record</p>
        <h2 id="record-admission-title">{personName(stay.patient)}</h2>
        <p className="detail-meta"><PatientNumber className="record-id" value={stay.patient.patientNumber} /><span className="record-id">{stay.admissionNumber}</span>
          <span className={`status ${stay.status === 'ADMITTED' ? 'admission-admitted' : 'admission-discharged'}`}>{admissionStatusLabels[stay.status]}</span></p></div>
      <dl className="admission-banner-facts"><div><dt>Room</dt><dd><BedDouble size={16} aria-hidden="true" />{stay.roomNumber}</dd></div>
        <div><dt>Admitted</dt><dd>{displayTime(stay.admittedAt)}<small>by {staffName(stay.admittedBy)}</small></dd></div>
        {stay.dischargedAt && <div><dt>Discharged</dt><dd>{displayTime(stay.dischargedAt)}<small>by {staffName(stay.dischargedBy)}</small></dd></div>}</dl>
      {stay.status === 'DISCHARGED' && <p className="callout tone-neutral">This admission is closed. Its records are read-only; corrections are added as amendments.</p>}
    </section>}
    {context && <>
      <EncounterList user={user} patient={stay ? undefined : patient} admission={stay} revision={revision} onSelect={(id) => setSelection({ id })}
        emptyHint={target ? 'Select New clinical record to document care for this admission.' : undefined} />
      <MedicationHistory patient={patient!} admission={stay ?? (context.kind === 'patient' ? context.patient.currentAdmission : null)} revision={revision}
        onOpenRecord={(id) => setSelection({ id })} />
    </>}
    {creating && target && patient && <EncounterForm user={user} patient={patient} admission={target} onClose={() => setCreating(false)}
      onSaved={(encounter) => { setSelection({ id: encounter.id, initial: encounter }); setRevision((n) => n + 1) }} />}
    {discharging && stay && <DischargeDialog admission={stay} onClose={() => setDischarging(false)}
      onSaved={(admission) => { setContext({ kind: 'admission', admission }); setNotice('Patient discharged. Their medical history remains available.'); setRevision((n) => n + 1); onAdmissionsChanged?.() }} />}
  </div>
}
