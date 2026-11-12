import { useRef, useState, type FormEvent } from 'react'
import {
  Eye,
  EyeOff,
  KeyRound,
  ShieldCheck,
} from 'lucide-react'
import { Brand } from '../../components/branding/BrandMarks'
import { ThemeControl } from '../../components/ui/ThemeControl'
import {
  authErrorMessage,
  unexpectedFailureReference,
} from '../../api/client'

type LoginProps = {
  onLogin: (email: string, password: string) => Promise<void>
  notice?: string
}

export function Login({ onLogin, notice }: LoginProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [forgotOpen, setForgotOpen] = useState(false)
  const inFlight = useRef(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (inFlight.current) return
    inFlight.current = true

    setSubmitting(true)
    setError(null)

    try {
      await onLogin(email.trim(), password)
    } catch (error) {
      setError(error)
    } finally {
      setSubmitting(false)
      setPassword('')
      inFlight.current = false
    }
  }

  return (
    <div className="login-page">
      <div className="login-visual">
        <div className="login-orbit orbit-one" />
        <div className="login-orbit orbit-two" />

        <Brand inverse tagline="Hospital Records" />

        <div className="login-visual-copy">
          <p className="eyebrow">Staff workspace</p>

          <p className="login-headline">
            Clarity for every
            <br />
            <em>patient journey.</em>
          </p>

          <p>
            One secure workspace for your care team to manage records,
            admissions and the moments that matter.
          </p>

          <div className="login-trust">
            <ShieldCheck size={17} aria-hidden="true" />
            <span>Access for authorized hospital staff</span>
          </div>
        </div>

      </div>

      <div className="login-form-wrap">
        <div className="login-form">
          <p className="eyebrow">Welcome back</p>

          <h1>Sign in to your workspace</h1>

          <p className="login-helper">
            Use your registered hospital staff email to continue.
          </p>

          {notice && <p role="status" className="notice login-notice">{notice}</p>}

          <form onSubmit={handleSubmit} aria-busy={submitting}>
            <label htmlFor="login-email">
              Email address

              <input
                type="email"
                id="login-email" name="email" aria-describedby={error !== null ? 'login-error' : undefined}
                placeholder="you@hospital.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="username"
                disabled={submitting}
                required
              />
            </label>

            <label htmlFor="login-password">
              Password

              <div className="password-input">
                <input
                  type={showPassword ? 'text' : 'password'}
                  id="login-password" name="password" aria-describedby={error !== null ? 'login-error' : undefined}
                  placeholder="Enter your password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  disabled={submitting}
                  required
                />

                <button
                  type="button"
                  className="text-button"
                  onClick={() => setShowPassword((current) => !current)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword} disabled={submitting}
                >
                  {showPassword ? (
                    <EyeOff size={17} aria-hidden="true" />
                  ) : (
                    <Eye size={17} aria-hidden="true" />
                  )}
                </button>
              </div>
            </label>

            {error !== null && (
              <div
                role="alert"
                id="login-error" className="auth-error"
              >
                {authErrorMessage(error)}
                {/* A wrong password is an expected answer; a reference is only useful for an unexpected failure. */}
                {unexpectedFailureReference(error) && <p>Support reference: {unexpectedFailureReference(error)}</p>}
              </div>
            )}

            <button
              className="button button-primary login-button"
              type="submit"
              disabled={submitting}
            >
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          {/* Guidance only: no request is sent and nothing reveals whether an account exists. */}
          <div className="login-forgot">
            <button type="button" className="button-link" aria-expanded={forgotOpen} aria-controls="login-forgot-note"
              onClick={() => setForgotOpen((open) => !open)}>
              Forgot your password?
            </button>
            <p id="login-forgot-note" className="login-forgot-note" role="note" hidden={!forgotOpen}>
              <KeyRound size={18} aria-hidden="true" />
              <span>Contact your system administrator to reset your password.</span>
            </p>
          </div>
        </div>

        <div className="login-meta">
          <ThemeControl />
          <div className="login-copyright">
            © 2026 Medicare Hospital Records
          </div>
        </div>
      </div>
    </div>
  )
}
