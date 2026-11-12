import { expect, it } from 'vitest'
import { displayTime, localDateRange, localInputToISO, toLocalInput } from '../src/lib/time'

// Local-time helpers shared by admissions, clinical records and notifications.
const instant = '2026-10-29T09:30:00.000Z'
it('formats local display and round-trips a local input to the same instant', () => {
  expect(displayTime(instant)).toBe(new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(instant)))
  expect(localInputToISO(toLocalInput(instant))).toBe(instant)
  expect(displayTime('not a time')).toBe('Not recorded')
  expect(toLocalInput('not a time')).toBe('')
})
it.each(['', '2026-02-30T12:00', '2026-13-01T12:00', '2026-10-29T25:00', '2026-10-29', '2026-10-29T12:00Z'])('rejects invalid local input %s', (input) => expect(localInputToISO(input)).toBeNull())
it('uses inclusive local calendar boundaries and refuses reversed or malformed ranges', () => {
  const range = localDateRange('2026-10-29', '2026-10-29')!
  expect(toLocalInput(range.dateFrom)).toBe('2026-10-29T00:00')
  expect(toLocalInput(range.dateTo)).toBe('2026-10-29T23:59')
  expect(range.dateTo.endsWith('59.999Z')).toBe(true)
  expect(localDateRange('2026-10-30', '2026-10-29')).toBeNull()
  expect(localDateRange('2026-10-29', 'tomorrow')).toBeNull()
})
