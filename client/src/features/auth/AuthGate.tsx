import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react'
import { authStore, type createAuthStore } from './auth-store'
import { ApiError, authErrorMessage } from '../../api/client'
import { Login } from './Login'
import { TemporaryPasswordScreen } from './TemporaryPasswordScreen'
import { Brand } from '../../components/branding/BrandMarks'
import type { StaffUser } from '../../api/auth'
import { OfflineState } from '../../pwa/PwaUi'
import { checkConnection, connectivityStore } from '../../pwa/connectivity'
import { installPreference } from '../../pwa/install'
import './auth.css'

// A failed session check with no server response at all (not an HTTP error) means the network.
const unreachable = (error: unknown) => !(error instanceof ApiError) && !(error instanceof DOMException && error.name === 'AbortError')

export function AuthGate({ children, store = authStore }: {
  children: (user: StaffUser) => ReactNode
  store?: ReturnType<typeof createAuthStore>
}) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const { online } = useSyncExternalStore(connectivityStore.subscribe, connectivityStore.getSnapshot)
  useEffect(() => {
    const controller = new AbortController()
    void store.refreshUser(controller.signal)
    return () => controller.abort()
  }, [store])
  // When the connection returns, a session check that failed for lack of it runs again (once per
  // reconnection: the latest state is read through a ref, so a repeated failure cannot loop).
  const latest = useRef(state)
  useEffect(() => { latest.current = state })
  useEffect(() => {
    if (!online) return
    let cancelled = false
    void (async () => {
      // The network can take a few seconds to settle after reconnecting: retry a bounded number of times.
      for (const wait of [0, 1000, 3000, 6000]) {
        if (wait) await new Promise((resolve) => setTimeout(resolve, wait))
        const current = latest.current
        if (cancelled || !(current.status === 'error' && unreachable(current.error))) return
        await store.refreshUser()
      }
    })()
    return () => { cancelled = true }
  }, [online, store])
  if (state.status === 'loading') return <main className="auth-status"><Brand /><p role="status" aria-live="polite">Checking your secure session…</p></main>
  if (state.status === 'error' && unreachable(state.error)) {
    return <OfflineState onRetry={async () => { const ok = await checkConnection(); if (ok) await store.refreshUser(); return ok }} />
  }
  if (state.status === 'error') return <main className="auth-status"><Brand />
    <section className="panel recovery-panel">
      <div role="alert"><h1>Unable to check your session</h1><p>{authErrorMessage(state.error)}</p>
        {state.error instanceof ApiError && state.error.requestId && <p className="support-reference">Support reference: {state.error.requestId}</p>}
      </div>
      <div className="recovery-actions"><button className="button button-primary" onClick={() => { void store.refreshUser() }}>Try again</button></div>
    </section>
  </main>
  if (state.status === 'unauthenticated') return <Login onLogin={store.login} notice={state.notice} />
  // Security first: no workspace, menu or install offer until the temporary password is replaced.
  if (state.user.mustChangePassword) {
    return <TemporaryPasswordScreen key={state.user.id} user={state.user} onSignOut={() => store.logout()}
      onChanged={() => { installPreference.markOffer(); store.passwordChanged(true) }} />
  }
  return children(state.user)
}
