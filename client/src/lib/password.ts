// Mirrors the server password policy so people can correct a password before sending it. The
// server stays authoritative. Passwords are counted in characters and never trimmed or changed.
export const PASSWORD_MIN = 15
export const PASSWORD_MAX = 128
export const passwordLength = (value: string) => [...value].length
export function passwordProblem(password: string, empty = 'Enter a password.') {
  const length = passwordLength(password)
  if (!password) return empty
  if (length < PASSWORD_MIN || length > PASSWORD_MAX) return `Use ${PASSWORD_MIN} to ${PASSWORD_MAX} characters.`
  if (!password.trim()) return 'The password can’t be only spaces.'
  if (password.includes('\0')) return 'Remove unsupported characters from the password.'
  return undefined
}
