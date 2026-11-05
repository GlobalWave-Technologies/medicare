import { describe, expect, it } from 'vitest'
import { parseEnvironment } from '../src/config/env.js'

const database = 'postgresql://test:placeholder@localhost:5432/medicare_test'

describe('environment validation', () => {
  it('requires an HTTPS client origin in production', () => {
    expect(() => parseEnvironment({ NODE_ENV: 'production', PORT: '4000', DATABASE_URL: database,
      LOG_LEVEL: 'info', CLIENT_ORIGIN: 'http://hospital.example.test', TRUSTED_PROXY_CIDRS: 'none' })).toThrow('CLIENT_ORIGIN')
  })
  it('requires production to state its proxy trust, with none for direct connections', () => {
    const production = { NODE_ENV: 'production', PORT: '4000', DATABASE_URL: database, LOG_LEVEL: 'info', CLIENT_ORIGIN: 'https://hospital.example.test' }
    for (const value of [undefined, '']) expect(() => parseEnvironment({ ...production, TRUSTED_PROXY_CIDRS: value })).toThrow(/^Invalid or missing environment variables: TRUSTED_PROXY_CIDRS$/)
    expect(parseEnvironment({ ...production, TRUSTED_PROXY_CIDRS: 'none' }).TRUSTED_PROXY_CIDRS).toEqual([])
    expect(parseEnvironment({ ...production, TRUSTED_PROXY_CIDRS: '10.20.0.5' }).TRUSTED_PROXY_CIDRS).toEqual(['10.20.0.5'])
    expect(() => parseEnvironment({ ...production, TRUSTED_PROXY_CIDRS: 'none,10.20.0.5' })).toThrow('TRUSTED_PROXY_CIDRS')
  })
  it.each(['true', '*', '1', '0.0.0.0/0', '::/0', '127.0.0.1/33', '::1/129', 'localhost', '127.0.0.1/8/9'])('rejects unsafe proxy trust %s', (value) => {
    expect(() => parseEnvironment({ DATABASE_URL: database, TRUSTED_PROXY_CIDRS: value })).toThrow('TRUSTED_PROXY_CIDRS')
  })

  it('accepts explicit proxy addresses and bounded CIDRs', () => {
    expect(parseEnvironment({ DATABASE_URL: database, TRUSTED_PROXY_CIDRS: '127.0.0.1, ::1/128,10.10.0.0/24' }).TRUSTED_PROXY_CIDRS)
      .toEqual(['127.0.0.1', '::1/128', '10.10.0.0/24'])
  })
  it('uses only safe development defaults', () => {
    expect(parseEnvironment({ DATABASE_URL: database })).toEqual({
      NODE_ENV: 'development', PORT: 4000, DATABASE_URL: database,
      CLIENT_ORIGIN: 'http://localhost:5173', LOG_LEVEL: 'info', TRUSTED_PROXY_CIDRS: [],
    })
  })

  it('requires a database URL even in development', () => {
    expect(() => parseEnvironment({})).toThrow('DATABASE_URL')
  })

  it('requires explicit production configuration', () => {
    expect(() => parseEnvironment({ NODE_ENV: 'production' })).toThrow('PORT, DATABASE_URL, CLIENT_ORIGIN, LOG_LEVEL, TRUSTED_PROXY_CIDRS')
    expect(parseEnvironment({ NODE_ENV: 'production', PORT: '8080', DATABASE_URL: database,
      CLIENT_ORIGIN: 'https://hospital.example.test', LOG_LEVEL: 'warn', TRUSTED_PROXY_CIDRS: 'none' }).PORT).toBe(8080)
  })

  it.each(['', '0', '65536', 'abc', '3.5'])('rejects invalid port %s', (port) => {
    expect(() => parseEnvironment({ DATABASE_URL: database, PORT: port })).toThrow('PORT')
  })

  it.each(['*', 'https://example.test/path', 'https://example.test/', 'ftp://example.test', 'https://user:pass@example.test'])('rejects invalid origin %s', (origin) => {
    expect(() => parseEnvironment({ DATABASE_URL: database, CLIENT_ORIGIN: origin })).toThrow('CLIENT_ORIGIN')
  })

  it.each(['mysql://test:secret@localhost/db', 'postgresql://localhost', 'not-a-url'])('rejects invalid database URL without leaking it', (url) => {
    expect(() => parseEnvironment({ DATABASE_URL: url })).toThrow(/^Invalid or missing environment variables: DATABASE_URL$/)
  })

  it('rejects unknown environment and log level', () => {
    expect(() => parseEnvironment({ DATABASE_URL: database, NODE_ENV: 'prod', LOG_LEVEL: 'verbose' })).toThrow('NODE_ENV, LOG_LEVEL')
  })
})
