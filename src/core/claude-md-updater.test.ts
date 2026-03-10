import { describe, it, expect, vi, beforeEach } from 'vitest'

// We test readClaudeMd indirectly through updateClaudeMd.
// Ensure proper type narrowing for error handling.

describe('readClaudeMd error handling', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('re-throws non-Error exceptions without crashing', async () => {
    vi.doMock('node:fs/promises', () => ({
      readFile: vi.fn().mockRejectedValue('some string error'),
      writeFile: vi.fn().mockResolvedValue(undefined),
      mkdir: vi.fn().mockResolvedValue(undefined),
    }))

    const { updateClaudeMd } = await import('./claude-md-updater.js')

    await expect(updateClaudeMd('/tmp/test-claude-md/CLAUDE.md')).rejects.toBe(
      'some string error'
    )
  })

  it('returns empty string when file does not exist (ENOENT)', async () => {
    const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })

    vi.doMock('node:fs/promises', () => ({
      readFile: vi.fn().mockRejectedValue(enoent),
      writeFile: vi.fn().mockResolvedValue(undefined),
      mkdir: vi.fn().mockResolvedValue(undefined),
    }))

    const { updateClaudeMd } = await import('./claude-md-updater.js')

    const result = await updateClaudeMd('/tmp/test-claude-md/CLAUDE.md')
    expect(result.action).toBe('added')
  })

  it('re-throws Error instances with non-ENOENT code', async () => {
    const eperm = Object.assign(new Error('EPERM'), { code: 'EPERM' })

    vi.doMock('node:fs/promises', () => ({
      readFile: vi.fn().mockRejectedValue(eperm),
      writeFile: vi.fn().mockResolvedValue(undefined),
      mkdir: vi.fn().mockResolvedValue(undefined),
    }))

    const { updateClaudeMd } = await import('./claude-md-updater.js')

    await expect(updateClaudeMd('/tmp/test-claude-md/CLAUDE.md')).rejects.toThrow('EPERM')
  })

  it('re-throws objects without code property', async () => {
    const weirdError = { message: 'weird' }

    vi.doMock('node:fs/promises', () => ({
      readFile: vi.fn().mockRejectedValue(weirdError),
      writeFile: vi.fn().mockResolvedValue(undefined),
      mkdir: vi.fn().mockResolvedValue(undefined),
    }))

    const { updateClaudeMd } = await import('./claude-md-updater.js')

    await expect(updateClaudeMd('/tmp/test-claude-md/CLAUDE.md')).rejects.toBe(weirdError)
  })
})
