import { useEffect, useState } from 'react'
import { patientsApi, type PatientPage, type PatientQuery } from '../../api/patients'

export function usePatients(query: Required<PatientQuery>, revision: number, enabled = true) {
  const { page, limit, search, archived } = query
  const key = JSON.stringify([page, limit, search, archived, revision])
  const [result, setResult] = useState<{ key: string; data?: PatientPage; error?: unknown }>()
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void patientsApi.list({ page, limit, search, archived }, controller.signal).then((data) => {
        if (!controller.signal.aborted) setResult({ key, data })
      }).catch((error: unknown) => {
        if (!controller.signal.aborted) setResult({ key, error })
      })
    }, search ? 300 : 0)
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [page, limit, search, archived, revision, key, enabled])
  return { loading: enabled && result?.key !== key, data: result?.key === key ? result.data : undefined, error: result?.key === key ? result.error : undefined }
}
