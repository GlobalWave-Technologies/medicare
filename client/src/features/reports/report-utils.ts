import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { BackendRole } from '../../api/auth'
import { ApiError, authErrorMessage } from '../../api/client'
export type ReportKind = 'patients' | 'admissions'
// Mirrors the server permissions: operational reports for Admin and Records Officers only.
export const reportKinds = (role: BackendRole): ReportKind[] => role === 'DOCTOR_IN_CHARGE' ? [] : ['patients', 'admissions']
export const reportTitles: Record<ReportKind, string> = { patients: 'Patient registrations', admissions: 'Admissions and discharges' }

export const formatCount = (value: number) => value.toLocaleString()
export const plural = (value: number, one: string, many = `${one}s`) => `${formatCount(value)} ${value === 1 ? one : many}`
export function generatedLabel(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

// Gridline steps stay whole numbers, because every value is a count.
export function niceTop(max: number) {
  if (max <= 1) return 1
  const magnitude = 10 ** Math.floor(Math.log10(max))
  return [1, 2, 4, 6, 8, 10].map((step) => step * magnitude).find((value) => value >= max) ?? max
}
export function labelIndexes(count: number, limit = 4) {
  if (count <= limit) return Array.from({ length: count }, (_, index) => index)
  return [...new Set(Array.from({ length: limit }, (_, index) => Math.round(index * (count - 1) / (limit - 1))))]
}

const errors: Record<string, string> = {
  INVALID_REPORT_RANGE: 'The reporting period wasn’t accepted. Choose a start date before the end date.',
  REPORT_RANGE_TOO_LARGE: 'Choose a reporting period of 366 days or fewer.',
  VALIDATION_ERROR: 'The reporting period wasn’t accepted. Check the dates and try again.',
}
export function reportError(error: unknown, subject: 'report' | 'dashboard' = 'report') {
  if (error instanceof ApiError) {
    if (error.code && errors[error.code]) return errors[error.code]
    if (error.status === 403) return `You don’t have access to this ${subject}.`
    if (error.status === 401) return 'Your session has expired. Sign in again.'
    if (error.code === 'INVALID_RESPONSE') return `The ${subject} could not be displayed because the server response was incomplete. Try again.`
    if (error.status >= 500) return `The ${subject} couldn’t be loaded. Try again.`
  }
  return authErrorMessage(error)
}

// One read per key. A newer key aborts the older request and its late result is discarded.
export function useKeyedRead<T>(key: string, load: (signal: AbortSignal) => Promise<T>) {
  const [result, setResult] = useState<{ key: string; data?: T; error?: unknown }>()
  const latest = useRef(load)
  useLayoutEffect(() => { latest.current = load })
  useEffect(() => {
    const controller = new AbortController()
    latest.current(controller.signal).then((data) => { if (!controller.signal.aborted) setResult({ key, data }) },
      (error: unknown) => { if (!controller.signal.aborted) setResult({ key, error }) })
    return () => controller.abort()
  }, [key])
  const current = result?.key === key ? result : undefined
  return { loading: !current, data: current?.data, error: current?.error }
}
