import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { Client } from 'pg'
import { afterEach, expect, it } from 'vitest'
import { isolatedTestEnvironment } from './helpers/database.js'
import { withTimeout } from '../src/shared/utils/withTimeout.js'

const env = isolatedTestEnvironment()

const children: ChildProcess[] = []
afterEach(() => {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill()
  }
  children.length = 0
})

async function availablePort() {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected a TCP address')
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  return address.port
}

function start(port: number, databaseUrl = env.DATABASE_URL) {
  // The test-only IPC bridge exercises the real signal handler on Windows too,
  // where child.kill('SIGTERM') would forcibly terminate instead of draining.
  // Test the freshly built production artifact, retaining the startup deadlines.
  const child = spawn(process.execPath, ['--input-type=module', '-e',
    "process.on('message', () => process.emit('SIGTERM')); process.channel?.unref(); await import('./dist/server.js');"], {
    cwd: new URL('../', import.meta.url),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env, NODE_ENV: 'production', PORT: String(port),
      DATABASE_URL: databaseUrl, CLIENT_ORIGIN: 'https://client.example.test', LOG_LEVEL: 'info', TRUSTED_PROXY_CIDRS: 'none' },
  })
  children.push(child)
  let output = ''
  const exited = once(child, 'exit')
  const listening = new Promise<void>((resolve, reject) => {
    child.on('error', reject)
    child.on('exit', () => reject(new Error('Server exited before listening')))
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString()
      if (output.includes('Server listening')) resolve()
    })
  })
  // Startup failure is asserted via exit status in the negative test below.
  void listening.catch(() => undefined)
  child.stderr?.on('data', (chunk: Buffer) => { output += chunk.toString() })
  return { child, exited, listening, output: () => output }
}

it('starts the real listener, serves readiness, and drains on SIGTERM', async () => {
  const port = await availablePort()
  const server = start(port)
  await withTimeout(server.listening, 8000)
  const response = await fetch(`http://127.0.0.1:${port}/api/v1/health/ready`)
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ success: true, data: { status: 'ready' } })
  server.child.send('shutdown')
  const [exitCode] = await withTimeout(server.exited, 8000)
  expect(exitCode).toBe(0)
  expect(server.output()).toContain('Server stopped')
  expect(server.output()).not.toContain(env.DATABASE_URL)
})

it('completes a write already in progress before stopping, and commits it exactly once', async () => {
  const audits = async () => {
    const client = new Client({ connectionString: env.DATABASE_URL }); await client.connect()
    try { return (await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM "AuditEvent" WHERE action = 'LOGIN_FAILED'`)).rows[0]!.n } finally { await client.end() }
  }
  const port = await availablePort(), server = start(port), before = await audits()
  await withTimeout(server.listening, 8000)
  // A refused sign-in hashes a password and then writes one audit event: slow enough to still be running.
  const inFlight = fetch(`http://127.0.0.1:${port}/api/v1/auth/login`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://client.example.test' },
    body: JSON.stringify({ email: 'nobody@example.test', password: 'Synthetic in-flight passphrase' }) })
  await new Promise((resolve) => setTimeout(resolve, 30))
  server.child.send('shutdown')
  const response = await withTimeout(inFlight, 8000)
  expect(response.status).toBe(401)
  const [exitCode] = await withTimeout(server.exited, 8000)
  expect(exitCode).toBe(0)
  expect(await audits()).toBe(before + 1)
  expect(server.output()).toContain('Server stopped')
  expect(server.output()).not.toMatch(/Synthetic in-flight passphrase|nobody@example/)
})

it('exits nonzero on missing production configuration without opening a listener', async () => {
  const server = start(await availablePort(), '')
  const [exitCode] = await withTimeout(server.exited, 8000)
  expect(exitCode).toBe(1)
  expect(server.output()).toContain('Invalid or missing environment variables: DATABASE_URL')
  expect(server.output()).not.toContain('Server listening')
})

it('exits nonzero with safe logs when PostgreSQL is unreachable', async () => {
  const closedPort = await availablePort()
  const server = start(await availablePort(), `postgresql://test:private-password@127.0.0.1:${closedPort}/unavailable`)
  const [exitCode] = await withTimeout(server.exited, 8000)
  expect(exitCode).toBe(1)
  expect(server.output()).toContain('Startup failed')
  expect(server.output()).toContain('Server stopped')
  expect(server.output()).not.toMatch(/private-password|postgresql:\/\/|Server listening/)
})
