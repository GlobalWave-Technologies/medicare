import { useEffect, useState } from 'react'
import { admissionsApi, type AdmissionPage, type AdmissionQuery } from '../../api/admissions'

// One list read per query and revision; a newer query aborts the older one. Searches wait briefly for typing to settle.
export function useAdmissions(query: AdmissionQuery | null, revision: number) {
  const serialized = JSON.stringify(query), key = JSON.stringify([serialized, revision])
  const [result, setResult] = useState<{ key: string; data?: AdmissionPage; error?: unknown }>()
  useEffect(() => {
    const options = JSON.parse(serialized) as AdmissionQuery | null
    if (!options) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void admissionsApi.list(options, controller.signal).then((data) => { if (!controller.signal.aborted) setResult({ key, data }) })
        .catch((error: unknown) => { if (!controller.signal.aborted) setResult({ key, error }) })
    }, options.search ? 300 : 0)
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [serialized, key])
  return { loading: query !== null && result?.key !== key, data: result?.key === key ? result.data : undefined, error: result?.key === key ? result.error : undefined }
}
