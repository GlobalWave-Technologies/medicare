import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from '../src/shared/security/password.js'
import { bootstrapAdminSchema, staffNumberSchema } from '../src/modules/staff/staff.validation.js'

describe('password hashing and staff input', () => {
  it('uses salted Argon2id, verifies correctly, and rejects the wrong passphrase', async () => {
    const password = 'synthetic test passphrase only'
    const first = await hashPassword(password)
    const second = await hashPassword(password)
    expect(first).toMatch(/^\$argon2id\$v=19\$/)
    expect(first.split('$')[3]?.split(',').sort()).toEqual(['m=65536', 'p=1', 't=3'])
    expect(first).not.toBe(second)
    expect(first).not.toContain(password)
    expect(await verifyPassword(password, first)).toBe(true)
    expect(await verifyPassword('a different synthetic phrase', first)).toBe(false)
    expect(await verifyPassword(password, '$argon2id$invalid')).toBe(false)
    expect(await verifyPassword(password, 'plaintext')).toBe(false)
  })

  it.each(['short', ' '.repeat(20), 'a'.repeat(129), 'valid long string\0invalid'])('rejects invalid password input case %#', async (password) => {
    await expect(hashPassword(password)).rejects.toThrow('Invalid password input')
    expect(bootstrapAdminSchema.safeParse({ firstName: 'Synthetic', lastName: 'Administrator',
      email: 'test@example.test', staffNumber: 'STF-TEST001', password }).success).toBe(false)
  })

  it('supports Unicode passphrases and preserves whitespace', async () => {
    const password = '  long unicode passphrase 日本語  '
    const hash = await hashPassword(password)
    expect(await verifyPassword(password, hash)).toBe(true)
    expect(await verifyPassword(password.trim(), hash)).toBe(false)
  })

  it('normalizes staff identifiers and email without changing passwords', () => {
    const parsed = bootstrapAdminSchema.parse({ firstName: ' Synthetic ', lastName: ' Admin ',
      email: ' ADMIN@EXAMPLE.TEST ', staffNumber: ' stf-test001 ', password: '  synthetic long passphrase  ' })
    expect(parsed.email).toBe('admin@example.test')
    expect(parsed.staffNumber).toBe('STF-TEST001')
    expect(parsed.password).toBe('  synthetic long passphrase  ')
    expect(staffNumberSchema.safeParse('STF-short!').success).toBe(false)
  })
})
