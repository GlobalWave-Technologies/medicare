// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { INSTALL_DISMISSED_KEY, INSTALL_OFFER_KEY, initInstall, installRelevant, installStore, isIosDevice, isStandalone, resetInstallForTests } from '../src/pwa/install'
import { applyUpdate, registerServiceWorker, resetUpdatesForTests } from '../src/pwa/updates'
import { initConnectivity, setOnlineForTests } from '../src/pwa/connectivity'
import { InstallAction, InstallOnboarding, OfflineOverlay, UpdateNotice } from '../src/pwa/PwaUi'
import type { StaffUser } from '../src/api/auth'

vi.mock('../src/features/auth/AuthGate', () => ({ AuthGate: ({ children }: { children: (user: StaffUser) => ReactNode }) => children({
  id: 'synthetic', staffNumber: 'STF-PWA', firstName: 'Pwa', lastName: 'Staff', email: 'pwa@example.test', role: 'RECORDS_OFFICER', status: 'ACTIVE', mustChangePassword: false }) }))

let host: HTMLDivElement, root: Root
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  localStorage.clear(); resetInstallForTests(); resetUpdatesForTests(); setOnlineForTests(true)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
const render = async (node: ReactNode) => act(async () => root.render(node))
const button = (name: string) => [...document.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === name)
const media = (matches: Record<string, boolean>) => vi.fn((query: string) => ({ matches: Object.entries(matches).some(([key, value]) => value && query.includes(key)), addEventListener: vi.fn(), removeEventListener: vi.fn() }))
function promptEvent(outcome: 'accepted' | 'dismissed') {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
  event.prompt = vi.fn().mockResolvedValue(undefined)
  event.userChoice = Promise.resolve({ outcome })
  return event
}
function offerInstall(outcome: 'accepted' | 'dismissed' = 'accepted') {
  vi.stubGlobal('matchMedia', media({}))
  initInstall(window)
  const event = promptEvent(outcome)
  act(() => { window.dispatchEvent(event) })
  return event
}

it('captures the browser install prompt without showing it, and uses it only on request', async () => {
  const event = offerInstall('accepted')
  expect(event.defaultPrevented).toBe(true)
  expect(event.prompt).not.toHaveBeenCalled()
  expect(installStore.getSnapshot().promptAvailable).toBe(true)
  expect(await installStore.prompt()).toBe('accepted')
  expect(event.prompt).toHaveBeenCalledTimes(1)
})

it('respects a dismissal: the same prompt is never retried straight away', async () => {
  const event = offerInstall('dismissed')
  expect(await installStore.prompt()).toBe('dismissed')
  expect(await installStore.prompt()).toBe('unavailable')
  expect(event.prompt).toHaveBeenCalledTimes(1)
  expect(installStore.getSnapshot().promptAvailable).toBe(false)
})

it('detects an installed (standalone) app and hides every install control', async () => {
  vi.stubGlobal('matchMedia', media({ 'display-mode: standalone': true }))
  initInstall(window)
  act(() => { window.dispatchEvent(promptEvent('accepted')) })
  expect(isStandalone(window)).toBe(true)
  expect(installRelevant(installStore.getSnapshot())).toBe(false)
  localStorage.setItem(INSTALL_OFFER_KEY, '1')
  await render(<><InstallAction /><InstallOnboarding /></>)
  expect(document.body.textContent).not.toMatch(/Install Medicare|Welcome to Medicare/)
})

