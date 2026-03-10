import { describe, it, expect } from 'vitest'
import { applyProfileToSettings } from '../src/core/profile-applicator.js'
import { getAllProfileDenyRules, profiles } from '../src/profiles/index.js'
import { strictProfile } from '../src/profiles/strict.js'
import { minimalProfile as realMinimalProfile } from '../src/profiles/minimal.js'
import { DEFAULT_DENY_RULES } from '../src/constants.js'
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

  it('removes stale ask entries when switching to a profile that allows them', () => {
    // Simulate: balanced was applied first (Edit/Write in ask)
    const afterBalanced = applyProfileToSettings({}, balancedProfile)
    expect(afterBalanced.settings.permissions?.ask).toContain('Edit')

    // Now switch to minimal (Edit/Write should be in allow, not ask)
    const minimalWithAllow: Profile = {
      name: 'minimal',
      description: 'test',
      deny: ['Bash(sudo *)'],
      allow: ['Read', 'Edit', 'Write', 'Bash'],
      ask: [],
      hooks: { enforce: true, sessionDiagnose: false },
    }
    const afterMinimal = applyProfileToSettings(afterBalanced.settings, minimalWithAllow)

    const askAfterMinimal = afterMinimal.settings.permissions?.ask ?? []
    expect(askAfterMinimal).not.toContain('Edit')
    expect(askAfterMinimal).not.toContain('Write')
    expect(afterMinimal.settings.permissions?.allow).toContain('Edit')
    expect(afterMinimal.settings.permissions?.allow).toContain('Write')
  })

  it('removes stale deny entries when switching to a less strict profile', () => {
    const strictProfile: Profile = {
      name: 'strict',
      description: 'test',
      deny: ['Bash(sudo *)', 'Bash(curl *)', 'Bash(wget *)', 'Read(**/.env)'],
      allow: ['Read', 'Glob'],
      ask: ['Bash', 'Edit'],
      hooks: { enforce: true, sessionDiagnose: true },
    }
    const afterStrict = applyProfileToSettings({}, strictProfile)
    expect(afterStrict.settings.permissions?.deny).toContain('Bash(curl *)')
    expect(afterStrict.settings.permissions?.deny).toContain('Bash(wget *)')

    // Switch to minimal (no curl/wget deny)
    const minimalLike: Profile = {
      name: 'minimal',
      description: 'test',
      deny: ['Bash(sudo *)'],
      allow: ['Read', 'Edit', 'Write', 'Bash'],
      ask: [],
      hooks: { enforce: true, sessionDiagnose: false },
    }
    const afterMinimal = applyProfileToSettings(afterStrict.settings, minimalLike)

    expect(afterMinimal.settings.permissions?.deny).not.toContain('Bash(curl *)')
    expect(afterMinimal.settings.permissions?.deny).not.toContain('Bash(wget *)')
    expect(afterMinimal.settings.permissions?.deny).toContain('Bash(sudo *)')
    expect(afterMinimal.removedFromDeny).toContain('Bash(curl *)')
    expect(afterMinimal.removedFromDeny).toContain('Bash(wget *)')
  })

  it('preserves user-added custom deny rules during profile switch', () => {
    // User has a custom deny rule not from any profile
    const settings: ClaudeSettings = {
      permissions: {
        deny: ['Bash(sudo *)', 'Bash(curl *)', 'Bash(my-custom-dangerous-cmd *)'],
      },
    }

    const minimalLike: Profile = {
      name: 'minimal',
      description: 'test',
      deny: ['Bash(sudo *)'],
      allow: ['Read'],
      hooks: { enforce: true, sessionDiagnose: false },
    }
    const result = applyProfileToSettings(settings, minimalLike)

    // curl removed (known profile rule), custom preserved
    expect(result.settings.permissions?.deny).not.toContain('Bash(curl *)')
    expect(result.settings.permissions?.deny).toContain('Bash(my-custom-dangerous-cmd *)')
    expect(result.settings.permissions?.deny).toContain('Bash(sudo *)')
  })

  it('reports removed ask entries in removedFromAsk', () => {
    const afterBalanced = applyProfileToSettings({}, balancedProfile)

    const minimalLike: Profile = {
      name: 'minimal',
      description: 'test',
      deny: ['Bash(sudo *)'],
      allow: ['Read', 'Edit', 'Write', 'Bash'],
      ask: [],
      hooks: { enforce: true, sessionDiagnose: false },
    }
    const result = applyProfileToSettings(afterBalanced.settings, minimalLike)

    expect(result.removedFromAsk).toContain('Edit')
  })

  it('dynamically uses all profile deny rules for stale rule cleanup', () => {
    // Apply strict profile first (has many deny rules)
    const afterStrict = applyProfileToSettings({}, strictProfile)

    // All strict deny rules should be present
    for (const rule of strictProfile.deny) {
      expect(afterStrict.settings.permissions?.deny).toContain(rule)
    }

    // Switch to real minimal profile — strict-only deny rules should be removed
    const afterMinimal = applyProfileToSettings(afterStrict.settings, realMinimalProfile)

    // Rules in strict but not in minimal AND not in DEFAULT_DENY_RULES should be removed
    const defaultDenySet = new Set(DEFAULT_DENY_RULES)
    const minimalDenySet = new Set([...realMinimalProfile.deny])
    for (const rule of strictProfile.deny) {
      if (!minimalDenySet.has(rule) && !defaultDenySet.has(rule)) {
        expect(afterMinimal.settings.permissions?.deny).not.toContain(rule)
      }
    }

    // Rules in DEFAULT_DENY_RULES should still be present regardless of profile
    for (const rule of DEFAULT_DENY_RULES) {
      expect(afterMinimal.settings.permissions?.deny).toContain(rule)
    }
  })

  it('automatically recognizes new profile deny rules without hardcoding', () => {
    // The allProfileDenyRules set should match exactly the union of
    // all profiles' deny rules plus DEFAULT_DENY_RULES
    const allRules = getAllProfileDenyRules()

    const expected = new Set<string>(DEFAULT_DENY_RULES)
    for (const profile of Object.values(profiles) as Profile[]) {
      for (const rule of profile.deny) {
        expected.add(rule)
      }
    }

    // They should be identical — no hardcoded extras, no missing rules
    expect(allRules.size).toBe(expected.size)
    for (const rule of expected) {
      expect(allRules.has(rule)).toBe(true)
    }
  })

  it('keeps ask entries that are not in the new profile allow', () => {
    // balanced puts Bash in ask
    const afterBalanced = applyProfileToSettings({}, balancedProfile)

    // A profile that allows Edit but not Bash
    const customProfile: Profile = {
      name: 'minimal',
      description: 'test',
      deny: ['Bash(sudo *)'],
      allow: ['Read', 'Edit'],
      ask: ['Bash(git push *)'],
      hooks: { enforce: true, sessionDiagnose: false },
    }
    const result = applyProfileToSettings(afterBalanced.settings, customProfile)

    // Bash should remain in ask (not in new profile's allow)
    expect(result.settings.permissions?.ask).toContain('Bash')
    // Edit should be removed from ask and moved to allow
    expect(result.settings.permissions?.ask).not.toContain('Edit')
    expect(result.settings.permissions?.allow).toContain('Edit')
  })
})
