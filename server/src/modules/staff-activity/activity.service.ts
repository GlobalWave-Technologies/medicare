import type { Prisma, PrismaClient } from '../../generated/prisma/client.js'
import { AppError } from '../../shared/errors/AppError.js'
import { DAY_MS } from '../reports/report.validation.js'
import { activityLabels, actionsIn, shownActions, staffSubjectActions, type ActivityAction } from './activity.labels.js'
import type { ActivityPeriod, ActivityQuery } from './activity.validation.js'

// "Active now": the person made a request within the last 5 minutes. "Recently active": within the
// last 30 minutes. "Idle": still signed in, but nothing for longer. Activity is written at most once
// a minute, so these are accurate to about a minute. A session only says someone is signed in; it is
// never taken to mean they are at the screen.
export const ACTIVE_NOW_MS = 5 * 60 * 1000
export const RECENT_MS = 30 * 60 * 1000
export type PresenceStatus = 'ACTIVE_NOW' | 'RECENTLY_ACTIVE' | 'IDLE'
export function presence(lastActivityAt: Date, now: Date): PresenceStatus {
  const idle = now.getTime() - lastActivityAt.getTime()
  return idle <= ACTIVE_NOW_MS ? 'ACTIVE_NOW' : idle <= RECENT_MS ? 'RECENTLY_ACTIVE' : 'IDLE'
}
const rank: Record<PresenceStatus, number> = { ACTIVE_NOW: 0, RECENTLY_ACTIVE: 1, IDLE: 2 }

// The only staff fields any activity response carries.
const staffRef = { id: true, staffNumber: true, firstName: true, lastName: true, role: true } satisfies Prisma.StaffUserSelect
type StaffRef = Prisma.StaffUserGetPayload<{ select: typeof staffRef }>
const fullName = (staff: Pick<StaffRef, 'firstName' | 'lastName'>) => `${staff.firstName} ${staff.lastName}`
const iso = (value: Date) => value.toISOString()
const midnight = (now: Date) => { const day = new Date(now); day.setUTCHours(0, 0, 0, 0); return day }
// Valid sessions only: not signed out, not expired, and the account still active.
const validSessions = (now: Date) => ({ revokedAt: null, expiresAt: { gt: now }, staffUser: { status: 'ACTIVE' as const } })
const sessionFields = { id: true, staffUserId: true, createdAt: true, lastActivityAt: true, expiresAt: true } satisfies Prisma.StaffSessionSelect

// Who is signed in now, one row per person, with how recently they used the system.
export async function activeStaff(db: PrismaClient, now = new Date()) {
  const [sessions, signedInToday] = await Promise.all([
    db.staffSession.findMany({ where: validSessions(now), select: { ...sessionFields, staffUser: { select: staffRef } }, orderBy: [{ lastActivityAt: 'desc' }, { id: 'asc' }], take: 1000 }),
    db.auditEvent.groupBy({ by: ['actorId'], where: { action: 'LOGIN_SUCCEEDED', createdAt: { gte: midnight(now) }, actorId: { not: null } } }),
  ])
  const people = new Map<string, { staff: StaffRef; signedInAt: Date; lastActivityAt: Date; sessions: number }>()
  for (const session of sessions) {
    const entry = people.get(session.staffUserId)
    if (!entry) people.set(session.staffUserId, { staff: session.staffUser, signedInAt: session.createdAt, lastActivityAt: session.lastActivityAt, sessions: 1 })
    else {
      entry.sessions += 1
      if (session.createdAt > entry.signedInAt) entry.signedInAt = session.createdAt
      if (session.lastActivityAt > entry.lastActivityAt) entry.lastActivityAt = session.lastActivityAt
    }
  }
  const staff = [...people.values()].map((entry) => ({ staff: entry.staff, signedInAt: iso(entry.signedInAt), lastActivityAt: iso(entry.lastActivityAt),
    status: presence(entry.lastActivityAt, now), sessions: entry.sessions }))
    .sort((a, b) => rank[a.status] - rank[b.status] || b.lastActivityAt.localeCompare(a.lastActivityAt))
  return {
    generatedAt: iso(now), thresholds: { activeNowMinutes: ACTIVE_NOW_MS / 60000, recentMinutes: RECENT_MS / 60000 },
    summary: { activeNow: staff.filter((row) => row.status === 'ACTIVE_NOW').length, signedIn: staff.length, signedInToday: signedInToday.length },
    staff,
  }
}

// Counts for the administrator's Overview card.
export async function staffPresenceCounts(db: Prisma.TransactionClient, now = new Date()) {
  const [active, today] = await Promise.all([
    db.staffSession.groupBy({ by: ['staffUserId'], where: { ...validSessions(now), lastActivityAt: { gte: new Date(now.getTime() - ACTIVE_NOW_MS) } } }),
    db.auditEvent.groupBy({ by: ['actorId'], where: { action: 'LOGIN_SUCCEEDED', createdAt: { gte: midnight(now) }, actorId: { not: null } } }),
  ])
  return { staffActiveNow: active.length, staffSignedInToday: today.length }
}

