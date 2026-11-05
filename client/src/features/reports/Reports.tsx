import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { RefreshCw } from 'lucide-react'
import type { BackendRole } from '../../api/auth'
import { reportBuckets, reportsApi, type AppointmentReport, type ClinicalActivityReport, type PatientReport, type ReportQuery } from '../../api/reports'
import { KpiCard, ReportFeedback, ReportSkeleton, SectionHead, StatusBreakdown } from './ReportParts'
import { TrendChart } from './TrendChart'
import { customRange, isRangeProblem, presetRange, rangeDates, rangeLabel, type RangePreset, type RangeProblem, type ReportBucket } from './report-time'
import { appointmentStatuses, formatCount, formatRate, generatedLabel, plural, reportKinds, reportTitles, useKeyedRead, type ReportKind } from './report-utils'
import './reports.css'

type Preset = RangePreset | 'custom'
type Applied = { preset: Preset; bucket: ReportBucket; from: string; to: string }
type Draft = { preset: Preset; bucket: ReportBucket; fromDate: string; toDate: string }
type Loaded = { kind: 'patients'; report: PatientReport } | { kind: 'appointments'; report: AppointmentReport } | { kind: 'clinical'; report: ClinicalActivityReport }
const presets: [Preset, string][] = [['last7', 'Last 7 days'], ['last30', 'Last 30 days'], ['last90', 'Last 90 days'], ['custom', 'Custom dates']]
const bucketLabels: Record<ReportBucket, string> = { day: 'Day', week: 'Week', month: 'Month' }
const lower = (bucket: ReportBucket) => bucketLabels[bucket].toLowerCase()

async function load(kind: ReportKind, query: ReportQuery, signal: AbortSignal): Promise<Loaded> {
  if (kind === 'patients') return { kind, report: await reportsApi.patients(query, signal) }
  if (kind === 'appointments') return { kind, report: await reportsApi.appointments(query, signal) }
  return { kind, report: await reportsApi.clinicalActivity(query, signal) }
}

