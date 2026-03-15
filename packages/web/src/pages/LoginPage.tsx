import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LogIn } from 'lucide-react'
import { useAuth } from '../auth.tsx'

export function LoginPage() {
  const { user, isLoading, login } = useAuth()
  const navigate = useNavigate()

  const [devMode, setDevMode] = useState(false)
  const [devLoading, setDevLoading] = useState(false)
  const [googleEnabled, setGoogleEnabled] = useState(false)

  // Redirect to home if already authenticated
  useEffect(() => {
    if (!isLoading && user) {
      navigate('/', { replace: true })
    }
  }, [isLoading, user, navigate])

  // Detect dev mode and available providers
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/auth/dev', { method: 'HEAD' })
        if (!cancelled && res.ok) {
          setDevMode(true)
        }
      } catch {
        // Not in dev mode
      }
    })()
    void (async () => {
      try {
        const res = await fetch('/api/auth/google', { method: 'HEAD', redirect: 'manual' })
        // A redirect (302) means Google OAuth is configured
        // A 400 means it's not configured
        if (!cancelled && res.type === 'opaqueredirect') {
          setGoogleEnabled(true)
        }
      } catch {
        // Google OAuth not available
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const handleDevLogin = async () => {
    setDevLoading(true)
    try {
      const res = await fetch('/api/auth/dev')
      if (res.ok) {
        const data = (await res.json()) as { token: string }
        login(data.token)
      }
    } catch {
      // Ignore
    } finally {
      setDevLoading(false)
    }
  }

  if (isLoading) {
    return (
      <div className="login-page">
        <div className="login-card">
          <p className="login-loading">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <h1 className="login-title">webmux</h1>
        <p className="login-subtitle">Terminal sessions, anywhere.</p>

        <a className="primary-button login-button" href="/api/auth/github">
          <LogIn size={18} />
          Login with GitHub
        </a>

        {googleEnabled ? (
          <>
            <div className="login-divider">
              <span>or</span>
            </div>
            <a className="primary-button login-button" href="/api/auth/google">
              <LogIn size={18} />
              Login with Google
            </a>
          </>
        ) : null}

        {devMode ? (
          <button
            className="secondary-button login-button"
            disabled={devLoading}
            onClick={() => {
              void handleDevLogin()
            }}
            type="button"
          >
            Dev Mode
          </button>
        ) : null}
      </div>
    </div>
  )
}
