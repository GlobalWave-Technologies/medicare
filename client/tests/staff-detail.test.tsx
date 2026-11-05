// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '../src/api/client'
import { staffApi, type StaffMember } from '../src/api/staff'
import { disabled, doctor, officer, otherAdmin, pending, self, staffPage } from './staff-fixtures'
import {
  button, buttons, choose, click, deferred, dialog, directoryCalls, escape, field, harness, manage, press, render, setup, submit, teardown, text, tick,
} from './staff-harness'

beforeEach(setup)
afterEach(teardown)
const all = [self, officer, doctor, pending, disabled, otherAdmin]
const listEveryone = () => vi.mocked(staffApi.list).mockImplementation(async (query = {}) => query.limit === 1 ? staffPage([], 1, 0, 1) : staffPage(all))
async function open(member: StaffMember) { listEveryone(); await render(); await manage(member) }
const section = (title: string) => Array.from(harness.host.querySelectorAll<HTMLElement>('.staff-section')).find((item) => item.querySelector('h3')?.textContent === title)!
const sectionButtons = (title: string) => Array.from(section(title).querySelectorAll('button')).map((item) => item.textContent)
const notice = () => harness.host.querySelector('.staff-notice')?.textContent
const warning = () => document.getElementById(dialog()!.getAttribute('aria-describedby')!)?.textContent ?? ''
const confirmButton = () => dialog()!.querySelector<HTMLButtonElement>('.modal-footer button:last-child')!

it('opens a detail panel with only the safe account fields, read fresh from the server', async () => {
  await open(officer)
  expect(vi.mocked(staffApi.get).mock.calls[0]![0]).toBe(officer.id); expect(vi.mocked(staffApi.get).mock.calls[0]![1]).toBeInstanceOf(AbortSignal)
  expect(harness.host.querySelector('#staff-detail-title')?.textContent).toBe('Rhea Records')
  expect(Array.from(harness.host.querySelectorAll('.staff-identity > div')).map((item) => [item.querySelector('dt')?.textContent, item.querySelector('dd')?.textContent])).toEqual([
    ['Staff number', 'STF-REC00002'], ['Work email', 'rhea.records@example.test']])
  expect(harness.host.querySelector('.staff-detail-tags')?.textContent).toBe('Records OfficerActive')
  expect(harness.host.querySelector<HTMLElement>('.staff-workspace')!.hidden).toBe(true)
  // The only password content is the fixed Password section with its action: no value, hash or token is ever shown.
  const password = section('Password').textContent!
  expect(password).toBe('PasswordReplace a forgotten or exposed password. This signs the person out on all devices.Reset password')
  expect(text().replace(password, '')).not.toMatch(/password|hash|token|session id|created|updated|last login/i)
  expect(text()).not.toMatch(/hash|token|argon2|session id|last login/i)
  expect(Array.from(harness.host.querySelectorAll('.staff-section h3')).map((h3) => h3.textContent)).toEqual(['Role', 'Account access', 'Sessions', 'Password'])
})
it('moves focus to the detail heading and back to the same row action', async () => {
  await open(officer)
  expect(document.activeElement).toBe(harness.host.querySelector('#staff-detail-title'))
  await click('Back to staff directory')
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Manage Rhea Records')
})
it('keeps actions unavailable until the latest account details arrive', async () => {
  const read = deferred<{ user: StaffMember }>(); vi.mocked(staffApi.get).mockReturnValue(read.promise)
  await open(officer)
  expect(harness.host.querySelector('#staff-detail-title')?.textContent).toBe('Rhea Records')
  expect(text()).toContain('Checking the latest account details…'); expect(harness.host.querySelector('.staff-sections')).toBeNull()
  read.resolve({ user: { ...officer, status: 'SUSPENDED' } }); await tick()
  expect(sectionButtons('Account access')).toEqual(['Reactivate account', 'Disable account'])
})
it('shows a not-found state without actions', async () => {
  vi.mocked(staffApi.get).mockRejectedValue(new ApiError(404, 'Staff account not found', 'STAFF_NOT_FOUND', 'req-404'))
  await open(officer)
  expect(harness.host.querySelector('#staff-detail-title')?.textContent).toBe('Staff account not found')
  expect(harness.host.querySelector('[role="alert"]')?.textContent).toBe('This staff account was not found. Return to the staff directory and refresh it.Support reference: req-404')
  expect(buttons().map((item) => item.textContent)).toEqual(['Back to staff directory'])
  expect(document.activeElement).toBe(harness.host.querySelector('#staff-detail-title'))
})
it('blocks actions after a failed read and recovers on Try again', async () => {
  vi.mocked(staffApi.get).mockRejectedValueOnce(new TypeError('Failed to fetch'))
  await open(officer)
  expect(text()).toContain('Account actions are unavailable until the latest details load.'); expect(button('Change role')).toBeUndefined()
  await click('Try again'); expect(button('Change role')).toBeDefined(); expect(staffApi.get).toHaveBeenCalledTimes(2)
})
it.each([
  [pending, ['Activate account', 'Disable account'], ['button-primary', 'button-danger-quiet']],
  [officer, ['Suspend account', 'Disable account'], ['staff-button-caution', 'button-danger-quiet']],
  [doctor, ['Reactivate account', 'Disable account'], ['button-primary', 'button-danger-quiet']],
])('offers only the valid status actions for $status', async (member, labels, classes) => {
  await open(member)
  expect(sectionButtons('Account access')).toEqual(labels)
  expect(Array.from(section('Account access').querySelectorAll('button')).map((item) => item.className.split(' ').at(-1))).toEqual(classes)
  expect(section('Account access').textContent).not.toMatch(/Deactivate/)
})
it('shows DISABLED as terminal with no status, role or session actions', async () => {
  await open(disabled)
  expect(sectionButtons('Account access')).toEqual([]); expect(sectionButtons('Role')).toEqual([]); expect(sectionButtons('Sessions')).toEqual([])
  expect(section('Account access').textContent).toContain('No further status changes are available. Disabled is permanent.')
  expect(section('Account access').textContent).toContain('can’t be reactivated')
  expect(section('Sessions').textContent).toBe('SessionsA disabled account can’t be signed in, so it has no active sessions to sign out.')
})
it('offers session sign-out only for active accounts', async () => {
  for (const member of [pending, doctor]) {
    await open(member); expect(sectionButtons('Sessions')).toEqual([]); await click('Back to staff directory')
  }
  await manage(officer); expect(sectionButtons('Sessions')).toEqual(['Sign out all sessions'])
})

