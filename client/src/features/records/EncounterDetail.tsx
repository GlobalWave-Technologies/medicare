import { PatientNumber } from '../../components/ui/PatientNumber'
import { useEffect, useState } from 'react'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import { LoadingRows } from '../../components/ui/LoadingRows'
import type { StaffUser } from '../../api/auth'
import { encountersApi, type Encounter } from '../../api/encounters'
import { personName, staffName } from '../../lib/people'
import { displayTime, localTimezone } from '../../lib/time'
import { canAmend, canEditDraft, clinicalLabels, hasClinicalAccess } from './clinical-utils'
import { ClinicalFeedback } from './ClinicalFeedback'
import { EncounterForm } from './EncounterForm'
import { ClinicalCommand } from './ClinicalCommands'
import { MedicationOrderView } from './MedicationOrderView'
type Props = { user: StaffUser; id: string; initial?: Encounter; onBack: () => void; onChanged: () => void; backLabel?: string }
export function EncounterDetail(props: Props) { return hasClinicalAccess(props.user.role) ? <Detail {...props} /> : null }
function Detail({ user, id, initial, onBack, onChanged, backLabel = 'Back to clinical records' }: Props) {
  const [encounter, setEncounter] = useState(initial), [loading, setLoading] = useState(!initial), [error, setError] = useState<unknown>(), [revision, setRevision] = useState(0)
  const [dialog, setDialog] = useState<'edit' | 'finalize' | 'amend' | null>(null), [notice, setNotice] = useState(initial ? 'Draft saved.' : '')
  useEffect(() => {
    if (initial && revision === 0) return
    const controller = new AbortController()
    void encountersApi.get(id, controller.signal).then((result) => { if (!controller.signal.aborted) { setEncounter(result.encounter); setLoading(false) } })
      .catch((caught: unknown) => { if (!controller.signal.aborted) { setError(caught); setEncounter(undefined); setLoading(false) } })
    return () => controller.abort()
  }, [id, initial, revision])
  function openDialog(next: 'edit' | 'finalize' | 'amend') { setNotice(''); setDialog(next) }
  function saved(value: Encounter) { setEncounter(value); setNotice(value.status === 'DRAFT' ? 'Draft saved.' : dialog === 'amend' ? 'Amendment added to permanent history.' : 'Clinical record finalized.'); onChanged() }
  const text = (value: string | null) => value ? <p className="clinical-text">{value}</p> : <p className="clinical-empty">Not recorded</p>
  return <section className="panel clinical-workspace clinical-detail" aria-busy={loading}>
    <div className="list-tools detail-tools"><button className="button button-ghost" disabled={Boolean(dialog)} onClick={onBack}><ArrowLeft size={17} aria-hidden="true" />{backLabel}</button><button className="button button-ghost" disabled={loading || Boolean(dialog)} onClick={() => { setLoading(true); setError(undefined); setNotice(''); setRevision((n) => n + 1) }}><RefreshCw size={17} aria-hidden="true" />Refresh clinical record</button></div>
    {loading && <LoadingRows label="Loading clinical record…" />}{error !== undefined && <ClinicalFeedback error={error} />}{notice && <p role="status" className="notice">{notice}</p>}
    {encounter && !loading && <>
      <div className="detail-header"><div><p className="eyebrow">Clinical record</p>
        <div className="detail-title"><h2>{encounter.reference}</h2><span className={`clinical-status clinical-status-${encounter.status.toLowerCase()}`}>{clinicalLabels[encounter.status]}</span></div>
        <p className="detail-meta"><span><strong>{personName(encounter.patient)}</strong> · <PatientNumber value={encounter.patient.patientNumber} /></span><span>{displayTime(encounter.occurredAt)}</span><span>Times in {localTimezone()}.</span></p></div>
        {(canEditDraft(user, encounter) || canAmend(user, encounter)) && <div className="clinical-actions">{canEditDraft(user, encounter) && <><button className="button button-primary" onClick={() => openDialog('edit')}>Edit draft</button><button className="button button-ghost" onClick={() => openDialog('finalize')}>Finalize record</button></>}{canAmend(user, encounter) && <button className="button button-primary" onClick={() => openDialog('amend')}>Add amendment</button>}</div>}
      </div>
      {encounter.status !== 'DRAFT' && <p className="callout tone-neutral clinical-readonly">This record is read-only. Original clinical content remains intact.</p>}
      <dl className="clinical-detail-grid"><div><dt>Patient</dt><dd>{personName(encounter.patient)}<small>{encounter.patient.patientNumber}</small></dd></div><div><dt>Clinician</dt><dd>{staffName(encounter.clinician)}</dd></div><div><dt>Original author</dt><dd>{staffName(encounter.author)}<small>{encounter.author.staffNumber}</small></dd></div>
        <div><dt>Admission</dt><dd>{encounter.admission?.admissionNumber ?? 'Recorded before admissions'}</dd></div>
        {encounter.appointment && <div><dt>Past appointment</dt><dd>{encounter.appointment.reference}</dd></div>}
        <div><dt>Encounter time</dt><dd>{displayTime(encounter.occurredAt)}</dd></div><div><dt>Recorded</dt><dd>{displayTime(encounter.createdAt)}</dd></div><div><dt>Room</dt><dd>{encounter.roomLabel || 'Not recorded'}</dd></div><div><dt>Follow-up</dt><dd>{encounter.followUpAt ? displayTime(encounter.followUpAt) : 'Not recorded'}</dd></div>
        {encounter.reviewedAt && <div><dt>Finalized</dt><dd>{displayTime(encounter.reviewedAt)}</dd></div>}{encounter.status === 'VOIDED' && <div><dt>Voided</dt><dd>{encounter.voidedAt ? displayTime(encounter.voidedAt) : 'Not recorded'}{encounter.voidReason && <p>{encounter.voidReason}</p>}</dd></div>}
      </dl>
      <section className="clinical-original" aria-label={encounter.status === 'REVIEWED' ? 'Original finalized record' : 'Clinical content'}>
        <h3>{encounter.status === 'REVIEWED' ? 'Original finalized record' : 'Clinical content'}</h3>
        <div className="clinical-block"><h4>Complaints</h4>{encounter.complaints.length ? <ul>{encounter.complaints.map((item) => <li className="clinical-text" key={item.id}>{item.description}</li>)}</ul> : <p className="clinical-empty">None recorded.</p>}</div>
        <div className="clinical-block"><h4>History summary</h4>{text(encounter.historySummary)}</div>
        <div className="clinical-block"><h4>Clinical notes</h4>{text(encounter.clinicalNotes)}</div>
        <div className="clinical-block"><h4>Diagnoses</h4>{encounter.diagnoses.length ? <ol>{encounter.diagnoses.map((item) => <li key={item.id}><p className="clinical-text">{item.description}</p>{item.code && <p className="clinical-code">Code: {item.code}</p>}{item.notes && <p className="clinical-text">{item.notes}</p>}</li>)}</ol> : <p className="clinical-empty">None recorded.</p>}</div>
        <div className="clinical-block"><h4>Medications</h4>
          {encounter.status === 'REVIEWED' && encounter.medications.length > 0 && <p className="field-helper">Locked when the record was finalized. Corrections are added as amendments.</p>}
          {encounter.status === 'DRAFT' && encounter.medications.length > 0 && <p className="field-helper">Draft orders: they can be changed with Edit draft until the record is finalized.</p>}
          {encounter.medications.length ? <ol className="medication-list" aria-label="Medication orders">{encounter.medications.map((item) => <li key={item.id}>
            <MedicationOrderView order={item} /></li>)}</ol> : <p className="clinical-empty">None prescribed.</p>}</div>
        <div className="clinical-block"><h4>Treatment plan</h4>{text(encounter.treatmentPlan)}</div>
      </section>
      <section className="clinical-amendments" aria-label="Amendments"><h3>Amendments</h3><p>Permanent additions to the original record, shown in chronological order.</p>{encounter.amendments.length ? <ol>{encounter.amendments.map((item) => <li key={item.id}><article><p><strong>{staffName(item.author)}</strong> · {displayTime(item.createdAt)}</p><h4>Reason</h4><p className="clinical-text">{item.reason}</p><h4>Amendment content</h4><p className="clinical-text">{item.content}</p></article></li>)}</ol> : <p className="clinical-empty">No amendments recorded.</p>}</section>
      {dialog === 'edit' && canEditDraft(user, encounter) && <EncounterForm user={user} patient={encounter.patient} admission={encounter.admission} encounter={encounter} onClose={() => setDialog(null)} onSaved={saved} />}
      {dialog === 'finalize' && canEditDraft(user, encounter) && <ClinicalCommand encounter={encounter} action="finalize" onClose={() => setDialog(null)} onSaved={saved} />}
      {dialog === 'amend' && canAmend(user, encounter) && <ClinicalCommand encounter={encounter} action="amend" onClose={() => setDialog(null)} onSaved={saved} />}
    </>}
  </section>
}
