import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Track calls for assertions
let unlinkBehavior: 'enoent' | 'eacces' | 'pass' = 'pass'
let unlinkCallCount = 0

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    rename: vi.fn().mockRejectedValue(new Error('rename failed')),
    unlink: vi.fn().mockImplementation(async (path: string) => {
      unlinkCallCount++
      if (unlinkBehavior === 'enoent') {
        throw Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' })
      }
      if (unlinkBehavior === 'eacces') {
        throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
      }
      return actual.unlink(path)
    }),
  }
})

// Must import after vi.mock
import { writeSettings } from '../src/core/settings-writer.js'

describe('settings-writer: temp file cleanup error handling', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    unlinkBehavior = 'pass'
    unlinkCallCount = 0
  })

  afterEach(() => {
    stderrSpy.mockRestore()
  })

  it('silently ignores ENOENT when temp file does not exist', async () => {
    unlinkBehavior = 'enoent'

    const dir = await mkdtemp(join(tmpdir(), 'csg-cleanup-'))
    try {
      const filePath = join(dir, 'settings.json')
      const result = await writeSettings(
        filePath,
        { permissions: { allow: ['Read'] } },
        { skipBackup: true }
      )

      expect(result.success).toBe(false)
      expect(unlinkCallCount).toBeGreaterThan(0)
      // ENOENT should NOT produce a stderr warning
      const stderrCalls = stderrSpy.mock.calls
        .map(c => String(c[0]))
        .filter(msg => msg.includes('Warning'))
      expect(stderrCalls).toHaveLength(0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('logs warning to stderr for EACCES on temp file cleanup', async () => {
    unlinkBehavior = 'eacces'

    const dir = await mkdtemp(join(tmpdir(), 'csg-cleanup-'))
    try {
      const filePath = join(dir, 'settings.json')
      const result = await writeSettings(
        filePath,
        { permissions: { allow: ['Read'] } },
        { skipBackup: true }
      )

      expect(result.success).toBe(false)
      expect(unlinkCallCount).toBeGreaterThan(0)
      const warningCalls = stderrSpy.mock.calls
        .map(c => String(c[0]))
        .filter(msg => msg.includes('Warning'))
      expect(warningCalls).toHaveLength(1)
      expect(warningCalls[0]).toContain('temp file')
      expect(warningCalls[0]).toContain('EACCES')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
