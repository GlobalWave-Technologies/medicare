import { useEffect, useState } from 'react'

// Local-time display and entry shared by admissions, clinical records and notifications.
export const localTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone
export function displayTime(value: string) {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date) : 'Not recorded'
}
const pad = (value: number) => String(value).padStart(2, '0')
export function toLocalInput(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
export function localInputToISO(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null
  const date = new Date(value)
  // Round-trip rejects impossible calendar dates and spring-forward gaps. JS
  // chooses the earlier occurrence of repeated fall-back times (documented UI).
  if (!Number.isFinite(date.getTime()) || toLocalInput(date.toISOString()) !== value) return null
  return date.toISOString()
}
export function localDateRange(from: string, to: string) {
  // Some zones advance clocks at midnight. A calendar-day filter starts at
  // that day's first existing instant, even when its 00:00 does not exist.
  const midnight = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
    const date = new Date(`${value}T00:00`)
    if (!Number.isFinite(date.getTime()) || toLocalInput(date.toISOString()).slice(0, 10) !== value) return null
    return date.toISOString()
  }
  const dateFrom = midnight(from), end = midnight(to)
  if (!dateFrom || !end || dateFrom > end) return null
  const next = new Date(end)
  next.setDate(next.getDate() + 1)
  next.setHours(0, 0, 0, 0)
  return { dateFrom, dateTo: new Date(next.getTime() - 1).toISOString() }
}
// A clock for relative labels ("Today, 09:30") that refreshes while the page is open.
export function useClock() {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const update = () => setNow(Date.now())
    const timer = window.setInterval(update, 15000)
    window.addEventListener('focus', update)
    document.addEventListener('visibilitychange', update)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', update); document.removeEventListener('visibilitychange', update) }
  }, [])
  return now
}
