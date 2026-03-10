import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock updateClaudeMd before importing the module under test
vi.mock('../src/core/claude-md-updater.js', () => ({
  updateClaudeMd: vi.fn(),
}))

import { handleSetup } from '../src/mcp/tools.js'
import { updateClaudeMd } from '../src/core/claude-md-updater.js'
import type { ClaudeMdUpdateResult } from '../src/core/claude-md-updater.js'

const mockedUpdateClaudeMd = vi.mocked(updateClaudeMd)

describe('handleSetup - CLAUDE.md integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls updateClaudeMd for valid profile', async () => {
    mockedUpdateClaudeMd.mockResolvedValue({
      action: 'added',
      filePath: '/home/user/.claude/CLAUDE.md',
    })

    const result = await handleSetup({ profile: 'balanced' })

    expect(mockedUpdateClaudeMd).toHaveBeenCalledOnce()
    expect(result.isError).toBeUndefined()
  })

  it('includes CLAUDE.md update status in result message when added', async () => {
    mockedUpdateClaudeMd.mockResolvedValue({
      action: 'added',
      filePath: '/home/user/.claude/CLAUDE.md',
    })

    const result = await handleSetup({ profile: 'balanced' })
    const text = result.content[0].text

    expect(text).toContain('CLAUDE.md')
    expect(text).toMatch(/追加|added/i)
  })

  it('includes CLAUDE.md update status in result message when updated', async () => {
    mockedUpdateClaudeMd.mockResolvedValue({
      action: 'updated',
      filePath: '/home/user/.claude/CLAUDE.md',
    })

    const result = await handleSetup({ profile: 'strict' })
    const text = result.content[0].text

    expect(text).toContain('CLAUDE.md')
    expect(text).toMatch(/更新|updated/i)
  })

  it('includes CLAUDE.md update status in result message when skipped', async () => {
    mockedUpdateClaudeMd.mockResolvedValue({
      action: 'skipped',
      filePath: '/home/user/.claude/CLAUDE.md',
    })

    const result = await handleSetup({ profile: 'balanced' })
    const text = result.content[0].text

    expect(text).toContain('CLAUDE.md')
    expect(text).toMatch(/スキップ|skipped|変更なし/i)
  })

  it('does not call updateClaudeMd for invalid profile', async () => {
    const result = await handleSetup({ profile: 'nonexistent' })

    expect(mockedUpdateClaudeMd).not.toHaveBeenCalled()
    expect(result.isError).toBe(true)
  })

  it('continues even if updateClaudeMd throws an error', async () => {
    mockedUpdateClaudeMd.mockRejectedValue(new Error('Permission denied'))

    const result = await handleSetup({ profile: 'balanced' })

    // Should not be an error result - setup should continue
    expect(result.isError).toBeUndefined()
    expect(result.content[0].text).toContain('balanced')
    // Should mention CLAUDE.md error
    expect(result.content[0].text).toMatch(/CLAUDE\.md.*失敗|CLAUDE\.md.*エラー|error.*CLAUDE\.md/i)
  })

  it('still contains original setup instructions', async () => {
    mockedUpdateClaudeMd.mockResolvedValue({
      action: 'added',
      filePath: '/home/user/.claude/CLAUDE.md',
    })

    const result = await handleSetup({ profile: 'strict' })
    const text = result.content[0].text

    expect(text).toContain('npx claude-settings-guard init')
    expect(text).toContain('strict')
  })
})
