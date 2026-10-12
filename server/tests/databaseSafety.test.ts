import { expect, it } from 'vitest'
import { parseTestDatabaseEnvironment } from '../src/config/env.js'

it('never falls back to the application DATABASE_URL', () => {
  expect(() => parseTestDatabaseEnvironment({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://localhost/production' })).toThrow('TEST_DATABASE_URL')
})

it.each([
  { NODE_ENV: 'production', TEST_DATABASE_URL: 'postgresql://localhost/medicare_test_control' },
  { NODE_ENV: 'test', TEST_DATABASE_URL: 'postgresql://remote.example.test/medicare_test_control' },
  { NODE_ENV: 'test', TEST_DATABASE_URL: 'postgresql://localhost/medicare' },
  { NODE_ENV: 'test', TEST_DATABASE_URL: 'postgresql://localhost/production' },
  { NODE_ENV: 'test', TEST_DATABASE_URL: 'postgresql://localhost/medicare_test_control?host=remote.example.test' },
])('refuses unsafe database test configuration %#', (input) => {
  expect(() => parseTestDatabaseEnvironment(input)).toThrow()
})

it('accepts an explicit loopback test control database', () => {
  const env = parseTestDatabaseEnvironment({ NODE_ENV: 'test', TEST_DATABASE_URL: 'postgresql://localhost/medicare_test_control' })
  expect(env.DATABASE_URL).toBe('postgresql://localhost/medicare_test_control')
})