it('changes a role after confirmation and shows the server-returned role with the sign-out effect', async () => {
  vi.mocked(staffApi.changeRole).mockResolvedValue({ user: { ...officer, role: 'DOCTOR_IN_CHARGE' } })
  await open(officer); const before = directoryCalls().length
  await click('Change role')
  expect(document.getElementById(dialog()!.getAttribute('aria-labelledby')!)?.textContent).toBe('Change role')
  expect(warning()).toBe('Changing Rhea Records’s role updates the areas they can access and signs them out of all current sessions. They’ll need to sign in again.')
  const current = harness.host.querySelector<HTMLInputElement>('input[name="newRole"][value="RECORDS_OFFICER"]')!
  expect(current.disabled).toBe(true); expect(current.closest('label')?.textContent).toContain('Records Officer (current role)')
  await submit(); expect(dialog()!.textContent).toContain('Choose the new role.'); expect(staffApi.changeRole).not.toHaveBeenCalled()
  await choose('newRole', 'DOCTOR_IN_CHARGE'); await submit()
  expect(staffApi.changeRole).toHaveBeenCalledExactlyOnceWith(officer.id, 'DOCTOR_IN_CHARGE')
  expect(dialog()).toBeNull()
  expect(notice()).toBe('Role updated to Doctor in Charge. Existing sessions have been signed out.')
  expect(section('Role').querySelector('.staff-section-value')?.textContent).toBe('Doctor in Charge')
  expect(directoryCalls().length).toBeGreaterThan(before); expect(harness.ended).not.toHaveBeenCalled()
})
it('does not change anything locally until the role change is confirmed by the server', async () => {
  const change = deferred<{ user: StaffMember }>(); vi.mocked(staffApi.changeRole).mockReturnValue(change.promise)
  await open(officer); await click('Change role'); await choose('newRole', 'ADMIN'); await submit(); await submit()
  expect(staffApi.changeRole).toHaveBeenCalledOnce(); expect(confirmButton().textContent).toBe('Changing role…')
  expect(section('Role').querySelector('.staff-section-value')?.textContent).toBe('Records Officer')
  change.resolve({ user: { ...officer, role: 'ADMIN' } }); await tick()
  expect(section('Role').querySelector('.staff-section-value')?.textContent).toBe('Admin')
})
it('explains last-active-administrator protection and keeps the role and session', async () => {
  vi.mocked(staffApi.changeRole).mockRejectedValue(new ApiError(409, 'At least one active administrator must remain', 'LAST_ADMIN_PROTECTION', 'req-last'))
  await open(otherAdmin); await click('Change role')
  expect(warning()).toContain('If this is the last active administrator, the change will be refused.')
  await choose('newRole', 'RECORDS_OFFICER'); await submit()
  expect(dialog()!.querySelector('[role="alert"]')?.textContent).toBe('You can’t remove the last active administrator. Make another account an active Admin first.Support reference: req-last')
  expect(dialog()!.textContent).not.toContain('At least one active administrator must remain')
  await click('Cancel'); expect(section('Role').querySelector('.staff-section-value')?.textContent).toBe('Admin'); expect(notice()).toBeUndefined()
  expect(harness.ended).not.toHaveBeenCalled()
})
it('warns about a self role change and ends the session only after the server accepts it', async () => {
  vi.mocked(staffApi.changeRole).mockRejectedValueOnce(new ApiError(409, 'x', 'LAST_ADMIN_PROTECTION'))
  await open(self); expect(harness.host.querySelector('.staff-detail-tags')?.textContent).toContain('Your account')
  await click('Change role')
  expect(warning()).toContain('This is your own account. You’ll be signed out immediately and lose access to Staff & Access.')
  expect(dialog()!.querySelector('.staff-warning')?.className).toContain('tone-danger')
  await choose('newRole', 'RECORDS_OFFICER'); await submit()
  expect(harness.ended).not.toHaveBeenCalled(); expect(dialog()!.textContent).toContain('You can’t remove the last active administrator.')
  const before = directoryCalls().length
  await submit(); expect(staffApi.changeRole).toHaveBeenLastCalledWith(self.id, 'RECORDS_OFFICER')
  expect(harness.ended).toHaveBeenCalledOnce(); expect(directoryCalls().length).toBe(before)
})

