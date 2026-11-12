import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { ActivityPoint } from '../../api/dashboard'
import { formatCount, labelIndexes, niceTop } from '../reports/report-utils'
import { longDay, pointSummary, shortDay } from './dashboard-utils'

// The two series differ by line style and marker shape as well as colour, so neither relies on colour alone.
const lines = [
  { key: 'admissions', label: 'Admissions', one: 'admission', className: 'series-admissions' },
  { key: 'discharges', label: 'Discharges', one: 'discharge', className: 'series-discharges' },
] as const
function useWidth() {
  const ref = useRef<HTMLDivElement>(null), [width, setWidth] = useState(640)
  useEffect(() => {
    const element = ref.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => { if (entry) setWidth(Math.max(240, Math.round(entry.contentRect.width))) })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}

// Daily admissions and discharges exactly as the server counted them: one point per UTC day, nothing smoothed or filled in.
export function ActivityChart({ series, title, busy = false }: { series: ActivityPoint[]; title: string; busy?: boolean }) {
  const id = useId(), [frame, width] = useWidth(), [active, setActive] = useState<number | null>(null)
  const count = series.length, many = count > 10, compact = width < 480
  const height = compact ? 200 : 232, left = 34, right = 14, top = 14, bottom = 30
  const plotWidth = width - left - right, plotHeight = height - top - bottom
  const max = Math.max(0, ...series.flatMap((point) => [point.admissions, point.discharges])), peak = niceTop(max)
  const ticks = peak <= 4 ? Array.from({ length: peak + 1 }, (_, index) => index) : [0, peak / 2, peak]
  const x = (index: number) => left + (count <= 1 ? plotWidth / 2 : index * plotWidth / (count - 1))
  const y = (value: number) => top + plotHeight - value / peak * plotHeight
  const path = (key: 'admissions' | 'discharges') => series.map((point, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)},${y(point[key]).toFixed(1)}`).join(' ')
  const labels = labelIndexes(count, many ? (compact ? 4 : 7) : count)
  const point = active === null ? undefined : series[active]
  const nearest = (clientX: number, target: Element) => {
    const box = target.getBoundingClientRect(), offset = (clientX - box.left) / Math.max(1, box.width) * width
    return Math.min(count - 1, Math.max(0, Math.round((offset - left) / Math.max(1, plotWidth) * (count - 1))))
  }
  function onKey(event: KeyboardEvent<HTMLDivElement>) {
    const current = active ?? count - 1
    const next = { ArrowLeft: current - 1, ArrowRight: current + 1, Home: 0, End: count - 1 }[event.key]
    if (next === undefined) return
    event.preventDefault(); setActive(Math.min(count - 1, Math.max(0, next)))
  }
  const tipLeft = point && active !== null ? x(active) : 0
  const tipAlign = tipLeft < 110 ? 'start' : tipLeft > width - 110 ? 'end' : 'middle'
  return <figure className={`activity-chart${busy ? ' is-busy' : ''}`} aria-labelledby={`${id}-title`}>
    <figcaption className="visually-hidden" id={`${id}-title`}>{title}</figcaption>
    <ul className="activity-legend">{lines.map((line) => <li key={line.key}><svg width="30" height="12" aria-hidden="true" focusable="false" className={line.className}>
      <line x1="1" x2="29" y1="6" y2="6" className="activity-line" />{line.key === 'admissions' ? <circle cx="15" cy="6" r="4" className="activity-marker" /> : <rect x="11" y="2" width="8" height="8" className="activity-marker" />}
    </svg>{line.label}</li>)}</ul>
    <div ref={frame} className="activity-frame" tabIndex={0} role="group" aria-roledescription="chart" aria-label={`${title}. Use the left and right arrow keys to read each day.`}
      onKeyDown={onKey} onFocus={() => setActive((current) => current ?? count - 1)} onBlur={() => setActive(null)}
      onPointerMove={(event: PointerEvent<HTMLDivElement>) => setActive(nearest(event.clientX, event.currentTarget))} onPointerLeave={(event) => { if (document.activeElement !== event.currentTarget) setActive(null) }}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" focusable="false">
        {ticks.map((tick) => <g key={tick}><line className="activity-grid" x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} />
          <text className="activity-axis" x={left - 8} y={y(tick)} dy="0.35em" textAnchor="end">{formatCount(tick)}</text></g>)}
        {labels.map((index, position) => <text key={index} className="activity-axis" x={x(index)} y={height - 8}
          textAnchor={count > 1 && position === 0 && many ? 'start' : count > 1 && position === labels.length - 1 && many ? 'end' : 'middle'}>{shortDay(series[index]!.period, many)}</text>)}
        {point && active !== null && <line className="activity-crosshair" x1={x(active)} x2={x(active)} y1={top} y2={top + plotHeight} />}
        {lines.map((line) => <g key={line.key} className={line.className}>
          <path className="activity-line" d={path(line.key)} />
          {series.map((item, index) => (!many || index === active) && (line.key === 'admissions'
            ? <circle key={item.period} className="activity-marker" cx={x(index)} cy={y(item[line.key])} r={index === active ? 5 : 4} />
            : <rect key={item.period} className="activity-marker" x={x(index) - (index === active ? 5 : 4)} y={y(item[line.key]) - (index === active ? 5 : 4)} width={index === active ? 10 : 8} height={index === active ? 10 : 8} />))}
        </g>)}
      </svg>
      {point && active !== null && <div className={`activity-tooltip align-${tipAlign}`} style={{ left: tipLeft }} aria-hidden="true">
        <strong>{longDay(point.period)}</strong>
        {lines.map((line) => <span key={line.key}><i className={`activity-key ${line.className}`} />{line.label}<b>{formatCount(point[line.key])}</b></span>)}
      </div>}
    </div>
    <p className="visually-hidden" aria-live="polite">{point ? pointSummary(point) : ''}</p>
    <details className="chart-data">
      <summary>Show data table</summary>
      <div className="report-table-scroll" role="region" aria-label={`${title} data`} tabIndex={0}>
        <table>
          <caption className="visually-hidden">{title}, by day (UTC)</caption>
          <thead><tr><th scope="col">Date</th><th scope="col">Admissions</th><th scope="col">Discharges</th></tr></thead>
          <tbody>{series.map((item) => <tr key={item.period}><th scope="row">{longDay(item.period)}</th><td>{formatCount(item.admissions)}</td><td>{formatCount(item.discharges)}</td></tr>)}</tbody>
        </table>
      </div>
    </details>
  </figure>
}
