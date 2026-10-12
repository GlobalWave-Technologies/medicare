export class AppError extends Error {
  readonly status: number
  readonly code: string

  // Only pass deliberately public messages, never caught error messages.
  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'AppError'
    this.status = status
    this.code = code
  }
}
