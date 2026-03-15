import { describe, expect, it } from 'vitest'
import { signJwt, verifyJwt, hashSecret, verifySecret } from './auth.js'

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
