import { describe, it, expect } from 'vitest'
import { applyProfileToSettings } from '../src/core/profile-applicator.js'
import type { ClaudeSettings, Profile } from '../src/types.js'

const minimalProfile: Profile = {
  name: 'minimal',
  description: 'test',
  deny: ['Bash(sudo *)'],
  allow: ['Read', 'Bash'],
  hooks: { enforce: true, sessionDiagnose: false },
}

const balancedProfile: Profile = {
  name: 'balanced',
  description: 'test',
  deny: ['Bash(sudo *)', 'Read(**/.env)'],
  allow: ['Read', 'Glob'],
  ask: ['Bash', 'Edit'],
  hooks: { enforce: true, sessionDiagnose: false },
}

describe('applyProfileToSettings', () => {
  it('adds missing deny rules', () => {
    const settings: ClaudeSettings = { permissions: { deny: [] } }
    const result = applyProfileToSettings(settings, balancedProfile)

    expect(result.settings.permissions?.deny).toContain('Bash(sudo *)')
    expect(result.settings.permissions?.deny).toContain('Read(**/.env)')
  })

  it('does not duplicate existing deny rules', () => {
    const settings: ClaudeSettings = {
      permissions: { deny: ['Bash(sudo *)'] },
    }
    const result = applyProfileToSettings(settings, balancedProfile)
    const denyCount = result.settings.permissions!.deny!.filter(d => d === 'Bash(sudo *)').length
    expect(denyCount).toBe(1)
  })

  it('adds missing allow rules', () => {
    const settings: ClaudeSettings = { permissions: { allow: [] } }
    const result = applyProfileToSettings(settings, balancedProfile)

    expect(result.settings.permissions?.allow).toContain('Read')
    expect(result.settings.permissions?.allow).toContain('Glob')
  })

  it('adds missing ask rules', () => {
    const settings: ClaudeSettings = { permissions: {} }
    const result = applyProfileToSettings(settings, balancedProfile)

    expect(result.settings.permissions?.ask).toContain('Bash')
    expect(result.settings.permissions?.ask).toContain('Edit')
  })

  it('does not add ask when profile has none', () => {
    const settings: ClaudeSettings = { permissions: {} }
    const result = applyProfileToSettings(settings, minimalProfile)

    expect(result.settings.permissions?.ask).toBeUndefined()
  })

  it('reports added deny count', () => {
    const settings: ClaudeSettings = { permissions: { deny: [] } }
    const result = applyProfileToSettings(settings, balancedProfile)

    expect(result.addedDeny).toBeGreaterThan(0)
  })

  it('reports added allow count', () => {
    const settings: ClaudeSettings = { permissions: {} }
    const result = applyProfileToSettings(settings, balancedProfile)

    expect(result.addedAllow).toBeGreaterThan(0)
  })

  it('reports added ask count', () => {
    const settings: ClaudeSettings = { permissions: {} }
    const result = applyProfileToSettings(settings, balancedProfile)

    expect(result.addedAsk).toBeGreaterThan(0)
  })

  it('returns immutable result (does not mutate input)', () => {
    const settings: ClaudeSettings = { permissions: { deny: ['existing'] } }
    const original = JSON.parse(JSON.stringify(settings))
    applyProfileToSettings(settings, balancedProfile)

    expect(settings).toEqual(original)
  })

  it('preserves other settings fields', () => {
    const settings: ClaudeSettings = {
      permissions: { deny: [] },
      env: { FOO: 'bar' },
    }
    const result = applyProfileToSettings(settings, minimalProfile)

    expect(result.settings.env).toEqual({ FOO: 'bar' })
  })

  it('includes DEFAULT_DENY_RULES in deny', () => {
    const settings: ClaudeSettings = { permissions: {} }
    const result = applyProfileToSettings(settings, minimalProfile)

    // DEFAULT_DENY_RULES includes 'Bash(rm -rf /*)' which minimal doesn't have
    expect(result.settings.permissions?.deny).toContain('Bash(rm -rf /*)')
  })

  it('handles settings with no permissions field', () => {
    const settings: ClaudeSettings = {}
    const result = applyProfileToSettings(settings, balancedProfile)

    expect(result.settings.permissions?.deny).toBeDefined()
    expect(result.settings.permissions?.allow).toBeDefined()
  })
})
