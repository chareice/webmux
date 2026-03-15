import jwt from 'jsonwebtoken'
import bcrypt from 'bcrypt'

const BCRYPT_ROUNDS = 10

export interface JwtPayload {
  userId: string
  displayName: string
  role: string
}

interface OAuthStatePayload {
  redirectTo?: string
}

export function signJwt(payload: JwtPayload, secret: string): string {
  return jwt.sign(payload, secret, { expiresIn: '7d' })
}

export function verifyJwt(token: string, secret: string): JwtPayload {
  return jwt.verify(token, secret) as JwtPayload
}

export async function hashSecret(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS)
}

export async function verifySecret(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}

export function encodeOAuthState(payload: OAuthStatePayload): string | undefined {
  if (!payload.redirectTo) {
    return undefined
  }

  return Buffer.from(JSON.stringify(payload)).toString('base64url')
}

export function decodeOAuthState(state?: string | null): OAuthStatePayload {
  if (!state) {
    return {}
  }

  try {
    const parsed = JSON.parse(Buffer.from(state, 'base64url').toString('utf-8')) as OAuthStatePayload
    return parsed.redirectTo ? { redirectTo: parsed.redirectTo } : {}
  } catch {
    return {}
  }
}

export function appendAuthTokenToRedirectTarget(redirectTarget: string, token: string): string {
  const url = new URL(redirectTarget)
  url.searchParams.set('token', token)
  return url.toString()
}

export function getGithubOAuthUrl(clientId: string, baseUrl: string, state?: string): string {
  const redirectUri = `${baseUrl}/api/auth/github/callback`
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'read:user',
  })
  if (state) {
    params.set('state', state)
  }
  return `https://github.com/login/oauth/authorize?${params.toString()}`
}

export async function exchangeGithubCode(
  clientId: string,
  clientSecret: string,
  code: string
): Promise<string> {
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
    }),
  })

  const data = (await response.json()) as { access_token?: string; error?: string; error_description?: string }

  if (data.error || !data.access_token) {
    throw new Error(`GitHub OAuth error: ${data.error_description ?? data.error ?? 'no access_token'}`)
  }

  return data.access_token
}

export interface GithubUser {
  id: number
  login: string
  avatar_url: string
}

export async function getGithubUser(accessToken: string): Promise<GithubUser> {
  const response = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
    },
  })

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`)
  }

  const data = (await response.json()) as GithubUser
  return { id: data.id, login: data.login, avatar_url: data.avatar_url }
}

// --- Google OAuth ---

export interface GoogleUser {
  id: string
  email: string
  name: string
  picture: string
}

export function getGoogleOAuthUrl(clientId: string, baseUrl: string, state?: string): string {
  const redirectUri = `${baseUrl}/api/auth/google/callback`
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
  })
  if (state) {
    params.set('state', state)
  }
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

export async function exchangeGoogleCode(
  clientId: string,
  clientSecret: string,
  code: string,
  baseUrl: string
): Promise<string> {
  const redirectUri = `${baseUrl}/api/auth/google/callback`
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  })

  const data = (await response.json()) as { access_token?: string; error?: string; error_description?: string }

  if (data.error || !data.access_token) {
    throw new Error(`Google OAuth error: ${data.error_description ?? data.error ?? 'no access_token'}`)
  }

  return data.access_token
}

export async function getGoogleUser(accessToken: string): Promise<GoogleUser> {
  const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (!response.ok) {
    throw new Error(`Google API error: ${response.status} ${response.statusText}`)
  }

  const data = (await response.json()) as GoogleUser
  return { id: data.id, email: data.email, name: data.name, picture: data.picture }
}
