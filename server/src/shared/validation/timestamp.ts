import { z } from 'zod'

// Explicit offset and millisecond precision match PostgreSQL timestamptz(3).
export const timezoneTimestamp = z.iso.datetime({ offset: true }).refine((value) =>
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  && !value.startsWith('0000') && Number.isFinite(Date.parse(value)))
