// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '../src/api/client'
import { staffApi } from '../src/api/staff'
import { staffActivityApi, type ActiveStaff, type ActivityItem, type ActivityPage, type StaffActivityDetail } from '../src/api/staffActivity'
import { StaffActivity } from '../src/features/staff-activity/StaffActivity'

const now = '2026-11-12T10:00:00.000Z', at = (minutes: number) => new Date(Date.parse(now) - minutes * 60000).toISOString()
const person = (id: string, lastName: string, role: 'ADMIN' | 'RECORDS_OFFICER' | 'DOCTOR_IN_CHARGE', staffNumber: string) => ({ id, firstName: 'Synthetic', lastName, role, staffNumber })
const ama = person('s1', 'Mensah', 'DOCTOR_IN_CHARGE', 'STF-MO0001'), kofi = person('s2', 'Asante', 'RECORDS_OFFICER', 'STF-RO0001'), esi = person('s3', 'Quaye', 'DOCTOR_IN_CHARGE', 'STF-MO0002')
const active: ActiveStaff = { generatedAt: now, thresholds: { activeNowMinutes: 5, recentMinutes: 30 }, summary: { activeNow: 1, signedIn: 3, signedInToday: 4 }, staff: [
  { staff: ama, signedInAt: at(120), lastActivityAt: at(2), status: 'ACTIVE_NOW', sessions: 2 },
  { staff: kofi, signedInAt: at(200), lastActivityAt: at(12), status: 'RECENTLY_ACTIVE', sessions: 1 },
  { staff: esi, signedInAt: at(300), lastActivityAt: at(90), status: 'IDLE', sessions: 1 },
] }
const event = (id: string, actor: typeof ama, text: string, category: ActivityItem['category'], minutes: number): ActivityItem => ({ id, occurredAt: at(minutes), event: 'X', category, text, actor, subject: null })
const page = (items: ActivityItem[], total = items.length): ActivityPage => ({ generatedAt: now, items, pagination: { page: 1, limit: 25, total, totalPages: Math.ceil(total / 25) } })
const events = page([event('e1', ama, 'Finalized a clinical record', 'clinical', 3), event('e2', kofi, 'Admitted a patient', 'admissions', 15), event('e3', ama, 'Signed in', 'authentication', 120)], 60)
const detail: StaffActivityDetail = { generatedAt: now, staff: { ...ama, status: 'ACTIVE', lastLoginAt: at(120), lastActivityAt: at(2) },
  sessions: [{ id: 'sess-1', signedInAt: at(120), lastActivityAt: at(2), expiresAt: at(-360), status: 'ACTIVE_NOW', current: false },
    { id: 'sess-2', signedInAt: at(30), lastActivityAt: at(20), expiresAt: at(-450), status: 'RECENTLY_ACTIVE', current: false }],
  activity: { items: [event('e1', ama, 'Finalized a clinical record', 'clinical', 3)], pagination: { page: 1, limit: 20, total: 1, totalPages: 1 } } }

let host: HTMLDivElement, root: Root, ended: ReturnType<typeof vi.fn<() => void>>, visibility: DocumentVisibilityState
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(now)); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  visibility = 'visible'; vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host); ended = vi.fn()
  vi.spyOn(staffActivityApi, 'active').mockResolvedValue(active)
  vi.spyOn(staffActivityApi, 'events').mockResolvedValue(events)
  vi.spyOn(staffActivityApi, 'staff').mockResolvedValue(detail)
  vi.spyOn(staffActivityApi, 'revokeSession').mockResolvedValue({ revoked: true })
  vi.spyOn(staffApi, 'revokeSessions').mockResolvedValue({ revoked: true })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
const tick = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
const render = async (initialStaffId?: string) => { await act(async () => root.render(<StaffActivity initialStaffId={initialStaffId} onSessionEnded={ended} />)); await tick() }
const button = (text: string) => Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((item) => item.textContent?.trim() === text)
const click = async (text: string) => { await act(async () => button(text)!.click()); await tick() }
const rows = () => Array.from(host.querySelectorAll('.activity-table tbody tr')).map((row) => Array.from(row.querySelectorAll('td')).slice(0, 6).map((cell) => cell.textContent?.replace(/\s*\(.*\)$/, '')))
async function type(element: HTMLInputElement | HTMLSelectElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value')!.set!
    setter.call(element, value); element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
}

