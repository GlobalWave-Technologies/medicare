// @vitest-environment jsdom
import { act, StrictMode, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '../src/api/client'
import { notificationsApi, type InboxNotification, type NotificationPage } from '../src/api/notifications'
import { Notifications } from '../src/features/notifications/Notifications'
import type { UnreadCount } from '../src/features/notifications/useNotifications'
import { displayTime } from '../src/features/appointments/appointment-time'
import { appointmentNotice, broadcastNotice, inboxPage, readAt, staff } from './notification-fixtures'

let root: Root, host: HTMLDivElement, unread: UnreadCount, openAppointment: ReturnType<typeof vi.fn<(id: string) => void>>
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-04T15:00:00Z')); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  unread = { count: 1, loading: false, refresh: vi.fn() }; openAppointment = vi.fn()
  vi.spyOn(notificationsApi, 'list').mockResolvedValue(inboxPage())
  vi.spyOn(notificationsApi, 'get').mockImplementation(async (id) => ({ notification: [appointmentNotice, broadcastNotice].find((item) => item.id === id)! }))
  vi.spyOn(notificationsApi, 'markRead').mockImplementation(async (id) => ({ notification: { ...[appointmentNotice, broadcastNotice].find((item) => item.id === id)!, readAt } }))
  vi.spyOn(notificationsApi, 'markAllRead').mockResolvedValue({ updated: 1 })
  vi.spyOn(notificationsApi, 'broadcast').mockResolvedValue({ notification: broadcastNotice, recipientCount: 14 })
  vi.spyOn(window, 'confirm').mockReturnValue(false)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals() })
const tick = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(0) }) }
const render = async (node: ReactNode) => { await act(async () => root.render(node)); await tick() }
const inbox = (role: Parameters<typeof staff>[0] = 'DOCTOR_IN_CHARGE') => <Notifications user={staff(role)} unread={unread} onOpenAppointment={openAppointment} />
const buttons = () => Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
const button = (text: string) => buttons().find((item) => item.textContent?.trim() === text)
const click = async (text: string) => { await act(async () => button(text)!.click()); await tick() }
const dialog = () => host.querySelector<HTMLElement>('[role="dialog"]')
const items = () => Array.from(host.querySelectorAll<HTMLLIElement>('.notification-list > li'))
const lastQuery = () => vi.mocked(notificationsApi.list).mock.calls.at(-1)![0]
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
async function fill(name: string, value: string) {
  await act(async () => {
    const element = host.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`[name="${name}"]`)!
    const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value)
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
}
const submit = async () => { await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) }); await tick() }

