import { useSyncExternalStore } from 'react'
import { apiUrl } from '../api/client'

// Whether Medicare can reach its server. Hospital records are never kept for offline use, so
// while this is false the workspace is covered by a connection-required screen.
type ConnectivityState = { online: boolean }
let state: ConnectivityState = { online: typeof navigator === 'undefined' ? true : navigator.onLine !== false }
let initialized = false
const listeners = new Set<() => void>()
const publish = (online: boolean) => { if (state.online !== online) { state = { online }; listeners.forEach((listener) => listener()) } }

export const connectivityStore = {
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
  getSnapshot: () => state,
}

export const useOffline = () => !useSyncExternalStore(connectivityStore.subscribe, connectivityStore.getSnapshot).online

// Confirms with the public health endpoint (no credentials, never cached).
export async function checkConnection(fetcher: typeof fetch = fetch) {
  try {
    const response = await fetcher(apiUrl('/health'), { cache: 'no-store', credentials: 'omit' })
    publish(response.ok)
    return response.ok
  } catch {
    publish(false)
    return false
  }
}

export function initConnectivity(win: Window = window) {
  if (initialized) return
  initialized = true
  win.addEventListener('offline', () => publish(false))
  // The first request after a reconnection can still fail while the network settles, so confirm
  // a few times before leaving the decision to the Retry button.
  win.addEventListener('online', () => { void confirmOnline() })
}
async function confirmOnline() {
  for (const wait of [0, 1000, 3000, 6000, 12000]) {
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait))
    if (await checkConnection()) return
  }
}

export function setOnlineForTests(online: boolean) { state = { online }; initialized = false; listeners.clear() }