it('recognises iPhone and iPad (including iPadOS desktop mode) but not desktop or Android', () => {
  expect(isIosDevice({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1', maxTouchPoints: 5 })).toBe(true)
  expect(isIosDevice({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15', maxTouchPoints: 5 })).toBe(true)
  expect(isIosDevice({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15', maxTouchPoints: 0 })).toBe(false)
  expect(isIosDevice({ userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/156.0 Mobile Safari/537.36', maxTouchPoints: 5 })).toBe(false)
  expect(isIosDevice({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/156.0 Safari/537.36', maxTouchPoints: 0 })).toBe(false)
})

it('offers installation once after the first password change; Not now stores only a device preference', async () => {
  offerInstall('accepted')
  localStorage.setItem(INSTALL_OFFER_KEY, '1')
  await render(<InstallOnboarding />)
  const dialog = document.querySelector('[role="dialog"]')!
  expect(dialog.querySelector('h2')?.textContent).toBe('Welcome to Medicare')
  expect(dialog.textContent).toContain('Add Medicare to this device for faster access.')
  expect(button('Install Medicare')).toBeDefined(); expect(button('Not now')).toBeDefined()
  await act(async () => { button('Not now')!.click() })
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(Object.fromEntries(Object.entries(localStorage))).toEqual({ [INSTALL_DISMISSED_KEY]: '1' })
  await render(null); await render(<InstallOnboarding />)
  expect(document.querySelector('[role="dialog"]')).toBeNull()
})

it('is not shown without a pending offer, and Install uses the browser prompt and respects its answer', async () => {
  const event = offerInstall('dismissed')
  await render(<InstallOnboarding />)
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  localStorage.setItem(INSTALL_OFFER_KEY, '1')
  await render(null); await render(<InstallOnboarding />)
  await act(async () => { button('Install Medicare')!.click() })
  expect(event.prompt).toHaveBeenCalledTimes(1)
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(localStorage.getItem(INSTALL_DISMISSED_KEY)).toBe('1')
  expect(localStorage.getItem(INSTALL_OFFER_KEY)).toBeNull()
})

it('keeps a manual Install Medicare action, and shows Add to Home Screen steps on iPhone and iPad', async () => {
  offerInstall('accepted')
  await render(<InstallAction />)
  expect(button('Install Medicare')).toBeDefined()
  resetInstallForTests()
  vi.stubGlobal('navigator', { ...navigator, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1', maxTouchPoints: 5 })
  initInstall(window)
  await render(null); await render(<InstallAction />)
  await act(async () => { button('Install Medicare')!.click() })
  const steps = [...document.querySelectorAll('[role="dialog"] .install-steps li')].map((item) => item.textContent)
  expect(steps).toEqual(['Tap Share in the browser toolbar.', 'Choose Add to Home Screen.', 'Tap Add to confirm.'])
})

function fakeServiceWorker() {
  const listeners: Record<string, () => void> = {}
  const waiting = { postMessage: vi.fn(), state: 'installed', addEventListener: vi.fn() }
  const registration = { waiting, installing: null, addEventListener: vi.fn(), update: vi.fn().mockResolvedValue(undefined) }
  const serviceWorker = { register: vi.fn().mockResolvedValue(registration), controller: {}, addEventListener: (type: string, listener: () => void) => { listeners[type] = listener } }
  const reload = vi.fn()
  const win = { location: { reload }, setInterval: vi.fn(), document: { addEventListener: vi.fn(), visibilityState: 'visible' } } as unknown as Window
  return { nav: { serviceWorker } as unknown as Navigator, win, waiting, reload, listeners, serviceWorker }
}

it('registers the worker at the root scope and offers a waiting release without reloading', async () => {
  const sw = fakeServiceWorker()
  await registerServiceWorker(sw.nav, sw.win)
  expect(sw.serviceWorker.register).toHaveBeenCalledWith('/sw.js', { scope: '/' })
  await render(<UpdateNotice />)
  expect(document.querySelector('.update-notice[role="status"]')?.textContent).toContain('An update to Medicare is available.')
  expect(button('Refresh when safe')).toBeDefined()
  sw.listeners.controllerchange?.()
  expect(sw.reload).not.toHaveBeenCalled()
})

it('never reloads over an open form; refreshes only when deliberately chosen and safe', async () => {
  const sw = fakeServiceWorker()
  await registerServiceWorker(sw.nav, sw.win)
  const form = document.createElement('div'); form.setAttribute('role', 'dialog'); form.append(document.createElement('form')); document.body.append(form)
  await render(<UpdateNotice />)
  await act(async () => { button('Refresh when safe')!.click() })
  expect(sw.waiting.postMessage).not.toHaveBeenCalled()
  expect(document.querySelector('.update-notice')?.textContent).toContain('Save or close the open form first, then refresh.')
  form.remove()
  expect(applyUpdate()).toBe('reloading')
  expect(sw.waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
  expect(sw.reload).not.toHaveBeenCalled()
  sw.listeners.controllerchange?.()
  expect(sw.reload).toHaveBeenCalledTimes(1)
})

it('does nothing without service-worker support', async () => {
  expect(await registerServiceWorker({} as Navigator, window)).toBeUndefined()
})

it('covers the app with a connection-required screen while offline, and Retry restores it', async () => {
  // Workspace requests stay pending; only the health check is answered, as the test directs.
  const health = vi.fn<() => Promise<Response>>()
  const fetch = vi.fn((url: string) => String(url).endsWith('/health') ? health() : new Promise<Response>(() => {}))
  vi.stubGlobal('fetch', fetch)
  const { App } = await import('../src/app/App')
  initConnectivity(window)
  await render(<App />)
  expect(document.querySelector('.app-frame')?.hasAttribute('inert')).toBe(false)
  act(() => { window.dispatchEvent(new Event('offline')) })
  const overlay = document.querySelector('[role="alertdialog"]')!
  expect(overlay.querySelector('h1')?.textContent).toBe('Medicare needs a network connection to access hospital records.')
  expect(overlay.textContent).toContain('Reconnect to continue.')
  expect(document.querySelector('.app-frame')?.hasAttribute('inert')).toBe(true)
  expect(document.querySelector('.app-frame')?.getAttribute('aria-hidden')).toBe('true')
  health.mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce(new Response('{}', { status: 200 }))
  await act(async () => { button('Retry')!.click() })
  expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('Still offline.')
  await act(async () => { button('Retry')!.click() })
  expect(fetch).toHaveBeenCalledWith('/api/v1/health', { cache: 'no-store', credentials: 'omit' })
  expect(health).toHaveBeenCalledTimes(2)
  expect(document.querySelector('[role="alertdialog"]')).toBeNull()
  expect(document.querySelector('.app-frame')?.hasAttribute('inert')).toBe(false)
})

it('when the browser reports the connection is back, the server is confirmed a few times before Retry is needed', async () => {
  vi.useFakeTimers()
  try {
    const health = vi.fn().mockRejectedValueOnce(new TypeError('still settling')).mockRejectedValueOnce(new TypeError('still settling')).mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', health)
    initConnectivity(window)
    await render(<OfflineOverlay />)
    act(() => { window.dispatchEvent(new Event('offline')) })
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull()
    await act(async () => { window.dispatchEvent(new Event('online')) })
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(4500) })
    // (An earlier test's listener on the shared window may also check; the behaviour is what matters.)
    expect(health.mock.calls.length).toBeGreaterThanOrEqual(3)
    expect(document.querySelector('[role="alertdialog"]')).toBeNull()
  } finally { vi.useRealTimers() }
})

it('while offline, the connection is re-checked quietly every 15 seconds even if the browser never reports it is back', async () => {
  vi.useFakeTimers()
  try {
    const health = vi.fn().mockRejectedValueOnce(new TypeError('offline')).mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', health)
    setOnlineForTests(false)
    await render(<OfflineOverlay />)
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(15000) })
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull()
    expect(document.querySelector('[role="alertdialog"]')?.textContent).not.toContain('Still offline.')
    await act(async () => { await vi.advanceTimersByTimeAsync(15000) })
    expect(health).toHaveBeenCalledTimes(2)
    expect(health).toHaveBeenCalledWith('/api/v1/health', { cache: 'no-store', credentials: 'omit' })
    expect(document.querySelector('[role="alertdialog"]')).toBeNull()
  } finally { vi.useRealTimers() }
})

it('the overlay alone renders nothing while online', async () => {
  await render(<OfflineOverlay />)
  expect(host.innerHTML).toBe('')
})
