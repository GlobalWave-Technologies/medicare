import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runInNewContext } from 'node:vm'
import { afterEach, expect, it, vi } from 'vitest'
import { SHELL_FILES, buildServiceWorker, medicareServiceWorker } from '../pwa/build'

const CLIENT = join(import.meta.dirname, '..')
const template = readFileSync(join(CLIENT, 'pwa/service-worker.js'), 'utf8')
const FILES = [...SHELL_FILES, '/assets/index-abc123.js', '/assets/index-def456.css']
const contents = Object.fromEntries(FILES.map((path) => [path, `content of ${path}`]))

type Listener = (event: Record<string, unknown>) => void
// Runs the generated worker in an isolated context with fake Cache Storage and network.
function boot({ online = true, existing = [] as string[] } = {}) {
  const source = buildServiceWorker(template, FILES, contents)
  const stores = new Map<string, Map<string, string>>()
  for (const name of existing) stores.set(name, new Map())
  const puts: string[] = []
  const cacheFor = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map())
    const entries = stores.get(name)!
    return {
      addAll: vi.fn(async (requests: { url: string }[]) => { for (const request of requests) entries.set(new URL(request.url, 'https://medicare.test').pathname, `cached ${request.url}`) }),
      match: vi.fn(async (path: string) => entries.has(path) ? { body: entries.get(path), fromCache: true } : undefined),
      put: vi.fn(async (request: string) => { puts.push(String(request)) }),
    }
  }
  const caches = { open: vi.fn(async (name: string) => cacheFor(name)), keys: vi.fn(async () => [...stores.keys()]), delete: vi.fn(async (name: string) => stores.delete(name)) }
  const network = vi.fn(async (request: { url: string }) => { if (!online) throw new TypeError('Failed to fetch'); return { body: `network ${request.url}`, fromCache: false } })
  const listeners: Record<string, Listener> = {}
  const self = { location: { origin: 'https://medicare.test' }, addEventListener: (type: string, listener: Listener) => { listeners[type] = listener },
    skipWaiting: vi.fn(), clients: { claim: vi.fn(async () => {}) } }
  class FakeRequest { url: string; cache?: string; constructor(url: string, init: { cache?: string } = {}) { this.url = url; this.cache = init.cache } }
  runInNewContext(source, { self, caches, fetch: network, Request: FakeRequest, Response: { error: () => ({ error: true }) }, URL, console })
  async function fetchEvent(path: string, { method = 'GET', mode = 'cors', origin = 'https://medicare.test' } = {}) {
    let responded: Promise<unknown> | undefined
    listeners.fetch!({ request: { url: origin + path, method, mode }, respondWith: (value: Promise<unknown>) => { responded = value } })
    return responded === undefined ? 'network-default' : await responded
  }
  async function lifecycle(type: 'install' | 'activate') {
    let pending: Promise<unknown> | undefined
    listeners[type]!({ waitUntil: (value: Promise<unknown>) => { pending = value } })
    await pending
  }
  return { listeners, stores, caches, network, puts, self, fetchEvent, lifecycle, source }
}
const versionOf = (source: string) => /const VERSION = "([0-9a-f]+)"/.exec(source)?.[1]

afterEach(() => { vi.restoreAllMocks() })

it('precaches exactly the static release files: shell, theme script, icons, manifest and fingerprinted assets', async () => {
  const worker = boot()
  await worker.lifecycle('install')
  const [name] = [...worker.stores.keys()]
  expect(name).toBe(`medicare-static-${versionOf(worker.source)}`)
  expect([...worker.stores.get(name!)!.keys()].sort()).toEqual([...FILES].sort())
  expect([...worker.stores.get(name!)!.keys()].some((path) => path.startsWith('/api'))).toBe(false)
})

it('never answers or stores API traffic: patients, clinical records, notifications, staff, reports or auth', async () => {
  const worker = boot()
  await worker.lifecycle('install')
  for (const path of ['/api/v1/patients', '/api/v1/patients/123', '/api/v1/encounters/abc', '/api/v1/appointments', '/api/v1/notifications', '/api/v1/staff',
    '/api/v1/dashboard', '/api/v1/reports/patients', '/api/v1/auth/me', '/api/v1/auth/csrf', '/api/v1/health']) {
    expect(await worker.fetchEvent(path)).toBe('network-default')
    expect(await worker.fetchEvent(path, { mode: 'navigate' })).toBe('network-default')
  }
  expect(await worker.fetchEvent('/api/v1/patients', { method: 'POST' })).toBe('network-default')
  expect(await worker.fetchEvent('/patients', { method: 'POST', mode: 'navigate' })).toBe('network-default')
  expect(worker.network).not.toHaveBeenCalled()
  expect(worker.puts).toEqual([])
})

