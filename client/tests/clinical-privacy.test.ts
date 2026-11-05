/// <reference types="node" />
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
const featurePath = resolve('src/features/records')
const source = readdirSync(featurePath).filter((name) => /\.tsx?$/.test(name)).map((name) => readFileSync(resolve(featurePath, name), 'utf8')).join('\n')
it('contains no clinical mock, console, analytics or browser-storage persistence in production feature code', () => {
  expect(source).not.toMatch(/mocks\/|console\.|localStorage|sessionStorage|indexedDB|analytics\.|fetch\(/)
  expect(source + readFileSync(resolve('src/api/encounters.ts'), 'utf8')).not.toMatch(/\bany\b/)
})
it('removes every mock data module, and reports never read encounter records', () => {
  expect(existsSync(resolve('src/mocks'))).toBe(false)
  expect(readFileSync(resolve('src/features/reports/Reports.tsx'), 'utf8')).not.toContain('/encounters')
  expect(readFileSync(resolve('src/api/reports.ts'), 'utf8')).not.toMatch(/\/encounters|encountersApi/)
})
