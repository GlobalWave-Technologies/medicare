// @vitest-environment jsdom
/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '../src/api/client'
import { staffApi } from '../src/api/staff'
import { created, doctor, officer, otherAdmin, self, signedIn, staffPage, validForm } from './staff-fixtures'
import {
  button, buttons, choose, click, deferred, dialog, directoryCalls, escape, field, fill, harness, lastQuery, press, render, setup, submit, teardown, text, tick, totals, type Page,
} from './staff-harness'

beforeEach(setup)
afterEach(teardown)
const rows = () => Array.from(harness.host.querySelectorAll<HTMLTableRowElement>('.staff-table tbody tr'))
async function openForm() { await click('Add staff member'); expect(dialog()?.getAttribute('aria-labelledby')).toBeTruthy() }
async function completeForm(role = 'DOCTOR_IN_CHARGE') {
  for (const [name, value] of Object.entries(validForm)) await fill(name, value)
  await choose('role', role)
}

it('renders nothing for a non-admin and sends no staff request', async () => {
  for (const role of ['RECORDS_OFFICER', 'DOCTOR_IN_CHARGE'] as const) {
    await render({ ...signedIn, role })
    expect(harness.host.querySelector('h2')?.textContent).toBe('Administrator access required')
    expect(button('Add staff member')).toBeUndefined(); expect(harness.host.querySelector('table')).toBeNull()
  }
  expect(staffApi.list).not.toHaveBeenCalled(); expect(staffApi.get).not.toHaveBeenCalled()
})
it('shows a contained loading state, then the server directory', async () => {
  const page = deferred<Page>()
  vi.mocked(staffApi.list).mockImplementation((query = {}) => query.limit === 1 ? Promise.resolve(staffPage([], 1, 0, 1)) : page.promise)
  await render()
  expect(harness.host.querySelector('[role="status"]')?.textContent).toBe('Loading staff accounts…')
  expect(harness.host.querySelector('.staff-skeleton')?.getAttribute('aria-hidden')).toBe('true')
  expect(text()).not.toMatch(/No staff accounts|No additional staff/); expect(harness.host.querySelector('section')?.getAttribute('aria-busy')).toBe('true')
  page.resolve(staffPage()); await tick()
  expect(rows()).toHaveLength(3); expect(harness.host.querySelector('.staff-skeleton')).toBeNull()
  expect(directoryCalls()[0]![0]).toEqual({ page: 1, limit: 20 }); expect(directoryCalls()[0]![1]).toBeInstanceOf(AbortSignal)
})
it('lists name, staff number, email, readable role and status, and marks the signed-in account', async () => {
  await render()
  expect(Array.from(harness.host.querySelectorAll('.staff-table th')).map((th) => [th.textContent, th.getAttribute('scope')])).toEqual(
    [['Staff member', 'col'], ['Staff number', 'col'], ['Email', 'col'], ['Role', 'col'], ['Status', 'col'], ['Actions', 'col']])
  expect(rows().map((row) => Array.from(row.cells).slice(1, 5).map((cell) => cell.textContent))).toEqual([
    ['STF-ADMIN001', 'ada.admin@example.test', 'Admin', 'Active'],
    ['STF-REC00002', 'rhea.records@example.test', 'Records Officer', 'Active'],
    ['STF-DOC00003', 'dara.doctor@example.test', 'Doctor in Charge', 'Suspended'],
  ])
  expect(rows()[0]!.cells[0]!.textContent).toBe('AAAda AdminYour account'); expect(rows()[1]!.textContent).not.toContain('Your account')
  expect(text()).not.toMatch(/RECORDS_OFFICER|DOCTOR_IN_CHARGE|SUSPENDED|\bACTIVE\b/)
})
it('shows status in words with a decorative icon, not by colour alone', async () => {
  await render()
  const badge = rows()[2]!.querySelector('.staff-status')!
  expect(badge.textContent).toBe('Suspended'); expect(badge.className).toContain('status-suspended')
  expect(badge.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
})
it('shows server totals for every status, independent of the page and filters', async () => {
  await render()
  const statusCalls = vi.mocked(staffApi.list).mock.calls.filter(([query]) => query?.limit === 1).map(([query]) => query)
  expect(statusCalls).toEqual([{ status: 'PENDING', limit: 1 }, { status: 'ACTIVE', limit: 1 }, { status: 'SUSPENDED', limit: 1 }, { status: 'DISABLED', limit: 1 }])
  const cards = Array.from(harness.host.querySelectorAll('.staff-summary-card')).map((card) => [card.querySelector('dt')?.textContent, card.querySelector('dd')?.textContent])
  expect(cards).toEqual([['Active', String(totals.ACTIVE)], ['Pending', String(totals.PENDING)], ['Suspended', String(totals.SUSPENDED)], ['Disabled', String(totals.DISABLED)]])
  expect(text()).toContain('Totals cover every staff account, not only the page shown.')
  expect(text()).toContain('3 staff accounts in total')
})
it('keeps the directory usable when totals fail, and retries both together', async () => {
  vi.mocked(staffApi.list).mockImplementation(async (query = {}) => { if (query.limit === 1) throw new TypeError('Failed to fetch'); return staffPage() })
  await render()
  expect(text()).toContain('Account totals are unavailable.'); expect(rows()).toHaveLength(3)
  vi.mocked(staffApi.list).mockImplementation(async (query = {}) => query.limit === 1 ? staffPage([], 1, 4, 1) : staffPage())
  await press(harness.host.querySelector('.staff-summary-error button')); expect(text()).not.toContain('Account totals are unavailable.')
})
it('uses bounded server pagination', async () => {
  vi.mocked(staffApi.list).mockImplementation(async (query = {}) => query.limit === 1 ? staffPage([], 1, 0, 1) : staffPage([officer], query.page ?? 1, 45))
  await render()
  const pager = harness.host.querySelector('nav[aria-label="Staff pages"]')!
  expect(pager.textContent).toContain('45 results · Page 1 of 3'); expect(pager.querySelectorAll('button')).toHaveLength(2)
  expect(button('Previous')!.disabled).toBe(true)
  await click('Next'); expect(lastQuery()).toEqual({ page: 2, limit: 20 })
  await click('Next'); expect(lastQuery()).toEqual({ page: 3, limit: 20 }); expect(button('Next')!.disabled).toBe(true)
})
it('filters by the server-supported role and status only, resetting to the first page', async () => {
  vi.mocked(staffApi.list).mockImplementation(async (query = {}) => query.limit === 1 ? staffPage([], 1, 0, 1) : staffPage([officer], query.page ?? 1, 45))
  await render(); await click('Next')
  await fill('staffRole', 'DOCTOR_IN_CHARGE'); expect(lastQuery()).toEqual({ page: 1, limit: 20, role: 'DOCTOR_IN_CHARGE' })
  await fill('staffStatus', 'SUSPENDED'); expect(lastQuery()).toEqual({ page: 1, limit: 20, role: 'DOCTOR_IN_CHARGE', status: 'SUSPENDED' })
  expect(text()).toContain('45 staff accounts match these filters')
  expect(Array.from(field<HTMLSelectElement>('staffRole').options).map((option) => option.textContent)).toEqual(['All roles', 'Admin', 'Records Officer', 'Doctor in Charge'])
  expect(Array.from(field<HTMLSelectElement>('staffStatus').options).map((option) => option.textContent)).toEqual(['All statuses', 'Pending', 'Active', 'Suspended', 'Disabled'])
  await click('Clear filters'); expect(lastQuery()).toEqual({ page: 1, limit: 20 })
  expect(harness.host.querySelectorAll('input')).toHaveLength(0)
  expect(vi.mocked(staffApi.list).mock.calls.every(([query]) => Object.keys(query!).every((key) => ['page', 'limit', 'role', 'status'].includes(key)))).toBe(true)
})
it('explains a filter with no matches and offers to clear it', async () => {
  vi.mocked(staffApi.list).mockImplementation(async (query = {}) => query.limit === 1 ? staffPage([], 1, 0, 1) : query.role ? staffPage([]) : staffPage())
  await render(); await fill('staffRole', 'ADMIN')
  expect(harness.host.querySelector('.staff-empty')?.textContent).toBe('No staff accounts match these filters.Clear filters')
  await press(harness.host.querySelector<HTMLButtonElement>('.staff-empty button')); expect(rows()).toHaveLength(3)
})
it('offers a first-page return when a page is past the end', async () => {
  vi.mocked(staffApi.list).mockImplementation(async (query = {}) => query.limit === 1 ? staffPage([], 1, 0, 1) : (query.page ?? 1) > 1 ? staffPage([], 2, 3) : staffPage([officer], 1, 21))
  await render(); await click('Next')
  expect(text()).toContain('No staff accounts on this page.'); await click('Return to first page'); expect(lastQuery()).toEqual({ page: 1, limit: 20 })
})
it('shows a clean first-run state when only the signed-in administrator exists', async () => {
  vi.mocked(staffApi.list).mockImplementation(async (query = {}) => query.limit === 1 ? staffPage([], 1, 0, 1) : staffPage([self]))
  await render()
  expect(harness.host.querySelector('.staff-callout')?.textContent).toContain('No additional staff accounts have been added yet.')
  expect(rows()).toHaveLength(1)
  await press(harness.host.querySelector<HTMLButtonElement>('.staff-callout button')); expect(dialog()?.textContent).toContain('Add staff member')
})
it('shows a safe list error with its reference and recovers on Try again', async () => {
  vi.mocked(staffApi.list).mockImplementation(async (query = {}) => {
    if (query.limit === 1) return staffPage([], 1, 0, 1)
    throw new ApiError(500, 'relation "StaffUser" does not exist', 'INTERNAL_ERROR', 'req-list-500')
  })
  await render()
  const alert = harness.host.querySelector('.staff-recovery [role="alert"]')!
  expect(alert.textContent).toBe('Unable to contact the server. Please try again.Support reference: req-list-500')
  expect(text()).not.toMatch(/relation|StaffUser/)
  vi.mocked(staffApi.list).mockImplementation(async (query = {}) => query.limit === 1 ? staffPage([], 1, 0, 1) : staffPage())
  await click('Try again'); expect(rows()).toHaveLength(3); expect(harness.host.querySelector('[role="alert"]')).toBeNull()
})
it('ignores a slower response for a superseded filter and aborts it', async () => {
  const first = deferred<Page>(), second = deferred<Page>()
  vi.mocked(staffApi.list).mockImplementation((query = {}) => query.limit === 1 ? Promise.resolve(staffPage([], 1, 0, 1)) : query.role ? second.promise : first.promise)
  await render(); await fill('staffRole', 'ADMIN')
  expect((directoryCalls()[0]![1] as AbortSignal).aborted).toBe(true)
  second.resolve(staffPage([otherAdmin])); await tick(); first.resolve(staffPage([officer, doctor])); await tick()
  expect(rows().map((row) => row.cells[1]!.textContent)).toEqual(['STF-ADM00006'])
})
it('refreshes the directory and totals on request', async () => {
  await render(); const before = vi.mocked(staffApi.list).mock.calls.length
  await press(buttons().find((item) => item.getAttribute('aria-label') === 'Refresh staff directory'))
  expect(vi.mocked(staffApi.list).mock.calls.length).toBe(before + 5)
})
it('renders labelled cards alongside the table for narrow screens, switched by CSS', async () => {
  await render()
  const cards = Array.from(harness.host.querySelectorAll<HTMLElement>('.staff-cards > li > article'))
  expect(harness.host.querySelector('.staff-cards')?.getAttribute('aria-label')).toBe('Staff accounts')
  expect(cards.map((card) => document.getElementById(card.getAttribute('aria-labelledby')!)?.textContent)).toEqual(['Ada Admin', 'Rhea Records', 'Dara Doctor'])
  expect(Array.from(cards[1]!.querySelectorAll('dt')).map((dt) => dt.textContent)).toEqual(['Staff number', 'Role', 'Status', 'Email'])
  expect(cards[1]!.querySelector('button')?.getAttribute('aria-label')).toBe('Manage Rhea Records')
  const css = readFileSync(resolve('src/features/staff/staff.css'), 'utf8')
  expect(css).toMatch(/\.staff-cards \{ display: none;/); expect(css).toMatch(/@media \(max-width: 1100px\) \{\s*\.staff-table \{ display: none; \}\s*\.staff-cards \{ display: grid;/)
})
it('wraps long names and email addresses instead of overflowing', async () => {
  const long = { ...officer, firstName: 'Bartholomew-Alexander'.repeat(3), email: `${'very.long.address'.repeat(8)}@example.test` }
  vi.mocked(staffApi.list).mockImplementation(async (query = {}) => query.limit === 1 ? staffPage([], 1, 0, 1) : staffPage([long]))
  await render()
  expect(rows()[0]!.querySelector('.staff-email')?.textContent).toBe(long.email)
  const css = readFileSync(resolve('src/features/staff/staff.css'), 'utf8'), shared = readFileSync(resolve('src/styles/App.css'), 'utf8')
  expect(css).toMatch(/\.staff-email \{ overflow-wrap: anywhere;/); expect(shared).toMatch(/\.staff-table \{[^}]*table-layout: fixed/)
  expect(css).toMatch(/\.staff-person strong, \.staff-person h3 \{[^}]*overflow-wrap: anywhere/)
})
it('gives every row action a specific accessible name and native button semantics', async () => {
  await render()
  const actions = Array.from(harness.host.querySelectorAll<HTMLButtonElement>('.staff-table .staff-manage'))
  expect(actions.map((item) => [item.getAttribute('aria-label'), item.type, item.textContent])).toEqual([
    ['Manage Ada Admin', 'button', 'Manage'], ['Manage Rhea Records', 'button', 'Manage'], ['Manage Dara Doctor', 'button', 'Manage']])
  expect(harness.host.querySelectorAll('[onclick], div[tabindex="0"], span[role="button"]')).toHaveLength(0)
})

it('opens Add staff member as a named dialog with every accepted field and no invented ones', async () => {
  await render(); await openForm()
  expect(document.getElementById(dialog()!.getAttribute('aria-labelledby')!)?.textContent).toBe('Add staff member')
  expect(Array.from(dialog()!.querySelectorAll('input')).map((input) => input.name)).toEqual(
    ['firstName', 'lastName', 'email', 'staffNumber', 'role', 'role', 'role', 'password', 'confirmPassword'])
  expect(Array.from(dialog()!.querySelectorAll<HTMLInputElement>('input[name="role"]')).map((input) => [input.value, input.checked])).toEqual(
    [['ADMIN', false], ['RECORDS_OFFICER', false], ['DOCTOR_IN_CHARGE', false]])
  expect(dialog()!.textContent).not.toMatch(/Status|Middle name|Phone/)
})
it('requires every field, links errors to their inputs and focuses the first problem', async () => {
  await render(); await openForm(); await submit()
  expect(staffApi.create).not.toHaveBeenCalled()
  for (const name of ['firstName', 'lastName', 'email', 'staffNumber', 'password']) {
    const input = field(name)
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(input.getAttribute('aria-describedby')!.split(' ').map((id) => document.getElementById(id)?.textContent).join(' ')).toMatch(/Enter/)
  }
  expect(dialog()!.textContent).toContain('Choose a role for this account.')
  expect(document.activeElement).toBe(field('firstName'))
})
it('validates the staff number format and password rules before sending', async () => {
  await render(); await openForm(); await completeForm()
  await fill('staffNumber', 'EMP-1'); await fill('password', 'too short'); await fill('confirmPassword', 'too short'); await submit()
  expect(dialog()!.textContent).toContain('Use STF- followed by 6 to 32 letters or digits'); expect(dialog()!.textContent).toContain('Use 15 to 128 characters.')
  expect(document.activeElement).toBe(field('staffNumber'))
  await fill('staffNumber', validForm.staffNumber); await fill('password', validForm.password); await fill('confirmPassword', `${validForm.password}!`); await submit()
  expect(dialog()!.textContent).toContain('The passwords don’t match.'); expect(document.activeElement).toBe(field('confirmPassword'))
  expect(staffApi.create).not.toHaveBeenCalled()
})
it('associates the password requirements and counts characters as the server does', async () => {
  await render(); await openForm(); await fill('password', '🔐'.repeat(3))
  const described = field('password').getAttribute('aria-describedby')!.split(' ').map((id) => document.getElementById(id)?.textContent ?? '')
  expect(described[0]).toMatch(/^15 to 128 characters; spaces are allowed\..*not shown again/); expect(described[1]).toBe('3 of at least 15 characters')
  expect(field('password').type).toBe('password'); expect(field('password').getAttribute('autocomplete')).toBe('new-password')
  expect(field('email').getAttribute('autocomplete')).toBe('off')
})
it('shows and hides both password fields with a pressed-state toggle, hiding them again on submit', async () => {
  await render(); await openForm()
  const toggle = button('Show passwords')!
  expect(toggle.getAttribute('aria-pressed')).toBe('false'); expect(toggle.getAttribute('aria-controls')).toBe(`${field('password').id} ${field('confirmPassword').id}`)
  await press(toggle); expect([field('password').type, field('confirmPassword').type]).toEqual(['text', 'text'])
  expect(button('Hide passwords')!.getAttribute('aria-pressed')).toBe('true'); expect(staffApi.create).not.toHaveBeenCalled()
  await submit(); expect([field('password').type, field('confirmPassword').type]).toEqual(['password', 'password'])
})
it('creates the account with the chosen role enum and opens it from the server response', async () => {
  const server = { ...created, staffNumber: 'STF-SERVER99' }
  vi.mocked(staffApi.create).mockResolvedValue({ user: server }); vi.mocked(staffApi.get).mockResolvedValue({ user: server })
  await render(); await openForm(); await completeForm('DOCTOR_IN_CHARGE'); const before = directoryCalls().length; await submit()
  expect(staffApi.create).toHaveBeenCalledExactlyOnceWith({ ...validForm, role: 'DOCTOR_IN_CHARGE' })
  expect(dialog()).toBeNull()
  expect(harness.host.querySelector('#staff-detail-title')?.textContent).toBe('Nia Newhire')
  expect(harness.host.querySelector('.staff-notice')?.textContent).toBe('Account created for Nia Newhire (STF-SERVER99). They can sign in now with the initial password you set.')
  expect(text()).not.toContain('STF-NEW00007'); expect(text()).not.toContain(validForm.password)
  expect(directoryCalls().length).toBeGreaterThan(before)
})
it('reports a duplicate email on its field without clearing the form or closing', async () => {
  vi.mocked(staffApi.create).mockRejectedValue(new ApiError(409, 'Email is already assigned', 'EMAIL_ALREADY_EXISTS', 'req-dup'))
  await render(); await openForm(); await completeForm(); await submit()
  expect(dialog()).not.toBeNull(); expect(field('email').getAttribute('aria-invalid')).toBe('true'); expect(document.activeElement).toBe(field('email'))
  expect(document.getElementById(field('email').getAttribute('aria-describedby')!.split(' ').at(-1)!)?.textContent).toBe('Another staff account already uses this email address.')
  expect(dialog()!.querySelectorAll('[role="alert"]')).toHaveLength(0)
  expect(field('firstName').value).toBe('Nia'); expect(field('password').value).toBe(validForm.password)
})
it('does not pull focus back to an earlier refused field after a later, unrelated failure', async () => {
  vi.mocked(staffApi.create).mockRejectedValueOnce(new ApiError(409, 'Email is already assigned', 'EMAIL_ALREADY_EXISTS')).mockRejectedValueOnce(new TypeError('Failed to fetch'))
  await render(); await openForm(); await completeForm(); await submit()
  expect(document.activeElement).toBe(field('email'))
  await fill('email', 'other.address@example.test'); field('firstName').focus(); await submit()
  expect(dialog()!.querySelector('[role="alert"]')?.textContent).toContain('could not be confirmed')
  expect(document.activeElement).not.toBe(field('email')); expect(field('email').getAttribute('aria-invalid')).toBe('false')
})
it('reports a duplicate staff number on its field', async () => {
  vi.mocked(staffApi.create).mockRejectedValue(new ApiError(409, 'Staff number is already assigned', 'STAFF_NUMBER_ALREADY_EXISTS'))
  await render(); await openForm(); await completeForm(); await submit()
  expect(field('staffNumber').getAttribute('aria-invalid')).toBe('true'); expect(document.activeElement).toBe(field('staffNumber'))
  expect(dialog()!.textContent).toContain('This staff number is already assigned to another account.')
})
it('sends one create while pending and locks the form', async () => {
  const pendingCreate = deferred<{ user: typeof created }>(); vi.mocked(staffApi.create).mockReturnValue(pendingCreate.promise)
  await render(); await openForm(); await completeForm(); await submit(); await submit()
  expect(staffApi.create).toHaveBeenCalledOnce()
  expect(dialog()!.querySelector('fieldset')!.disabled).toBe(true); expect(button('Creating account…')!.disabled).toBe(true)
  expect(dialog()!.textContent).toContain('Creating staff account…'); expect(dialog()!.getAttribute('aria-busy')).toBe('true')
  await escape(); expect(dialog()).not.toBeNull()
  pendingCreate.resolve({ user: created }); await tick(); expect(dialog()).toBeNull()
})
it('warns before discarding a partly completed form, including on Escape and page unload', async () => {
  await render(); await openForm(); await fill('firstName', 'Unsaved')
  await click('Cancel'); expect(window.confirm).toHaveBeenCalledWith('Discard this new staff account? The details you entered will be lost.'); expect(dialog()).not.toBeNull()
  await escape(); expect(dialog()).not.toBeNull()
  const unload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(true)
  vi.mocked(window.confirm).mockReturnValue(true); await click('Cancel'); expect(dialog()).toBeNull(); expect(staffApi.create).not.toHaveBeenCalled()
})
it('closes an untouched form without a prompt', async () => {
  await render(); await openForm(); await click('Cancel'); expect(dialog()).toBeNull(); expect(window.confirm).not.toHaveBeenCalled()
})
it('treats a lost create response as uncertain and flags a later duplicate as a possible earlier success', async () => {
  vi.mocked(staffApi.create).mockRejectedValueOnce(new TypeError('Failed to fetch'))
  await render(); await openForm(); await completeForm(); await submit()
  expect(dialog()!.querySelector('[role="alert"]')?.textContent).toBe('The new account could not be confirmed and it may already have been created. Refresh the staff directory and check before trying again.')
  expect(staffApi.create).toHaveBeenCalledOnce()
  vi.mocked(staffApi.create).mockRejectedValueOnce(new ApiError(409, 'Email is already assigned', 'EMAIL_ALREADY_EXISTS'))
  await submit()
  expect(dialog()!.textContent).toContain('An earlier attempt could not be confirmed, so this account may already exist.')
  expect(staffApi.create).toHaveBeenCalledTimes(2)
})
it('never stores or logs the initial password', async () => {
  const setItem = vi.spyOn(Storage.prototype, 'setItem')
  const logs = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) => vi.spyOn(console, method).mockImplementation(() => {}))
  vi.mocked(staffApi.create).mockRejectedValueOnce(new ApiError(400, 'Invalid request data', 'VALIDATION_ERROR', 'req-400'))
  await render(); await openForm(); await completeForm(); await submit(); await submit()
  expect(setItem).not.toHaveBeenCalled(); expect(localStorage.length).toBe(0); expect(sessionStorage.length).toBe(0)
  expect(logs.flatMap((spy) => spy.mock.calls).flat().map(String).join(' ')).not.toContain(validForm.password)
  expect(document.cookie).not.toContain(validForm.password); expect(window.location.href).not.toContain('correct')
})
it('handles a refused create without local success', async () => {
  vi.mocked(staffApi.create).mockRejectedValue(new ApiError(403, 'Permission denied', 'FORBIDDEN', 'req-403'))
  await render(); await openForm(); await completeForm(); await submit()
  expect(dialog()!.querySelector('[role="alert"]')?.textContent).toBe('Only administrators can manage staff accounts.Support reference: req-403')
  expect(harness.host.querySelector('.staff-notice')).toBeNull(); expect(harness.ended).not.toHaveBeenCalled()
})
it('creates staff for each role with its mapped enum', async () => {
  for (const [label, role] of [['Admin', 'ADMIN'], ['Records Officer', 'RECORDS_OFFICER'], ['Doctor in Charge', 'DOCTOR_IN_CHARGE']] as const) {
    vi.mocked(staffApi.create).mockClear(); await render(); await openForm(); await completeForm(role)
    expect(harness.host.querySelector<HTMLInputElement>(`input[name="role"][value="${role}"]`)!.closest('label')!.textContent).toContain(label)
    await submit(); expect(vi.mocked(staffApi.create).mock.calls[0]![0].role).toBe(role)
    await click('Back to staff directory')
  }
})
