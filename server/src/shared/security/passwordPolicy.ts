import { z } from 'zod'

// Count Unicode code points; do not trim or normalize the actual password.
export const passwordSchema = z.string().refine((value) => {
  const length = [...value].length
  return length >= 15 && length <= 128 && value.trim().length > 0 && !value.includes('\0')
}, 'Password must contain 15-128 characters and cannot be blank or contain NUL')
