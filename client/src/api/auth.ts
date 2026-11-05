import { ApiError, csrfToken, isRecord, mutation, request, resetApiSession } from './client'

export type BackendRole = 'ADMIN' | 'RECORDS_OFFICER' | 'DOCTOR_IN_CHARGE'
export type StaffUser = {
  id: string; staffNumber: string; firstName: string; lastName: string; email: string
  role: BackendRole; status: 'ACTIVE'
}
function userResult(data: unknown): { user: StaffUser } {
  const user = isRecord(data) && isRecord(data.user) ? data.user : {}
  if (typeof user.id !== 'string' || typeof user.staffNumber !== 'string'
    || typeof user.firstName !== 'string' || typeof user.lastName !== 'string' || typeof user.email !== 'string'
    || !['ADMIN', 'RECORDS_OFFICER', 'DOCTOR_IN_CHARGE'].includes(String(user.role)) || user.status !== 'ACTIVE') {
    throw new ApiError(502, 'The server returned an invalid staff identity.', 'INVALID_RESPONSE')
  }
  return { user: { id: user.id, staffNumber: user.staffNumber, firstName: user.firstName,
    lastName: user.lastName, email: user.email, role: user.role as BackendRole, status: 'ACTIVE' } }
}
async function endSession(path: string) {
  const result = await mutation<{ loggedOut: boolean }>(path, { method: 'POST' })
  if (result?.loggedOut !== true) throw new ApiError(502, 'Unexpected logout response.', 'INVALID_RESPONSE')
  resetApiSession()
  return result
}
export const authApi = {
  async login(email: string, password: string) {
    resetApiSession()
    return userResult(await request<unknown>('/auth/login', {
      method: 'POST', body: JSON.stringify({ email: email.trim(), password }),
    }, false))
  },
  async me(signal?: AbortSignal) { return userResult(await request<unknown>('/auth/me', { signal })) },
  async csrf() { return { csrfToken: await csrfToken() } },
  // Sends the current and new passwords only (never the confirmation). The server signs out every
  // session, including this one, so the browser session is reset as soon as it succeeds.
  async changePassword(currentPassword: string, newPassword: string) {
    const result = await mutation<{ passwordChanged: boolean }>('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) })
    if (result?.passwordChanged !== true) throw new ApiError(502, 'Unexpected password change response.', 'INVALID_RESPONSE')
    resetApiSession()
    return result
  },
  logout: () => endSession('/auth/logout'),
  logoutAll: () => endSession('/auth/logout-all'),
}
