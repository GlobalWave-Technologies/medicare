import { ApiError, isRecord, mutation, request } from './client'
import type { BackendRole } from './auth'

export type StaffStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'DISABLED'
export type StaffMember = {
  id: string; staffNumber: string; firstName: string; lastName: string; email: string
  role: BackendRole; status: StaffStatus
}
export type StaffPagination = { page: number; limit: number; total: number; totalPages: number }
export type StaffPage = { users: StaffMember[]; pagination: StaffPagination }
export type StaffQuery = { page?: number; limit?: number; role?: BackendRole; status?: StaffStatus }
export type CreateStaffInput = {
  firstName: string; lastName: string; email: string; staffNumber: string; role: BackendRole; password: string
}
type StaffResult = { user: StaffMember }

export const staffRoles: readonly BackendRole[] = ['ADMIN', 'RECORDS_OFFICER', 'DOCTOR_IN_CHARGE']
export const staffStatuses: readonly StaffStatus[] = ['PENDING', 'ACTIVE', 'SUSPENDED', 'DISABLED']
const invalid = () => new ApiError(502, 'The server returned an unexpected response.', 'INVALID_RESPONSE')
const path = (id: string) => `/staff/${encodeURIComponent(id)}`
const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

// Keep only the documented safe fields, so nothing else returned can reach the UI.
function member(value: unknown): StaffMember {
  if (!isRecord(value)) throw invalid()
  const { id, staffNumber, firstName, lastName, email, role, status } = value
  if (typeof id !== 'string' || typeof staffNumber !== 'string' || typeof firstName !== 'string'
    || typeof lastName !== 'string' || typeof email !== 'string'
    || !staffRoles.includes(role as BackendRole) || !staffStatuses.includes(status as StaffStatus)) throw invalid()
  return { id, staffNumber, firstName, lastName, email, role: role as BackendRole, status: status as StaffStatus }
}
function result(data: unknown): StaffResult {
  if (!isRecord(data)) throw invalid()
  return { user: member(data.user) }
}
function staffPage(data: unknown): StaffPage {
  const pagination = isRecord(data) && isRecord(data.pagination) ? data.pagination : {}
  if (!isRecord(data) || !Array.isArray(data.users) || !count(pagination.page) || !count(pagination.limit)
    || !count(pagination.total) || Number(pagination.limit) < 1) throw invalid()
  const page = Number(pagination.page), limit = Number(pagination.limit), total = Number(pagination.total)
  return { users: data.users.map(member), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } }
}
// The request body is rebuilt from the six accepted fields; the password is sent exactly as typed.
function creation(input: CreateStaffInput) {
  return {
    firstName: input.firstName.trim(), lastName: input.lastName.trim(), email: input.email.trim(),
    staffNumber: input.staffNumber.trim().toUpperCase(), role: input.role, password: input.password,
  }
}

export const staffApi = {
  async list(query: StaffQuery = {}, signal?: AbortSignal) {
    const params = new URLSearchParams({ page: String(query.page ?? 1), limit: String(query.limit ?? 20) })
    if (query.role) params.set('role', query.role)
    if (query.status) params.set('status', query.status)
    return staffPage(await request<unknown>(`/staff?${params}`, { signal }))
  },
  get: async (id: string, signal?: AbortSignal) => result(await request<unknown>(path(id), { signal })),
  create: async (input: CreateStaffInput) => result(await mutation<unknown>('/staff', { method: 'POST', body: JSON.stringify(creation(input)) })),
  changeRole: async (id: string, role: BackendRole) => result(await mutation<unknown>(`${path(id)}/role`, { method: 'PATCH', body: JSON.stringify({ role }) })),
  changeStatus: async (id: string, status: StaffStatus) => result(await mutation<unknown>(`${path(id)}/status`, { method: 'PATCH', body: JSON.stringify({ status }) })),
  async revokeSessions(id: string) {
    const data = await mutation<unknown>(`${path(id)}/sessions`, { method: 'DELETE' })
    if (!isRecord(data) || data.revoked !== true) throw invalid()
    return { revoked: true as const }
  },
}
