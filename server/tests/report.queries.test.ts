import { describe, expect, it, vi } from 'vitest'
import type { Prisma } from '../src/generated/prisma/client.js'
import { patientActivity, patientSnapshot, appointmentActivity, clinicalActivity, ownUnreadNotifications, upcomingAppointments } from '../src/modules/reports/report.queries.js'
import { resolveReportRange } from '../src/modules/reports/report.validation.js'

const range = resolveReportRange({ from: '2024-02-28T00:00:00Z', to: '2024-03-02T00:00:00Z' }, false)
const author = '00000000-0000-4000-8000-000000000001'
function database() {
  // Deliberately provides only aggregate methods; findMany/full-record reads fail.
  const raw = vi.fn<(query: TemplateStringsArray | Prisma.Sql, ...values: unknown[]) => Promise<unknown[]>>().mockResolvedValue([])
  const count = vi.fn().mockResolvedValue(0)
  const db = { $queryRaw: raw, encounter: { count }, appointment: { count }, notificationRecipient: { count } } as unknown as Prisma.TransactionClient
  return { db, raw, count }
}
describe('bounded database aggregation and parameter binding', () => {
  it.each(['patients', 'appointments', 'clinical'] as const)('%s uses one bounded aggregate query without full-record reads', async (kind) => {
    const { db, raw, count } = database()
    const result = kind === 'patients' ? await patientActivity(db, range) : kind === 'appointments' ? await appointmentActivity(db, range, author) : await clinicalActivity(db, range, author)
    expect(raw).toHaveBeenCalledTimes(1)
    expect(count).toHaveBeenCalledTimes(kind === 'clinical' ? 1 : 0)
    expect(result.series).toHaveLength(3)
    for (const row of result.series) expect(Object.entries(row).filter(([key]) => key !== 'period').every(([, value]) => value === 0)).toBe(true)
    const [query, ...args] = raw.mock.calls[0]!
    const isSql = 'values' in query && !Array.isArray(query)
    const strings = isSql ? (query as Prisma.Sql).strings : query as TemplateStringsArray
    const values = isSql ? (query as Prisma.Sql).values : args
    const sql = strings.join('?')
    expect(sql).toMatch(/count\(\*\)/)
    expect(sql).toContain("AT TIME ZONE 'UTC'")
    expect(sql).toContain('::timestamptz')
    expect(sql).not.toMatch(/SELECT\s+\*|LIMIT|OFFSET|2024-02-28|00000000-0000/)
    expect(values).toContain(range.from.toISOString())
    expect(values).toContain(range.to.toISOString())
    expect(values).toContain('day')
    if (kind !== 'patients') expect(values).toContain(author)
  })
  it('converts empty current patient snapshots to finite numeric zeros', async () => {
    const { db, raw } = database()
    raw.mockResolvedValueOnce([{ active: 0n, archived: 0n }])
    expect(await patientSnapshot(db)).toEqual({ activePatients: 0, archivedPatients: 0 })
  })
  it('uses a database count constrained to the current unread inbox', async () => {
    const { db, count } = database()
    expect(await ownUnreadNotifications(db, author)).toBe(0)
    expect(count).toHaveBeenCalledExactlyOnceWith({ where: { staffUserId: author, readAt: null } })
  })
  it('counts upcoming appointments with fixed status and principal predicates', async () => {
    const { db, count } = database(), now = new Date()
    expect(await upcomingAppointments(db, now, author)).toBe(0)
    expect(count).toHaveBeenCalledExactlyOnceWith({ where: { clinicianId: author, scheduledStart: { gte: now }, status: { in: ['SCHEDULED', 'CONFIRMED'] } } })
  })
})
