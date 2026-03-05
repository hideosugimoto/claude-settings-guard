import { describe, it, expect } from 'vitest'
import { VERSION } from '../src/version.js'

describe('version', () => {
  it('exports a semver-like version string', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('matches package.json version', async () => {
    const { readFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const pkg = JSON.parse(
      await readFile(join(import.meta.dirname, '..', 'package.json'), 'utf-8')
    )
    expect(VERSION).toBe(pkg.version)
  })
})
