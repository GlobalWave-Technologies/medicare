import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ActivityPoint, DashboardQuery } from '../../api/dashboard'
import { DAY_MS, presetRange, utcDate } from '../reports/report-time'
import { plural } from '../reports/report-utils'

export type ChartPeriod = 'last7' | 'last30' | 'month'
export const chartPeriods: [ChartPeriod, string, string][] = [['last7', 'Last 7 days', 'in the last 7 days'], ['last30', 'Last 30 days', 'in the last 30 days'], ['month', 'This month', 'this month']]
// Chart periods are whole UTC calendar days ending today, recomputed on every load so an open
// dashboard moves on to the new day by itself.
export function periodQuery(period: ChartPeriod, now: number): DashboardQuery {
  if (period !== 'month') return presetRange(period, now)
  const today = Math.floor(now / DAY_MS) * DAY_MS, first = new Date(today)
  first.setUTCDate(1)
  return { from: first.toISOString(), to: new Date(today + DAY_MS).toISOString() }
}

const day = (period: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', ...options }).format(utcDate(period) ?? 0)
export const shortDay = (period: string, many: boolean) => many ? day(period, { day: 'numeric', month: 'short' }) : day(period, { weekday: 'short', day: 'numeric' })
export const longDay = (period: string) => day(period, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
export const pointSummary = (point: ActivityPoint) => `${longDay(point.period)}: ${plural(point.admissions, 'admission')}, ${plural(point.discharges, 'discharge')}`
export function activitySummary(admissions: number, discharges: number, phrase: string, series: ActivityPoint[]) {
  const busiest = series.reduce<ActivityPoint | undefined>((best, point) => point.admissions > (best?.admissions ?? 0) ? point : best, undefined)
  return `${plural(admissions, 'admission')} and ${plural(discharges, 'discharge')} ${phrase}.${busiest ? ` Most admissions: ${longDay(busiest.period)} (${busiest.admissions}).` : ''}`
}

// Refreshes one interval after the last load (automatic or requested) while the page is visible.
// A hidden tab makes no requests; it refreshes once when shown again if a refresh fell due.
// The third value says whether the current load was automatic, so it can be marked as a background
// request that does not count as the person's own activity.
export function useAutoRefresh(intervalMs = 60000) {
  const [state, setState] = useState({ tick: 0, automatic: false })
  useEffect(() => {
    let due = false
    const timer = window.setTimeout(() => { if (document.visibilityState === 'visible') setState((s) => ({ tick: s.tick + 1, automatic: true })); else due = true }, intervalMs)
    const visible = () => { if (due && document.visibilityState === 'visible') setState((s) => ({ tick: s.tick + 1, automatic: true })) }
    document.addEventListener('visibilitychange', visible)
    return () => { window.clearTimeout(timer); document.removeEventListener('visibilitychange', visible) }
  }, [intervalMs, state.tick])
  return [state.tick, () => setState((s) => ({ tick: s.tick + 1, automatic: false })), state.automatic] as const
}

// Like a keyed read, but a refresh or a new key keeps the last figures on screen until the new
// ones arrive, so the dashboard never blanks or jumps. A failed refresh keeps them too.
export function useLiveRead<T>(key: string, revision: number, load: (signal: AbortSignal) => Promise<T>) {
  const [result, setResult] = useState<{ key: string; revision: number; data?: T; error?: unknown; shown?: T }>()
  const latest = useRef(load)
  useLayoutEffect(() => { latest.current = load })
  useEffect(() => {
    const controller = new AbortController()
    latest.current(controller.signal).then((data) => { if (!controller.signal.aborted) setResult({ key, revision, data, shown: data }) },
      (error: unknown) => { if (!controller.signal.aborted) setResult((current) => ({ key, revision, error, shown: current?.shown })) })
    return () => controller.abort()
  }, [key, revision])
  const settled = result?.key === key && result.revision === revision
  const data = result?.shown
  return { data, error: settled ? result.error : undefined, loading: !settled && data === undefined, updating: !settled && data !== undefined, current: settled && result.data !== undefined, sameKey: result?.key === key }
}