it('serves the live page online and the data-free shell offline; nothing fetched at run time is stored', async () => {
  const online = boot({ online: true })
  await online.lifecycle('install')
  expect(await online.fetchEvent('/patients/123', { mode: 'navigate' })).toEqual({ body: 'network https://medicare.test/patients/123', fromCache: false })
  const offline = boot({ online: false })
  await offline.lifecycle('install')
  expect(await offline.fetchEvent('/patients/123', { mode: 'navigate' })).toEqual({ body: 'cached /index.html', fromCache: true })
  expect([...online.puts, ...offline.puts]).toEqual([])
})

it('answers precached static files from the release cache and leaves everything else to the network', async () => {
  const worker = boot({ online: false })
  await worker.lifecycle('install')
  expect(await worker.fetchEvent('/assets/index-abc123.js')).toEqual({ body: 'cached /assets/index-abc123.js', fromCache: true })
  expect(await worker.fetchEvent('/icons/icon-192.png')).toEqual({ body: 'cached /icons/icon-192.png', fromCache: true })
  expect(await worker.fetchEvent('/theme-init.js')).toEqual({ body: 'cached /theme-init.js', fromCache: true })
  expect(await worker.fetchEvent('/assets/index-OLD.js')).toBe('network-default')
  expect(await worker.fetchEvent('/robots.txt')).toBe('network-default')
  expect(await worker.fetchEvent('/assets/x.js', { origin: 'https://cdn.example' })).toBe('network-default')
})

it('activation removes only Medicare’s earlier release caches and takes control', async () => {
  const worker = boot({ existing: ['medicare-static-0123456789abcdef', 'medicare-static-old', 'another-app-cache', 'workbox-precache'] })
  await worker.lifecycle('install')
  await worker.lifecycle('activate')
  expect([...worker.stores.keys()].sort()).toEqual(['another-app-cache', `medicare-static-${versionOf(worker.source)}`, 'workbox-precache'].sort())
  expect(worker.self.clients.claim).toHaveBeenCalled()
})

it('waits for a deliberate refresh before taking over, and has no sync, push or periodic sync', () => {
  const worker = boot()
  expect(worker.self.skipWaiting).not.toHaveBeenCalled()
  worker.listeners.message!({ data: { type: 'OTHER' } })
  expect(worker.self.skipWaiting).not.toHaveBeenCalled()
  worker.listeners.message!({ data: { type: 'SKIP_WAITING' } })
  expect(worker.self.skipWaiting).toHaveBeenCalledTimes(1)
  expect(Object.keys(worker.listeners).sort()).toEqual(['activate', 'fetch', 'install', 'message'])
  expect(template).not.toMatch(/registration\.sync|pushManager|periodicSync|showNotification|indexedDB|localStorage|IDBFactory|BroadcastChannel/)
})

it('a changed release (any cached file) produces a different worker version; an identical build does not', () => {
  const a = buildServiceWorker(template, FILES, contents), b = buildServiceWorker(template, FILES, contents)
  const c = buildServiceWorker(template, FILES, { ...contents, '/theme-init.js': 'changed' })
  const d = buildServiceWorker(template, [...FILES, '/assets/index-new789.js'], contents)
  expect(versionOf(a)).toBe(versionOf(b))
  expect(new Set([versionOf(a), versionOf(c), versionOf(d)]).size).toBe(3)
  expect(a).not.toContain('__MEDICARE_SW_')
})

