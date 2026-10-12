import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readdir } from 'node:fs/promises'
import { Client } from 'pg'
import { loadTestDatabaseEnvironment } from '../src/config/env.js'

const serverRoot = fileURLToPath(new URL('../', import.meta.url))

async function run(args: string[], databaseUrl: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: serverRoot, windowsHide: true, stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'test', TEST_DATABASE_URL: databaseUrl, DATABASE_URL: databaseUrl },
    })
    child.on('error', () => reject(new Error('Test subprocess could not start')))
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error('Database verification failed')))
  })
}

async function main() {
  const env = loadTestDatabaseEnvironment()
  const control = new Client({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 3000 })
  const suites = (await readdir(new URL('./', import.meta.url))).filter((name) => name.endsWith('.database.test.ts')).sort()
  try {
    await control.connect()
    for (const suite of suites) await runSuite(control, env.DATABASE_URL, suite)
  } finally { await control.end() }
}

async function runSuite(control: Client, databaseUrl: string, suite: string) {
  const name = `medicare_test_run_${randomUUID().replaceAll('-', '')}`
  // Never drop/reset the configured database. Only this freshly generated name
  // is mutated and removed; the control database is used for CREATE/DROP only.
  if (!/^medicare_test_run_[a-f0-9]{32}$/.test(name)) throw new Error('Unsafe generated database name')
  const url = new URL(databaseUrl)
  url.pathname = `/${name}`
  let created = false
  try {
    await control.query(`CREATE DATABASE "${name}"`)
    created = true
    await run(['../node_modules/prisma/build/index.js', 'validate'], url.href)
    await run(['../node_modules/prisma/build/index.js', 'migrate', 'deploy'], url.href)
    await run(['../node_modules/prisma/build/index.js', 'migrate', 'deploy'], url.href)
    await run(['../node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.database.config.ts', `tests/${suite}`], url.href)
  } finally {
    if (created) await control.query(`DROP DATABASE "${name}" WITH (FORCE)`)
  }
}

main().catch(() => {
  process.stderr.write('Database tests failed. Require NODE_ENV=test, a loopback TEST_DATABASE_URL named medicare_test_*, and CREATEDB permission. The configured database is never reset.\n')
  process.exitCode = 1
})
