import { describe, it, expect } from 'vitest'
import { applyRecommendations } from '../src/core/recommendation-applier.js'
import type { ClaudeSettings, Recommendation } from '../src/types.js'

describe('applyRecommendations', () => {
  it('adds allow recommendations to permissions.allow', () => {
    const settings: ClaudeSettings = { permissions: { allow: ['Read(*)'] } }
    const recs: Recommendation[] = [{
      action: 'add-allow',
      pattern: 'Bash(npm test)',
      reason: 'frequent allow',
    }]

    const result = applyRecommendations(settings, recs)
    expect(result.settings.permissions?.allow).toEqual(['Read(*)', 'Bash(npm test)'])
    expect(result.addedAllow).toEqual(['Bash(npm test)'])
  })

  it('adds deny recommendations to permissions.deny', () => {
    const settings: ClaudeSettings = { permissions: { deny: ['Bash(sudo *)'] } }
    const recs: Recommendation[] = [{
      action: 'add-deny',
      pattern: 'Bash(rm -rf /*)',
      reason: 'frequent deny',
    }]

    const result = applyRecommendations(settings, recs)
    expect(result.settings.permissions?.deny).toEqual(['Bash(sudo *)', 'Bash(rm -rf /*)'])
    expect(result.addedDeny).toEqual(['Bash(rm -rf /*)'])
    expect(result.hasDenyChanges).toBe(true)
  })

  it('does not add duplicates', () => {
    const settings: ClaudeSettings = { permissions: { allow: ['Bash(npm test)'] } }
    const recs: Recommendation[] = [{
      action: 'add-allow',
      pattern: 'Bash(npm test)',
      reason: 'duplicate',
    }]

    const result = applyRecommendations(settings, recs)
    expect(result.settings.permissions?.allow).toEqual(['Bash(npm test)'])
    expect(result.addedAllow).toHaveLength(0)
  })

  it('does not mutate original settings', () => {
    const settings: ClaudeSettings = { permissions: { allow: [], deny: [] } }
    const recs: Recommendation[] = [{
      action: 'add-deny',
      pattern: 'Bash(sudo *)',
      reason: 'deny',
    }]

    const result = applyRecommendations(settings, recs)
    expect(result.settings).not.toBe(settings)
    expect(settings.permissions?.deny).toEqual([])
    expect(result.settings.permissions?.deny).toEqual(['Bash(sudo *)'])
  })

  it('returns no changes for empty recommendations', () => {
    const settings: ClaudeSettings = {}
    const result = applyRecommendations(settings, [])

    expect(result.settings).toBe(settings)
    expect(result.addedAllow).toEqual([])
    expect(result.addedDeny).toEqual([])
    expect(result.hasDenyChanges).toBe(false)
  })
})
