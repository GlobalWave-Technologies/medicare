import { describe, expect, it } from 'vitest'
import { ACTIVE_NOW_MS, RECENT_MS, presence } from '../src/modules/staff-activity/activity.service.js'
import { activityCategories, activityLabels, actionsIn, shownActions, staffSubjectActions } from '../src/modules/staff-activity/activity.labels.js'
import { activityQuerySchema, sessionParamsSchema } from '../src/modules/staff-activity/activity.validation.js'
import { ACTIVITY_WRITE_INTERVAL_MS } from '../src/modules/auth/session.service.js'

const now = new Date('2026-11-12T10:00:00.000Z'), ago = (ms: number) => new Date(now.getTime() - ms)
describe('presence', () => {
  it('uses 5 and 30 minute thresholds, inclusive, and writes activity at most once a minute', () => {
    expect([ACTIVE_NOW_MS, RECENT_MS, ACTIVITY_WRITE_INTERVAL_MS]).toEqual([300000, 1800000, 60000])
    expect([presence(ago(0), now), presence(ago(ACTIVE_NOW_MS), now), presence(ago(ACTIVE_NOW_MS + 1), now),
      presence(ago(RECENT_MS), now), presence(ago(RECENT_MS + 1), now)]).toEqual(['ACTIVE_NOW', 'ACTIVE_NOW', 'RECENTLY_ACTIVE', 'RECENTLY_ACTIVE', 'IDLE'])
  })
})
describe('activity labels', () => {
  it('puts every listed action in exactly one of six categories', () => {
    expect(activityCategories).toEqual(['authentication', 'patients', 'admissions', 'clinical', 'staff', 'catalog'])
    const all = activityCategories.flatMap((category) => actionsIn(category))
    expect(all.sort()).toEqual([...shownActions].sort()); expect(actionsIn('all')).toEqual(shownActions)
  })
  it('never lists record views, failed sign-ins, appointments or bootstrap', () => {
    expect(shownActions.filter((action) => /VIEWED|LOGIN_FAILED|APPOINTMENT|BOOTSTRAP|NOTIFICATION_SENT/.test(action))).toEqual([])
  })
  it('names a person only for actions on staff accounts, and words self sign-out differently', () => {
    for (const action of shownActions) {
      const named = activityLabels[action].text('Synthetic Person', false).includes('Synthetic Person')
      expect([action, named]).toEqual([action, staffSubjectActions.includes(action) && action !== 'SESSION_REVOKED' ? true : action === 'SESSION_REVOKED'])
    }
    expect(activityLabels.SESSION_REVOKED.text(null, true)).toBe('Signed out on all devices')
    expect(activityLabels.PASSWORD_RESET.text(null, false)).toBe('Reset a staff member’s password')
  })
  it('describes clinical work without any detail', () => {
    for (const action of actionsIn('clinical')) expect(activityLabels[action].text(null, false)).toMatch(/^(Created|Updated|Finalized|Added) (a|an) (draft clinical record|clinical record|amendment to a clinical record)$/)
  })
})
describe('query validation', () => {
  it('defaults to today, all categories, 25 per page, and caps a page at 50', () => {
    expect(activityQuerySchema.parse({})).toEqual({ page: 1, limit: 25, period: 'today', category: 'all' })
    expect(activityQuerySchema.safeParse({ limit: '50' }).success).toBe(true)
    expect(activityQuerySchema.safeParse({ limit: '51' }).success).toBe(false)
  })
  it.each([{ actorId: 'x' }, { action: 'LOGIN_FAILED' }, { search: 'a\u0000b' }, { category: 'VIEWS' }, { period: 'all' }, { role: 'admin' }])('rejects %j', (query) => {
    expect(activityQuerySchema.safeParse(query).success).toBe(false)
  })
  it('requires real identifiers for a session to end', () => {
    expect(sessionParamsSchema.safeParse({ id: 'x', sessionId: 'y' }).success).toBe(false)
  })
})