it('confirms a suspension with its sign-out consequence', async () => {
  await open(officer); await click('Suspend account')
  expect(document.getElementById(dialog()!.getAttribute('aria-labelledby')!)?.textContent).toBe('Suspend account')
  expect(warning()).toBe('Active →to SuspendedRhea Records will be signed out on all devices and unable to access Medicare until an administrator reactivates the account.')
  expect(confirmButton().className).toContain('staff-button-caution')
  await press(confirmButton())
  expect(staffApi.changeStatus).toHaveBeenCalledExactlyOnceWith(officer.id, 'SUSPENDED')
  expect(notice()).toBe('Account suspended. Rhea Records has been signed out and can’t sign in until the account is reactivated.')
  expect(sectionButtons('Account access')).toEqual(['Reactivate account', 'Disable account']); expect(sectionButtons('Sessions')).toEqual([])
})
it('reactivates a suspended account as a positive, reviewed action', async () => {
  await open(doctor); await click('Reactivate account')
  expect(warning()).toContain('Dara Doctor will be able to sign in again with their existing password. They are not signed in automatically')
  expect(dialog()!.querySelector('.staff-warning')?.className).toContain('tone-info'); expect(confirmButton().className).toContain('button-primary')
  await press(confirmButton())
  expect(staffApi.changeStatus).toHaveBeenCalledExactlyOnceWith(doctor.id, 'ACTIVE'); expect(notice()).toBe('Account reactivated. Dara Doctor can sign in again.')
})
it('activates a pending account and explains missing credentials safely', async () => {
  vi.mocked(staffApi.changeStatus).mockRejectedValueOnce(new ApiError(409, 'Account credentials must be provisioned before activation', 'CREDENTIALS_REQUIRED'))
  await open(pending); await click('Activate account')
  expect(warning()).toContain('Pat Pending will be able to sign in with the credentials already set for this account.')
  await press(confirmButton())
  expect(dialog()!.querySelector('[role="alert"]')?.textContent).toBe('This account has no password yet. Set a password first, then activate the account.')
  await press(confirmButton()); expect(notice()).toBe('Account activated. Pat Pending can now sign in.')
})
it('requires explicit acknowledgement before permanently disabling an account', async () => {
  await open(officer); await click('Disable account')
  expect(document.getElementById(dialog()!.getAttribute('aria-labelledby')!)?.textContent).toBe('Disable account permanently')
  expect(warning()).toContain('This permanently disables Rhea Records’s account under the current system policy and cannot be reversed.')
  expect(dialog()!.querySelector('.staff-warning')?.className).toContain('tone-danger'); expect(confirmButton().className).toContain('button-danger')
  await submit(); expect(staffApi.changeStatus).not.toHaveBeenCalled()
  const box = field('understood')
  expect(box.getAttribute('aria-invalid')).toBe('true'); expect(document.activeElement).toBe(box)
  expect(document.getElementById(box.getAttribute('aria-describedby')!)?.textContent).toBe('Confirm that you understand this can’t be undone.')
  await press(box); await submit()
  expect(staffApi.changeStatus).toHaveBeenCalledExactlyOnceWith(officer.id, 'DISABLED')
  expect(notice()).toBe('Account disabled permanently. Rhea Records has been signed out.')
  expect(sectionButtons('Account access')).toEqual([]); expect(sectionButtons('Role')).toEqual([])
})
it('reports a server-refused transition without changing the shown status', async () => {
  vi.mocked(staffApi.changeStatus).mockRejectedValue(new ApiError(409, 'Account status transition is not allowed', 'INVALID_STATUS_TRANSITION', 'req-409'))
  await open(officer); await click('Suspend account'); await press(confirmButton())
  expect(dialog()!.querySelector('[role="alert"]')?.textContent).toBe('This status change isn’t allowed from the account’s current status. Refresh the account to see its latest status.Support reference: req-409')
  await escape(); expect(section('Account access').querySelector('.staff-status')?.textContent).toBe('Active'); expect(notice()).toBeUndefined()
})
it('treats a lost status response as uncertain and never retries it', async () => {
  vi.mocked(staffApi.changeStatus).mockRejectedValue(new TypeError('Failed to fetch'))
  await open(officer); await click('Suspend account'); await press(confirmButton()); await tick()
  expect(dialog()!.querySelector('[role="alert"]')?.textContent).toBe('The status change could not be confirmed. Refresh this account to see its current status before trying again.')
  expect(staffApi.changeStatus).toHaveBeenCalledOnce()
})
it('keeps a forbidden status change from looking successful', async () => {
  vi.mocked(staffApi.changeStatus).mockRejectedValue(new ApiError(403, 'Permission denied', 'FORBIDDEN', 'req-403'))
  await open(officer); await click('Disable account'); await press(field('understood')); await submit()
  expect(dialog()!.querySelector('[role="alert"]')?.textContent).toBe('Only administrators can manage staff accounts.Support reference: req-403')
  expect(notice()).toBeUndefined(); expect(harness.ended).not.toHaveBeenCalled()
  await escape(); expect(section('Account access').querySelector('.staff-status')?.textContent).toBe('Active')
})
it('warns about self suspension and ends the session after it succeeds', async () => {
  await open(self); await click('Suspend account')
  expect(warning()).toContain('This is your own account. You’ll be signed out immediately and need another administrator to reactivate you.')
  await press(confirmButton()); expect(staffApi.changeStatus).toHaveBeenCalledWith(self.id, 'SUSPENDED'); expect(harness.ended).toHaveBeenCalledOnce()
})
it('warns that disabling your own account permanently removes your access', async () => {
  await open(self); await click('Disable account')
  expect(warning()).toContain('This is your own account. You will permanently lose access.')
})

