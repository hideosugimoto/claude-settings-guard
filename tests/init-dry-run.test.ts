import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ClaudeSettings, Profile } from '../src/types.js'

// Mock all external dependencies before importing the module under test
vi.mock('../src/core/settings-reader.js', () => ({
  readGlobalSettings: vi.fn(),
}))

vi.mock('../src/core/settings-writer.js', () => ({
  writeSettings: vi.fn(),
}))

vi.mock('../src/utils/paths.js', () => ({
  getGlobalSettingsPath: vi.fn(() => '/mock/.claude/settings.json'),
  expandHome: vi.fn((p: string) => p),
}))

vi.mock('../src/core/hook-regenerator.js', () => ({
  regenerateEnforceHook: vi.fn(),
  ensureHookRegistered: vi.fn(),
}))

vi.mock('../src/commands/deploy-slash.js', () => ({
  deploySlashCommands: vi.fn(() => Promise.resolve({ deployed: [], skipped: [], errors: [] })),
  printDeployResult: vi.fn(),
}))

vi.mock('../src/core/session-hook.js', () => ({
  installSessionHook: vi.fn(),
}))

vi.mock('../src/core/claude-md-updater.js', () => ({
  updateClaudeMd: vi.fn(() => Promise.resolve({ action: 'skipped', filePath: '/mock/CLAUDE.md' })),
}))

vi.mock('../src/core/automode-switch.js', () => ({
  extractManagedRules: vi.fn(() => ({ deny: [], allow: [], ask: [] })),
  saveManagedRules: vi.fn(() => Promise.resolve('/mock/.claude/csg-rules.json')),
  deploySessionSwitchHook: vi.fn(() => Promise.resolve('/mock/.claude/hooks/csg-session.sh')),
  mergeSessionSwitchHookIntoSettings: vi.fn((settings: unknown) => settings),
}))


vi.mock('../src/profiles/index.js', () => ({
  isValidProfileName: vi.fn((name: string) => ['minimal', 'balanced', 'strict'].includes(name)),
  getProfile: vi.fn((name: string) => {
    const profiles: Record<string, Profile> = {
      balanced: {
        name: 'balanced',
        description: 'Balanced profile',
        deny: ['Bash(sudo *)'],
        allow: ['Read', 'Glob'],
        ask: ['Bash', 'Edit'],
        hooks: { enforce: true, sessionDiagnose: false },
      },
      minimal: {
        name: 'minimal',
        description: 'Minimal profile',
        deny: ['Bash(sudo *)'],
        allow: ['Read', 'Bash'],
        hooks: { enforce: false, sessionDiagnose: false },
      },
    }
    return profiles[name] ?? profiles.balanced
  }),
}))

vi.mock('../src/core/profile-applicator.js', () => ({
  applyProfileToSettings: vi.fn((_settings: ClaudeSettings, _profile: Profile) => ({
    settings: { permissions: { deny: ['Bash(sudo *)'], allow: ['Read', 'Glob'] } },
    addedDeny: 1,
    addedAllow: 2,
    addedAsk: 1,
    removedFromAllow: 0,
    removedFromDeny: [],
    removedFromAsk: [],
  })),
}))

import { initCommand } from '../src/commands/init.js'
import { readGlobalSettings } from '../src/core/settings-reader.js'
import { writeSettings } from '../src/core/settings-writer.js'
import { regenerateEnforceHook, ensureHookRegistered } from '../src/core/hook-regenerator.js'
import { deploySlashCommands } from '../src/commands/deploy-slash.js'
import { installSessionHook } from '../src/core/session-hook.js'
import { updateClaudeMd } from '../src/core/claude-md-updater.js'

