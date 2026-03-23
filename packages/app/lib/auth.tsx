import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import { Linking, Platform } from 'react-native'

import { configure, devLogin, getMe } from './api'
import type { User } from './api'
import {
  extractAuthCallback,
  LAST_SERVER_URL_KEY,
  normalizeServerUrl,
} from './auth-utils'
import { registerForPush, unregisterPush } from './push'
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

  const persistSession = useCallback(async (nextServerUrl: string, nextToken: string) => {
    const normalizedNextServerUrl = normalizeServerUrl(nextServerUrl)
    const normalizedServerUrl =
      Platform.OS === 'web' ? '' : normalizedNextServerUrl

    await storage.set(TOKEN_KEY, nextToken)
    await storage.set(SERVER_URL_KEY, normalizedServerUrl)
    if (normalizedNextServerUrl) {
      await storage.set(LAST_SERVER_URL_KEY, normalizedNextServerUrl)
    }

    configure(normalizedServerUrl, nextToken)
    setServerUrl(normalizedServerUrl)
    setToken(nextToken)
  }, [])

  // Restore session from storage on mount, and handle OAuth callbacks.
  useEffect(() => {
    let cancelled = false
    let subscription: { remove: () => void } | null = null

    const handleAuthCallback = async (rawUrl: string): Promise<boolean> => {
      const callback = extractAuthCallback(rawUrl)
      if (!callback) {
        return false
      }

      await persistSession(callback.serverUrl, callback.token)

      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        const url = new URL(window.location.href)
        url.searchParams.delete('token')
        url.searchParams.delete('provider')
        url.searchParams.delete('server')
        window.history.replaceState({}, '', url.pathname + url.search + url.hash)
      }

      return true
    }

    const restore = async () => {
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        if (await handleAuthCallback(window.location.href)) {
          return
        }
      }

      if (Platform.OS !== 'web') {
        const initialUrl = await Linking.getInitialURL()
        if (initialUrl && await handleAuthCallback(initialUrl)) {
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

    if (Platform.OS !== 'web') {
      subscription = Linking.addEventListener('url', (event) => {
        void handleAuthCallback(event.url)
      })
    }

    return () => {
      cancelled = true
      subscription?.remove()
    }
  }, [persistSession])

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
    await persistSession(newServerUrl, newToken)
  }, [persistSession])

  const logout = useCallback(async () => {
    await unregisterPush()
    await storage.remove(TOKEN_KEY)
    await storage.remove(SERVER_URL_KEY)
    configure('', '')
    setToken(null)
    setUser(null)
    setServerUrl('')
  }, [])

  // Register for push notifications on mobile when logged in
  useEffect(() => {
    if (!isLoggedIn || Platform.OS === 'web') {
      return
    }

    let disposed = false
    let cleanup: (() => void) | null = null

    void registerForPush().then((teardown) => {
      if (disposed) {
        teardown()
        return
      }
      cleanup = teardown
    })

    return () => {
      disposed = true
      cleanup?.()
    }
  }, [isLoggedIn])

  const value = useMemo<AuthContextValue>(
    () => ({ user, token, serverUrl, isLoading, isLoggedIn, login, logout }),
    [user, token, serverUrl, isLoading, isLoggedIn, login, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
