// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { BackendRole, StaffUser } from '../src/api/auth'
import { ApiError } from '../src/api/client'
import { admissionsApi } from '../src/api/admissions'
import { encountersApi } from '../src/api/encounters'
import { notificationsApi } from '../src/api/notifications'
import { patientsApi } from '../src/api/patients'
import { staffApi } from '../src/api/staff'
import { App } from '../src/app/App'
import { officer, signedIn, staffPage } from './staff-fixtures'

const identity = vi.hoisted(() => ({ role: 'ADMIN' as BackendRole }))
vi.mock('../src/features/auth/AuthGate', () => ({ AuthGate: ({ children }: { children: (user: StaffUser) => ReactNode }) => children({ ...signedIn, role: identity.role }) }))
let host: HTMLDivElement, root: Root
const empty = { items: [], pagination: { page: 1, limit: 10, total: 0, totalPages: 0 } }
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-05T10:00:00Z')); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  vi.spyOn(notificationsApi, 'unreadCount').mockResolvedValue({ count: 0 })
  vi.spyOn(notificationsApi, 'list').mockResolvedValue({ items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } })
  vi.spyOn(patientsApi, 'list').mockResolvedValue(empty)
  vi.spyOn(admissionsApi, 'list').mockResolvedValue(empty)
  vi.spyOn(encountersApi, 'list').mockResolvedValue(empty)
  vi.spyOn(staffApi, 'list').mockResolvedValue(staffPage([{ ...signedIn }, officer]))
  vi.spyOn(staffApi, 'get').mockResolvedValue({ user: officer })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals() })
const tick = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(300) }) }
const start = async (role: BackendRole) => { identity.role = role; await act(async () => root.render(<App />)); await tick() }
const navLabels = () => Array.from(host.querySelectorAll('.desktop-sidebar nav button span:first-of-type')).map((item) => item.textContent)
const navButton = (label: string) => Array.from(host.querySelectorAll<HTMLButtonElement>('.desktop-sidebar nav button')).find((item) => item.querySelector('span')?.textContent === label)
const nav = async (label: string) => { await act(async () => navButton(label)!.click()); await tick() }

it('shows Staff & Access to administrators with the real workspace', async () => {
  await start('ADMIN')
  expect(navLabels()).toContain('Staff & Access')
  await nav('Staff & Access')
  expect(host.querySelector('h1')?.textContent).toBe('Staff & Access')
  expect(host.querySelector('.subheading')?.textContent).toBe('Manage staff accounts, roles and system access.')
  expect(host.querySelector('h2')?.textContent).toBe('Staff directory'); expect(host.textContent).not.toMatch(/not available|NOT YET AVAILABLE/)
  expect(staffApi.list).toHaveBeenCalled()
})
it('opens Staff & Access from the administrator overview in one step', async () => {
  await start('ADMIN')
  expect(host.querySelector('h1')?.textContent).toBe('Overview')
  await nav('Staff & Access')
  expect(host.querySelector('[aria-current="page"]')?.textContent).toBe('Staff & Access')
})
it.each(['RECORDS_OFFICER', 'DOCTOR_IN_CHARGE'] as const)('hides Staff from %s and never requests staff data in any of their views', async (role) => {
  await start(role)
  expect(navLabels()).not.toContain('Staff & Access')
  for (const label of navLabels()) await nav(label!)
  expect(host.textContent).not.toMatch(/Staff directory|Add staff member|Staff & Access/)
  expect(staffApi.list).not.toHaveBeenCalled(); expect(staffApi.get).not.toHaveBeenCalled()
})
it('includes Staff in the administrator mobile navigation only', async () => {
  for (const role of ['ADMIN', 'RECORDS_OFFICER'] as const) {
    await start(role)
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Open navigation"]')!.click())
    const labels = Array.from(host.querySelectorAll('.mobile-sidebar nav button span:first-of-type')).map((item) => item.textContent)
    expect(labels.includes('Staff & Access')).toBe(role === 'ADMIN')
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Close navigation"]')!.click())
  }
})
it('keeps the administrator signed in and the workspace contained when the server refuses staff data', async () => {
  vi.mocked(staffApi.list).mockRejectedValue(new ApiError(403, 'Permission denied', 'FORBIDDEN', 'req-403'))
  await start('ADMIN'); await nav('Staff & Access')
  expect(host.querySelector('.staff-recovery [role="alert"]')?.textContent).toBe('Only administrators can manage staff accounts.Support reference: req-403')
  expect(host.querySelector('.profile-copy')?.textContent).toContain('Ada Admin'); expect(navLabels()).toContain('Staff & Access')
  expect(host.querySelector('.staff-table')).toBeNull()
})
it('resets the staff workspace when navigating away and back', async () => {
  await start('ADMIN'); await nav('Staff & Access')
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Manage Rhea Records"]')!.click()); await tick()
  expect(host.querySelector('#staff-detail-title')?.textContent).toBe('Rhea Records')
  await nav('Patients'); await nav('Staff & Access')
  expect(host.querySelector('#staff-detail-title')).toBeNull(); expect(host.querySelector('h2')?.textContent).toBe('Staff directory')
})
