import { hasUnsavedWork } from '../components/ui/useUnsavedChanges'

// Service-worker registration and updates. A new release waits until someone chooses to refresh,
// and only this tab's own request reloads this tab, so no open form is ever reloaded away.
type UpdateState = { available: boolean }
let state: UpdateState = { available: false }
let registration: ServiceWorkerRegistration | undefined
let requested = false
const listeners = new Set<() => void>()
const publish = (next: UpdateState) => { state = next; listeners.forEach((listener) => listener()) }

export const updateStore = {
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
  getSnapshot: () => state,
}

export async function registerServiceWorker(nav: Navigator = navigator, win: Window = window) {
  if (!('serviceWorker' in nav)) return undefined
  try {
    registration = await nav.serviceWorker.register('/sw.js', { scope: '/' })
  } catch {
    return undefined // installation and the offline shell are optional; Medicare works without them
  }
  const watch = (worker: ServiceWorker | null) => worker?.addEventListener('statechange', () => {
    if (worker.state === 'installed' && nav.serviceWorker.controller) publish({ available: true })
  })
  if (registration.waiting && nav.serviceWorker.controller) publish({ available: true })
  registration.addEventListener('updatefound', () => watch(registration!.installing))
  nav.serviceWorker.addEventListener('controllerchange', () => { if (requested) win.location.reload() })
  // A tab left open all day looks for a new release every hour and when it comes back into view.
  const check = () => { void registration?.update().catch(() => {}) }
  win.setInterval(check, 60 * 60 * 1000)
  win.document.addEventListener('visibilitychange', () => { if (win.document.visibilityState === 'visible') check() })
  return registration
}

export type UpdateResult = 'reloading' | 'unsaved' | 'none'
// Called only from the update notice. Refuses while a form may hold unsaved work.
export function applyUpdate(root: ParentNode = document): UpdateResult {
  if (hasUnsavedWork(root)) return 'unsaved'
  const waiting = registration?.waiting
  if (!waiting) return 'none'
  requested = true
  waiting.postMessage({ type: 'SKIP_WAITING' })
  return 'reloading'
}

export function resetUpdatesForTests() { state = { available: false }; registration = undefined; requested = false; listeners.clear() }
