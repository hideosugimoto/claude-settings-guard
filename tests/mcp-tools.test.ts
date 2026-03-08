import { describe, it, expect, vi } from 'vitest'
import { handleDiagnose, handleRecommend, handleEnforce, handleSetup } from '../src/mcp/tools.js'

describe('mcp/tools', () => {
  describe('handleDiagnose', () => {
    it('returns a result with content', async () => {
      const result = await handleDiagnose()
      expect(result.content).toHaveLength(1)
      expect(result.content[0].type).toBe('text')
      expect(typeof result.content[0].text).toBe('string')
    })

    it('returns pattern count or not-found message', async () => {
      const result = await handleDiagnose()
      const text = result.content[0].text
      expect(
        text.includes('パターン') || text.includes('見つかりません')
      ).toBe(true)
    })
  })

  describe('handleEnforce', () => {
    it('returns a result for dry-run', async () => {
      const result = await handleEnforce({ dryRun: true })
      expect(result.content).toHaveLength(1)
      expect(typeof result.content[0].text).toBe('string')
    })

    it('returns a result for non dry-run', async () => {
      const result = await handleEnforce({})
      expect(result.content).toHaveLength(1)
      expect(typeof result.content[0].text).toBe('string')
    })

    it('handles missing settings gracefully', async () => {
      const result = await handleEnforce({ dryRun: true })
      // Should not throw, returns either result or error
      expect(result.content[0].type).toBe('text')
    })
  })

  describe('handleRecommend', () => {
    it('returns profile info for valid profile', async () => {
      const result = await handleRecommend({ profile: 'minimal' })
      expect(result.isError).toBeUndefined()
      expect(result.content[0].text).toContain('minimal')
      expect(result.content[0].text).toContain('deny')
      expect(result.content[0].text).toContain('allow')
    })

    it('defaults to balanced profile', async () => {
      const result = await handleRecommend({})
      expect(result.content[0].text).toContain('balanced')
    })

    it('returns error for invalid profile', async () => {
      const result = await handleRecommend({ profile: 'nonexistent' })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('不明なプロファイル')
    })

    it('includes ask rules for balanced profile', async () => {
      const result = await handleRecommend({ profile: 'balanced' })
      expect(result.content[0].text).toContain('ask')
    })

    it('shows strict profile features', async () => {
      const result = await handleRecommend({ profile: 'strict' })
      expect(result.content[0].text).toContain('sessionDiagnose=true')
    })
  })

  describe('handleSetup', () => {
    it('returns instruction for valid profile', async () => {
      const result = await handleSetup({ profile: 'strict' })
      expect(result.isError).toBeUndefined()
      expect(result.content[0].text).toContain('strict')
      expect(result.content[0].text).toContain('npx claude-settings-guard init')
    })

    it('defaults to balanced', async () => {
      const result = await handleSetup({})
      expect(result.content[0].text).toContain('balanced')
    })

    it('returns error for invalid profile', async () => {
      const result = await handleSetup({ profile: 'invalid' })
      expect(result.isError).toBe(true)
    })
  })

  describe('profile validation edge cases', () => {
    it('handleRecommend: empty string profile returns error', async () => {
      const result = await handleRecommend({ profile: '' })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('不明なプロファイル')
    })

    it('handleSetup: empty string profile returns error', async () => {
      const result = await handleSetup({ profile: '' })
      expect(result.isError).toBe(true)
    })

    it('handleRecommend: case-sensitive - Balanced (uppercase) returns error', async () => {
      const result = await handleRecommend({ profile: 'Balanced' })
      expect(result.isError).toBe(true)
    })

    it('handleSetup: case-sensitive - STRICT (uppercase) returns error', async () => {
      const result = await handleSetup({ profile: 'STRICT' })
      expect(result.isError).toBe(true)
    })

    it('handleRecommend: profile with spaces returns error', async () => {
      const result = await handleRecommend({ profile: ' balanced ' })
      expect(result.isError).toBe(true)
    })

    it('handleRecommend: SQL injection-like profile returns error', async () => {
      const result = await handleRecommend({ profile: "'; DROP TABLE --" })
      expect(result.isError).toBe(true)
    })

    it('handleSetup: very long profile name returns error', async () => {
      const result = await handleSetup({ profile: 'a'.repeat(1000) })
      expect(result.isError).toBe(true)
    })

    it('handleRecommend: lists valid profile names in error', async () => {
      const result = await handleRecommend({ profile: 'invalid' })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('minimal')
      expect(result.content[0].text).toContain('balanced')
      expect(result.content[0].text).toContain('strict')
    })

    it('handleRecommend: all valid profiles return non-error results', async () => {
      for (const name of ['minimal', 'balanced', 'strict']) {
        const result = await handleRecommend({ profile: name })
        expect(result.isError).toBeUndefined()
        expect(result.content[0].text).toContain(name)
      }
    })

    it('handleRecommend: minimal profile has no ask rules section', async () => {
      const result = await handleRecommend({ profile: 'minimal' })
      // minimal profile has no ask rules
      expect(result.content[0].text).not.toContain('ask ルール')
    })

    it('handleSetup: includes security warning about direct apply', async () => {
      const result = await handleSetup({ profile: 'balanced' })
      expect(result.content[0].text).toContain('セキュリティ上')
    })
  })
})