function periodStart(period: ActivityPeriod, now: Date) {
  const today = midnight(now)
  return period === 'today' ? today : new Date(today.getTime() - (period === 'last7' ? 6 : 29) * DAY_MS)
}
// Only identifiers needed to build the sentence are read: never metadata, addresses or browsers.
const eventSelect = { id: true, action: true, createdAt: true, actorId: true, entityType: true, entityId: true, actor: { select: staffRef } } satisfies Prisma.AuditEventSelect
type EventRow = Prisma.AuditEventGetPayload<{ select: typeof eventSelect }>
async function describe(db: PrismaClient, rows: EventRow[]) {
  const subjectIds = [...new Set(rows.filter((row) => row.entityType === 'STAFF_USER' && staffSubjectActions.includes(row.action as ActivityAction)).map((row) => row.entityId))]
  const subjects = new Map((subjectIds.length ? await db.staffUser.findMany({ where: { id: { in: subjectIds } }, select: staffRef }) : []).map((staff) => [staff.id, staff]))
  return rows.map((row) => {
    const action = row.action as ActivityAction, label = activityLabels[action]
    const target = staffSubjectActions.includes(action) ? subjects.get(row.entityId) ?? null : null
    const self = row.actorId !== null && row.actorId === row.entityId
    return { id: row.id, occurredAt: iso(row.createdAt), event: action, category: label.category,
      text: label.text(target ? fullName(target) : null, self), actor: row.actor, subject: target && !self ? target : null }
  })
}
// Wildcard characters are escaped, so a search is always literal text.
const escapeLike = (value: string) => value.replace(/[\\%_]/g, '\\$&')
function staffSearch(search: string | undefined): Prisma.StaffUserWhereInput | undefined {
  const words = search?.split(/\s+/).filter(Boolean).slice(0, 5) ?? []
  if (!words.length) return undefined
  return { AND: words.map((word) => {
    const contains = { contains: escapeLike(word), mode: 'insensitive' as const }
    return { OR: [{ firstName: contains }, { lastName: contains }, { staffNumber: contains }] }
  }) }
}

// The recent activity list: safe sentences, newest first, a page at a time.
export async function activityEvents(db: PrismaClient, query: ActivityQuery, now = new Date()) {
  const actor = { ...staffSearch(query.search), ...(query.role ? { role: query.role } : {}) }
  const where: Prisma.AuditEventWhereInput = {
    action: { in: actionsIn(query.category) }, createdAt: { gte: periodStart(query.period, now), lte: now }, actorId: { not: null },
    ...(Object.keys(actor).length ? { actor: { is: actor } } : {}),
  }
  const [rows, total] = await Promise.all([
    db.auditEvent.findMany({ where, select: eventSelect, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * query.limit, take: query.limit }),
    db.auditEvent.count({ where }),
  ])
  return { generatedAt: iso(now), range: { from: iso(periodStart(query.period, now)), to: iso(now), timezone: 'UTC' as const },
    items: await describe(db, rows), pagination: { page: query.page, limit: query.limit, total } }
}

// One staff member: account facts, every current session, and what they did or had done to their account.
export async function staffActivity(db: PrismaClient, id: string, query: { page: number; limit: number }, currentSessionId: string, now = new Date()) {
  const staff = await db.staffUser.findUnique({ where: { id }, select: { ...staffRef, status: true, lastLoginAt: true, lastActivityAt: true } })
  if (!staff) throw new AppError(404, 'STAFF_NOT_FOUND', 'Staff account not found')
  const where: Prisma.AuditEventWhereInput = { action: { in: shownActions }, createdAt: { lte: now },
    OR: [{ actorId: id }, { entityType: 'STAFF_USER', entityId: id, action: { in: [...staffSubjectActions] } }] }
  const [sessions, rows, total] = await Promise.all([
    db.staffSession.findMany({ where: { ...validSessions(now), staffUserId: id }, select: sessionFields, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 50 }),
    db.auditEvent.findMany({ where, select: eventSelect, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * query.limit, take: query.limit }),
    db.auditEvent.count({ where }),
  ])
  return {
    generatedAt: iso(now),
    staff: { id: staff.id, staffNumber: staff.staffNumber, firstName: staff.firstName, lastName: staff.lastName, role: staff.role, status: staff.status,
      lastLoginAt: staff.lastLoginAt ? iso(staff.lastLoginAt) : null, lastActivityAt: staff.lastActivityAt ? iso(staff.lastActivityAt) : null },
    sessions: sessions.map((session) => ({ id: session.id, signedInAt: iso(session.createdAt), lastActivityAt: iso(session.lastActivityAt), expiresAt: iso(session.expiresAt),
      status: presence(session.lastActivityAt, now), current: session.id === currentSessionId })),
    activity: { items: await describe(db, rows), pagination: { page: query.page, limit: query.limit, total } },
  }
}
