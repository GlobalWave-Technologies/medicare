import { useSyncExternalStore } from 'react'

// Theme preference is a non-sensitive display setting. Only the bare preference word is
// stored, under one key; nothing about the signed-in person or their session goes with it.
// public/theme-init.js applies the same rules before the first paint and must stay in step.
export type ThemePreference = 'light' | 'dark' | 'system'
export type Theme = 'light' | 'dark'
export const themeStorageKey = 'medicare-theme'
export const themePreferences: readonly ThemePreference[] = ['light', 'dark', 'system']
export const themeColors: Record<Theme, string> = { light: '#c2410c', dark: '#191c20' }
const darkQuery = '(prefers-color-scheme: dark)'

export const isThemePreference = (value: unknown): value is ThemePreference => typeof value === 'string' && (themePreferences as readonly string[]).includes(value)

function storage(): Storage | undefined {
  try { return window.localStorage } catch { return undefined }
}
export function readThemePreference(): ThemePreference {
  try {
    const stored = storage()?.getItem(themeStorageKey)
    return isThemePreference(stored) ? stored : 'system'
  } catch { return 'system' }
}
function systemMedia(): MediaQueryList | undefined {
  try { return typeof window.matchMedia === 'function' ? window.matchMedia(darkQuery) : undefined } catch { return undefined }
}
export const resolveTheme = (preference: ThemePreference, systemDark = systemMedia()?.matches ?? false): Theme =>
  preference === 'system' ? (systemDark ? 'dark' : 'light') : preference

export function applyTheme(theme: Theme) {
  const root = document.documentElement
  if (root.dataset.theme !== theme) root.dataset.theme = theme
  root.style.colorScheme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColors[theme])
}

let preference: ThemePreference = 'system'
let media: MediaQueryList | undefined
const listeners = new Set<() => void>()
const notify = () => { for (const listener of listeners) listener() }
const sync = () => applyTheme(resolveTheme(preference))

function onSystemChange() {
  // A manual Light or Dark choice is never overridden by an operating-system change.
  if (preference === 'system') sync()
}
function onStorage(event: StorageEvent) {
  if (event.key !== null && event.key !== themeStorageKey) return
  preference = readThemePreference(); sync(); notify()
}

// Reads the saved preference, applies it and follows system changes while System is chosen.
export function initTheme() {
  stopTheme()
  preference = readThemePreference(); sync()
  media = systemMedia()
  media?.addEventListener?.('change', onSystemChange)
  window.addEventListener('storage', onStorage)
}
export function stopTheme() {
  media?.removeEventListener?.('change', onSystemChange); media = undefined
  window.removeEventListener('storage', onStorage)
}

export const themeStore = {
  getPreference: () => preference,
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
  setPreference(next: ThemePreference) {
    if (!isThemePreference(next)) return
    preference = next
    try { storage()?.setItem(themeStorageKey, next) } catch { /* Storage can be unavailable; the choice still applies to this page. */ }
    sync(); notify()
  },
}

export const useThemePreference = () => useSyncExternalStore(themeStore.subscribe, themeStore.getPreference, themeStore.getPreference)
