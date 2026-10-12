import { useRef, useState, type FormEvent } from 'react'
import {
  ArrowUpRight,
  Eye,
  EyeOff,
  ShieldCheck,
  UserRound,
} from 'lucide-react'
import { CloudMark } from '../../components/branding/BrandMarks'
import {
  ApiError,
  authErrorMessage,
} from '../../api/client'

type LoginProps = {
  onLogin: (email: string, password: string) => Promise<void>
}

export function Login({ onLogin }: LoginProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<unknown>(null)
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

        <div className="login-brand">
          <div className="brand-mark">
            <CloudMark />
          </div>

          <strong>Hospital Records System</strong>
          <span>Secure Access Portal</span>
        </div>

        <div className="login-visual-copy">
          <p className="eyebrow">A BETTER WAY TO CARE</p>

          <h1>
            Clarity for every
            <br />
            <em>patient journey.</em>
          </h1>

          <p>
            One secure workspace for your care team to manage records,
            appointments and the moments that matter.
          </p>

          <div className="login-trust">
            <ShieldCheck size={17} />
            <span>Protected with enterprise-grade security</span>
          </div>
        </div>

        <span className="login-version">HRS / v1.0.0</span>
      </div>

      <div className="login-form-wrap">
        <div className="login-form">
          <div className="login-user-icon">
            <UserRound size={30} />
          </div>

          <p className="eyebrow">WELCOME BACK</p>

          <h2>Sign in to your workspace</h2>

          <p className="login-helper">
            Use your registered hospital staff email to continue.
          </p>

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
                    <EyeOff size={17} />
                  ) : (
                    <Eye size={17} />
                  )}
                </button>
              </div>
            </label>

            {error !== null && (
              <div
                role="alert"
                id="login-error" className="auth-error"
                style={{
                  marginTop: 12,
                  marginBottom: 8,
                  color: '#b42318',
                  fontSize: 14,
                }}
              >
                {authErrorMessage(error)}
                {error instanceof ApiError && error.requestId && <p>Support reference: {error.requestId}</p>}
              </div>
            )}

            <button
              className="button button-primary login-button"
              type="submit"
              disabled={submitting}
            >
              {submitting ? 'Signing in...' : 'Sign in securely'}

              {!submitting && <ArrowUpRight size={17} />}
            </button>
          </form>

          <div className="login-footer">
            <p>
              Staff access is managed by your hospital administrator.
            </p>
          </div>
        </div>

        <div className="login-copyright">
          © 2026 Hospital Records System
          <span> · </span>
          Privacy & security
        </div>
      </div>
    </div>
  )
}