describe('initCommand --dry-run', () => {
  let stdoutOutput: string
  let stderrOutput: string
  const originalStdoutWrite = process.stdout.write
  const originalStderrWrite = process.stderr.write

  beforeEach(() => {
    vi.clearAllMocks()
    stdoutOutput = ''
    stderrOutput = ''

    process.stdout.write = vi.fn((chunk: string | Uint8Array) => {
      stdoutOutput += String(chunk)
      return true
    }) as typeof process.stdout.write

    process.stderr.write = vi.fn((chunk: string | Uint8Array) => {
      stderrOutput += String(chunk)
      return true
    }) as typeof process.stderr.write

    vi.mocked(readGlobalSettings).mockResolvedValue({
      permissions: { deny: [], allow: [] },
    })

    vi.mocked(writeSettings).mockResolvedValue({
      success: true,
      backupPath: '/mock/backup.json',
    })

    vi.mocked(regenerateEnforceHook).mockResolvedValue({
      hookPath: '/mock/hook.sh',
      rulesCount: 1,
    })

    vi.mocked(ensureHookRegistered).mockImplementation((s) => s)

    vi.mocked(installSessionHook).mockResolvedValue({
      hookPath: '/mock/session-hook.sh',
      settings: { permissions: { deny: ['Bash(sudo *)'], allow: ['Read'] } },
    })
  })

  afterEach(() => {
    process.stdout.write = originalStdoutWrite
    process.stderr.write = originalStderrWrite
  })

  it('accepts dryRun option in InitOptions', async () => {
    // Should not throw when dryRun is passed
    await initCommand({ dryRun: true })
  })

  it('does not write settings when dry-run is enabled', async () => {
    await initCommand({ dryRun: true })

    expect(writeSettings).not.toHaveBeenCalled()
  })

  it('does not deploy slash commands when dry-run is enabled', async () => {
    await initCommand({ dryRun: true })

    expect(deploySlashCommands).not.toHaveBeenCalled()
  })

  it('does not update CLAUDE.md when dry-run is enabled', async () => {
    await initCommand({ dryRun: true })

    expect(updateClaudeMd).not.toHaveBeenCalled()
  })

  it('does not generate enforce hook when dry-run is enabled', async () => {
    await initCommand({ dryRun: true })

    expect(regenerateEnforceHook).not.toHaveBeenCalled()
  })

  it('does not install session hook when dry-run is enabled', async () => {
    await initCommand({ dryRun: true })

    expect(installSessionHook).not.toHaveBeenCalled()
  })

  it('displays [DRY-RUN] prefix in output', async () => {
    await initCommand({ dryRun: true })

    expect(stdoutOutput).toContain('[DRY-RUN]')
  })

  it('displays summary of what would change', async () => {
    await initCommand({ dryRun: true })

    // Should show the rules that would be added
    expect(stdoutOutput).toContain('deny')
    expect(stdoutOutput).toContain('allow')
  })

  it('displays final message that no changes were applied', async () => {
    await initCommand({ dryRun: true })

    expect(stdoutOutput).toContain('変更は適用されていません')
  })

  it('still reads settings to compute what would change', async () => {
    await initCommand({ dryRun: true })

    expect(readGlobalSettings).toHaveBeenCalled()
  })

  it('shows profile name with dry-run prefix when profile is specified', async () => {
    await initCommand({ dryRun: true, profile: 'strict' })

    expect(stdoutOutput).toContain('[DRY-RUN]')
    expect(stdoutOutput).toContain('strict')
  })

  it('shows removed rules info in dry-run mode', async () => {
    const { applyProfileToSettings } = await import('../src/core/profile-applicator.js')
    vi.mocked(applyProfileToSettings).mockReturnValueOnce({
      settings: { permissions: { deny: ['Bash(sudo *)'], allow: ['Read'] } },
      addedDeny: 0,
      addedAllow: 0,
      addedAsk: 0,
      removedFromAllow: 0,
      removedFromDeny: ['Bash(curl *)'],
      removedFromAsk: ['Edit'],
    })

    await initCommand({ dryRun: true })

    expect(stdoutOutput).toContain('Bash(curl *)')
    expect(stdoutOutput).toContain('Edit')
  })

  it('works normally (writes settings) when dry-run is not set', async () => {
    await initCommand({})

    expect(writeSettings).toHaveBeenCalled()
    expect(deploySlashCommands).toHaveBeenCalled()
    expect(updateClaudeMd).toHaveBeenCalled()
    expect(stdoutOutput).not.toContain('[DRY-RUN]')
    expect(stdoutOutput).not.toContain('変更は適用されていません')
  })
})
