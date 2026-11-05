import { useEffect, useState } from 'react'
import { encountersApi, type EncounterPage, type EncounterQuery } from '../../api/encounters'
export function useEncounters(query: EncounterQuery | null, patientId: string | undefined, revision: number) {
  const serialized = JSON.stringify(query), key = JSON.stringify([serialized, patientId, revision])
  const [result, setResult] = useState<{ key: string; data?: EncounterPage; error?: unknown }>()
  useEffect(() => {
    const options = JSON.parse(serialized) as EncounterQuery | null
    if (!options) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      const pending = patientId ? encountersApi.history(patientId, options, controller.signal) : encountersApi.list(options, controller.signal)
      void pending.then((data) => { if (!controller.signal.aborted) setResult({ key, data }) }).catch((error: unknown) => { if (!controller.signal.aborted) setResult({ key, error }) })
    }, options.search ? 300 : 0)
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [serialized, patientId, key])
  return { loading: query !== null && result?.key !== key, data: result?.key === key ? result.data : undefined, error: result?.key === key ? result.error : undefined }
}
