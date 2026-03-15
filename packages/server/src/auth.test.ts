import { describe, expect, it } from 'vitest'
import {
  appendAuthTokenToRedirectTarget,
  decodeOAuthState,
  encodeOAuthState,
  getGithubOAuthUrl,
  hashSecret,
  signJwt,
  verifyJwt,
  verifySecret,
} from './auth.js'

const TEST_SECRET = 'test-jwt-secret-key'

describe('JWT', () => {
  it('signs and verifies a token', () => {
    const payload = { userId: 'u1', displayName: 'alice', role: 'admin' }
    const token = signJwt(payload, TEST_SECRET)

    expect(typeof token).toBe('string')
    expect(token.split('.')).toHaveLength(3)

    const decoded = verifyJwt(token, TEST_SECRET)
    expect(decoded.userId).toBe('u1')
    expect(decoded.displayName).toBe('alice')
    expect(decoded.role).toBe('admin')
  })

  it('rejects token with wrong secret', () => {
    const token = signJwt({ userId: 'u1', displayName: 'a', role: 'user' }, TEST_SECRET)
    expect(() => verifyJwt(token, 'wrong-secret')).toThrow()
  })

  it('rejects malformed token', () => {
    expect(() => verifyJwt('not.a.jwt', TEST_SECRET)).toThrow()
  })
})

describe('secret hashing', () => {
  it('hashes and verifies a secret', async () => {
    const plain = 'my-agent-secret'
    const hash = await hashSecret(plain)

    expect(hash).not.toBe(plain)
    expect(await verifySecret(plain, hash)).toBe(true)
  })

  it('rejects wrong secret', async () => {
    const hash = await hashSecret('correct')
    expect(await verifySecret('wrong', hash)).toBe(false)
  })
})

describe('OAuth redirect helpers', () => {
  it('round-trips a mobile redirect target through OAuth state', () => {
    const encoded = encodeOAuthState({ redirectTo: 'webmux://auth?server=https%3A%2F%2Fnas.example.com' })

    expect(decodeOAuthState(encoded)).toEqual({
      redirectTo: 'webmux://auth?server=https%3A%2F%2Fnas.example.com',
    })
  })

  it('appends the JWT to an existing mobile redirect target', () => {
    const redirectTarget = appendAuthTokenToRedirectTarget(
      'webmux://auth?server=https%3A%2F%2Fnas.example.com',
      'jwt-token',
    )

    const parsed = new URL(redirectTarget)
    expect(parsed.protocol).toBe('webmux:')
    expect(parsed.searchParams.get('server')).toBe('https://nas.example.com')
    expect(parsed.searchParams.get('token')).toBe('jwt-token')
  })

  it('includes the encoded state in the GitHub authorize URL', () => {
    const encoded = encodeOAuthState({ redirectTo: 'webmux://auth' })
    const authorizeUrl = getGithubOAuthUrl('client-id', 'https://webmux.example.com', encoded)
    const parsed = new URL(authorizeUrl)

    expect(parsed.origin).toBe('https://github.com')
    expect(parsed.searchParams.get('redirect_uri')).toBe(
      'https://webmux.example.com/api/auth/github/callback',
    )
    expect(parsed.searchParams.get('state')).toBe(encoded)
  })
})
