import { describe, it, expect } from 'vitest'
import { applyRecommendations } from '../src/core/recommendation-applier.js'
import type { ClaudeSettings, Recommendation } from '../src/types.js'

describe('applyRecommendations', () => {
  it('adds allow recommendations', () => {
    const settings: ClaudeSettings = {}
    const recs: Recommendation[] = [{
      action: 'add-allow',
      pattern: 'Bash(npm test)',
      reason: 'frequent allow',
    }]

    const result = applyRecommendations(settings, recs)
    expect(result.finalAllow).toContain('Bash(npm test)')
    expect(result.addedAllow).toContain('Bash(npm test)')
  })

  it('adds deny recommendations', () => {
    const settings: ClaudeSettings = {}
    const recs: Recommendation[] = [{
      action: 'add-deny',
      pattern: 'Bash(rm -rf /*)',
      reason: 'deny',
    }]

    const result = applyRecommendations(settings, recs)
    expect(result.finalDeny).toContain('Bash(rm -rf /*)')
    expect(result.addedDeny).toContain('Bash(rm -rf /*)')
    expect(result.hasDenyChanges).toBe(true)
  })

  it('adds ask recommendations', () => {
    const settings: ClaudeSettings = {}
    const recs: Recommendation[] = [{
      action: 'add-ask',
      pattern: 'Bash(ssh *)',
      reason: 'needs confirmation',
    }]

    const result = applyRecommendations(settings, recs)
    expect(result.finalAsk).toContain('Bash(ssh *)')
    expect(result.addedAsk).toContain('Bash(ssh *)')
  })

  it('clears CSG-managed rules and rebuilds from recommendations', () => {
    // Simulate existing CSG-managed rules in settings
    const settings: ClaudeSettings = {
      permissions: {
        allow: ['Read', 'Glob', 'Grep', 'Bash(git add *)'],
        deny: ['Bash(sudo *)'],
        ask: ['Bash(git push *)'],
      },
    }

    // Recommend only a subset — the managed rules not in recs should be cleared
    const recs: Recommendation[] = [
      { action: 'add-deny', pattern: 'Bash(sudo *)', reason: 'deny' },
      { action: 'add-allow', pattern: 'Read', reason: 'allow' },
    ]

    const result = applyRecommendations(settings, recs)
    // CSG-managed rules not in recs should be gone
    expect(result.finalAllow).not.toContain('Bash(git add *)')
    expect(result.finalAsk).not.toContain('Bash(git push *)')
    // Recommended rules should be present
    expect(result.finalDeny).toContain('Bash(sudo *)')
    expect(result.finalAllow).toContain('Read')
  })

  it('preserves user-added custom rules', () => {
    const settings: ClaudeSettings = {
      permissions: {
        allow: ['Read', 'Bash(my-custom-tool *)'],
        deny: ['Bash(sudo *)'],
      },
    }

    const recs: Recommendation[] = [
      { action: 'add-deny', pattern: 'Bash(sudo *)', reason: 'deny' },
      { action: 'add-allow', pattern: 'Read', reason: 'allow' },
    ]

    const result = applyRecommendations(settings, recs)
    // User-added rule should be preserved
    expect(result.finalAllow).toContain('Bash(my-custom-tool *)')
    expect(result.finalAllow).toContain('Read')
  })

  it('deny takes precedence over allow', () => {
    const settings: ClaudeSettings = {}
    const recs: Recommendation[] = [
      { action: 'add-deny', pattern: 'Bash(rm *)', reason: 'deny' },
      { action: 'add-allow', pattern: 'Bash(rm *)', reason: 'allow' },
    ]

    const result = applyRecommendations(settings, recs)
    expect(result.finalDeny).toContain('Bash(rm *)')
    expect(result.finalAllow).not.toContain('Bash(rm *)')
  })

  it('ask takes precedence over allow', () => {
    const settings: ClaudeSettings = {}
    const recs: Recommendation[] = [
      { action: 'add-ask', pattern: 'Bash(curl *)', reason: 'ask' },
      { action: 'add-allow', pattern: 'Bash(curl *)', reason: 'allow' },
    ]

    const result = applyRecommendations(settings, recs)
    expect(result.finalAsk).toContain('Bash(curl *)')
    expect(result.finalAllow).not.toContain('Bash(curl *)')
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
  })
})
