import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { vi } from 'vitest'
import type { StaffUser } from '../src/api/auth'
import { staffApi, type StaffMember, type StaffPage, type StaffQuery, type StaffStatus } from '../src/api/staff'
import { StaffAdministration } from '../src/features/staff/StaffAdministration'
import { created, disabled, doctor, officer, otherAdmin, pending, self, signedIn, staffPage } from './staff-fixtures'

export const everyone = [self, officer, doctor, pending, disabled, otherAdmin, created]
export const totals: Record<StaffStatus, number> = { PENDING: 1, ACTIVE: 12, SUSPENDED: 2, DISABLED: 3 }
export const harness: { host: HTMLDivElement; root: Root; ended: ReturnType<typeof vi.fn<() => void>> } = {} as never

export function setup() {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-05T10:00:00Z')); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  harness.host = document.createElement('div'); document.body.append(harness.host); harness.root = createRoot(harness.host); harness.ended = vi.fn()
  vi.spyOn(staffApi, 'list').mockImplementation(async (query: StaffQuery = {}) => query.limit === 1 ? staffPage([], 1, totals[query.status!], 1) : staffPage())
  vi.spyOn(staffApi, 'get').mockImplementation(async (id: string) => ({ user: everyone.find((member) => member.id === id)! }))
  vi.spyOn(staffApi, 'create').mockResolvedValue({ user: created })
  vi.spyOn(staffApi, 'changeRole').mockImplementation(async (id, role) => ({ user: { ...everyone.find((member) => member.id === id)!, role } }))
  vi.spyOn(staffApi, 'changeStatus').mockImplementation(async (id, status) => ({ user: { ...everyone.find((member) => member.id === id)!, status } }))
  vi.spyOn(staffApi, 'revokeSessions').mockResolvedValue({ revoked: true })
  vi.spyOn(window, 'confirm').mockReturnValue(false)
}
export async function teardown() {
  await act(async () => harness.root.unmount()); harness.host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks()
}
export const tick = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(0) }) }
export const render = async (user: StaffUser = signedIn) => {
  await act(async () => harness.root.render(<StaffAdministration user={user} onSessionEnded={harness.ended} />)); await tick()
}
const visible = (element: Element) => !element.closest('[hidden]')
export const buttons = () => Array.from(harness.host.querySelectorAll<HTMLButtonElement>('button')).filter(visible)
export const button = (text: string) => buttons().find((item) => item.textContent?.trim() === text)
export const press = async (element: HTMLElement | null | undefined) => { await act(async () => element!.click()); await tick() }
export const click = (text: string) => press(button(text))
export const manage = (member: StaffMember) => press(buttons().find((item) => item.getAttribute('aria-label') === `Manage ${member.firstName} ${member.lastName}`))
export const dialog = () => harness.host.querySelector<HTMLElement>('[role="dialog"]')
export const text = () => harness.host.textContent ?? ''
export const directoryCalls = () => vi.mocked(staffApi.list).mock.calls.filter(([query]) => query?.limit !== 1)
export const lastQuery = () => directoryCalls().at(-1)![0]
export const field = <T extends HTMLElement = HTMLInputElement>(name: string) => harness.host.querySelector<T>(`[name="${name}"]`)!
export async function fill(name: string, value: string) {
  await act(async () => {
    const element = field<HTMLInputElement | HTMLSelectElement>(name)
    const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value)
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
}
export const choose = (name: string, value: string) => press(harness.host.querySelector<HTMLInputElement>(`input[name="${name}"][value="${value}"]`))
export const submit = async () => {
  await act(async () => { dialog()!.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) }); await tick()
}
export const escape = async () => { await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))); await tick() }
export function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
export type Page = StaffPage