function PatientView({ report }: { report: PatientReport }) {
  const { bucket } = report.range
  return <>
    <section className="report-section" aria-labelledby="patients-now">
      <SectionHead id="patients-now" title="Current status"><p>Counts right now. They don’t depend on the reporting period.</p></SectionHead>
      <div className="kpi-grid">
        <KpiCard label="Active patients" value={formatCount(report.snapshot.activePatients)} detail="Registered and not archived." />
        <KpiCard label="Archived patients" value={formatCount(report.snapshot.archivedPatients)} detail="Kept on record; an archived patient can be reactivated." />
      </div>
    </section>
    <section className="report-section" aria-labelledby="patients-period">
      <SectionHead id="patients-period" title="In this reporting period"><p>Patients are counted by registration date, including patients archived since.</p></SectionHead>
      <div className="kpi-grid"><KpiCard label="Patients registered" value={formatCount(report.summary.registrationsInRange)} detail={`${rangeLabel(report.range)} (UTC).`} /></div>
      {report.summary.registrationsInRange === 0
        ? <p className="report-empty">No patients were registered in this period.</p>
        : <TrendChart title={`Patients registered per ${lower(bucket)}`} unit="patients registered" bucket={bucket} periods={report.series.map((row) => row.period)}
          series={[{ label: 'Patients registered', tone: 'primary', values: report.series.map((row) => row.registrations) }]} />}
    </section>
  </>
}
function AppointmentView({ report }: { report: AppointmentReport }) {
  const { summary, series, range } = report
  return <section className="report-section" aria-labelledby="appointments-period">
    <SectionHead id="appointments-period" title="In this reporting period">
      <p>Appointments are counted by their scheduled start in this period, using each appointment’s current status, so later changes can update past periods. Upcoming appointments are shown on the Overview.</p>
    </SectionHead>
    <div className="kpi-grid">
      <KpiCard label="Appointments" value={formatCount(summary.totalAppointments)} detail="All statuses, by scheduled start." />
      <KpiCard label="Completed" value={formatCount(summary.completed)} detail="Marked completed." />
      <KpiCard label="Cancellation rate" value={formatRate(summary.cancellationRate)} detail={`${formatCount(summary.cancelled)} of ${plural(summary.totalAppointments, 'appointment')} cancelled.`} />
      <KpiCard label="No-show rate" value={formatRate(summary.noShowRate)} detail={`${formatCount(summary.noShow)} of ${plural(summary.totalAppointments, 'appointment')} marked no-show.`} />
    </div>
    <StatusBreakdown summary={summary} title="Appointments by current status" empty="No appointment activity was recorded in this period." />
    {summary.totalAppointments > 0 && <TrendChart title={`Appointments per ${lower(range.bucket)}`} unit="appointments" bucket={range.bucket} periods={series.map((row) => row.period)}
      series={[{ label: 'Appointments', tone: 'primary', values: series.map((row) => row.totalAppointments) }]}
      columns={[{ label: 'Total', values: series.map((row) => row.totalAppointments) },
        ...appointmentStatuses.map(({ key, label }) => ({ label, values: series.map((row) => row[key]) }))]} />}
  </section>
}
function ClinicalView({ report }: { report: ClinicalActivityReport }) {
  const { summary, series, range } = report
  const empty = !summary.encountersInRange && !summary.finalizedEncountersInRange && !summary.amendmentsInRange
  return <>
    <p className="report-scope">Only your own work: encounters you authored and amendments you added. No clinical text, diagnoses or patient details are included. Opening this report is recorded in the audit log.</p>
    <section className="report-section" aria-labelledby="clinical-now">
      <SectionHead id="clinical-now" title="Current status"><p>Right now, regardless of the reporting period.</p></SectionHead>
      <div className="kpi-grid"><KpiCard label="My open drafts" value={formatCount(report.snapshot.currentAuthoredDrafts)} detail="Encounters you started that aren’t finalized yet." /></div>
    </section>
    <section className="report-section" aria-labelledby="clinical-period">
      <SectionHead id="clinical-period" title="In this reporting period"><p>Each measure uses its own date: the encounter date, the finalization date and the amendment date.</p></SectionHead>
      <div className="kpi-grid">
        <KpiCard label="Encounters documented" value={formatCount(summary.encountersInRange)} detail="Encounters you authored, by encounter date." />
        <KpiCard label="Encounters finalized" value={formatCount(summary.finalizedEncountersInRange)} detail="Your encounters, by finalization date." />
        <KpiCard label="Amendments added" value={formatCount(summary.amendmentsInRange)} detail="Amendments you added, by amendment date." />
      </div>
      {empty ? <p className="report-empty">No clinical activity was recorded in this period.</p>
        : <TrendChart title={`My clinical activity per ${lower(range.bucket)}`} unit="items" bucket={range.bucket} periods={series.map((row) => row.period)} series={[
          { label: 'Encounters documented', tone: 'primary', values: series.map((row) => row.encounters) },
          { label: 'Encounters finalized', tone: 'secondary', values: series.map((row) => row.finalized) },
          { label: 'Amendments added', tone: 'accent', values: series.map((row) => row.amendments) }]} />}
    </section>
  </>
}

