import { authApi, type StaffUser } from '../../api/auth'
import { ApiError, onSessionInvalidated } from '../../api/client'

export type AuthState =
  | { status: 'loading'; user: null }
  | { status: 'authenticated'; user: StaffUser }
  | { status: 'unauthenticated'; user: null; notice?: string }
  | { status: 'error'; user: null; error: unknown }

// Only the calls the store makes; the password change is made by its own dialog.
type AuthStoreApi = Pick<typeof authApi, 'me' | 'login' | 'csrf' | 'logout' | 'logoutAll'>
export function createAuthStore(api: AuthStoreApi = authApi) {
  let state: AuthState = { status: 'loading', user: null }
  let operation = 0
  let ending: Promise<void> | undefined
  const listeners = new Set<() => void>()
  const set = (next: AuthState) => { state = next; listeners.forEach((listener) => listener()) }
  const invalidate = () => { operation += 1; set({ status: 'unauthenticated', user: null }) }
  const unsubscribe = onSessionInvalidated(invalidate)
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
  return {
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
    passwordChanged() { operation += 1; set({ status: 'unauthenticated', user: null, notice: 'Your password was changed and you were signed out everywhere. Sign in with your new password.' }) },
    logout: () => end(false),
    logoutAll: () => end(true),
    dispose: unsubscribe,
  }
}

export const authStore = createAuthStore()
