import jwt from 'jsonwebtoken'
import bcrypt from 'bcrypt'

const BCRYPT_ROUNDS = 10

export interface JwtPayload {
  userId: string
  githubLogin: string
  role: string
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

export function getGithubOAuthUrl(clientId: string, baseUrl: string): string {
  const redirectUri = `${baseUrl}/api/auth/github/callback`
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'read:user',
  })
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
