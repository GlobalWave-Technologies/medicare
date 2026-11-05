import { useEffect, useSyncExternalStore, type ReactNode } from 'react'
import { authStore, type createAuthStore } from './auth-store'
import { ApiError, authErrorMessage } from '../../api/client'
import { Login } from './Login'
import { Brand } from '../../components/branding/BrandMarks'
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
  if (state.status === 'loading') return <main className="auth-status"><Brand /><p role="status" aria-live="polite">Checking your secure session…</p></main>
  if (state.status === 'error') return <main className="auth-status"><Brand />
    <section className="panel recovery-panel">
      <div role="alert"><h1>Unable to check your session</h1><p>{authErrorMessage(state.error)}</p>
        {state.error instanceof ApiError && state.error.requestId && <p className="support-reference">Support reference: {state.error.requestId}</p>}
      </div>
      <div className="recovery-actions"><button className="button button-primary" onClick={() => { void store.refreshUser() }}>Try again</button></div>
    </section>
  </main>
  if (state.status === 'unauthenticated') return <Login onLogin={store.login} />
  return children(state.user)
}
