import { useId } from 'react'
import { periodLabel, type ReportBucket } from './report-time'
import { formatCount, labelIndexes, niceTop } from './report-utils'

export type ChartSeries = { label: string; tone: 'primary' | 'secondary' | 'accent'; values: number[] }
const bucketWords: Record<ReportBucket, [string, string, string]> = { day: ['day', 'days', 'Date'], week: ['week', 'weeks', 'Week starting'], month: ['month', 'months', 'Month'] }
const partialNote: Record<ReportBucket, string> = {
  day: 'Each bar is one UTC calendar day.',
  week: 'Weeks start on Monday (UTC). The first and last weeks can be partial.',
  month: 'Months are UTC calendar months. The first and last months can be partial.',
}
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)
function peakPhrase(period: string, bucket: ReportBucket) {
  if (bucket === 'day') return `on ${periodLabel(period, 'day')}`
  return bucket === 'week' ? `in the ${periodLabel(period, 'week').replace('Week', 'week')}` : `in ${periodLabel(period, 'month')}`
}

// Renders the server series exactly as returned: one bar group per period, nothing filled or smoothed.
export function TrendChart({ title, periods, bucket, series, unit, columns }: {
  title: string; periods: string[]; bucket: ReportBucket; series: ChartSeries[]; unit: string; columns?: { label: string; values: number[] }[]
}) {
  const id = useId(), count = periods.length, [one, many, heading] = bucketWords[bucket]
  const values = series.flatMap((item) => item.values), top = niceTop(Math.max(0, ...values))
  const ticks = top <= 2 ? Array.from({ length: top + 1 }, (_, index) => index) : [0, top / 2, top]
  const slot = 12, gap = count > 90 ? 0.4 : count > 31 ? 1 : 2, width = (slot - gap * 2) / Math.max(1, series.length)
  const span = `${formatCount(count)} ${count === 1 ? one : many}`
  let summary: string
  if (series.length === 1) {
    const peak = Math.max(0, ...series[0]!.values), at = series[0]!.values.indexOf(peak)
    summary = `${formatCount(sum(series[0]!.values))} ${unit} across ${span}.${peak > 0 ? ` Highest: ${formatCount(peak)} ${peakPhrase(periods[at]!, bucket)}.` : ''}`
  } else summary = `${series.map((item) => `${item.label}: ${formatCount(sum(item.values))}`).join('; ')}, across ${span}.`
  const table = columns ?? series.map(({ label, values: data }) => ({ label, values: data }))
  const essential = new Set(labelIndexes(count, 3))
  return <figure className="trend-chart" aria-labelledby={`${id}-title`}>
    <figcaption><h3 id={`${id}-title`}>{title}</h3><p id={`${id}-summary`}>{summary} <span className="chart-note">{partialNote[bucket]}</span></p></figcaption>
    {series.length > 1 && <ul className="chart-legend">{series.map((item) => <li key={item.label}><span className={`chart-swatch tone-${item.tone}`} aria-hidden="true" />{item.label}</li>)}</ul>}
    <div className="chart-frame" role="img" aria-labelledby={`${id}-title ${id}-summary`}>
      <div className="chart-y" aria-hidden="true">{ticks.map((tick) => <span key={tick} style={{ bottom: `${tick / top * 100}%` }}>{formatCount(tick)}</span>)}</div>
      <div className="chart-plot">
        <svg viewBox={`0 0 ${Math.max(1, count) * slot} 100`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
          {ticks.map((tick) => <line key={tick} className="chart-grid" x1="0" x2={Math.max(1, count) * slot} y1={100 - tick / top * 100} y2={100 - tick / top * 100} vectorEffect="non-scaling-stroke" />)}
          {periods.map((period, index) => series.map((item, position) => {
            const value = item.values[index] ?? 0, height = value / top * 100
            return <rect key={`${period}-${item.label}`} className={`chart-bar tone-${item.tone}`} x={index * slot + gap + position * width} y={100 - height} width={width} height={height}>
              <title>{`${periodLabel(period, bucket)}: ${formatCount(value)} ${item.label.toLowerCase()}`}</title>
            </rect>
          }))}
        </svg>
        {/* First, middle and last labels always show; the others only when the chart is wide enough. */}
        <div className="chart-x" aria-hidden="true">{labelIndexes(count, 7).map((index, position, all) => <span key={index}
          className={[position === 0 && all.length > 1 ? 'is-first' : position === all.length - 1 && all.length > 1 ? 'is-last' : '', essential.has(index) ? '' : 'is-optional'].filter(Boolean).join(' ') || undefined}
          style={{ left: `${(index + 0.5) / count * 100}%` }}>{periodLabel(periods[index]!, bucket, 'short')}</span>)}</div>
      </div>
    </div>
    <details className="chart-data">
      <summary>Show data table</summary>
      <div className="report-table-scroll" role="region" aria-label={`${title} data`} tabIndex={0}>
        <table>
          <caption className="visually-hidden">{title}, by {one}</caption>
          <thead><tr><th scope="col">{heading}</th>{table.map((column) => <th key={column.label} scope="col">{column.label}</th>)}</tr></thead>
          <tbody>{periods.map((period, index) => <tr key={period}><th scope="row">{periodLabel(period, bucket)}</th>
            {table.map((column) => <td key={column.label}>{formatCount(column.values[index] ?? 0)}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </details>
  </figure>
}
