import { describe, it, expect } from 'vitest'

describe('version', () => {
  it('exports a semver-like version string', async () => {
    const { VERSION } = await import('../src/version.js')
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('matches package.json version', async () => {
    const { VERSION } = await import('../src/version.js')
    const { readFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const pkg = JSON.parse(
      await readFile(join(import.meta.dirname, '..', 'package.json'), 'utf-8')
    )
    expect(VERSION).toBe(pkg.version)
  })

  it('returns string type, not undefined or null', async () => {
    const { VERSION } = await import('../src/version.js')
    expect(typeof VERSION).toBe('string')
    expect(VERSION.length).toBeGreaterThan(0)
  })

  it('is always a valid semver-like string (fallback guarantees 0.0.0)', async () => {
    const { VERSION } = await import('../src/version.js')
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/)
  })
})
