import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import type { Plugin, ResolvedConfig } from 'vite'

const template = () => readFileSync(new URL('./service-worker.js', import.meta.url), 'utf8')

// Public files that are safe to keep for the offline shell. Everything else in client/public
// (and every API response) is left to the network.
export const SHELL_FILES = ['/index.html', '/theme-init.js', '/favicon.svg', '/manifest.webmanifest',
  '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png', '/icons/apple-touch-icon.png']

const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name)
  return statSync(path).isDirectory() ? files(path) : [path]
})

// Writes the release's version (a digest of every cached file) and file list into the worker.
// A new release therefore produces a different worker, which the browser installs as an update.
export function buildServiceWorker(source: string, cached: string[], contents: Record<string, Buffer | string>) {
  const hash = createHash('sha256')
  for (const path of [...cached].sort()) hash.update(path).update('\0').update(contents[path] ?? '').update('\0')
  const version = hash.digest('hex').slice(0, 16)
  return source.replace("'__MEDICARE_SW_VERSION__'", JSON.stringify(version)).replace('__MEDICARE_SW_FILES__', JSON.stringify(cached))
}

export function medicareServiceWorker(): Plugin {
  let config: ResolvedConfig
  return {
    name: 'medicare-service-worker',
    apply: 'build',
    configResolved(resolved) { config = resolved },
    writeBundle() {
      // resolve, not join: an absolute --outDir must not be appended to the project root.
      const outDir = resolve(config.root, config.build.outDir)
      const assets = files(join(outDir, 'assets')).filter((path) => !path.endsWith('.map'))
        .map((path) => '/' + relative(outDir, path).split(sep).join('/')).sort()
      const cached = [...SHELL_FILES, ...assets]
      const contents: Record<string, Buffer> = {}
      for (const path of cached) {
        const fromOut = join(outDir, path.slice(1)), fromPublic = join(config.publicDir, path.slice(1))
        try { contents[path] = readFileSync(fromOut) } catch { contents[path] = readFileSync(fromPublic) }
      }
      writeFileSync(join(outDir, 'sw.js'), buildServiceWorker(template(), cached, contents))
    },
  }
}
