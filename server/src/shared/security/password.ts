import { argon2id, hash, verify } from 'argon2'
import { passwordSchema } from './passwordPolicy.js'

export async function hashPassword(password: string): Promise<string> {
  if (!passwordSchema.safeParse(password).success) throw new Error('Invalid password input')
  return hash(password, { type: argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1, hashLength: 32 })
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  if (!passwordSchema.safeParse(password).success || !passwordHash.startsWith('$argon2id$')) return false
  try {
    return await verify(passwordHash, password)
  } catch {
    return false
  }
}