export function Reports({ role }: { role: BackendRole }) {
  const kinds = reportKinds(role)
  const [selected, setKind] = useState<ReportKind>(kinds[0]!)
  // Only a report this role may read can ever be active.
  const kind = kinds.includes(selected) ? selected : kinds[0]!
  const [applied, setApplied] = useState<Applied>(() => ({ preset: 'last30', bucket: 'day', ...presetRange('last30', Date.now()) }))
  const [draft, setDraft] = useState<Draft>({ preset: 'last30', bucket: 'day', fromDate: '', toDate: '' })
  const [problem, setProblem] = useState<RangeProblem>(), [revision, setRevision] = useState(0)
  const tabs = useRef<HTMLDivElement>(null)
  const query: ReportQuery = { from: applied.from, to: applied.to, bucket: applied.bucket }
  const { data, loading, error } = useKeyedRead(JSON.stringify([kind, query, revision]), (signal) => load(kind, query, signal))
  const dates = rangeDates(applied)
  const pending = draft.preset !== applied.preset || draft.bucket !== applied.bucket
    || (draft.preset === 'custom' && (draft.fromDate !== dates.first || draft.toDate !== dates.last))
  function changePreset(preset: Preset) {
    setProblem(undefined)
    setDraft((current) => ({ ...current, preset, ...(preset === 'custom' && !current.fromDate && !current.toDate ? { fromDate: dates.first, toDate: dates.last } : {}) }))
  }
  function apply(event: FormEvent) {
    event.preventDefault()
    let range: { from: string; to: string }
    if (draft.preset === 'custom') {
      const result = customRange(draft.fromDate, draft.toDate)
      if (isRangeProblem(result)) { setProblem(result); document.querySelector<HTMLInputElement>(`[name="${result.field === 'from' ? 'reportFrom' : 'reportTo'}"]`)?.focus(); return }
      range = result
    } else range = presetRange(draft.preset, Date.now())
    setProblem(undefined); setApplied({ preset: draft.preset, bucket: draft.bucket, ...range }); setRevision((n) => n + 1)
  }
  function tabKey(event: KeyboardEvent<HTMLButtonElement>) {
    const index = kinds.indexOf(kind)
    const next = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: kinds.length - 1 }[event.key]
    if (next === undefined) return
    event.preventDefault()
    const target = kinds[(next + kinds.length) % kinds.length]!
    setKind(target); tabs.current?.querySelector<HTMLButtonElement>(`#report-tab-${target}`)?.focus()
  }
  const described = (field: 'from' | 'to') => ['report-utc-help', problem?.field === field ? 'report-range-error' : ''].filter(Boolean).join(' ')
  const title = reportTitles[kind]
  const panel = <>
    <form className="report-filters" onSubmit={apply} noValidate aria-label="Reporting period">
      <label className="report-field">Reporting period
        <select name="reportPeriod" value={draft.preset} onChange={(event) => changePreset(event.target.value as Preset)}>
          {presets.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
      {draft.preset === 'custom' && <>
        <label className="report-field">From (UTC date)
          <input type="date" name="reportFrom" value={draft.fromDate} aria-invalid={problem?.field === 'from'} aria-describedby={described('from')} onChange={(event) => { setProblem(undefined); setDraft((current) => ({ ...current, fromDate: event.target.value })) }} /></label>
        <label className="report-field">To (UTC date, inclusive)
          <input type="date" name="reportTo" value={draft.toDate} aria-invalid={problem?.field === 'to'} aria-describedby={described('to')} onChange={(event) => { setProblem(undefined); setDraft((current) => ({ ...current, toDate: event.target.value })) }} /></label>
      </>}
      <fieldset className="report-buckets">
        <legend>Group by</legend>
        <div className="report-segments">{reportBuckets.map((bucket) => <label key={bucket}>
          <input type="radio" name="reportBucket" value={bucket} checked={draft.bucket === bucket} onChange={() => setDraft((current) => ({ ...current, bucket }))} />{bucketLabels[bucket]}</label>)}</div>
      </fieldset>
      <div className="report-filter-actions">
        <button className="button button-primary">Apply</button>
        <button type="button" className="button button-ghost" aria-label="Refresh report" disabled={loading} onClick={() => setRevision((n) => n + 1)}><RefreshCw size={17} aria-hidden="true" />Refresh</button>
      </div>
      {problem && <p id="report-range-error" className="report-field-error" role="alert">{problem.message}</p>}
      <p id="report-utc-help" className="report-hint">Reporting periods use UTC calendar dates, and weeks start on Monday.{pending && ' Select Apply to update the report.'}</p>
    </form>
    <div className="report-results" aria-busy={loading}>
      {loading && <ReportSkeleton label={`Loading ${title.toLowerCase()}…`} cards={kind === 'patients' ? 2 : kind === 'clinical' ? 1 : 4} />}
      {error !== undefined && <ReportFeedback error={error} onRetry={() => setRevision((n) => n + 1)} />}
      {data && <>
        <div className="report-meta">
          <p><strong>{rangeLabel(data.report.range)}</strong> (UTC) · grouped by {lower(data.report.range.bucket)}</p>
          <p>Generated <time dateTime={data.report.generatedAt}>{generatedLabel(data.report.generatedAt)}</time></p>
        </div>
        {data.kind === 'patients' && <PatientView report={data.report} />}
        {data.kind === 'appointments' && <AppointmentView report={data.report} />}
        {data.kind === 'clinical' && <ClinicalView report={data.report} />}
      </>}
    </div>
  </>
  if (kinds.length === 1) return <section className="panel reports-workspace" aria-labelledby="report-title">
    <h2 id="report-title" className="report-title">{title}</h2>{panel}
  </section>
  return <div className="panel reports-workspace">
    <div ref={tabs} role="tablist" aria-label="Report type" className="report-tabs">
      {kinds.map((item) => <button key={item} id={`report-tab-${item}`} type="button" role="tab" aria-selected={kind === item} aria-controls="report-panel"
        tabIndex={kind === item ? 0 : -1} onClick={() => setKind(item)} onKeyDown={tabKey}>{reportTitles[item]}</button>)}
    </div>
    <div id="report-panel" role="tabpanel" aria-labelledby={`report-tab-${kind}`}>{panel}</div>
  </div>
}
