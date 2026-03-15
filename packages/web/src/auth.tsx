import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import type { ReactNode } from 'react'

const JWT_STORAGE_KEY = 'webmux:jwt'

interface User {
  id: string
  githubLogin: string
  avatarUrl: string | null
  role: string
}

interface AuthContextValue {
  user: User | null
  token: string | null
  isLoading: boolean
  login: (token: string) => void
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider')
  }
  return ctx
}

/**
 * Helper for authenticated API calls. Automatically adds the JWT
 * Authorization header if a token exists in localStorage.
 */
export async function fetchApi(
  path: string,
  options?: RequestInit,
): Promise<Response> {
  const token = localStorage.getItem(JWT_STORAGE_KEY)
  const headers = new Headers(options?.headers)
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  return fetch(path, { ...options, headers })
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() =>
    localStorage.getItem(JWT_STORAGE_KEY),
  )
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Check URL for ?token=xxx from OAuth callback and store it
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const urlToken = params.get('token')
    if (urlToken) {
      localStorage.setItem(JWT_STORAGE_KEY, urlToken)
      setToken(urlToken)
      // Remove token from URL without reload
      const url = new URL(window.location.href)
      url.searchParams.delete('token')
      window.history.replaceState({}, '', url.pathname + url.search + url.hash)
    }
  }, [])

  // Fetch user info whenever token changes
  useEffect(() => {
    let cancelled = false

    const loadUser = async () => {
      const currentToken = localStorage.getItem(JWT_STORAGE_KEY)

      if (!currentToken) {
        // Try dev mode auto-login
        try {
          const devCheck = await fetch('/api/auth/dev')
          if (devCheck.ok) {
            const data = (await devCheck.json()) as { token: string }
            localStorage.setItem(JWT_STORAGE_KEY, data.token)
            if (!cancelled) {
              setToken(data.token)
              // loadUser will be called again via the token dependency
              return
            }
          }
        } catch {
          // Dev mode not available, that's fine
        }

        if (!cancelled) {
          setUser(null)
          setIsLoading(false)
        }
        return
      }

      try {
        const res = await fetch('/api/auth/me', {
          headers: { Authorization: `Bearer ${currentToken}` },
        })
        if (res.ok) {
          const data = (await res.json()) as User
          if (!cancelled) {
            setUser(data)
          }
        } else {
          // Invalid/expired token
          localStorage.removeItem(JWT_STORAGE_KEY)
          if (!cancelled) {
            setToken(null)
            setUser(null)
          }
        }
      } catch {
        // Network error — keep token, user stays null
      }

      if (!cancelled) {
        setIsLoading(false)
      }
    }

    void loadUser()

    return () => {
      cancelled = true
    }
  }, [token])

  const login = useCallback((newToken: string) => {
    localStorage.setItem(JWT_STORAGE_KEY, newToken)
    setToken(newToken)
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem(JWT_STORAGE_KEY)
    setToken(null)
    setUser(null)
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({ user, token, isLoading, login, logout }),
    [user, token, isLoading, login, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
