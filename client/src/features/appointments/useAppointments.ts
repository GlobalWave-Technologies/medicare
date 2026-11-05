import { useEffect, useState } from 'react'
import { appointmentsApi, type AppointmentPage, type AppointmentQuery } from '../../api/appointments'
import type { BackendRole } from '../../api/auth'

export function scopedQuery(query: AppointmentQuery, role: BackendRole): AppointmentQuery {
  if (role !== 'DOCTOR_IN_CHARGE') return query
  const { clinicianId: _clinicianId, ...ownQuery } = query
  return ownQuery
}
export function useAppointments(query: AppointmentQuery | null, role: BackendRole, revision: number) {
  const serialized = JSON.stringify(query && scopedQuery(query, role))
  const key = JSON.stringify([serialized, role, revision])
  const [result, setResult] = useState<{ key: string; data?: AppointmentPage; error?: unknown }>()
  useEffect(() => {
    const options = JSON.parse(serialized) as AppointmentQuery | null
    if (!options) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void appointmentsApi.list(options, controller.signal).then((data) => {
        if (!controller.signal.aborted) setResult({ key, data })
      }).catch((error: unknown) => { if (!controller.signal.aborted) setResult({ key, error }) })
    }, options.search ? 300 : 0)
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [serialized, key])
  return { loading: query !== null && result?.key !== key, data: result?.key === key ? result.data : undefined, error: result?.key === key ? result.error : undefined }
}
export function useAppointmentClock() {
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
