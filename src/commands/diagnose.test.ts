import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../utils/jq-check.js', () => ({
  isJqAvailable: vi.fn(),
}))

vi.mock('../core/settings-reader.js', () => ({
  readGlobalSettings: vi.fn(),
  extractAllRules: vi.fn(),
}))

vi.mock('../utils/display.js', () => ({
  printHeader: vi.fn(),
  printIssue: vi.fn(),
  printSuccess: vi.fn(),
}))

vi.mock('../utils/exit.js', () => ({
  exitWithError: vi.fn(() => { throw new Error('exit') }),
}))

vi.mock('../utils/paths.js', () => ({
  getHooksDir: vi.fn(() => '/tmp/hooks'),
}))

vi.mock('../core/pattern-validator.js', () => ({
  validatePatterns: vi.fn(() => []),
  findConflicts: vi.fn(() => []),
  checkAllowAskConflicts: vi.fn(() => []),
  checkAllowDenyConflicts: vi.fn(() => []),
  checkBareToolConflicts: vi.fn(() => []),
  checkMissingPairedDenyRules: vi.fn(() => []),
  checkCrossToolBypasses: vi.fn(() => []),
  checkPrefixBypasses: vi.fn(() => []),
}))

import { runDiagnose } from './diagnose.js'
import { isJqAvailable } from '../utils/jq-check.js'
import { readGlobalSettings, extractAllRules } from '../core/settings-reader.js'

const mockedIsJqAvailable = vi.mocked(isJqAvailable)
const mockedReadGlobalSettings = vi.mocked(readGlobalSettings)
const mockedExtractAllRules = vi.mocked(extractAllRules)

describe('runDiagnose jq check', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('includes JQ_NOT_FOUND issue when jq is not available and enforce hook is registered', async () => {
    mockedIsJqAvailable.mockReturnValue(false)
    mockedReadGlobalSettings.mockResolvedValue({
      PreToolUse: [{
        matcher: 'Bash',
        hooks: [{ type: 'command', command: '/tmp/hooks/enforce-permissions.sh' }],
      }],
      permissions: { deny: ['Bash(rm *)'] },
    })
    mockedExtractAllRules.mockReturnValue({
      allowRules: [],
      denyRules: ['Bash(rm *)'],
      askRules: [],
      legacyAllowedTools: [],
      legacyDeny: [],
    })

    const result = await runDiagnose()

    const jqIssue = result.issues.find(i => i.code === 'JQ_NOT_FOUND')
    expect(jqIssue).toBeDefined()
    expect(jqIssue!.severity).toBe('info')
    expect(jqIssue!.message).toContain('jq')
  })

  it('does not include JQ_NOT_FOUND issue when jq is available', async () => {
    mockedIsJqAvailable.mockReturnValue(true)
    mockedReadGlobalSettings.mockResolvedValue({
      PreToolUse: [{
        matcher: 'Bash',
        hooks: [{ type: 'command', command: '/tmp/hooks/enforce-permissions.sh' }],
      }],
      permissions: { deny: ['Bash(rm *)'] },
    })
    mockedExtractAllRules.mockReturnValue({
      allowRules: [],
      denyRules: ['Bash(rm *)'],
      askRules: [],
      legacyAllowedTools: [],
      legacyDeny: [],
    })

    const result = await runDiagnose()

    const jqIssue = result.issues.find(i => i.code === 'JQ_NOT_FOUND')
    expect(jqIssue).toBeUndefined()
  })
})