it('shows a contained loading state without an empty message, then server notifications', async () => {
  const pending = deferred<NotificationPage>(); vi.mocked(notificationsApi.list).mockReturnValueOnce(pending.promise)
  await render(inbox())
  expect(host.querySelector('[role="status"]')?.textContent).toBe('Loading notifications…')
  expect(host.querySelector('.notification-skeleton')?.getAttribute('aria-hidden')).toBe('true')
  expect(host.textContent).not.toMatch(/caught up|No unread|match this filter/)
  await act(async () => pending.resolve(inboxPage())); await tick()
  expect(host.textContent).not.toContain('Loading notifications…')
  expect(notificationsApi.list).toHaveBeenCalledExactlyOnceWith({ page: 1, limit: 20 }, expect.any(AbortSignal))
  expect(items().map((item) => item.querySelector('h3')?.textContent)).toEqual(['New appointment', 'Staff briefing'])
  expect(host.querySelector('.notification-summary')?.textContent).toBe('Unread1In this view2')
})
it('marks unread and read items with text, not only colour, and keeps read items visible', async () => {
  await render(inbox())
  const [unreadItem, readItem] = items()
  expect(unreadItem!.className).toContain('is-unread'); expect(unreadItem!.querySelector('.notification-state')?.textContent).toBe('Unread')
  expect(readItem!.className).toContain('is-read'); expect(readItem!.querySelector('.notification-state')?.textContent).toBe('Read')
  expect(readItem!.textContent).toContain('Staff broadcast'); expect(unreadItem!.textContent).toContain('Linked appointment')
  const open = unreadItem!.querySelector('button')!, [tags, time] = open.getAttribute('aria-describedby')!.split(' ')
  expect(document.getElementById(tags!)?.textContent).toContain('Unread')
  expect(document.getElementById(time!)?.getAttribute('dateTime')).toBe(appointmentNotice.createdAt)
  expect(document.getElementById(time!)?.getAttribute('title')).toBe(displayTime(appointmentNotice.createdAt))
})
it.each([['Unread', { read: false }], ['Read', { read: true }]] as const)('filters %s on the server from page one', async (label, expected) => {
  vi.mocked(notificationsApi.list).mockResolvedValueOnce(inboxPage([appointmentNotice], 1, 45))
  await render(inbox()); await click('Next')
  expect(lastQuery()).toEqual({ page: 2, limit: 20 })
  await click(label)
  expect(lastQuery()).toEqual({ page: 1, limit: 20, ...expected })
  expect(button(label)!.getAttribute('aria-pressed')).toBe('true'); expect(button('All')!.getAttribute('aria-pressed')).toBe('false')
  await click('All'); expect(lastQuery()).toEqual({ page: 1, limit: 20 })
})
it('filters by notification type and uses backend pagination metadata', async () => {
  vi.mocked(notificationsApi.list).mockResolvedValue(inboxPage([broadcastNotice], 1, 41))
  await render(inbox()); await fill('notificationType', 'BROADCAST'); await tick()
  expect(lastQuery()).toEqual({ page: 1, limit: 20, type: 'BROADCAST' })
  expect(host.querySelector('[aria-label="Notification pages"]')?.textContent).toContain('41 results · Page 1 of 3')
  expect(button('Previous')!.disabled).toBe(true); await click('Next'); expect(lastQuery()).toEqual({ page: 2, limit: 20, type: 'BROADCAST' })
  expect(items()).toHaveLength(1)
})
it.each([
  [[], 'You’re all caught up. New operational notifications will appear here.'],
  [['Unread'], 'No unread notifications.'],
  [['Read'], 'No notifications match this filter.'],
])('distinguishes empty states after %j', async (steps, message) => {
  vi.mocked(notificationsApi.list).mockResolvedValue(inboxPage([]))
  await render(inbox()); for (const step of steps) await click(step)
  expect(host.querySelector('.notification-empty')?.textContent).toBe(message)
  expect(host.querySelector('.notification-list')).toBeNull(); expect(host.querySelector('[aria-label="Notification pages"]')).toBeNull()
})
it('treats a type-filtered empty unread view as a filter match, not an empty inbox', async () => {
  vi.mocked(notificationsApi.list).mockResolvedValue(inboxPage([]))
  await render(inbox()); await fill('notificationType', 'DIRECT'); await tick()
  expect(host.querySelector('.notification-empty')?.textContent).toBe('No notifications match this filter.')
})
it('shows a safe retryable list error with the support reference only', async () => {
  vi.mocked(notificationsApi.list).mockRejectedValueOnce(new ApiError(503, 'pool exhausted at db-host:5432', 'SERVICE_UNAVAILABLE', 'req-list-1'))
  await render(inbox())
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('Unable to contact the server. Please try again.Support reference: req-list-1')
  expect(host.textContent).not.toContain('db-host'); expect(host.textContent).not.toMatch(/caught up/)
  await click('Try again'); expect(notificationsApi.list).toHaveBeenCalledTimes(2); expect(items()).toHaveLength(2)
})
it('never lets an older filter response replace a newer one', async () => {
  const first = deferred<NotificationPage>(), second = deferred<NotificationPage>()
  vi.mocked(notificationsApi.list).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
  await render(inbox()); await click('Unread')
  expect(vi.mocked(notificationsApi.list).mock.calls[0]![1]!.aborted).toBe(true)
  await act(async () => second.resolve(inboxPage([appointmentNotice]))); await tick()
  await act(async () => first.resolve(inboxPage([broadcastNotice]))); await tick()
  expect(items().map((item) => item.querySelector('h3')?.textContent)).toEqual(['New appointment'])
})
it('opens an unread notification, marks it read once and reflects the server readAt everywhere', async () => {
  await act(async () => root.render(<StrictMode>{inbox()}</StrictMode>)); await tick()
  await click('New appointment')
  expect(dialog()?.getAttribute('aria-labelledby') && document.getElementById(dialog()!.getAttribute('aria-labelledby')!)?.textContent).toBe('New appointment')
  expect(notificationsApi.markRead).toHaveBeenCalledExactlyOnceWith(appointmentNotice.id)
  expect(notificationsApi.get).not.toHaveBeenCalled()
  expect(dialog()!.querySelector('.notification-state')?.textContent).toBe('Read')
  expect(dialog()!.querySelector(`time[dateTime="${readAt}"]`)?.textContent).toBe(displayTime(readAt))
  expect(items()[0]!.className).toContain('is-read'); expect(items()[0]!.querySelector('.notification-state')?.textContent).toBe('Read')
  expect(unread.refresh).toHaveBeenCalledOnce()
  await click('Close'); expect(dialog()).toBeNull()
  await click('New appointment'); expect(notificationsApi.markRead).toHaveBeenCalledOnce()
  expect(notificationsApi.get).toHaveBeenCalledWith(appointmentNotice.id, expect.any(AbortSignal))
})
it('refreshes an already-read notification without a write and keeps its original read time', async () => {
  await render(inbox()); await click('Staff briefing')
  expect(notificationsApi.markRead).not.toHaveBeenCalled(); expect(notificationsApi.get).toHaveBeenCalledOnce()
  expect(dialog()!.querySelector('.notification-message')?.textContent).toBe('Please attend the operational briefing at 14:00.\nRoom 2.')
  expect(dialog()!.querySelector(`time[dateTime="${broadcastNotice.readAt}"]`)).not.toBeNull()
  expect(button('View appointment')).toBeUndefined(); expect(unread.refresh).not.toHaveBeenCalled()
})
it('shows only a generic not-found result for a notification the server does not return', async () => {
  vi.mocked(notificationsApi.markRead).mockRejectedValueOnce(new ApiError(404, 'Delivery belongs to staff 5555', 'NOTIFICATION_NOT_FOUND', 'req-404'))
  await render(inbox()); await click('New appointment')
  expect(dialog()!.querySelector('h2')?.textContent).toBe('Notification not found')
  expect(dialog()!.querySelector('[role="alert"]')?.textContent).toBe('Notification not found.Support reference: req-404')
  expect(dialog()!.textContent).not.toMatch(/5555|assigned to you/); expect(button('View appointment')).toBeUndefined()
})
it('reports an unconfirmed read without retrying until staff choose to', async () => {
  vi.mocked(notificationsApi.markRead).mockRejectedValueOnce(new TypeError('Failed to fetch'))
  await render(inbox()); await click('New appointment')
  expect(dialog()!.querySelector('[role="alert"]')?.textContent).toBe('The read status could not be confirmed. Refresh notifications to see the current state.')
  expect(notificationsApi.markRead).toHaveBeenCalledOnce(); expect(dialog()!.querySelector('.notification-state')?.textContent).toBe('Unread')
  await vi.advanceTimersByTimeAsync(60000); expect(notificationsApi.markRead).toHaveBeenCalledOnce()
  await click('Mark as read'); expect(notificationsApi.markRead).toHaveBeenCalledTimes(2)
  expect(dialog()!.querySelector('.notification-state')?.textContent).toBe('Read'); expect(button('Mark as read')).toBeUndefined()
})
it('renders markup-like legacy content as inert text', async () => {
  const hostile: InboxNotification = { ...appointmentNotice, readAt, title: '<img src=x onerror="window.injected=1">', message: '<script>window.injected=1</script>&lt;b&gt;' }
  vi.mocked(notificationsApi.list).mockResolvedValue(inboxPage([hostile])); vi.mocked(notificationsApi.get).mockResolvedValue({ notification: hostile })
  await render(inbox()); await click(hostile.title)
  expect(host.querySelector('.notification-list img, .notification-list script, [role="dialog"] img, [role="dialog"] script, [role="dialog"] b')).toBeNull()
  expect(dialog()!.querySelector('.notification-message')?.textContent).toBe(hostile.message)
  expect(items()[0]!.querySelector('h3')?.textContent).toBe(hostile.title); expect((window as { injected?: number }).injected).toBeUndefined()
})
it('shows an unsupported target normally without inventing navigation', async () => {
  const future: InboxNotification = { ...appointmentNotice, readAt, target: { type: 'STAFF_ACCOUNT', id: 'unsupported' } }
  vi.mocked(notificationsApi.list).mockResolvedValue(inboxPage([future])); vi.mocked(notificationsApi.get).mockResolvedValue({ notification: future })
  await render(inbox()); expect(items()[0]!.textContent).not.toContain('Linked appointment')
  await click('New appointment'); expect(dialog()!.textContent).toContain('An appointment has been assigned to you.')
  expect(button('View appointment')).toBeUndefined(); expect(openAppointment).not.toHaveBeenCalled()
})
it('hands an appointment target to the existing appointment screen and closes the detail', async () => {
  await render(inbox()); await click('New appointment'); await click('View appointment')
  expect(openAppointment).toHaveBeenCalledExactlyOnceWith(appointmentNotice.target!.id); expect(dialog()).toBeNull()
})
it('marks all as read once, keeps the content and reloads page one from the server', async () => {
  vi.mocked(notificationsApi.list).mockResolvedValueOnce(inboxPage([appointmentNotice, broadcastNotice], 1, 30)).mockResolvedValueOnce(inboxPage([appointmentNotice, broadcastNotice], 2, 30))
  await render(inbox()); await click('Next')
  const pending = deferred<{ updated: number }>(); vi.mocked(notificationsApi.markAllRead).mockReturnValueOnce(pending.promise)
  vi.mocked(notificationsApi.list).mockResolvedValue(inboxPage([{ ...appointmentNotice, readAt }, broadcastNotice], 1, 30))
  await click('Mark all as read'); await act(async () => button('Marking all as read…')!.click())
  expect(button('Marking all as read…')!.disabled).toBe(true); expect(notificationsApi.markAllRead).toHaveBeenCalledOnce()
  await act(async () => pending.resolve({ updated: 1 })); await tick()
  expect(host.querySelector('.notification-notice')?.textContent).toBe('1 notification marked as read.')
  expect(lastQuery()).toEqual({ page: 1, limit: 20 }); expect(unread.refresh).toHaveBeenCalledOnce()
  expect(items()).toHaveLength(2); expect(items().every((item) => item.className.includes('is-read'))).toBe(true)
})
it('recovers the unread view to an accurate empty state after mark all', async () => {
  vi.mocked(notificationsApi.list).mockResolvedValueOnce(inboxPage()).mockResolvedValueOnce(inboxPage([appointmentNotice])).mockResolvedValue(inboxPage([]))
  vi.mocked(notificationsApi.markAllRead).mockResolvedValueOnce({ updated: 0 })
  await render(inbox()); await click('Unread'); await click('Mark all as read')
  expect(lastQuery()).toEqual({ page: 1, limit: 20, read: false })
  expect(host.querySelector('.notification-notice')?.textContent).toBe('All notifications were already marked as read.')
  expect(host.querySelector('.notification-empty')?.textContent).toBe('No unread notifications.')
})
it('reports an unconfirmed mark-all without automatic retry and disables it when nothing is unread', async () => {
  vi.mocked(notificationsApi.markAllRead).mockRejectedValueOnce(new ApiError(502, 'upstream reset', 'BAD_GATEWAY'))
  await render(inbox()); await click('Mark all as read')
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('The read status could not be confirmed. Refresh notifications to see the current state.')
  await vi.advanceTimersByTimeAsync(60000); expect(notificationsApi.markAllRead).toHaveBeenCalledOnce(); expect(unread.refresh).toHaveBeenCalledOnce()
  unread = { ...unread, count: 0 }; await render(inbox()); expect(button('Mark all as read')!.disabled).toBe(true)
})
it('refreshes the inbox and unread count deliberately and never polls', async () => {
  await render(inbox()); await vi.advanceTimersByTimeAsync(10 * 60000)
  expect(notificationsApi.list).toHaveBeenCalledOnce(); expect(unread.refresh).not.toHaveBeenCalled()
  await click('Refresh'); expect(notificationsApi.list).toHaveBeenCalledTimes(2); expect(unread.refresh).toHaveBeenCalledOnce()
  expect(host.querySelector('[aria-label="Refresh notifications"]')).not.toBeNull()
})
it('offers a retry for an unavailable unread count instead of a number', async () => {
  unread = { error: new TypeError('Failed to fetch'), loading: false, refresh: vi.fn() }
  await render(inbox()); expect(host.querySelector('.notification-summary dd')?.textContent).toBe('Unavailable')
  expect(host.querySelector('[role="alert"]')).toBeNull(); await click('Retry unread count'); expect(unread.refresh).toHaveBeenCalledOnce()
})
it.each(['RECORDS_OFFICER', 'DOCTOR_IN_CHARGE'] as const)('gives %s no broadcast controls', async (role) => {
  await render(inbox(role)); expect(button('New broadcast')).toBeUndefined(); expect(host.textContent).not.toMatch(/broadcast composer|Send broadcast/)
})

