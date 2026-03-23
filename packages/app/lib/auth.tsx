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
import { resolveAuthBootstrapState } from './auth-bootstrap'
import {
  LAST_SERVER_URL_KEY,
  normalizeServerUrl,
} from './auth-utils'
import { withTimeout } from './async-utils'
import { registerForPush, unregisterPush } from './push'
import { storage } from './storage'

const TOKEN_KEY = 'webmux:token'
const SERVER_URL_KEY = 'webmux:server_url'
const GET_ME_TIMEOUT_MS = 10_000

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

    const restore = async () => {
      const bootstrap = await resolveAuthBootstrapState({
        currentUrl:
          Platform.OS === 'web' && typeof window !== 'undefined'
            ? window.location.href
            : null,
        devLogin,
        getInitialUrl: async () => Linking.getInitialURL(),
        platformOs: Platform.OS,
        readServerUrl: async () => storage.get(SERVER_URL_KEY),
        readToken: async () => storage.get(TOKEN_KEY),
      })

      try {
        if (bootstrap.source === 'callback' && bootstrap.token) {
          await persistSession(bootstrap.serverUrl, bootstrap.token)

          if (Platform.OS === 'web' && typeof window !== 'undefined') {
            const url = new URL(window.location.href)
            url.searchParams.delete('token')
            url.searchParams.delete('provider')
            url.searchParams.delete('server')
            window.history.replaceState({}, '', url.pathname + url.search + url.hash)
          }
          return
        }

        if (bootstrap.source === 'storage' && bootstrap.token) {
          if (!cancelled) {
            setToken(bootstrap.token)
            setServerUrl(bootstrap.serverUrl)
          }
          return
        }

        if (bootstrap.source === 'dev' && bootstrap.token) {
          await persistSession('', bootstrap.token)
          return
        }
      } catch {
        await storage.remove(TOKEN_KEY)
        await storage.remove(SERVER_URL_KEY)
      }

      if (!cancelled) {
        setToken(null)
        setUser(null)
        setServerUrl('')
        setIsLoading(false)
      }
    }

    void restore()

    if (Platform.OS !== 'web') {
      subscription = Linking.addEventListener('url', (event) => {
        const restoreCallbackSession = async () => {
          const bootstrap = await resolveAuthBootstrapState({
            currentUrl: event.url,
            devLogin,
            getInitialUrl: async () => null,
            platformOs: 'web',
            readServerUrl: async () => null,
            readToken: async () => null,
          })

          if (bootstrap.source !== 'callback' || !bootstrap.token) {
            return
          }

          try {
            await persistSession(bootstrap.serverUrl, bootstrap.token)
          } catch {
            await storage.remove(TOKEN_KEY)
            await storage.remove(SERVER_URL_KEY)
            if (!cancelled) {
              setToken(null)
              setUser(null)
              setServerUrl('')
              setIsLoading(false)
            }
          }
        }

        void restoreCallbackSession()
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
        const me = await withTimeout(
          getMe(),
          GET_ME_TIMEOUT_MS,
          'Loading user timed out',
        )
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