it('signs out every session of another account after confirmation, without implying a status change', async () => {
  await open(officer); const before = directoryCalls().length
  await click('Sign out all sessions')
  expect(warning()).toBe('This immediately signs Rhea Records out on all devices. Any unsaved work in their open sessions may be lost.Their account stays Active and they can sign in again.')
  expect(confirmButton().className).toContain('staff-button-caution')
  await press(confirmButton())
  expect(staffApi.revokeSessions).toHaveBeenCalledExactlyOnceWith(officer.id)
  expect(notice()).toBe('All sessions for Rhea Records have been signed out. The account is still Active.')
  expect(section('Account access').querySelector('.staff-status')?.textContent).toBe('Active')
  expect(directoryCalls().length).toBe(before); expect(harness.ended).not.toHaveBeenCalled()
  expect(text()).not.toMatch(/session id|token|[0-9a-f]{32}/i)
})
it('reports an uncertain sign-out as safe to repeat', async () => {
  vi.mocked(staffApi.revokeSessions).mockRejectedValueOnce(new ApiError(503, 'Service unavailable', 'SERVICE_UNAVAILABLE', 'req-503'))
  await open(officer); await click('Sign out all sessions'); await press(confirmButton())
  expect(dialog()!.querySelector('[role="alert"]')?.textContent).toBe('Signing out could not be confirmed. Refresh this account, then try again if needed. Signing out again is safe.Support reference: req-503')
  expect(notice()).toBeUndefined(); expect(staffApi.revokeSessions).toHaveBeenCalledOnce()
})
it('signs the administrator out when they revoke their own sessions', async () => {
  await open(self); await click('Sign out all sessions')
  expect(warning()).toContain('including this browser')
  await press(confirmButton()); expect(staffApi.revokeSessions).toHaveBeenCalledWith(self.id); expect(harness.ended).toHaveBeenCalledOnce()
})

