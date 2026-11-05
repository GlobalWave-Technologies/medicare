/// <reference types="node" />
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
const moduleUrl = pathToFileURL(resolve('src/features/appointments/appointment-time.ts')).href
function inZone(zone: string, expression: string): unknown {
  return JSON.parse(execFileSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', '--input-type=module', '-e', `import * as time from ${JSON.stringify(moduleUrl)}; console.log(JSON.stringify(${expression}))`], { env: { ...process.env, TZ: zone }, encoding: 'utf8' }))
}
it('converts New York local time without shifting the intended calendar date', () => {
  expect(inZone('America/New_York', "time.localInputToISO('2026-10-29T09:30')")).toBe('2026-10-29T13:30:00.000Z')
  expect(inZone('America/New_York', "time.toLocalInput('2026-10-29T02:30:00Z')")).toBe('2026-10-28T22:30')
})
it('rejects a spring-forward nonexistent local time', () => expect(inZone('America/New_York', "time.localInputToISO('2026-03-08T02:30')")).toBeNull())
it('chooses the earlier occurrence of a repeated fall-back local time', () => expect(inZone('America/New_York', "time.localInputToISO('2026-11-01T01:30')")).toBe('2026-11-01T05:30:00.000Z'))
it.each([['2026-03-08', 23], ['2026-11-01', 25]] as const)('uses calendar-day boundaries on %s (%s hours)', (date, hours) => {
  expect(inZone('America/New_York', `(() => { const range = time.localDateRange('${date}', '${date}'); return (Date.parse(range.dateTo) + 1 - Date.parse(range.dateFrom)) / 3600000 })()`)).toBe(hours)
})
it('supports a non-whole-hour timezone', () => expect(inZone('Asia/Kathmandu', "time.localInputToISO('2026-10-29T09:30')")).toBe('2026-10-29T03:45:00.000Z'))
it('uses the first existing instant when a calendar day skips midnight', () => {
  expect(inZone('America/Havana', "time.localDateRange('2026-03-08', '2026-03-08')")).toEqual({ dateFrom: '2026-03-08T05:00:00.000Z', dateTo: '2026-03-09T03:59:59.999Z' })
  expect(inZone('Pacific/Apia', "time.localDateRange('2011-12-30', '2011-12-30')")).toBeNull()
})

