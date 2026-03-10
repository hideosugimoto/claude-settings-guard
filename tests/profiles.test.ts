import { describe, it, expect } from 'vitest'
import { getAllProfileDenyRules, getProfile, getProfileNames, isValidProfileName, profiles } from '../src/profiles/index.js'
import { minimalProfile } from '../src/profiles/minimal.js'
import { balancedProfile } from '../src/profiles/balanced.js'
import { strictProfile } from '../src/profiles/strict.js'
import { DEFAULT_DENY_RULES } from '../src/constants.js'
import type { ProfileName } from '../src/types.js'

describe('profiles', () => {
  describe('getProfileNames', () => {
    it('returns all three profile names', () => {
      expect(getProfileNames()).toEqual(['minimal', 'balanced', 'strict'])
    })
  })

  describe('isValidProfileName', () => {
    it('accepts valid profile names', () => {
      expect(isValidProfileName('minimal')).toBe(true)
      expect(isValidProfileName('balanced')).toBe(true)
      expect(isValidProfileName('strict')).toBe(true)
    })

    it('rejects invalid profile names', () => {
      expect(isValidProfileName('unknown')).toBe(false)
      expect(isValidProfileName('')).toBe(false)
      expect(isValidProfileName('Minimal')).toBe(false)
    })
  })

  describe('getProfile', () => {
    it('returns the correct profile for each name', () => {
      expect(getProfile('minimal')).toBe(minimalProfile)
      expect(getProfile('balanced')).toBe(balancedProfile)
      expect(getProfile('strict')).toBe(strictProfile)
    })
  })

  describe('profiles registry', () => {
    it('contains all three profiles', () => {
      expect(Object.keys(profiles)).toEqual(['minimal', 'balanced', 'strict'])
    })
  })

  describe('minimal profile', () => {
    it('has correct name and description', () => {
      expect(minimalProfile.name).toBe('minimal')
      expect(minimalProfile.description).toBeTruthy()
    })

    it('has minimal deny rules', () => {
      expect(minimalProfile.deny).toContain('Bash(sudo *)')
      expect(minimalProfile.deny).toContain('Bash(rm -rf /*)')
      expect(minimalProfile.deny.length).toBe(2)
    })

    it('allows most tools', () => {
      expect(minimalProfile.allow).toContain('Bash')
      expect(minimalProfile.allow).toContain('Read')
      expect(minimalProfile.allow).toContain('Edit')
      expect(minimalProfile.allow).toContain('Write')
    })

    it('has ask rules for hard-to-reverse commands', () => {
      expect(minimalProfile.ask).toBeDefined()
      expect(minimalProfile.ask).toContain('Bash(git push *)')
      expect(minimalProfile.ask).toContain('Bash(npm publish *)')
    })

    it('enables enforce but not sessionDiagnose', () => {
      expect(minimalProfile.hooks.enforce).toBe(true)
      expect(minimalProfile.hooks.sessionDiagnose).toBe(false)
    })
  })

  describe('balanced profile', () => {
    it('has correct name', () => {
      expect(balancedProfile.name).toBe('balanced')
    })

    it('denies sensitive file access', () => {
      expect(balancedProfile.deny).toContain('Read(**/.env)')
      expect(balancedProfile.deny).toContain('Read(**/secrets/**)')
    })

    it('asks for write operations', () => {
      expect(balancedProfile.ask).toContain('Bash')
      expect(balancedProfile.ask).toContain('Edit')
      expect(balancedProfile.ask).toContain('Write')
    })

    it('allows read-only tools', () => {
      expect(balancedProfile.allow).toContain('Read')
      expect(balancedProfile.allow).toContain('Glob')
      expect(balancedProfile.allow).toContain('Grep')
    })

    it('does not enable sessionDiagnose', () => {
      expect(balancedProfile.hooks.sessionDiagnose).toBe(false)
    })
  })

  describe('strict profile', () => {
    it('has correct name', () => {
      expect(strictProfile.name).toBe('strict')
    })

    it('denies network commands', () => {
      expect(strictProfile.deny).toContain('Bash(curl *)')
      expect(strictProfile.deny).toContain('Bash(wget *)')
    })

    it('denies writing to .env', () => {
      expect(strictProfile.deny).toContain('Write(**/.env)')
    })

    it('enables sessionDiagnose', () => {
      expect(strictProfile.hooks.sessionDiagnose).toBe(true)
    })

    it('has more deny rules than balanced', () => {
      expect(strictProfile.deny.length).toBeGreaterThan(balancedProfile.deny.length)
    })
  })

  describe('getAllProfileDenyRules', () => {
    it('returns a Set containing all deny rules from every profile', () => {
      const allRules = getAllProfileDenyRules()
      const allNames: ProfileName[] = ['minimal', 'balanced', 'strict']

      for (const name of allNames) {
        const profile = getProfile(name)
        for (const rule of profile.deny) {
          expect(allRules.has(rule)).toBe(true)
        }
      }
    })

    it('includes DEFAULT_DENY_RULES', () => {
      const allRules = getAllProfileDenyRules()

      for (const rule of DEFAULT_DENY_RULES) {
        expect(allRules.has(rule)).toBe(true)
      }
    })

    it('returns a ReadonlySet (immutable)', () => {
      const allRules = getAllProfileDenyRules()
      expect(allRules).toBeInstanceOf(Set)
    })

    it('does not contain rules that are not in any profile or DEFAULT_DENY_RULES', () => {
      const allRules = getAllProfileDenyRules()
      expect(allRules.has('Bash(some-random-command *)')).toBe(false)
    })

    it('contains the union of all profile deny rules plus DEFAULT_DENY_RULES', () => {
      const allRules = getAllProfileDenyRules()

      // Build expected set manually
      const expected = new Set<string>(DEFAULT_DENY_RULES)
      for (const name of getProfileNames()) {
        for (const rule of getProfile(name).deny) {
          expected.add(rule)
        }
      }

      expect(allRules.size).toBe(expected.size)
      for (const rule of expected) {
        expect(allRules.has(rule)).toBe(true)
      }
    })
  })

  describe('all profiles have required fields', () => {
    const allNames: ProfileName[] = ['minimal', 'balanced', 'strict']

    for (const name of allNames) {
      it(`${name} has all required fields`, () => {
        const profile = getProfile(name)
        expect(profile.name).toBe(name)
        expect(profile.description).toBeTruthy()
        expect(Array.isArray(profile.deny)).toBe(true)
        expect(Array.isArray(profile.allow)).toBe(true)
        expect(typeof profile.hooks.enforce).toBe('boolean')
        expect(typeof profile.hooks.sessionDiagnose).toBe('boolean')
      })

      it(`${name} deny rules are all strings`, () => {
        const profile = getProfile(name)
        for (const rule of profile.deny) {
          expect(typeof rule).toBe('string')
        }
      })
    }
  })
})
