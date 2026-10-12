import { useEffect, useSyncExternalStore, type ReactNode } from 'react'
import { authStore, type createAuthStore } from './auth-store'
import { ApiError, authErrorMessage } from '../../api/client'
import { Login } from './Login'
import type { StaffUser } from '../../api/auth'
import './auth.css'

export function AuthGate({ children, store = authStore }: {
  children: (user: StaffUser) => ReactNode
  store?: ReturnType<typeof createAuthStore>
}) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  useEffect(() => {
    const controller = new AbortController()
    void store.refreshUser(controller.signal)
    return () => controller.abort()
  }, [store])
  if (state.status === 'loading') return <main className="auth-status" role="status" aria-live="polite">Checking your secure session…</main>
  if (state.status === 'error') return <main className="auth-status">
    <div role="alert"><h1>Unable to check your session</h1><p>{authErrorMessage(state.error)}</p>
      {state.error instanceof ApiError && state.error.requestId && <p>Support reference: {state.error.requestId}</p>}
    </div>
    <button className="button button-primary" onClick={() => { void store.refreshUser() }}>Try again</button>
  </main>
  if (state.status === 'unauthenticated') return <Login onLogin={store.login} />
  return children(state.user)
}
