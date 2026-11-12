import { useEffect, useState } from 'react'
import { Check, Copy } from 'lucide-react'

// Patient numbers are long ("PT-" and 36 characters). Lists and summaries show the first part and
// keep the full number for screen readers, search, the tooltip and copying; the patient record
// shows it in full with a copy button. Short numbers would need a migration (a future decision).
const shortPatientNumber = (value: string) => value.length > 14 ? `${value.slice(0, 11)}…` : value

export function PatientNumber({ value, className = '' }: { value: string; className?: string }) {
  const short = shortPatientNumber(value)
  if (short === value) return <span className={`patient-number ${className}`.trim()}>{value}</span>
  return <span className={`patient-number ${className}`.trim()} title={value}>
    <span aria-hidden="true">{short}</span><span className="visually-hidden">{value}</span>
  </span>
}

export function CopyPatientNumber({ value }: { value: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  useEffect(() => {
    if (state === 'idle') return
    const timer = window.setTimeout(() => setState('idle'), 2500)
    return () => window.clearTimeout(timer)
  }, [state])
  async function copy() {
    try { await navigator.clipboard.writeText(value); setState('copied') } catch { setState('failed') }
  }
  return <>
    <button type="button" className="icon-btn copy-number" onClick={() => void copy()} aria-label="Copy patient number" title="Copy patient number">
      {state === 'copied' ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
    </button>
    <span className="copy-number-status" role="status">{state === 'copied' ? 'Patient number copied' : state === 'failed' ? 'Copying isn’t available here; select the number to copy it.' : ''}</span>
  </>
}
