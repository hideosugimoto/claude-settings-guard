import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock updateClaudeMd before importing the module under test
vi.mock('../src/core/claude-md-updater.js', () => ({
  updateClaudeMd: vi.fn(),
}))

import { handleSetup } from '../src/mcp/tools.js'
import { updateClaudeMd } from '../src/core/claude-md-updater.js'

const mockedUpdateClaudeMd = vi.mocked(updateClaudeMd)

describe('handleSetup - CLAUDE.md integration removed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does NOT call updateClaudeMd for valid profile', async () => {
    const result = await handleSetup({ profile: 'balanced' })

    expect(mockedUpdateClaudeMd).not.toHaveBeenCalled()
    expect(result.isError).toBeUndefined()
  })

  it('does NOT call updateClaudeMd for any valid profile', async () => {
    await handleSetup({ profile: 'strict' })
    expect(mockedUpdateClaudeMd).not.toHaveBeenCalled()

    await handleSetup({ profile: 'minimal' })
    expect(mockedUpdateClaudeMd).not.toHaveBeenCalled()
  })

  it('does not call updateClaudeMd for invalid profile', async () => {
    const result = await handleSetup({ profile: 'nonexistent' })

    expect(mockedUpdateClaudeMd).not.toHaveBeenCalled()
    expect(result.isError).toBe(true)
  })

  it('mentions csg init in the response message', async () => {
    const result = await handleSetup({ profile: 'balanced' })
    const text = result.content[0].text

    expect(text).toContain('csg init')
    expect(text).toContain('CLAUDE.md')
  })

  it('still contains original setup instructions', async () => {
    const result = await handleSetup({ profile: 'strict' })
    const text = result.content[0].text

    expect(text).toContain('npx claude-settings-guard init')
    expect(text).toContain('strict')
  })

  it('does not include CLAUDE.md action status messages', async () => {
    const result = await handleSetup({ profile: 'balanced' })
    const text = result.content[0].text

    // Should NOT contain old action-specific messages
    expect(text).not.toContain('ルールセクションを追加しました')
    expect(text).not.toContain('ルールセクションを更新しました')
    expect(text).not.toContain('更新に失敗しました')
  })
})
