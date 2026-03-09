import { describe, it, expect, vi, beforeEach } from 'vitest'
import { regenerateEnforceHook, ensureHookRegistered } from '../src/core/hook-regenerator.js'
import { writeFile, chmod } from 'node:fs/promises'
import { ensureDir } from '../src/utils/paths.js'
import type { ClaudeSettings } from '../src/types.js'

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn(),
  chmod: vi.fn(),
}))

vi.mock('../src/utils/paths.js', () => ({
  getHooksDir: () => '/mock/hooks',
  ensureDir: vi.fn(),
  expandHome: () => '/mock/.claude/hooks/enforce-permissions.sh',
}))

describe('regenerateEnforceHook', () => {
  beforeEach(() => {
    vi.mocked(writeFile).mockReset()
    vi.mocked(chmod).mockReset()
    vi.mocked(ensureDir).mockReset()
  })

  it('generates hook script from deny rules', async () => {
    const settings: ClaudeSettings = { permissions: { deny: ['Bash(sudo *)'] } }
    const result = await regenerateEnforceHook(settings)

    expect(result.hookPath).toBe('/mock/hooks/enforce-permissions.sh')
    expect(result.rulesCount).toBe(1)
    expect(ensureDir).toHaveBeenCalledWith('/mock/hooks')
    expect(writeFile).toHaveBeenCalledOnce()
    expect(chmod).toHaveBeenCalledWith('/mock/hooks/enforce-permissions.sh', 0o755)
  })

  it('skips generation when deny rules are empty', async () => {
    const result = await regenerateEnforceHook({})

    expect(result.rulesCount).toBe(0)
    expect(writeFile).not.toHaveBeenCalled()
    expect(chmod).not.toHaveBeenCalled()
    expect(ensureDir).not.toHaveBeenCalled()
  })
})

describe('ensureHookRegistered', () => {
  it('adds PreToolUse entry when not registered', () => {
    const settings: ClaudeSettings = {}
    const result = ensureHookRegistered(settings)

    expect(result.PreToolUse).toHaveLength(1)
    expect(result.PreToolUse?.[0].hooks[0].command).toContain('enforce-permissions.sh')
  })

  it('returns unchanged settings when hook is already registered', () => {
    const settings: ClaudeSettings = {
      PreToolUse: [{
        matcher: '*',
        hooks: [{ type: 'command', command: '/mock/.claude/hooks/enforce-permissions.sh' }],
      }],
    }
    const result = ensureHookRegistered(settings)

    expect(result).toBe(settings)
    expect(result.PreToolUse).toHaveLength(1)
  })
})
