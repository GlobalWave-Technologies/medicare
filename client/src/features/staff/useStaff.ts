import { useEffect, useState } from 'react'
import { staffApi, staffStatuses, type StaffMember, type StaffPage, type StaffQuery, type StaffStatus } from '../../api/staff'

// Each read is keyed by its query and revision; a superseded or aborted response is discarded.
export function useStaffList(query: StaffQuery, revision: number) {
  const serialized = JSON.stringify(query)
  const key = JSON.stringify([serialized, revision])
  const [result, setResult] = useState<{ key: string; data?: StaffPage; error?: unknown }>()
  useEffect(() => {
    const controller = new AbortController()
    staffApi.list(JSON.parse(serialized) as StaffQuery, controller.signal).then((data) => {
      if (!controller.signal.aborted) setResult({ key, data })
    }).catch((error: unknown) => { if (!controller.signal.aborted) setResult({ key, error }) })
    return () => controller.abort()
  }, [serialized, key])
  const current = result?.key === key ? result : undefined
  return { loading: !current, data: current?.data, error: current?.error }
}

export type StaffTotals = Record<StaffStatus, number>
// Server totals for each status, read with the status filter so they never depend on the visible page.
export function useStaffTotals(revision: number) {
  const [result, setResult] = useState<{ revision: number; totals?: StaffTotals; error?: unknown }>()
  useEffect(() => {
    const controller = new AbortController()
    Promise.all(staffStatuses.map((status) => staffApi.list({ status, limit: 1 }, controller.signal)
      .then(({ pagination }) => [status, pagination.total] as const))).then((entries) => {
      if (!controller.signal.aborted) setResult({ revision, totals: Object.fromEntries(entries) as StaffTotals })
    }).catch((error: unknown) => { if (!controller.signal.aborted) setResult({ revision, error }) })
    return () => controller.abort()
  }, [revision])
  const current = result?.revision === revision ? result : undefined
  return { loading: !current, totals: current?.totals, error: current?.error }
}

export function useStaffMember(id: string, revision: number) {
  const key = `${id}:${revision}`
  const [result, setResult] = useState<{ key: string; user?: StaffMember; error?: unknown }>()
  useEffect(() => {
    const controller = new AbortController()
    staffApi.get(id, controller.signal).then(({ user }) => {
      if (!controller.signal.aborted) setResult({ key, user })
    }).catch((error: unknown) => { if (!controller.signal.aborted) setResult({ key, error }) })
    return () => controller.abort()
  }, [id, key])
  const current = result?.key === key ? result : undefined
  return { loading: !current, user: current?.user, error: current?.error }
}
