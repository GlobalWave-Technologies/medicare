// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { BackendRole, StaffUser } from '../src/api/auth'
import { ApiError } from '../src/api/client'
import { appointmentsApi } from '../src/api/appointments'
import { dashboardApi } from '../src/api/dashboard'
import { encountersApi } from '../src/api/encounters'
import { notificationsApi } from '../src/api/notifications'
import { patientsApi } from '../src/api/patients'
import { App } from '../src/app/App'
import { appointment, clinician, page } from './appointment-fixtures'
import { appointmentNotice, broadcastNotice, inboxPage, readAt, staff } from './notification-fixtures'
import { dashboardFor } from './report-fixtures'

const identity = vi.hoisted(() => ({ role: 'ADMIN' as BackendRole }))
vi.mock('../src/features/auth/AuthGate', () => ({ AuthGate: ({ children }: { children: (user: StaffUser) => ReactNode }) => children(staff(identity.role)) }))
let host: HTMLDivElement, root: Root
const empty = { items: [], pagination: { ...page.pagination, total: 0, totalPages: 0 } }
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-04T15:00:00Z')); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  vi.spyOn(notificationsApi, 'unreadCount').mockResolvedValue({ count: 0 })
  vi.spyOn(dashboardApi, 'get').mockImplementation(async () => dashboardFor(identity.role))
  vi.spyOn(notificationsApi, 'list').mockResolvedValue(inboxPage())
  vi.spyOn(notificationsApi, 'get').mockResolvedValue({ notification: broadcastNotice })
  vi.spyOn(notificationsApi, 'markRead').mockResolvedValue({ notification: { ...appointmentNotice, readAt } })
  vi.spyOn(notificationsApi, 'markAllRead').mockResolvedValue({ updated: 1 })
  vi.spyOn(patientsApi, 'list').mockResolvedValue(empty); vi.spyOn(patientsApi, 'get')
  vi.spyOn(appointmentsApi, 'list').mockResolvedValue(empty)
  vi.spyOn(appointmentsApi, 'get').mockResolvedValue({ appointment: { ...appointment, id: appointmentNotice.target!.id } })
  vi.spyOn(appointmentsApi, 'clinicians').mockResolvedValue({ clinicians: [clinician] })
  vi.spyOn(encountersApi, 'list').mockResolvedValue(empty); vi.spyOn(encountersApi, 'get')
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals() })
const tick = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(300) }) }
const start = async (role: BackendRole) => { identity.role = role; await act(async () => root.render(<App />)); await tick() }
const navButton = (label: string) => Array.from(host.querySelectorAll<HTMLButtonElement>('.desktop-sidebar nav button')).find((item) => item.querySelector('span')?.textContent === label)!
const nav = async (label: string) => { await act(async () => navButton(label).click()); await tick() }
const button = (text: string) => Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((item) => item.textContent?.trim() === text && !item.closest('[hidden]'))
const click = async (text: string) => { await act(async () => button(text)!.click()); await tick() }
const badge = () => navButton('Notifications').querySelector('.nav-badge')

