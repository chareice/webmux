import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('@webmux/shared package entrypoint', () => {
  it('points runtime imports at built JavaScript files', () => {
    const packageJsonPath = resolve(import.meta.dirname, '../../shared/package.json')
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      main?: string
      types?: string
    }

    expect(packageJson.main).toBe('./dist/index.js')
    expect(packageJson.types).toBe('./dist/index.d.ts')
  })
})