it('shows stable placeholders while loading', async () => {
  vi.mocked(staffActivityApi.active).mockReturnValue(new Promise(() => {})); vi.mocked(staffActivityApi.events).mockReturnValue(new Promise(() => {}))
  await render()
  expect(host.querySelectorAll('.recent-skeleton')).toHaveLength(2); expect(host.querySelector('.dashboard-updated')?.textContent).toBe('Loading staff activity…')
  expect(host.querySelector('[aria-labelledby="active-staff-title"]')?.getAttribute('aria-busy')).toBe('true')
})
it('lists signed-in staff with status in words, sessions and the thresholds explained', async () => {
  await render()
  expect(rows()).toEqual([
    ['Synthetic MensahSTF-MO0001', 'Medical Officer', expect.stringMatching(/^Today, /), '2 min ago', 'Active now', '2'],
    ['Synthetic AsanteSTF-RO0001', 'Records Officer', expect.stringMatching(/^Today, /), '12 min ago', 'Recently active', '1'],
    ['Synthetic QuayeSTF-MO0002', 'Medical Officer', expect.stringMatching(/^Today, /), expect.stringMatching(/^Today, /), 'Idle', '1'],
  ])
  expect(host.querySelector('.activity-head p')?.textContent).toBe('1 active now · 3 signed in · 4 signed in today')
  expect(host.textContent).toContain('Being signed in does not mean someone is at the screen.')
  // Relative times also carry the exact time for assistive technology.
  expect(host.querySelector('.activity-table time .visually-hidden')?.textContent).toMatch(/^ \(.+\)$/)
})
it('lists recent actions in plain words with who, role and when, and pages through them', async () => {
  await render()
  const items = Array.from(host.querySelectorAll('.activity-list li')).map((item) => [item.querySelector('.activity-who strong')?.textContent, item.querySelector('.activity-what')?.textContent, item.querySelector('.activity-category')?.textContent])
  expect(items).toEqual([['Synthetic Mensah', 'Finalized a clinical record', 'Clinical records'], ['Synthetic Asante', 'Admitted a patient', 'Admissions'], ['Synthetic Mensah', 'Signed in', 'Sign-in and sign-out']])
  expect(vi.mocked(staffActivityApi.events).mock.calls[0]![0]).toEqual({ page: 1, period: 'today', category: 'all', search: '', role: undefined })
  await click('Next'); expect(vi.mocked(staffActivityApi.events).mock.calls.at(-1)![0]).toMatchObject({ page: 2 })
})
it('filters by period, kind of activity, staff name or number and role', async () => {
  await render()
  await click('Last 7 days'); expect(vi.mocked(staffActivityApi.events).mock.calls.at(-1)![0]).toMatchObject({ period: 'last7', page: 1 })
  await type(host.querySelector<HTMLSelectElement>('select[name="activityCategory"]')!, 'clinical'); await tick()
  expect(vi.mocked(staffActivityApi.events).mock.calls.at(-1)![0]).toMatchObject({ category: 'clinical' })
  await type(host.querySelector<HTMLInputElement>('input[aria-label="Search staff by name or staff number"]')!, 'mensah'); await tick(300)
  expect(vi.mocked(staffActivityApi.events).mock.calls.at(-1)![0]).toMatchObject({ search: 'mensah' })
  expect(rows().map((row) => row[0])).toEqual(['Synthetic MensahSTF-MO0001'])
  await type(host.querySelector<HTMLInputElement>('input[aria-label="Search staff by name or staff number"]')!, 'ro0001'); await tick(300)
  expect(rows().map((row) => row[0])).toEqual(['Synthetic AsanteSTF-RO0001'])
  await click('Clear filters')
  await type(host.querySelector<HTMLSelectElement>('select[name="activityRole"]')!, 'DOCTOR_IN_CHARGE'); await tick(300)
  expect(rows().map((row) => row[1])).toEqual(['Medical Officer', 'Medical Officer'])
  expect(vi.mocked(staffActivityApi.events).mock.calls.at(-1)![0]).toMatchObject({ role: 'DOCTOR_IN_CHARGE' })
})
it('explains empty results without a broken table', async () => {
  vi.mocked(staffActivityApi.active).mockResolvedValue({ ...active, summary: { activeNow: 0, signedIn: 0, signedInToday: 0 }, staff: [] })
  vi.mocked(staffActivityApi.events).mockResolvedValue(page([]))
  await render()
  expect(host.querySelector('.activity-table')).toBeNull()
  expect(Array.from(host.querySelectorAll('.activity-empty')).map((item) => item.textContent)).toEqual(['No staff are signed in right now.', 'No staff activity recorded for this period.'])
})
it('shows a safe error with a retry, and recovers', async () => {
  vi.mocked(staffActivityApi.active).mockRejectedValueOnce(new ApiError(500, 'relation "StaffSession" does not exist', 'INTERNAL_ERROR', 'req-1'))
  await render()
  expect(host.querySelector('.report-error')?.textContent).toMatch(/couldn’t be loaded\. Try again\.Support reference: req-1$/); expect(host.textContent).not.toContain('relation')
  await click('Try again'); expect(rows()).toHaveLength(3)
})
it('refreshes every minute while visible, marking those reads as automatic; Refresh is not automatic', async () => {
  await render(); expect(vi.mocked(staffActivityApi.active).mock.calls[0]![1]).toBe(false)
  await tick(60000)
  expect(vi.mocked(staffActivityApi.active).mock.calls.at(-1)![1]).toBe(true); expect(vi.mocked(staffActivityApi.events).mock.calls.at(-1)![2]).toBe(true)
  visibility = 'hidden'; const calls = vi.mocked(staffActivityApi.active).mock.calls.length; await tick(5 * 60000)
  expect(vi.mocked(staffActivityApi.active).mock.calls.length).toBe(calls)
  visibility = 'visible'; await click('Refresh'); expect(vi.mocked(staffActivityApi.active).mock.calls.at(-1)![1]).toBe(false)
})
it('opens one person’s activity, with last sign-in, last activity and every current session', async () => {
  await render()
  await act(async () => host.querySelector<HTMLButtonElement>('.activity-row-action button')!.click()); await tick()
  expect(staffActivityApi.staff).toHaveBeenCalledWith('s1', 1, expect.any(AbortSignal))
  expect(host.querySelector('#activity-detail-title')?.textContent).toBe('Synthetic Mensah'); expect(host.querySelector('.detail-title .status')?.textContent).toBe('Active now')
  const facts = Array.from(host.querySelectorAll('.activity-facts dt')).map((item) => item.textContent)
  expect(facts).toEqual(['Last signed in', 'Last active', 'Signed in now'])
  expect(host.querySelector('.activity-facts')?.textContent).toContain('On 2 browsers or devices')
  expect(host.querySelectorAll('.activity-sessions li')).toHaveLength(2)
  expect(host.querySelectorAll('.activity-list-own li')).toHaveLength(1)
  await click('Back to Staff Activity'); expect(host.querySelector('.activity-table')).not.toBeNull()
})
it('says when someone has never signed in or is not signed in now', async () => {
  vi.mocked(staffActivityApi.staff).mockResolvedValue({ ...detail, staff: { ...detail.staff, lastLoginAt: null, lastActivityAt: null }, sessions: [], activity: { items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } } })
  await render('s1')
  expect(host.querySelector('.activity-facts')?.textContent).toContain('Never signed in'); expect(host.querySelector('.activity-facts')?.textContent).toContain('No activity recorded')
  expect(host.querySelector('.detail-title .status')?.textContent).toBe('Not signed in'); expect(button('Sign out everywhere')).toBeUndefined()
  expect(host.textContent).toContain('Not signed in on any browser or device.')
})
it('ends one session after confirmation, then reloads', async () => {
  await render('s1')
  await act(async () => host.querySelectorAll<HTMLButtonElement>('.activity-sessions button')[1]!.click()); await tick()
  const dialog = host.querySelector('[role="dialog"]')!
  expect(dialog.querySelector('h2')?.textContent).toBe('End this session?'); expect(dialog.textContent).toContain('Their other sessions continue.')
  expect(staffActivityApi.revokeSession).not.toHaveBeenCalled()
  await act(async () => dialog.querySelector<HTMLButtonElement>('.button-danger')!.click()); await tick()
  expect(staffActivityApi.revokeSession).toHaveBeenCalledWith('s1', 'sess-2')
  expect(host.querySelector('.staff-notice')?.textContent).toBe('Session ended. That browser must sign in again.')
  expect(vi.mocked(staffActivityApi.staff).mock.calls.length).toBeGreaterThan(1); expect(ended).not.toHaveBeenCalled()
})
it('signs someone out everywhere after confirmation, and warns when that includes your own session', async () => {
  vi.mocked(staffActivityApi.staff).mockResolvedValue({ ...detail, sessions: [{ ...detail.sessions[0]!, current: true }, detail.sessions[1]!] })
  await render('s1')
  expect(host.querySelectorAll('.activity-sessions button')).toHaveLength(1)
  expect(host.querySelector('.activity-sessions li strong')?.textContent).toBe('Session 1 (this browser, you)')
  await click('Sign out everywhere')
  expect(host.querySelector('[role="dialog"]')?.textContent).toContain('This includes your own session, so you will be signed out too.')
  await act(async () => host.querySelector<HTMLButtonElement>('[role="dialog"] .button-danger')!.click()); await tick()
  expect(staffApi.revokeSessions).toHaveBeenCalledWith('s1'); expect(ended).toHaveBeenCalledOnce()
})
it('keeps the dialog open with a plain message when ending a session fails', async () => {
  vi.mocked(staffActivityApi.revokeSession).mockRejectedValueOnce(new ApiError(404, 'This session has already ended', 'SESSION_NOT_FOUND', 'req-2'))
  await render('s1')
  await act(async () => host.querySelectorAll<HTMLButtonElement>('.activity-sessions button')[1]!.click()); await tick()
  await act(async () => host.querySelector<HTMLButtonElement>('[role="dialog"] .button-danger')!.click()); await tick()
  expect(host.querySelector('[role="dialog"]')).not.toBeNull(); expect(host.querySelector('[role="dialog"] [role="alert"]')).not.toBeNull()
})
it('never writes activity to browser storage', async () => {
  const setItem = vi.spyOn(Storage.prototype, 'setItem')
  await render(); await click('Last 30 days'); await tick(60000)
  expect(setItem).not.toHaveBeenCalled()
})
