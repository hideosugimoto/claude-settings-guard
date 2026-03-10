import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../utils/jq-check.js', () => ({
  isJqAvailable: vi.fn(),
}))

vi.mock('../core/settings-reader.js', () => ({
  readGlobalSettings: vi.fn(),
  extractAllRules: vi.fn(),
}))

vi.mock('../core/hook-generator.js', () => ({
  generateEnforceScript: vi.fn(() => '#!/bin/bash\n'),
}))

vi.mock('../utils/display.js', () => ({
  printHeader: vi.fn(),
  printSuccess: vi.fn(),
  printError: vi.fn(),
  printWarning: vi.fn(),
}))

vi.mock('../utils/exit.js', () => ({
  exitWithError: vi.fn(() => { throw new Error('exit') }),
}))

vi.mock('../core/hook-regenerator.js', () => ({
  regenerateEnforceHook: vi.fn(),
  ensureHookRegistered: vi.fn(),
}))

vi.mock('../core/settings-writer.js', () => ({
  writeSettings: vi.fn(),
}))

vi.mock('../utils/paths.js', () => ({
  getGlobalSettingsPath: vi.fn(() => '/tmp/settings.json'),
}))

import { enforceCommand } from './enforce.js'
import { isJqAvailable } from '../utils/jq-check.js'
import { readGlobalSettings, extractAllRules } from '../core/settings-reader.js'
import { printWarning } from '../utils/display.js'

const mockedIsJqAvailable = vi.mocked(isJqAvailable)
const mockedReadGlobalSettings = vi.mocked(readGlobalSettings)
const mockedExtractAllRules = vi.mocked(extractAllRules)
const mockedPrintWarning = vi.mocked(printWarning)

describe('enforceCommand jq check', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('prints warning when jq is not available', async () => {
    mockedIsJqAvailable.mockReturnValue(false)
    mockedReadGlobalSettings.mockResolvedValue({
      permissions: { deny: ['Bash(rm *)'] },
    })
    mockedExtractAllRules.mockReturnValue({
      allowRules: [],
      denyRules: ['Bash(rm *)'],
      askRules: [],
      legacyAllowedTools: [],
      legacyDeny: [],
    })

    await enforceCommand({ dryRun: true })

    expect(mockedPrintWarning).toHaveBeenCalledWith(
      expect.stringContaining('jq')
    )
  })

  it('does not print jq warning when jq is available', async () => {
    mockedIsJqAvailable.mockReturnValue(true)
    mockedReadGlobalSettings.mockResolvedValue({
      permissions: { deny: ['Bash(rm *)'] },
    })
    mockedExtractAllRules.mockReturnValue({
      allowRules: [],
      denyRules: ['Bash(rm *)'],
      askRules: [],
      legacyAllowedTools: [],
      legacyDeny: [],
    })

    await enforceCommand({ dryRun: true })

    const jqWarnings = mockedPrintWarning.mock.calls.filter(
      (call) => typeof call[0] === 'string' && call[0].includes('jq')
    )
    expect(jqWarnings).toHaveLength(0)
  })
})
