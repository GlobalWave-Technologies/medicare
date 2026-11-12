import { ApiError, isRecord, mutation, request } from './client'
import type { BackendRole } from './auth'
import type { StaffStatus } from './staff'

export type Presence = 'ACTIVE_NOW' | 'RECENTLY_ACTIVE' | 'IDLE'
export type ActivityCategory = 'authentication' | 'patients' | 'admissions' | 'clinical' | 'staff' | 'catalog'
export type ActivityPeriod = 'today' | 'last7' | 'last30'
export type StaffRef = { id: string; staffNumber: string; firstName: string; lastName: string; role: BackendRole }
export type ActiveStaffRow = { staff: StaffRef; signedInAt: string; lastActivityAt: string; status: Presence; sessions: number }
export type ActiveStaff = {
  generatedAt: string; thresholds: { activeNowMinutes: number; recentMinutes: number }
  summary: { activeNow: number; signedIn: number; signedInToday: number }; staff: ActiveStaffRow[]
}
export type ActivityItem = { id: string; occurredAt: string; event: string; category: ActivityCategory; text: string; actor: StaffRef; subject: StaffRef | null }
export type Pagination = { page: number; limit: number; total: number; totalPages: number }
export type ActivityPage = { generatedAt: string; items: ActivityItem[]; pagination: Pagination }
export type StaffSessionRow = { id: string; signedInAt: string; lastActivityAt: string; expiresAt: string; status: Presence; current: boolean }
export type StaffActivityDetail = {
  generatedAt: string
  staff: StaffRef & { status: StaffStatus; lastLoginAt: string | null; lastActivityAt: string | null }
  sessions: StaffSessionRow[]; activity: { items: ActivityItem[]; pagination: Pagination }
}
export type ActivityQuery = { page?: number; limit?: number; period?: ActivityPeriod; category?: ActivityCategory | 'all'; search?: string; role?: BackendRole }

export const presences: readonly Presence[] = ['ACTIVE_NOW', 'RECENTLY_ACTIVE', 'IDLE']
export const activityCategories: readonly ActivityCategory[] = ['authentication', 'patients', 'admissions', 'clinical', 'staff', 'catalog']
const roles: readonly BackendRole[] = ['ADMIN', 'RECORDS_OFFICER', 'DOCTOR_IN_CHARGE']
const statuses: readonly StaffStatus[] = ['PENDING', 'ACTIVE', 'SUSPENDED', 'DISABLED']
const invalid = () => new ApiError(502, 'The server returned an unexpected response.', 'INVALID_RESPONSE')
const record = (value: unknown) => { if (!isRecord(value)) throw invalid(); return value }
const text = (value: unknown) => { if (typeof value !== 'string' || !value) throw invalid(); return value }
const time = (value: unknown) => { if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw invalid(); return value }
const optionalTime = (value: unknown) => value === null ? null : time(value)
const count = (value: unknown) => { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw invalid(); return value }
const oneOf = <T extends string>(value: unknown, allowed: readonly T[]) => { if (!allowed.includes(value as T)) throw invalid(); return value as T }
const list = <T>(value: unknown, map: (item: unknown) => T) => { if (!Array.isArray(value)) throw invalid(); return value.map(map) }

// Each response is rebuilt from its documented fields only, so nothing else can reach the screen.
function staffRef(value: unknown): StaffRef {
  const data = record(value)
  return { id: text(data.id), staffNumber: text(data.staffNumber), firstName: text(data.firstName), lastName: text(data.lastName), role: oneOf(data.role, roles) }
}
function item(value: unknown): ActivityItem {
  const data = record(value)
  return { id: text(data.id), occurredAt: time(data.occurredAt), event: text(data.event), category: oneOf(data.category, activityCategories), text: text(data.text),
    actor: staffRef(data.actor), subject: data.subject === null ? null : staffRef(data.subject) }
}
function pagination(value: unknown): Pagination {
  const data = record(value), page = count(data.page), limit = count(data.limit), total = count(data.total)
  if (page < 1 || limit < 1 || limit > 50) throw invalid()
  return { page, limit, total, totalPages: Math.ceil(total / limit) }
}
function session(value: unknown): StaffSessionRow {
  const data = record(value)
  if (typeof data.current !== 'boolean') throw invalid()
  return { id: text(data.id), signedInAt: time(data.signedInAt), lastActivityAt: time(data.lastActivityAt), expiresAt: time(data.expiresAt), status: oneOf(data.status, presences), current: data.current }
}
// Automatic refreshes say so, and the server then does not count them as the administrator's activity.
const background = { 'X-Background-Refresh': '1' }
function eventParams(query: ActivityQuery) {
  const params = new URLSearchParams({ page: String(query.page ?? 1), limit: String(query.limit ?? 25), period: query.period ?? 'today', category: query.category ?? 'all' })
  if (query.search?.trim()) params.set('search', query.search.trim())
  if (query.role) params.set('role', query.role)
  return params
}

export const staffActivityApi = {
  async active(signal?: AbortSignal, automatic = false): Promise<ActiveStaff> {
    const data = record(await request<unknown>('/staff-activity/active', { signal, headers: automatic ? background : undefined }))
    const thresholds = record(data.thresholds), summary = record(data.summary)
    return { generatedAt: time(data.generatedAt), thresholds: { activeNowMinutes: count(thresholds.activeNowMinutes), recentMinutes: count(thresholds.recentMinutes) },
      summary: { activeNow: count(summary.activeNow), signedIn: count(summary.signedIn), signedInToday: count(summary.signedInToday) },
      staff: list(data.staff, (value) => { const row = record(value)
        return { staff: staffRef(row.staff), signedInAt: time(row.signedInAt), lastActivityAt: time(row.lastActivityAt), status: oneOf(row.status, presences), sessions: count(row.sessions) } }) }
  },
  async events(query: ActivityQuery, signal?: AbortSignal, automatic = false): Promise<ActivityPage> {
    const data = record(await request<unknown>(`/staff-activity/events?${eventParams(query)}`, { signal, headers: automatic ? background : undefined }))
    return { generatedAt: time(data.generatedAt), items: list(data.items, item), pagination: pagination(data.pagination) }
  },
  async staff(id: string, page = 1, signal?: AbortSignal): Promise<StaffActivityDetail> {
    const data = record(await request<unknown>(`/staff-activity/staff/${encodeURIComponent(id)}?page=${page}`, { signal }))
    const staff = record(data.staff), activity = record(data.activity)
    return { generatedAt: time(data.generatedAt),
      staff: { ...staffRef(staff), status: oneOf(staff.status, statuses), lastLoginAt: optionalTime(staff.lastLoginAt), lastActivityAt: optionalTime(staff.lastActivityAt) },
      sessions: list(data.sessions, session), activity: { items: list(activity.items, item), pagination: pagination(activity.pagination) } }
  },
  async revokeSession(staffId: string, sessionId: string) {
    const data = await mutation<unknown>(`/staff/${encodeURIComponent(staffId)}/sessions/${encodeURIComponent(sessionId)}/revoke`, { method: 'POST', body: '{}' })
    if (!isRecord(data) || data.revoked !== true) throw invalid()
    return { revoked: true as const }
  },
}
