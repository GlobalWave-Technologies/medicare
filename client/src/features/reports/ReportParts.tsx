import { useId, type ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import { ApiError } from '../../api/client'
import { reportError } from './report-utils'

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
