import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import { Platform } from 'react-native'

import { configure, devLogin, getMe } from './api'
import type { User } from './api'
import { storage } from './storage'

const TOKEN_KEY = 'webmux:token'
const SERVER_URL_KEY = 'webmux:server_url'

export type { User }

export interface AuthContextValue {
  user: User | null
  token: string | null
  serverUrl: string
  isLoading: boolean
  isLoggedIn: boolean
  login: (serverUrl: string, token: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider')
  }
  return ctx
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null)
  const [serverUrl, setServerUrl] = useState<string>('')
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const isLoggedIn = !!token

  // Restore session from storage on mount, and handle web OAuth callback
  useEffect(() => {
    let cancelled = false

    const restore = async () => {
      // On web: check URL for ?token=xxx (OAuth callback)
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search)
        const urlToken = params.get('token')
        if (urlToken) {
          await storage.set(TOKEN_KEY, urlToken)
          // Remove token from URL without reload
          const url = new URL(window.location.href)
          url.searchParams.delete('token')
          window.history.replaceState(
            {},
            '',
            url.pathname + url.search + url.hash,
          )
          if (!cancelled) {
            setToken(urlToken)
            // On web, serverUrl defaults to '' (same-origin)
            setServerUrl('')
            setIsLoading(false)
          }
          return
        }
      }

      // Restore from storage
      const [storedToken, storedServerUrl] = await Promise.all([
        storage.get(TOKEN_KEY),
        storage.get(SERVER_URL_KEY),
      ])

      if (storedToken) {
        if (!cancelled) {
          setToken(storedToken)
          setServerUrl(storedServerUrl ?? '')
        }
        return
      }

      // On web with no stored token: try dev login
      if (Platform.OS === 'web') {
        // Configure with empty baseUrl for same-origin requests
        configure('', '')
        const result = await devLogin()
        if (result?.token) {
          await storage.set(TOKEN_KEY, result.token)
          if (!cancelled) {
            setToken(result.token)
            setServerUrl('')
          }
          return
        }
      }

      if (!cancelled) {
        setIsLoading(false)
      }
    }

    void restore()

    return () => {
      cancelled = true
    }
  }, [])

  // When token/serverUrl change, configure API client and load user
  useEffect(() => {
    if (token === null) {
      // No token yet — either still restoring or logged out
      return
    }

    let cancelled = false

    configure(serverUrl, token)

    const loadUser = async () => {
      try {
        const me = await getMe()
        if (!cancelled) {
          setUser(me)
        }
      } catch {
        // getMe failed (likely 401) — clear session
        await storage.remove(TOKEN_KEY)
        await storage.remove(SERVER_URL_KEY)
        if (!cancelled) {
          setToken(null)
          setUser(null)
          setServerUrl('')
        }
      }

      if (!cancelled) {
        setIsLoading(false)
      }
    }

    void loadUser()

    return () => {
      cancelled = true
    }
  }, [token, serverUrl])

  const login = useCallback(async (newServerUrl: string, newToken: string) => {
    await storage.set(TOKEN_KEY, newToken)
    await storage.set(SERVER_URL_KEY, newServerUrl)
    configure(newServerUrl, newToken)
    setServerUrl(newServerUrl)
    setToken(newToken)
  }, [])

  const logout = useCallback(async () => {
    await storage.remove(TOKEN_KEY)
    await storage.remove(SERVER_URL_KEY)
    configure('', '')
    setToken(null)
    setUser(null)
    setServerUrl('')
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({ user, token, serverUrl, isLoading, isLoggedIn, login, logout }),
    [user, token, serverUrl, isLoading, isLoggedIn, login, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