const compose = async () => { await render(inbox('ADMIN')); button('New broadcast')!.focus(); await click('New broadcast') }
it('opens an accessible broadcast composer with audience help, limits and privacy reminder', async () => {
  await compose()
  expect(document.getElementById(dialog()!.getAttribute('aria-labelledby')!)?.textContent).toBe('New staff broadcast')
  expect(dialog()!.querySelector('legend')?.textContent).toBe('Audience')
  const title = host.querySelector<HTMLInputElement>('[name="broadcastTitle"]')!, message = host.querySelector<HTMLTextAreaElement>('[name="broadcastMessage"]')!
  expect(title.maxLength).toBe(150); expect(message.maxLength).toBe(2000)
  const described = (element: Element) => element.getAttribute('aria-describedby')!.split(' ').map((id) => document.getElementById(id)?.textContent).join(' ')
  expect(described(title)).toBe('0 of 150 characters')
  expect(described(message)).toBe('0 of 2000 characters. Plain text only. Do not include confidential patient or clinical information. A sent broadcast cannot be edited or withdrawn.')
  expect(dialog()!.textContent).toContain('Broadcasts are delivered to active staff accounts.')
})
it('requires title and message and focuses the first problem without sending', async () => {
  await compose(); await fill('broadcastMessage', '   '); await submit()
  expect(dialog()!.textContent).toContain('Enter the broadcast title.'); expect(dialog()!.textContent).toContain('Enter the broadcast message.')
  expect(document.activeElement?.getAttribute('name')).toBe('broadcastTitle')
  expect(host.querySelector('[name="broadcastTitle"]')!.getAttribute('aria-invalid')).toBe('true')
  expect(host.querySelector('[name="broadcastTitle"]')!.getAttribute('aria-describedby')).toContain('-title-error')
  expect(notificationsApi.broadcast).not.toHaveBeenCalled()
})
it('enforces the server title and message limits and plain-text rule before sending', async () => {
  await compose(); await fill('broadcastTitle', 'a'.repeat(151)); await fill('broadcastMessage', 'b'.repeat(2001)); await submit()
  expect(dialog()!.textContent).toContain('The title allows up to 150 characters.'); expect(dialog()!.textContent).toContain('The message allows up to 2000 characters.')
  await fill('broadcastTitle', 'Ward update'); await fill('broadcastMessage', 'See <a href="x">link</a>'); await submit()
  expect(dialog()!.textContent).toContain('Use plain text only. Remove the < and > characters.'); expect(notificationsApi.broadcast).not.toHaveBeenCalled()
})
it('sends an ALL audience and reports the server recipient count', async () => {
  await compose(); await fill('broadcastTitle', ' Staff briefing '); await fill('broadcastMessage', 'Briefing at 14:00.'); await submit()
  expect(notificationsApi.broadcast).toHaveBeenCalledExactlyOnceWith({ title: 'Staff briefing', message: 'Briefing at 14:00.', audience: { type: 'ALL' } }, expect.stringMatching(/^[0-9a-f-]{36}$/))
  expect(dialog()).toBeNull(); expect(host.querySelector('.notification-notice')?.textContent).toBe('Broadcast sent to 14 active staff members.')
  expect(notificationsApi.list).toHaveBeenCalledTimes(2); expect(unread.refresh).toHaveBeenCalledOnce()
})
it.each([['RECORDS_OFFICER', 'Records Officers'], ['DOCTOR_IN_CHARGE', 'Doctors in Charge'], ['ADMIN', 'Administrators']] as const)('sends the exact %s role enum', async (role, label) => {
  vi.mocked(notificationsApi.broadcast).mockResolvedValueOnce({ notification: broadcastNotice, recipientCount: 1 })
  await compose(); await act(async () => host.querySelector<HTMLInputElement>('input[value="ROLE"]')!.click())
  await fill('broadcastTitle', 'Rota'); await fill('broadcastMessage', 'Rota changes.'); await submit()
  expect(dialog()!.textContent).toContain('Choose the staff role that should receive this broadcast.'); expect(notificationsApi.broadcast).not.toHaveBeenCalled()
  expect(document.activeElement?.getAttribute('name')).toBe('audienceRole')
  await fill('audienceRole', role); await submit()
  expect(notificationsApi.broadcast).toHaveBeenCalledExactlyOnceWith({ title: 'Rota', message: 'Rota changes.', audience: { type: 'ROLE', role } }, expect.stringMatching(/^[0-9a-f-]{36}$/))
  expect(host.querySelector('.notification-notice')?.textContent).toBe(`Broadcast sent to 1 active staff member (${label}).`)
})
it.each([
  [new ApiError(409, 'No eligible notification recipients', 'NO_NOTIFICATION_RECIPIENTS'), 'No active staff accounts match this audience. Choose a different audience.'],
  [new ApiError(409, 'exceeds synchronous delivery limit', 'NOTIFICATION_AUDIENCE_TOO_LARGE'), 'This audience is too large for a single broadcast. Choose a specific role, or contact system support.'],
  [new ApiError(403, 'role ADMIN required', 'FORBIDDEN'), 'You do not have permission to perform this action.'],
  [new TypeError('Failed to fetch'), 'The broadcast could not be confirmed. Select Send broadcast again without changing anything; it will not be sent twice.'],
])('keeps the draft and explains a failed broadcast safely (%s)', async (failure, message) => {
  vi.mocked(notificationsApi.broadcast).mockRejectedValueOnce(failure)
  await compose(); await fill('broadcastTitle', 'Staff briefing'); await fill('broadcastMessage', 'Briefing at 14:00.'); await submit()
  expect(dialog()!.querySelector('[role="alert"]')?.textContent).toBe(message)
  expect(dialog()!.textContent).not.toMatch(/synchronous|role ADMIN|eligible notification/)
  expect(host.querySelector<HTMLInputElement>('[name="broadcastTitle"]')!.value).toBe('Staff briefing')
  await vi.advanceTimersByTimeAsync(60000); expect(notificationsApi.broadcast).toHaveBeenCalledOnce()
})
it('prevents duplicate sends and dismissal while a broadcast is pending', async () => {
  const pending = deferred<{ notification: InboxNotification; recipientCount: number }>()
  vi.mocked(notificationsApi.broadcast).mockReturnValueOnce(pending.promise)
  await compose(); await fill('broadcastTitle', 'Staff briefing'); await fill('broadcastMessage', 'Briefing.'); await submit(); await submit()
  expect(notificationsApi.broadcast).toHaveBeenCalledOnce(); expect(button('Sending…')!.disabled).toBe(true)
  expect(dialog()!.getAttribute('aria-busy')).toBe('true'); expect(dialog()!.textContent).toContain('Sending broadcast…')
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(dialog()).not.toBeNull(); expect(window.confirm).not.toHaveBeenCalled()
  await act(async () => pending.resolve({ notification: broadcastNotice, recipientCount: 3 })); await tick()
  expect(dialog()).toBeNull(); expect(host.querySelector('.notification-notice')?.textContent).toBe('Broadcast sent to 3 active staff members.')
})
it('asks before discarding an unsent broadcast and restores focus to the opener', async () => {
  await compose(); await fill('broadcastMessage', 'Unsent text')
  const unload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(true)
  await click('Cancel'); expect(window.confirm).toHaveBeenCalledWith('Discard this unsent broadcast?'); expect(dialog()).not.toBeNull()
  vi.mocked(window.confirm).mockReturnValue(true); await click('Cancel')
  expect(dialog()).toBeNull(); expect(notificationsApi.broadcast).not.toHaveBeenCalled()
  expect(document.activeElement?.textContent).toBe('New broadcast')
})
it('closes a blank composer without a prompt', async () => {
  await compose(); await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(dialog()).toBeNull(); expect(window.confirm).not.toHaveBeenCalled()
})
