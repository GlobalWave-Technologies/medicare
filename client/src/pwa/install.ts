// Installation as a home-screen / desktop app. Optional: nothing here gates access to Medicare.
// The only things stored are two device preferences that carry no identity or hospital data.

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}
export type InstallState = { standalone: boolean; promptAvailable: boolean; ios: boolean; installed: boolean }
export type InstallOutcome = 'accepted' | 'dismissed' | 'unavailable'

export const INSTALL_DISMISSED_KEY = 'medicare-install-dismissed'
export const INSTALL_OFFER_KEY = 'medicare-install-offer'

let deferred: BeforeInstallPromptEvent | undefined
let state: InstallState = { standalone: false, promptAvailable: false, ios: false, installed: false }
let initialized = false
const listeners = new Set<() => void>()
const publish = (next: Partial<InstallState>) => { state = { ...state, ...next }; listeners.forEach((listener) => listener()) }

// iPhone, iPod and iPad, including iPadOS reporting a desktop Safari user agent.
export function isIosDevice(nav: { userAgent: string; maxTouchPoints?: number }) {
  return /iPad|iPhone|iPod/.test(nav.userAgent) || (/Macintosh/.test(nav.userAgent) && (nav.maxTouchPoints ?? 0) > 1)
}
export function isStandalone(win: Window) {
  const query = (mode: string) => { try { return win.matchMedia(`(display-mode: ${mode})`).matches } catch { return false } }
  return query('standalone') || query('window-controls-overlay') || (win.navigator as { standalone?: boolean }).standalone === true
}

export function initInstall(win: Window = window) {
  if (initialized) return
  initialized = true
  publish({ standalone: isStandalone(win), ios: isIosDevice(win.navigator) })
  win.addEventListener('beforeinstallprompt', (event) => {
    // Hold the browser's prompt; Medicare offers it at a suitable moment, never before the
    // mandatory password change and never automatically.
    event.preventDefault()
    deferred = event as BeforeInstallPromptEvent
    publish({ promptAvailable: true })
  })
  win.addEventListener('appinstalled', () => { deferred = undefined; installPreference.clearOffer(); publish({ installed: true, promptAvailable: false }) })
  try { win.matchMedia('(display-mode: standalone)').addEventListener('change', () => publish({ standalone: isStandalone(win) })) } catch { /* not supported */ }
}

export const installStore = {
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
  getSnapshot: () => state,
  // Shows the browser's own install dialog once. A browser prompt cannot be reused, so after a
  // dismissal the action disappears until the browser offers installation again.
  async prompt(): Promise<InstallOutcome> {
    const event = deferred
    if (!event) return 'unavailable'
    deferred = undefined
    publish({ promptAvailable: false })
    await event.prompt()
    const { outcome } = await event.userChoice
    if (outcome === 'accepted') installPreference.clearOffer()
    return outcome
  },
}

export const installRelevant = (value: InstallState) => !value.standalone && !value.installed && (value.promptAvailable || value.ios)

const storage = () => { try { return window.localStorage } catch { return undefined } }
const read = (key: string) => { try { return storage()?.getItem(key) ?? null } catch { return null } }
const write = (key: string, value: string | null) => { try { if (value === null) storage()?.removeItem(key); else storage()?.setItem(key, value) } catch { /* storage unavailable */ } }
export const installPreference = {
  dismissed: () => read(INSTALL_DISMISSED_KEY) === '1',
  dismiss: () => { write(INSTALL_DISMISSED_KEY, '1'); write(INSTALL_OFFER_KEY, null) },
  // Set on this device after a mandatory password change, so the next sign-in offers installation.
  offerPending: () => read(INSTALL_OFFER_KEY) === '1',
  markOffer: () => write(INSTALL_OFFER_KEY, '1'),
  clearOffer: () => write(INSTALL_OFFER_KEY, null),
}

export function resetInstallForTests() {
  deferred = undefined; initialized = false; listeners.clear()
  state = { standalone: false, promptAvailable: false, ios: false, installed: false }
}
