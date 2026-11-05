// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { StaffUser } from '../src/api/auth'
import { dashboardApi } from '../src/api/dashboard'
import { notificationsApi } from '../src/api/notifications'
import { App } from '../src/app/App'
import { initTheme, readThemePreference, resolveTheme, stopTheme, themeColors, themeStorageKey, themeStore } from '../src/app/theme'
import { ThemeControl } from '../src/components/ui/ThemeControl'
import { Login } from '../src/features/auth/Login'
import { dashboardFor } from './report-fixtures'
import { contrast, hex, hue, sharedCss, themeNames, tokenBlocks } from './theme-tokens'

vi.mock('../src/features/auth/AuthGate', () => ({ AuthGate: ({ children }: { children: (user: StaffUser) => ReactNode }) => children({
  id: '70000000-0000-4000-8000-000000000016', staffNumber: 'STF-THEME', firstName: 'Tess', lastName: 'Theme', email: 'tess@example.test', status: 'ACTIVE', role: 'ADMIN' }) }))

// A controllable stand-in for the operating-system colour-scheme setting.
function systemScheme(dark: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>()
  const media = { matches: dark, media: '(prefers-color-scheme: dark)', addEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => listeners.add(listener), removeEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener) }
  vi.stubGlobal('matchMedia', vi.fn(() => media))
  return { change(next: boolean) { media.matches = next; for (const listener of listeners) listener({ matches: next } as MediaQueryListEvent) } }
}
const root = () => document.documentElement
const meta = () => document.querySelector('meta[name="theme-color"]')!
let host: HTMLDivElement, reactRoot: Root
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  localStorage.clear(); sessionStorage.clear(); root().removeAttribute('data-theme'); root().style.colorScheme = ''
  document.head.innerHTML = '<meta name="theme-color" content="#000000">'
  host = document.createElement('div'); document.body.append(host); reactRoot = createRoot(host)
})
afterEach(async () => { await act(async () => reactRoot.unmount()); host.remove(); stopTheme(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
const render = async (node: ReactNode) => { await act(async () => reactRoot.render(node)) }
const groups = () => Array.from(host.querySelectorAll<HTMLElement>('.theme-control[role="group"]'))
const choice = (group: HTMLElement, label: string) => Array.from(group.querySelectorAll<HTMLButtonElement>('button')).find((item) => item.textContent === label)!
const pressed = (group: HTMLElement) => Array.from(group.querySelectorAll('button[aria-pressed="true"]')).map((item) => item.textContent)
const choose = async (group: HTMLElement, label: string) => { await act(async () => choice(group, label).click()) }

it('documents the recovered original orange palette and where it came from', () => {
  const doc = readFileSync(resolve('../docs/branding-dark-mode.md'), 'utf8')
  for (const value of ['1e93826', '#f97316', '#ea580c', '#c2410c', '#fdba74', '#fed7aa', '#fff1e6', '#111827', '#f9fafb']) expect([value, doc.includes(value)]).toEqual([value, true])
  const tokens = tokenBlocks()
  expect([tokens.light['brand-mark'], tokens.light['brand-accent'], tokens.light.brand, tokens.light['brand-strong']]).toEqual(['#f97316', '#ea580c', '#c2410c', '#9a3412'])
  expect([tokens.dark.brand, tokens.dark['brand-mark']]).toEqual(['#f97316', '#f97316'])
})
it('keeps orange for the brand and separate hues for every status meaning, in both themes', () => {
  const tokens = tokenBlocks(), within = (value: string, from: number, to: number) => { const h = hue(hex(value)); return from <= to ? h >= from && h <= to : h >= from || h <= to }
  for (const theme of themeNames) {
    const t = tokens[theme]
    for (const name of ['brand', 'brand-strong', 'brand-accent', 'brand-mark', 'link', 'focus', 'chart-1']) expect([theme, name, within(t[name]!, 14, 32)]).toEqual([theme, name, true])
    expect([theme, 'success', within(t.success!, 90, 170), within(t['mark-completed']!, 90, 170)]).toEqual([theme, 'success', true, true])
    expect([theme, 'danger', within(t.danger!, 330, 10), within(t['danger-solid']!, 330, 10), within(t['mark-cancelled']!, 330, 10)]).toEqual([theme, 'danger', true, true, true])
    expect([theme, 'warning', within(t.warning!, 35, 56), within(t['mark-no-show']!, 35, 56)]).toEqual([theme, 'warning', true, true])
    expect([theme, 'info', within(t.info!, 195, 230), within(t['mark-scheduled']!, 195, 230)]).toEqual([theme, 'info', true, true])
    // A destructive action never looks like the ordinary orange primary action.
    const gap = Math.abs(hue(hex(t['danger-solid']!)) - 360 - hue(hex(t.brand!)))
    expect([theme, gap >= 25]).toEqual([theme, true])
  }
  const css = sharedCss()
  expect(css).toMatch(/\.button-primary \{ background: var\(--brand\); color: var\(--on-brand\); border-color: var\(--brand\); \}/)
  for (const rule of ['.button-danger {', '.button-danger-quiet {', '.button.staff-button-caution {']) expect([rule, css.slice(css.indexOf(rule)).split('}')[0]!.includes('--brand')]).toEqual([rule, false])
  expect(css).toContain('.button-danger { background: var(--danger-solid); color: var(--on-danger);')
})
it('passes contrast for orange buttons, links, focus rings and markers in both themes', () => {
  const tokens = tokenBlocks()
  for (const theme of themeNames) {
    const token = (name: string) => hex(tokens[theme][name]!), ratio = (a: string, b: string) => contrast(token(a), token(b))
    for (const fill of ['brand', 'brand-strong', 'brand-pressed']) expect([theme, fill, ratio('on-brand', fill) >= 4.5]).toEqual([theme, fill, true])
    for (const fill of ['danger-solid', 'danger-solid-hover']) expect([theme, fill, ratio('on-danger', fill) >= 4.5]).toEqual([theme, fill, true])
    for (const surface of ['surface', 'bg', 'surface-muted', 'surface-raised', 'brand-soft', 'unread-bg']) {
      expect([theme, 'focus', surface, ratio('focus', surface) >= 3]).toEqual([theme, 'focus', surface, true])
      expect([theme, 'link', surface, ratio('link', surface) >= 4.5]).toEqual([theme, 'link', surface, true])
    }
    for (const mark of ['brand-accent', 'chart-1', 'chart-2', 'chart-3']) expect([theme, mark, ratio(mark, 'surface') >= 3]).toEqual([theme, mark, true])
    for (const text of ['deep', 'ink', 'muted']) expect([theme, text, ratio(text, 'unread-bg') >= 4.5]).toEqual([theme, text, true])
    expect([theme, ratio('login-text', 'login-panel') >= 4.5, ratio('login-muted', 'login-panel') >= 4.5, ratio('login-accent', 'login-panel') >= 3]).toEqual([theme, true, true, true])
  }
  expect(sharedCss()).toContain(':focus-visible { outline: 3px solid var(--focus); outline-offset: 3px; }')
})
it('defines every colour token for dark mode and keeps colour values out of component rules', () => {
  const css = sharedCss(), tokens = tokenBlocks(css)
  const colourTokens = Object.keys(tokens.light).filter((name) => !/^(radius|text)(-|$)/.test(name))
  expect(colourTokens.filter((name) => !(name in tokens.dark))).toEqual([])
  expect(css).toMatch(/:root \{\s*color-scheme: light;/); expect(css).toMatch(/:root\[data-theme="dark"\] \{\s*color-scheme: dark;/)
  const rules = css.slice(css.indexOf('}', css.indexOf(':root[data-theme="dark"] {')) + 1)
  expect(rules.match(/#[0-9a-f]{3,8}\b|rgba?\(|\bwhite\b(?!-space)/gi)).toBeNull()
  for (const file of ['src/styles/index.css', ...readdirSync(resolve('src/features')).flatMap((feature) => readdirSync(resolve('src/features', feature)).filter((name) => name.endsWith('.css')).map((name) => `src/features/${feature}/${name}`))])
    expect([file, readFileSync(resolve(file), 'utf8').match(/#[0-9a-f]{3,8}\b|rgba?\(/gi)]).toEqual([file, null])
})
it('leaves no trace of the previous teal brand in the client', () => {
  const files: string[] = []
  const walk = (dir: string) => { for (const name of readdirSync(dir)) { const path = join(dir, name); if (statSync(path).isDirectory()) walk(path); else files.push(path) } }
  walk(resolve('src')); walk(resolve('public')); files.push(resolve('index.html'))
  const oldBrand = /#(166775|105462|eaf4f5|c8dde2|17697a|237d91|143b4c|c5e8e5|c6e1e7|d7e8eb|d0e3e9|e7f1f5|1e5b72|8fb3bd|5c8e9c|69a2ad|f6fafb|fbfdfd|f8fbfc|f4f9fa|edf5f6|f7fbfc|dfe7eb|233c49|f3f6f8|172f3c|526974|d7e2e7|c3d3da|7d95a1|f7fafb|eef3f5)\b/i
  expect(files.filter((file) => oldBrand.test(readFileSync(file, 'utf8')))).toEqual([])
})
it('follows the system setting until a choice is made, then remembers only that choice', () => {
  systemScheme(false); initTheme()
  expect([themeStore.getPreference(), root().dataset.theme, root().style.colorScheme, meta().getAttribute('content')]).toEqual(['system', 'light', 'light', themeColors.light])
  stopTheme(); systemScheme(true); initTheme()
  expect([root().dataset.theme, meta().getAttribute('content')]).toEqual(['dark', themeColors.dark])
  themeStore.setPreference('light')
  expect([root().dataset.theme, localStorage.getItem(themeStorageKey)]).toEqual(['light', 'light'])
  stopTheme(); initTheme()
  expect([themeStore.getPreference(), root().dataset.theme]).toEqual(['light', 'light'])
  themeStore.setPreference('system')
  expect([root().dataset.theme, localStorage.getItem(themeStorageKey)]).toEqual(['dark', 'system'])
  // Only the bare preference word is stored, under one key.
  expect([Object.keys(localStorage), sessionStorage.length]).toEqual([[themeStorageKey], 0])
})
it('ignores malformed or unavailable storage and falls back to the system setting', () => {
  systemScheme(true)
  for (const stored of ['purple', '{"theme":"dark","user":"x"}', 'DARK', '']) {
    localStorage.setItem(themeStorageKey, stored)
    expect([stored, readThemePreference()]).toEqual([stored, 'system'])
  }
  themeStore.setPreference('nonsense' as never)
  expect(localStorage.getItem(themeStorageKey)).toBe('')
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
  initTheme(); expect([themeStore.getPreference(), root().dataset.theme]).toEqual(['system', 'dark'])
  themeStore.setPreference('light'); expect(root().dataset.theme).toBe('light')
  expect(resolveTheme('system', false)).toBe('light'); expect(resolveTheme('dark', false)).toBe('dark')
})
it('updates with operating-system changes only while System is chosen', () => {
  const system = systemScheme(false); initTheme()
  system.change(true); expect(root().dataset.theme).toBe('dark')
  system.change(false); expect(root().dataset.theme).toBe('light')
  themeStore.setPreference('light'); system.change(true)
  expect(root().dataset.theme).toBe('light')
  themeStore.setPreference('dark'); system.change(false)
  expect(root().dataset.theme).toBe('dark')
  themeStore.setPreference('system'); expect(root().dataset.theme).toBe('light')
})
it('offers an accessible Light, Dark and System choice that switches without reloading', async () => {
  systemScheme(false); initTheme()
  await render(<ThemeControl />)
  const [group] = groups()
  expect(group!.getAttribute('aria-labelledby')).toBe(group!.querySelector('p')!.id); expect(group!.querySelector('p')!.textContent).toBe('Theme')
  expect(Array.from(group!.querySelectorAll('button')).map((item) => [item.textContent, item.type, item.getAttribute('aria-pressed')])).toEqual([['Light', 'button', 'false'], ['Dark', 'button', 'false'], ['System', 'button', 'true']])
  await choose(group!, 'Dark')
  expect([pressed(group!), root().dataset.theme, localStorage.getItem(themeStorageKey)]).toEqual([['Dark'], 'dark', 'dark'])
})
it('puts the theme choice in the desktop sidebar and the mobile menu, in step, without refetching', async () => {
  systemScheme(false); initTheme()
  const dashboard = vi.spyOn(dashboardApi, 'get').mockImplementation(async () => dashboardFor('ADMIN'))
  const unread = vi.spyOn(notificationsApi, 'unreadCount').mockResolvedValue({ count: 3 })
  await render(<App />); await act(async () => { await Promise.resolve() })
  const desktop = host.querySelector<HTMLElement>('.desktop-sidebar .sidebar-bottom > .theme-control')!
  expect(desktop.nextElementSibling?.classList.contains('sidebar-identity')).toBe(true)
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Open navigation"]')!.click())
  const drawer = host.querySelector<HTMLElement>('[role="dialog"] .mobile-sidebar .theme-control')!
  expect(drawer).not.toBeNull()
  const calls = [dashboard.mock.calls.length, unread.mock.calls.length]
  await choose(drawer, 'Dark')
  expect([pressed(drawer), pressed(desktop), root().dataset.theme]).toEqual([['Dark'], ['Dark'], 'dark'])
  await choose(desktop, 'Light')
  expect([pressed(drawer), root().dataset.theme]).toEqual([['Light'], 'light'])
  expect([dashboard.mock.calls.length, unread.mock.calls.length]).toEqual(calls)
  expect(host.querySelector('[role="dialog"]')).not.toBeNull()
})
it('offers the theme choice on sign-in, outside the sign-in form', async () => {
  systemScheme(true); initTheme()
  await render(<Login onLogin={vi.fn()} />)
  const [group] = groups()
  expect(group!.closest('form')).toBeNull(); expect(group!.closest('.login-meta')).not.toBeNull()
  expect(root().dataset.theme).toBe('dark')
  await choose(group!, 'Light'); expect(root().dataset.theme).toBe('light')
  expect(host.querySelector('form')!.querySelectorAll('button')).toHaveLength(2)
})
it('applies the saved theme before the application script runs', () => {
  const html = readFileSync(resolve('index.html'), 'utf8'), head = html.slice(0, html.indexOf('</head>'))
  expect(head.indexOf('<meta name="theme-color"')).toBeLessThan(head.indexOf('<script src="/theme-init.js"></script>'))
  expect(head).toContain('<script src="/theme-init.js"></script>'); expect(html.indexOf('/theme-init.js')).toBeLessThan(html.indexOf('type="module"'))
  const bootstrap = readFileSync(resolve('public/theme-init.js'), 'utf8')
  for (const value of [`'${themeStorageKey}'`, themeColors.light, themeColors.dark]) expect([value, bootstrap.includes(value)]).toEqual([value, true])
  const run = () => new Function(bootstrap)()
  const cases: [string | null, boolean, string][] = [['dark', false, 'dark'], ['light', true, 'light'], ['system', true, 'dark'], [null, false, 'light'], ['{"x":1}', true, 'dark']]
  for (const [stored, systemDark, expected] of cases) {
    localStorage.clear(); if (stored !== null) localStorage.setItem(themeStorageKey, stored)
    systemScheme(systemDark); root().removeAttribute('data-theme'); run()
    expect([stored, systemDark, root().dataset.theme, root().style.colorScheme, meta().getAttribute('content')]).toEqual([stored, systemDark, expected, expected, themeColors[expected as 'light' | 'dark']])
  }
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') }); systemScheme(false); run()
  expect(root().dataset.theme).toBe('light')
})
it('styles shells, dialogs, tables, fields, charts and unread notices from theme tokens', () => {
  const css = sharedCss(), rule = (selector: string, source = css) => source.slice(source.indexOf(selector)).split('}')[0]!
  expect(rule('.sidebar {')).toContain('background: var(--surface)'); expect(rule('.sidebar nav button.active {')).toMatch(/background: var\(--brand-soft\);.*inset 3px 0 0 var\(--brand-accent\)/)
  expect(rule('.nav-badge {')).toContain('background: var(--brand); color: var(--on-brand)')
  expect(rule('.modal {')).toContain('background: var(--surface-raised)'); expect(rule('.modal-backdrop {')).toContain('background: var(--backdrop)')
  expect(rule('.patients-table th, .appointment-table th, .staff-table th {')).toContain('background: var(--surface-muted)')
  expect(rule(':where(input:not([type="radio"], [type="checkbox"], [type="hidden"]), select, textarea) {')).toMatch(/border: 1px solid var\(--field-border\);.*background: var\(--surface\); color: var\(--deep\)/s)
  expect(css).toContain(':where(input, textarea)::placeholder { color: var(--muted); opacity: 1; }')
  expect(css).toContain(':where(input, textarea, select):-webkit-autofill { -webkit-text-fill-color: var(--deep); caret-color: var(--deep); box-shadow: 0 0 0 1000px var(--autofill) inset; }')
  expect(rule('.login-visual {')).toContain('background: var(--login-panel)')
  const reports = readFileSync(resolve('src/features/reports/reports.css'), 'utf8'), notices = readFileSync(resolve('src/features/notifications/notifications.css'), 'utf8')
  expect(reports).toContain('.chart-bar.tone-primary { fill: var(--chart-1); } .chart-bar.tone-secondary { fill: var(--chart-2); } .chart-bar.tone-accent { fill: var(--chart-3); }')
  expect(reports).toContain('.chart-grid { stroke: var(--chart-grid);')
  expect(notices).toContain('.notification-item.is-unread { background: var(--unread-bg); box-shadow: inset 3px 0 0 var(--brand-accent); }')
  expect(notices).toContain('.notification-item.is-unread h3 { font-weight: 700; }')
  expect(rule('.theme-segments button, .report-segments button,')).toContain('min-height: 44px')
})
