import { useId, type ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import { ApiError } from '../../api/client'
import type { AppointmentSummary } from '../../api/reports'
import { appointmentStatuses, formatCount, reportError } from './report-utils'

export function KpiCard({ label, value, detail, action }: {
  label: string; value: string; detail?: ReactNode; action?: { label: string; onClick: () => void }
}) {
  const id = useId()
  return <article className="kpi-card" aria-labelledby={id}>
    <h3 id={id} className="kpi-label">{label}</h3>
    <p className="kpi-value">{value}</p>
    {detail && <p className="kpi-detail">{detail}</p>}
    {action && <button type="button" className="kpi-action" onClick={action.onClick}>{action.label}<ArrowRight size={16} aria-hidden="true" /></button>}
  </article>
}

// Counts are given in words; the bar length and colour only reinforce them.
export function StatusBreakdown({ summary, title, empty }: { summary: AppointmentSummary; title: string; empty: string }) {
  const id = useId(), total = summary.totalAppointments
  return <section className="status-breakdown" aria-labelledby={id}>
    <h3 id={id}>{title}</h3>
    {total === 0 && <p className="report-empty-note">{empty}</p>}
    <ul>{appointmentStatuses.map(({ key, label, tone }) => <li key={key}>
      <span className="status-breakdown-label"><span className={`status-dot tone-${tone}`} aria-hidden="true" />{label}<span className="visually-hidden">:</span></span>
      <span className="status-breakdown-track" aria-hidden="true"><span className={`tone-${tone}`} style={{ width: `${total ? summary[key] / total * 100 : 0}%` }} /></span>
      <strong>{formatCount(summary[key])}</strong>
    </li>)}</ul>
  </section>
}

export function ReportFeedback({ error, subject = 'report', onRetry }: { error: unknown; subject?: 'report' | 'dashboard'; onRetry?: () => void }) {
  const forbidden = error instanceof ApiError && error.status === 403
  return <div className="report-recovery">
    <div role="alert" className="report-error">{reportError(error, subject)}
      {error instanceof ApiError && error.requestId && <small>Support reference: {error.requestId}</small>}</div>
    {onRetry && !forbidden && <button type="button" className="button button-ghost" onClick={onRetry}>Try again</button>}
  </div>
}

export function ReportSkeleton({ label, cards = 4 }: { label: string; cards?: number }) {
  return <>
    <p role="status" className="report-loading">{label}</p>
    <div className="report-skeleton" aria-hidden="true">
      <div className="kpi-grid">{Array.from({ length: cards }, (_, index) => <div key={index} className="kpi-card skeleton-card"><span /><span /></div>)}</div>
      <div className="skeleton-chart" />
    </div>
  </>
}

export function SectionHead({ id, title, children }: { id: string; title: string; children?: ReactNode }) {
  return <div className="report-section-head"><h2 id={id}>{title}</h2>{children}</div>
}