it.each(['ADMIN', 'RECORDS_OFFICER', 'DOCTOR_IN_CHARGE'] as const)('%s opens their own real inbox; only admin can broadcast', async (role) => {
  await start(role); await nav('Notifications')
  expect(host.querySelector('h1')?.textContent).toBe('Notifications')
  expect(host.querySelector('.subheading')?.textContent).toBe('Stay up to date with appointments and hospital operations.')
  expect(host.querySelectorAll('.notification-list > li')).toHaveLength(2); expect(host.textContent).not.toContain('not available yet')
  expect(Boolean(button('New broadcast'))).toBe(role === 'ADMIN')
  expect(vi.mocked(notificationsApi.list).mock.calls.every(([query]) => Object.keys(query!).every((key) => ['page', 'limit', 'read', 'type'].includes(key)))).toBe(true)
})
it('hides a zero badge and shows an exact count with an accessible label', async () => {
  await start('RECORDS_OFFICER'); expect(badge()).toBeNull(); expect(host.querySelector('.menu-badge')).toBeNull()
  vi.mocked(notificationsApi.unreadCount).mockResolvedValue({ count: 5 }); await nav('Patients')
  expect(badge()?.textContent).toBe('5'); expect(badge()?.getAttribute('aria-hidden')).toBe('true')
  expect(navButton('Notifications').querySelector('.visually-hidden')?.textContent).toBe('5 unread notifications')
  const menu = host.querySelector<HTMLButtonElement>('[aria-label="Open navigation"]')!
  expect(menu.querySelector('.menu-badge')?.textContent).toBe('5'); expect(document.getElementById(menu.getAttribute('aria-describedby')!)?.textContent).toBe('5 unread notifications')
})
it('compacts a large count without losing the exact accessible number', async () => {
  vi.mocked(notificationsApi.unreadCount).mockResolvedValue({ count: 120 }); await start('DOCTOR_IN_CHARGE')
  expect(badge()?.textContent).toBe('99+'); expect(navButton('Notifications').querySelector('.visually-hidden')?.textContent).toBe('120 unread notifications')
})
it('keeps working without a fake badge or alarm when the unread count fails', async () => {
  vi.mocked(notificationsApi.unreadCount).mockRejectedValue(new ApiError(503, 'database host down', 'SERVICE_UNAVAILABLE'))
  await start('ADMIN')
  expect(badge()).toBeNull(); expect(host.querySelector('[role="alert"]')).toBeNull(); expect(host.textContent).not.toContain('database host')
  await nav('Patients'); expect(host.querySelector('h1')?.textContent).toBe('Patients')
  await nav('Notifications'); expect(host.querySelector('.notification-summary dd')?.textContent).toBe('Unavailable')
  vi.mocked(notificationsApi.unreadCount).mockResolvedValueOnce({ count: 3 }); await click('Retry unread count')
  expect(badge()?.textContent).toBe('3'); expect(host.querySelector('.notification-summary dd')?.textContent).toBe('3')
})
it('refreshes the badge from the server after opening an unread notification', async () => {
  vi.mocked(notificationsApi.unreadCount).mockResolvedValue({ count: 1 }); await start('DOCTOR_IN_CHARGE'); await nav('Notifications')
  expect(badge()?.textContent).toBe('1')
  vi.mocked(notificationsApi.unreadCount).mockResolvedValue({ count: 0 }); await click('New appointment')
  expect(notificationsApi.markRead).toHaveBeenCalledExactlyOnceWith(appointmentNotice.id)
  expect(badge()).toBeNull(); expect(host.querySelector('.notification-summary dd')?.textContent).toBe('0')
})
it('refreshes the badge from the server after mark all', async () => {
  vi.mocked(notificationsApi.unreadCount).mockResolvedValue({ count: 2 }); await start('RECORDS_OFFICER'); await nav('Notifications')
  vi.mocked(notificationsApi.unreadCount).mockResolvedValue({ count: 0 }); await click('Mark all as read')
  expect(notificationsApi.markAllRead).toHaveBeenCalledOnce(); expect(badge()).toBeNull()
  expect(button('Mark all as read')!.disabled).toBe(true)
})
it('opens the linked appointment through the existing authorized screen and returns to the inbox', async () => {
  await start('DOCTOR_IN_CHARGE'); await nav('Notifications'); await click('New appointment'); await click('View appointment')
  expect(appointmentsApi.get).toHaveBeenCalledWith(appointmentNotice.target!.id, expect.any(AbortSignal))
  expect(host.querySelector('h1')?.textContent).toBe('Appointments'); expect(host.querySelector('.appointment-detail h2')?.textContent).toBe(appointment.reference)
  expect(navButton('Appointments').getAttribute('aria-current')).toBe('page')
  await click('Back to Notifications'); expect(host.querySelector('h1')?.textContent).toBe('Notifications')
  expect(patientsApi.get).not.toHaveBeenCalled(); expect(encountersApi.list).not.toHaveBeenCalled(); expect(encountersApi.get).not.toHaveBeenCalled()
})
it('handles an inaccessible appointment target safely without signing out', async () => {
  vi.mocked(appointmentsApi.get).mockRejectedValueOnce(new ApiError(404, 'reassigned to another doctor', 'APPOINTMENT_NOT_FOUND'))
  await start('DOCTOR_IN_CHARGE'); await nav('Notifications'); await click('New appointment'); await click('View appointment')
  expect(host.textContent).toContain('Appointment not found.'); expect(host.textContent).not.toContain('reassigned')
  expect(button('Sign out')).toBeDefined(); await click('Back to Notifications'); expect(host.querySelectorAll('.notification-list > li')).toHaveLength(2)
})
it('fetches no patient or clinical details and stores nothing in the browser while reading notifications', async () => {
  const setItem = vi.spyOn(Storage.prototype, 'setItem'), getItem = vi.spyOn(Storage.prototype, 'getItem')
  await start('DOCTOR_IN_CHARGE'); await nav('Notifications'); await click('New appointment'); await click('Close'); await click('Staff briefing')
  expect(setItem).not.toHaveBeenCalled(); expect(getItem).not.toHaveBeenCalled()
  expect(localStorage.length).toBe(0); expect(sessionStorage.length).toBe(0)
  expect(patientsApi.get).not.toHaveBeenCalled(); expect(appointmentsApi.get).not.toHaveBeenCalled()
  expect(encountersApi.list).not.toHaveBeenCalled(); expect(encountersApi.get).not.toHaveBeenCalled()
})
it('loads the unread count after sign-in without blocking the workspace and refreshes it on navigation', async () => {
  let resolve!: (value: { count: number }) => void
  vi.mocked(notificationsApi.unreadCount).mockReturnValueOnce(new Promise((done) => { resolve = done }))
  await start('ADMIN'); expect(host.querySelector('h1')?.textContent).toBe('Overview'); expect(badge()).toBeNull()
  await act(async () => resolve({ count: 4 })); expect(badge()?.textContent).toBe('4')
  await nav('Appointments'); expect(notificationsApi.unreadCount).toHaveBeenCalledTimes(2)
  await vi.advanceTimersByTimeAsync(30 * 60000); expect(notificationsApi.unreadCount).toHaveBeenCalledTimes(2)
})
