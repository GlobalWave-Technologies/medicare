import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'
import { z } from 'zod'
import { isIP } from 'node:net'

const trustedProxies = z.string().default('').transform((value) => value ? value.split(',').map((part) => part.trim()) : [])
  .refine((values) => values.every((value) => {
    const [address, prefix, extra] = value.split('/')
    const version = isIP(address ?? '')
    if (!version || extra !== undefined) return false
    return prefix === undefined || (/^\d+$/.test(prefix) && Number(prefix) >= 1 && Number(prefix) <= (version === 4 ? 32 : 128))
  }), 'Must contain explicit proxy IP addresses or bounded CIDR ranges')

const databaseUrl = z.url().refine((value) => {
  if (!URL.canParse(value)) return false
  const url = new URL(value)
  return ['postgres:', 'postgresql:'].includes(url.protocol)
    && Boolean(url.hostname) && url.pathname.length > 1
}, 'Must be a PostgreSQL URL with a database name')

const origin = z.url().refine((value) => {
  if (!URL.canParse(value)) return false
  const url = new URL(value)
  return ['http:', 'https:'].includes(url.protocol) && value === url.origin
}, 'Must be an HTTP(S) origin without a path or trailing slash')

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.coerce.number().int().min(1).max(65535),
  DATABASE_URL: databaseUrl,
  CLIENT_ORIGIN: origin,
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']),
  TRUSTED_PROXY_CIDRS: trustedProxies,
}).superRefine((value, context) => {
  if (value.NODE_ENV === 'production' && !value.CLIENT_ORIGIN.startsWith('https://')) {
    context.addIssue({ code: 'custom', path: ['CLIENT_ORIGIN'], message: 'Production requires HTTPS' })
  }
})

export type Environment = z.infer<typeof environmentSchema>

export class ConfigurationError extends Error {
  constructor(fields: string[]) {
    super(`Invalid or missing environment variables: ${[...new Set(fields)].join(', ')}`)
    this.name = 'ConfigurationError'
  }
}

export function parseEnvironment(input: Record<string, string | undefined>): Environment {
  const production = input.NODE_ENV === 'production'
  const parsed = environmentSchema.safeParse({
    NODE_ENV: input.NODE_ENV ?? 'development',
    PORT: input.PORT ?? (production ? undefined : '4000'),
    DATABASE_URL: input.DATABASE_URL,
    CLIENT_ORIGIN: input.CLIENT_ORIGIN ?? (production ? undefined : 'http://localhost:5173'),
    LOG_LEVEL: input.LOG_LEVEL ?? (production ? undefined : 'info'),
    TRUSTED_PROXY_CIDRS: input.TRUSTED_PROXY_CIDRS,
  })
  if (!parsed.success) {
    throw new ConfigurationError(parsed.error.issues.map((issue) => String(issue.path[0])))
  }
  return parsed.data
}

function loadEnvironmentFile() {
  config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true })
}

export function loadEnvironment(): Environment {
  loadEnvironmentFile()
  return parseEnvironment(process.env)
}

// Generation/validation do not need a live database or runtime configuration.
// Prisma commands that connect to a database require this URL themselves.
export function loadDatabaseUrl(): string | undefined {
  loadEnvironmentFile()
  const value = process.env.DATABASE_URL
  if (value === undefined) return undefined
  const parsed = databaseUrl.safeParse(value)
  if (!parsed.success) throw new ConfigurationError(['DATABASE_URL'])
  return parsed.data
}

export function loadBootstrapEnvironment() {
  const url = loadDatabaseUrl()
  if (!url) throw new ConfigurationError(['DATABASE_URL'])
  return {
    databaseUrl: url,
    admin: {
      firstName: process.env.BOOTSTRAP_ADMIN_FIRST_NAME,
      lastName: process.env.BOOTSTRAP_ADMIN_LAST_NAME,
      email: process.env.BOOTSTRAP_ADMIN_EMAIL,
      staffNumber: process.env.BOOTSTRAP_ADMIN_STAFF_NUMBER,
      password: process.env.BOOTSTRAP_ADMIN_PASSWORD,
    },
  }
}

export function parseTestDatabaseEnvironment(input: Record<string, string | undefined>) {
  const parsed = databaseUrl.safeParse(input.TEST_DATABASE_URL)
  if (input.NODE_ENV !== 'test' || !parsed.success) {
    throw new ConfigurationError(['NODE_ENV=test', 'TEST_DATABASE_URL'])
  }
  const url = new URL(parsed.data)
  // Explicit test-only name and loopback host; never fall back to DATABASE_URL.
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || !/^medicare_test_[a-z0-9_]+$/.test(url.pathname.slice(1))
    || url.search || url.hash) {
    throw new ConfigurationError(['TEST_DATABASE_URL (loopback, medicare_test_* database, no URL options)'])
  }
  return parseEnvironment({ NODE_ENV: 'test', DATABASE_URL: parsed.data })
}

export function loadTestDatabaseEnvironment() {
  loadEnvironmentFile()
  return parseTestDatabaseEnvironment(process.env)
}
