import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Download, RefreshCw, WifiOff } from 'lucide-react'
import { Brand } from '../components/branding/BrandMarks'
import { Dialog } from '../components/ui/Dialog'
import { checkConnection, connectivityStore } from './connectivity'
import { installPreference, installRelevant, installStore, type InstallState } from './install'
import { applyUpdate, updateStore } from './updates'
import './pwa.css'

const useInstall = () => useSyncExternalStore(installStore.subscribe, installStore.getSnapshot)
const OFFLINE_RECHECK_MS = 15000

// ---------------------------------------------------------------- connection required
// Shown instead of any hospital data when the server cannot be reached. Nothing is ever served
// from an offline copy, so there is no stale record to show.
export function OfflineState({ onRetry, overlay = false }: { onRetry: () => Promise<boolean> | void; overlay?: boolean }) {
  const [checking, setChecking] = useState(false), [failed, setFailed] = useState(false), heading = useRef<HTMLHeadingElement>(null), id = useId()
  useEffect(() => { heading.current?.focus() }, [])
  // Browsers do not always report a restored connection, so check again quietly every 15 seconds
  // while this screen is shown (the public health endpoint only; no credentials or data).
  const retryRef = useRef(onRetry)
  useEffect(() => { retryRef.current = onRetry })
  useEffect(() => {
    const timer = window.setInterval(() => { void retryRef.current() }, OFFLINE_RECHECK_MS)
    return () => window.clearInterval(timer)
  }, [])
  async function retry() {
    setChecking(true); setFailed(false)
    const ok = await onRetry()
    setChecking(false)
    if (ok === false) setFailed(true)
  }
  const Root = overlay ? 'div' : 'main'
  return <Root className={`auth-status offline-state${overlay ? ' offline-overlay' : ''}`} role={overlay ? 'alertdialog' : undefined} aria-modal={overlay || undefined}
    aria-labelledby={`${id}-title`} aria-describedby={`${id}-text`}>
    <Brand />
    <section className="panel recovery-panel">
      <WifiOff size={28} aria-hidden="true" className="offline-icon" />
      <h1 id={`${id}-title`} tabIndex={-1} ref={heading}>Medicare needs a network connection to access hospital records.</h1>
      <p id={`${id}-text`}>Reconnect to continue.</p>
      {failed && <p role="status" className="offline-still">Still offline. Check the network connection and try again.</p>}
      <div className="recovery-actions"><button type="button" className="button button-primary" disabled={checking} onClick={() => void retry()}>
        <RefreshCw size={17} aria-hidden="true" />{checking ? 'Checking connection…' : 'Retry'}</button></div>
    </section>
  </Root>
}

// Covers the whole app while offline. The workspace underneath stays mounted (unsaved text is
// kept) but is inert and hidden, so no record is visible or usable until the connection returns.
export function OfflineOverlay() {
  const { online } = useSyncExternalStore(connectivityStore.subscribe, connectivityStore.getSnapshot)
  if (online) return null
  return <OfflineState overlay onRetry={() => checkConnection()} />
}

// ---------------------------------------------------------------- update available
export function UpdateNotice() {
  const { available } = useSyncExternalStore(updateStore.subscribe, updateStore.getSnapshot)
  const [blocked, setBlocked] = useState(false)
  if (!available) return null
  return <div className="update-notice" role="status" aria-live="polite">
    <p><strong>An update to Medicare is available.</strong>{blocked && <span> Save or close the open form first, then refresh.</span>}</p>
    <button type="button" className="button button-ghost" onClick={() => setBlocked(applyUpdate() === 'unsaved')}><RefreshCw size={16} aria-hidden="true" />Refresh when safe</button>
  </div>
}

// ---------------------------------------------------------------- installation
function IosSteps() {
  return <ol className="install-steps">
    <li>Tap <strong>Share</strong> in the browser toolbar.</li>
    <li>Choose <strong>Add to Home Screen</strong>.</li>
    <li>Tap <strong>Add</strong> to confirm.</li>
  </ol>
}

export function IosInstallDialog({ onClose }: { onClose: () => void }) {
  const id = useId()
  return <Dialog title="Add Medicare to this device" onClose={onClose} size="compact" closeLabel="Close install instructions" describedBy={`${id}-text`}>
    <p id={`${id}-text`} className="install-text">On iPhone and iPad, add Medicare from the browser’s Share menu:</p>
    <IosSteps />
    <div className="modal-footer"><button type="button" className="button button-primary" onClick={onClose}>Done</button></div>
  </Dialog>
}

// After the first password change on this device and the next sign-in: an optional offer.
export function InstallOnboarding() {
  const install = useInstall(), relevant = installRelevant(install)
  // The device preference is read only once installation is actually possible here.
  const offered = useMemo(() => relevant && installPreference.offerPending() && !installPreference.dismissed(), [relevant])
  const [closed, setClosed] = useState(false)
  const setOpen = (value: boolean) => setClosed(!value)
  const [busy, setBusy] = useState(false), id = useId()
  if (!offered || closed || !relevant) return null
  const notNow = () => { installPreference.dismiss(); setOpen(false) }
  async function installNow() {
    setBusy(true)
    const outcome = await installStore.prompt()
    setBusy(false)
    // Respect the browser's answer: no second prompt straight after a dismissal.
    if (outcome === 'dismissed') installPreference.dismiss(); else installPreference.clearOffer()
    setOpen(false)
  }
  return <Dialog title="Welcome to Medicare" busy={busy} onClose={notNow} size="compact" closeLabel="Close install offer" describedBy={`${id}-text`}>
    <p id={`${id}-text`} className="install-text">Add Medicare to this device for faster access.</p>
    {install.ios && !install.promptAvailable ? <IosSteps /> : <p className="field-helper">It opens in its own window. Hospital records are never stored on the device for offline use.</p>}
    <div className="modal-footer">
      <button type="button" className="button button-ghost" disabled={busy} onClick={notNow}>Not now</button>
      {install.ios && !install.promptAvailable
        ? <button type="button" className="button button-primary" onClick={() => { installPreference.clearOffer(); setOpen(false) }}>Done</button>
        : <button type="button" className="button button-primary" disabled={busy} onClick={() => void installNow()}><Download size={17} aria-hidden="true" />Install Medicare</button>}
    </div>
  </Dialog>
}

// Kept in the menu even after "Not now", and only while installation is possible and not done.
export function InstallAction({ onBeforeOpen }: { onBeforeOpen?: () => void }) {
  const install: InstallState = useInstall()
  const [instructions, setInstructions] = useState(false)
  if (!installRelevant(install) && !instructions) return null
  return <>
    {installRelevant(install) && <button type="button" className="button-link sidebar-password sidebar-install" onClick={() => {
      onBeforeOpen?.()
      if (install.ios && !install.promptAvailable) setInstructions(true)
      else void installStore.prompt()
    }}><Download size={16} aria-hidden="true" />Install Medicare</button>}
    {instructions && <IosInstallDialog onClose={() => setInstructions(false)} />}
  </>
}
