import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock all dependencies before importing the module under test
vi.mock('../src/commands/diagnose.js', () => ({
  runDiagnose: vi.fn().mockResolvedValue({ issues: [], totalPatterns: 0 }),
}))

vi.mock('../src/commands/migrate.js', () => ({
  checkMigration: vi.fn().mockResolvedValue(null),
  applyMigration: vi.fn(),
}))

vi.mock('../src/commands/recommend.js', () => ({
  runRecommend: vi.fn().mockResolvedValue({ recommendations: [], eventCount: 0 }),
}))

vi.mock('../src/commands/init.js', () => ({
  initCommand: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../src/utils/prompt.js', () => ({
  confirm: vi.fn().mockResolvedValue(true),
  select: vi.fn().mockImplementation((_msg: string, _choices: string[], defaultVal: string) =>
    Promise.resolve(defaultVal)
  ),
}))

vi.mock('../src/utils/display.js', () => ({
  printHeader: vi.fn(),
  printIssue: vi.fn(),
  printMigration: vi.fn(),
  printRecommendation: vi.fn(),
  printSuccess: vi.fn(),
  printWarning: vi.fn(),
}))

import { setupCommand } from '../src/commands/setup.js'
import { initCommand } from '../src/commands/init.js'
import { select } from '../src/utils/prompt.js'

describe('setupCommand --profile option', () => {
  let stdoutWriteSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
  })

  afterEach(() => {
    stdoutWriteSpy.mockRestore()
  })

  describe('with -y and --profile', () => {
    it('uses the specified profile and skips profile selection', async () => {
      await setupCommand({ yes: true, profile: 'strict' })

      // select should NOT be called (profile selection skipped)
      expect(select).not.toHaveBeenCalled()
      // initCommand should be called with the specified profile
      expect(initCommand).toHaveBeenCalledWith({ profile: 'strict' })
    })

    it('uses minimal profile when specified', async () => {
      await setupCommand({ yes: true, profile: 'minimal' })

      expect(select).not.toHaveBeenCalled()
      expect(initCommand).toHaveBeenCalledWith({ profile: 'minimal' })
    })

    it('uses balanced profile when specified explicitly', async () => {
      await setupCommand({ yes: true, profile: 'balanced' })

      expect(select).not.toHaveBeenCalled()
      expect(initCommand).toHaveBeenCalledWith({ profile: 'balanced' })
    })
  })

  describe('with -y but without --profile', () => {
    it('defaults to balanced profile (existing behavior)', async () => {
      await setupCommand({ yes: true })

      expect(select).not.toHaveBeenCalled()
      expect(initCommand).toHaveBeenCalledWith({ profile: 'balanced' })
    })
  })

  describe('without -y but with --profile', () => {
    it('shows profile selection with the specified profile as default', async () => {
      await setupCommand({ yes: false, profile: 'strict' })

      // select SHOULD be called (interactive mode)
      expect(select).toHaveBeenCalledTimes(1)
      // The default value passed to select should be the specified profile
      expect(select).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        'strict'
      )
    })

    it('uses balanced as default when no profile specified in interactive mode', async () => {
      await setupCommand({ yes: false })

      expect(select).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        'balanced'
      )
    })
  })

  describe('invalid profile name', () => {
    it('throws an error for invalid profile name', async () => {
      await expect(
        setupCommand({ yes: true, profile: 'nonexistent' })
      ).rejects.toThrow(/invalid.*profile/i)
    })

    it('throws an error for empty string profile', async () => {
      await expect(
        setupCommand({ yes: true, profile: '' })
      ).rejects.toThrow(/invalid.*profile/i)
    })

    it('truncates long profile names in the error message to 50 chars', async () => {
      const longName = 'a'.repeat(100)
      const truncated = 'a'.repeat(50)

      let thrownError: Error | undefined
      try {
        await setupCommand({ yes: true, profile: longName })
      } catch (error) {
        thrownError = error as Error
      }

      expect(thrownError).toBeDefined()
      // The error message should contain the truncated name (50 chars)
      expect(thrownError!.message).toContain(truncated)
      // The error message should NOT contain the full 100-char name
      expect(thrownError!.message).not.toContain(longName)
    })
  })
})
