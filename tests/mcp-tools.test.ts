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
})
