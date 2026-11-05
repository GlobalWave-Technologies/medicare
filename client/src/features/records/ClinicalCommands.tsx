import { useUnsavedChanges } from '../../components/ui/useUnsavedChanges'
import { useRef, useState, type FormEvent } from 'react'
import { encountersApi, type Encounter } from '../../api/encounters'
import { ClinicalDialog } from './ClinicalDialog'
import { ClinicalFeedback } from './ClinicalFeedback'
import { validateAmendment } from './clinical-utils'
export function ClinicalCommand({ encounter, action, onClose, onSaved }: { encounter: Encounter; action: 'finalize' | 'amend'; onClose: () => void; onSaved: (encounter: Encounter) => void }) {
  const [reason, setReason] = useState(''), [content, setContent] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(), [validation, setValidation] = useState<string | null>(null)
  const pending = useRef(false)
  useUnsavedChanges(Boolean(reason || content))
  const close = () => { if (!pending.current && (!(reason || content) || window.confirm('Discard unsaved amendment text?'))) onClose() }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (pending.current) return
    const problem = action === 'amend' ? validateAmendment({ reason, content }) : null
    setValidation(problem); setError(undefined)
    if (problem) return
    pending.current = true; setBusy(true)
    try {
      const result = action === 'finalize' ? await encountersApi.finalize(encounter.id) : await encountersApi.amend(encounter.id, { reason: reason.trim(), content: content.trim() })
      onSaved(result.encounter); onClose()
    } catch (caught) { setError(caught) }
    finally { pending.current = false; setBusy(false) }
  }
  return <ClinicalDialog size={action === 'finalize' ? 'compact' : 'standard'} title={action === 'finalize' ? 'Finalize clinical record' : 'Add permanent amendment'} busy={busy} onClose={close}>
    <form className="clinical-form" onSubmit={submit} noValidate>
      <p className="modal-lead"><strong>{encounter.reference}</strong></p>
      <p id="clinical-command-help" className="callout tone-warning">{action === 'finalize' ? 'Once finalized, this clinical record cannot be edited directly. Corrections must be added as amendments.' : 'This amendment will be added to the permanent clinical history and will not replace the original record.'}</p>
      {validation && <p role="alert" className="clinical-error">{validation}</p>}{error !== undefined && <ClinicalFeedback error={error} mutation={action} />}
      {busy && <p role="status" className="loading-note">{action === 'finalize' ? 'Finalizing clinical record…' : 'Adding permanent amendment…'}</p>}
      {action === 'amend' && <fieldset disabled={busy}><label>Amendment reason<textarea name="amendmentReason" maxLength={1000} rows={3} aria-describedby="clinical-command-help" value={reason} onChange={(event) => setReason(event.target.value)} /></label><label>Amendment content<textarea name="amendmentContent" maxLength={20000} rows={10} aria-describedby="clinical-command-help" value={content} onChange={(event) => setContent(event.target.value)} /></label></fieldset>}
      <div className="modal-footer"><button type="button" className="button button-ghost" disabled={busy} onClick={close}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? (action === 'finalize' ? 'Finalizing…' : 'Adding amendment…') : action === 'finalize' ? 'Confirm finalization' : 'Add permanent amendment'}</button></div>
    </form>
  </ClinicalDialog>
}