it('the build plugin writes sw.js listing the built assets (and no source maps)', () => {
  const root = mkdtempSync(join(tmpdir(), 'medicare-sw-'))
  try {
    const outDir = join(root, 'dist'), publicDir = join(CLIENT, 'public')
    mkdirSync(join(outDir, 'assets'), { recursive: true })
    // A built dist: index.html from the client root, the rest copied from public/ (icons are read from public/ by the plugin).
    for (const file of ['index.html', 'theme-init.js', 'favicon.svg', 'manifest.webmanifest']) writeFileSync(join(outDir, file), readFileSync(join(file === 'index.html' ? CLIENT : publicDir, file)))
    writeFileSync(join(outDir, 'assets', 'index-AAAA1111.js'), 'js'); writeFileSync(join(outDir, 'assets', 'index-BBBB2222.css'), 'css'); writeFileSync(join(outDir, 'assets', 'index-AAAA1111.js.map'), 'map')
    // Relative (the default dist) and absolute --outDir values both resolve to the built directory.
    for (const configured of ['dist', outDir]) {
      rmSync(join(outDir, 'sw.js'), { force: true })
      const plugin = medicareServiceWorker() as unknown as { configResolved: (config: unknown) => void; writeBundle: () => void }
      plugin.configResolved({ root: join(root, 'project'), build: { outDir: configured === 'dist' ? '../dist' : configured }, publicDir })
      plugin.writeBundle()
      const sw = readFileSync(join(outDir, 'sw.js'), 'utf8')
      const list = JSON.parse(/const PRECACHE = (\[[^\]]*\])/.exec(sw)![1]!)
      expect(list).toEqual([...SHELL_FILES, '/assets/index-AAAA1111.js', '/assets/index-BBBB2222.css'])
      expect(list.some((path: string) => path.endsWith('.map'))).toBe(false)
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})

const png = (path: string) => { const data = readFileSync(path); return { signature: data.subarray(1, 4).toString(), width: data.readUInt32BE(16), height: data.readUInt32BE(20) } }
it('the manifest makes Medicare installable with its own name, orange theme and install icons', () => {
  const manifest = JSON.parse(readFileSync(join(CLIENT, 'public/manifest.webmanifest'), 'utf8'))
  expect(manifest).toMatchObject({ name: 'Medicare – Hospital Records', short_name: 'Medicare', start_url: '/', scope: '/', display: 'standalone', theme_color: '#c2410c', background_color: '#f9fafb' })
  const icons = manifest.icons as { src: string; sizes: string; type: string; purpose: string }[]
  for (const [size, purpose] of [['192x192', 'any'], ['512x512', 'any'], ['512x512', 'maskable']]) {
    const icon = icons.find((candidate) => candidate.sizes === size && candidate.purpose === purpose)!
    expect(icon.type).toBe('image/png')
    const file = png(join(CLIENT, 'public', icon.src))
    expect(file).toEqual({ signature: 'PNG', width: Number(size.split('x')[0]), height: Number(size.split('x')[1]) })
  }
  expect(png(join(CLIENT, 'public/icons/apple-touch-icon.png'))).toEqual({ signature: 'PNG', width: 180, height: 180 })
  for (const path of SHELL_FILES.filter((path) => path !== '/index.html')) expect(existsSync(join(CLIENT, 'public', path))).toBe(true)
})

it('the page links the manifest and Apple icon, and still loads no inline script', () => {
  const html = readFileSync(join(CLIENT, 'index.html'), 'utf8')
  expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />')
  expect(html).toContain('<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />')
  expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/)
  expect(html).not.toMatch(/<style|\sstyle=/)
})

it('stacking: the offline screen covers every dialog; the update notice stays beneath dialogs', () => {
  const css = readFileSync(join(CLIENT, 'src/pwa/pwa.css'), 'utf8') + readFileSync(join(CLIENT, 'src/styles/App.css'), 'utf8')
  const z = (selector: string) => Number(new RegExp(`\\${selector} \\{[^}]*z-index: (\\d+)`).exec(css)![1])
  expect(z('.offline-overlay')).toBeGreaterThan(z('.modal-backdrop'))
  expect(z('.update-notice')).toBeLessThan(z('.modal-backdrop'))
})

it('the documented frontend policy stays strict and already covers the worker and manifest', () => {
  const runbook = readFileSync(join(CLIENT, '../docs/release-operations.md'), 'utf8')
  const csp = /Content-Security-Policy: ([^\n]+)/.exec(runbook)![1]!
  expect(csp).toContain("default-src 'self'; script-src 'self'")
  expect(csp).not.toMatch(/unsafe-inline|unsafe-eval|\*|data:|blob:|worker-src|manifest-src/)
})
