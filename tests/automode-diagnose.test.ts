import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../src/utils/jq-check.js', () => ({
  isJqAvailable: vi.fn(() => true),
}))

vi.mock('../src/core/settings-reader.js', () => ({
  readGlobalSettings: vi.fn(),
  extractAllRules: vi.fn(),
}))

vi.mock('../src/utils/display.js', () => ({
  printHeader: vi.fn(),
  printIssue: vi.fn(),
  printSuccess: vi.fn(),
}))

vi.mock('../src/utils/exit.js', () => ({
  exitWithError: vi.fn(() => { throw new Error('exit') }),
}))

vi.mock('../src/utils/paths.js', () => ({
  getHooksDir: vi.fn(() => '/tmp/nonexistent-hooks'),
}))

vi.mock('../src/core/pattern-validator.js', () => ({
  validatePatterns: vi.fn(() => []),
  findConflicts: vi.fn(() => []),
  checkAllowAskConflicts: vi.fn(() => []),
  checkAllowDenyConflicts: vi.fn(() => []),
  checkBareToolConflicts: vi.fn(() => []),
  checkMissingPairedDenyRules: vi.fn(() => []),
  checkCrossToolBypasses: vi.fn(() => []),
  checkPrefixBypasses: vi.fn(() => []),
}))

import { runDiagnose } from '../src/commands/diagnose.js'
import { readGlobalSettings, extractAllRules } from '../src/core/settings-reader.js'

const mockedReadGlobalSettings = vi.mocked(readGlobalSettings)
const mockedExtractAllRules = vi.mocked(extractAllRules)

function mockExtractAllRules() {
  return {
    allowRules: [] as string[],
    denyRules: ['Bash(sudo *)'] as string[],
    askRules: [] as string[],
    legacyAllowedTools: [] as string[],
    legacyDeny: [] as string[],
  }
}

describe('diagnose AutoMode checks', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('detects AUTO_MODE_HOOK_CONFLICT when both autoMode and enforce hook exist', async () => {
    const settings = {
      permissions: {
        defaultMode: 'auto',
        deny: ['Bash(sudo *)'],
      },
      autoMode: {
        environment: ['Dev machine'],
        soft_deny: ['Never run sudo'],
      },
      PreToolUse: [{
        matcher: 'Bash',
        hooks: [{ type: 'shell', command: '~/.claude/hooks/enforce-permissions.sh' }],
      }],
    }

    mockedReadGlobalSettings.mockResolvedValue(settings)
    mockedExtractAllRules.mockReturnValue(mockExtractAllRules())

    const result = await runDiagnose()

    const hookConflict = result.issues.find(i => i.code === 'AUTO_MODE_HOOK_CONFLICT')
    expect(hookConflict).toBeDefined()
    expect(hookConflict?.severity).toBe('warning')
    expect(hookConflict?.message).toContain('AutoMode')
    expect(hookConflict?.message).toContain('enforce')
  })

  it('detects AUTO_MODE_REDUNDANT_RULES for broad patterns', async () => {
    const settings = {
      permissions: {
        defaultMode: 'auto',
        allow: ['Bash', 'Read', 'Glob'],
        deny: ['Bash(sudo *)'],
      },
      autoMode: {
        soft_deny: ['Never run sudo'],
      },
    }

    mockedReadGlobalSettings.mockResolvedValue(settings)
    mockedExtractAllRules.mockReturnValue({
      ...mockExtractAllRules(),
      allowRules: ['Bash', 'Read', 'Glob'],
    })

    const result = await runDiagnose()

    const redundant = result.issues.find(i => i.code === 'AUTO_MODE_REDUNDANT_RULES')
    expect(redundant).toBeDefined()
    expect(redundant?.severity).toBe('info')
    expect(redundant?.details).toContain('Bash')
  })

  it('does not flag AutoMode issues when AutoMode is disabled', async () => {
    const settings = {
      permissions: {
        allow: ['Read'],
        deny: ['Bash(sudo *)'],
      },
      PreToolUse: [{
        matcher: 'Bash',
        hooks: [{ type: 'shell', command: '~/.claude/hooks/enforce-permissions.sh' }],
      }],
    }

    mockedReadGlobalSettings.mockResolvedValue(settings)
    mockedExtractAllRules.mockReturnValue({
      ...mockExtractAllRules(),
      allowRules: ['Read'],
    })

    const result = await runDiagnose()

    const autoModeIssues = result.issues.filter(i =>
      i.code === 'AUTO_MODE_HOOK_CONFLICT' || i.code === 'AUTO_MODE_REDUNDANT_RULES'
    )
    expect(autoModeIssues).toHaveLength(0)
  })

  it('does not flag redundant rules when no broad patterns exist', async () => {
    const settings = {
      permissions: {
        defaultMode: 'auto',
        allow: ['Read', 'Glob', 'Grep', 'Bash(git status *)'],
        deny: ['Bash(sudo *)'],
      },
      autoMode: {
        soft_deny: ['Never run sudo'],
      },
    }

    mockedReadGlobalSettings.mockResolvedValue(settings)
    mockedExtractAllRules.mockReturnValue({
      ...mockExtractAllRules(),
      allowRules: ['Read', 'Glob', 'Grep', 'Bash(git status *)'],
    })

    const result = await runDiagnose()

    const redundant = result.issues.find(i => i.code === 'AUTO_MODE_REDUNDANT_RULES')
    expect(redundant).toBeUndefined()
  })
})
