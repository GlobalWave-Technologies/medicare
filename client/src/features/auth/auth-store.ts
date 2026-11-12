import { authApi, type StaffUser } from '../../api/auth'
import { ApiError, onPasswordChangeRequired, onSessionInvalidated } from '../../api/client'

export type AuthState =
  | { status: 'loading'; user: null }
  | { status: 'authenticated'; user: StaffUser }
  | { status: 'unauthenticated'; user: null; notice?: string }
  | { status: 'error'; user: null; error: unknown }

// Only the calls the store makes; the password change is made by its own dialog.
type AuthStoreApi = Pick<typeof authApi, 'me' | 'login' | 'csrf' | 'logout' | 'logoutAll'>
export const SESSION_ENDED = 'Your session has ended. Sign in again to continue.'
export function createAuthStore(api: AuthStoreApi = authApi) {
  let state: AuthState = { status: 'loading', user: null }
  let operation = 0
  let ending: Promise<void> | undefined
  const listeners = new Set<() => void>()
  const set = (next: AuthState) => { state = next; listeners.forEach((listener) => listener()) }
  const invalidate = () => { operation += 1; set({ status: 'unauthenticated', user: null }) }
  // A signed-in session that ended by itself (expired, or ended by an administrator) explains why
  // sign-in is showing; a deliberate sign-out or a first visit shows no notice.
  const unsubscribeSession = onSessionInvalidated(() => {
    const ended = state.status === 'authenticated' && !ending
    operation += 1
    set(ended ? { status: 'unauthenticated', user: null, notice: SESSION_ENDED } : { status: 'unauthenticated', user: null })
  })
  // A refused route means the account now needs a new password: re-read the identity, which
  // carries the flag, so the gate replaces the workspace with the change screen.
  let refresh: () => void = () => {}
  const unsubscribePassword = onPasswordChangeRequired(() => refresh())
  async function end(all: boolean) {
    if (ending) return ending
    const current = ++operation
    const pending = (async () => {
      try {
        await (all ? api.logoutAll() : api.logout())
        if (current === operation) invalidate()
      } catch (error) {
        if (current === operation && error instanceof ApiError && error.status === 401) invalidate()
        else if (!(error instanceof ApiError && error.status === 401)) throw error
      }
    })().finally(() => { if (ending === pending) ending = undefined })
    ending = pending
    return pending
  }
  const store = {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    async refreshUser(signal?: AbortSignal) {
      const current = ++operation
      set({ status: 'loading', user: null })
      try {
        const { user } = await api.me(signal)
        if (current === operation && !signal?.aborted) set({ status: 'authenticated', user })
      } catch (error) {
        if (current !== operation || signal?.aborted) return
        set(error instanceof ApiError && error.status === 401
          ? { status: 'unauthenticated', user: null } : { status: 'error', user: null, error })
      }
    },
    async login(email: string, password: string) {
      const current = ++operation
      const { user } = await api.login(email, password)
      if (current === operation) set({ status: 'authenticated', user })
    },
    // The server has already signed out every session; show sign-in with a confirmation.
    passwordChanged(required = false) {
      operation += 1
      set({ status: 'unauthenticated', user: null, notice: required ? 'Password changed successfully. Sign in again with your new password.'
        : 'Your password was changed and you were signed out everywhere. Sign in with your new password.' })
    },
    logout: () => end(false),
    logoutAll: () => end(true),
    dispose: () => { unsubscribeSession(); unsubscribePassword() },
  }
  refresh = () => { if (state.status === 'authenticated' && !state.user.mustChangePassword) void store.refreshUser() }
  return store
}

export const authStore = createAuthStore()