it('names dialogs, focuses them, restores focus and blocks dismissal while pending', async () => {
  const change = deferred<{ user: StaffMember }>(); vi.mocked(staffApi.changeStatus).mockReturnValue(change.promise)
  await open(officer); const opener = button('Suspend account')!; opener.focus(); await press(opener)
  expect(document.activeElement).toBe(dialog()); expect(dialog()!.getAttribute('aria-modal')).toBe('true')
  await escape(); expect(dialog()).toBeNull(); expect(document.activeElement).toBe(opener)
  await press(opener); await press(confirmButton()); await escape(); expect(dialog()).not.toBeNull()
  expect(dialog()!.querySelector<HTMLButtonElement>('[aria-label="Close suspend account"]')!.disabled).toBe(true)
  change.resolve({ user: { ...officer, status: 'SUSPENDED' } }); await tick(); expect(dialog()).toBeNull()
})
it('labels role choices and keeps every control a native, keyboard-operable element', async () => {
  await open(officer); await click('Change role')
  const legend = dialog()!.querySelector('legend')?.textContent
  expect(legend).toBe('New role for Rhea Records')
  for (const input of Array.from(dialog()!.querySelectorAll<HTMLInputElement>('input[name="newRole"]'))) {
    expect(input.type).toBe('radio'); expect(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent).toMatch(/\.$/)
  }
  expect(harness.host.querySelectorAll('[onclick], div[tabindex="0"], span[role="button"]')).toHaveLength(0)
  expect(buttons().every((item) => item.type === 'button' || item.closest('form'))).toBe(true)
})
it('never writes staff data to browser storage', async () => {
  const setItem = vi.spyOn(Storage.prototype, 'setItem')
  await open(officer); await click('Sign out all sessions'); await press(confirmButton())
  await click('Suspend account'); await press(confirmButton()); await click('Back to staff directory')
  expect(setItem).not.toHaveBeenCalled(); expect(localStorage.length).toBe(0); expect(sessionStorage.length).toBe(0)
})
