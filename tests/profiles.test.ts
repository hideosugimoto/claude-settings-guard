import { describe, it, expect } from 'vitest'
import { getAllProfileDenyRules, getProfile, getProfileNames, isValidProfileName, profiles } from '../src/profiles/index.js'
import { minimalProfile } from '../src/profiles/minimal.js'
import { balancedProfile } from '../src/profiles/balanced.js'
import { strictProfile } from '../src/profiles/strict.js'
import { smartProfile } from '../src/profiles/smart.js'
import { DEFAULT_DENY_RULES, HARD_TO_REVERSE_ASK_RULES, STRICT_ONLY_ASK_RULES, SMART_ASK_RULES } from '../src/constants.js'
import type { ProfileName } from '../src/types.js'

describe('profiles', () => {
  describe('getProfileNames', () => {
    it('returns all profile names', () => {
      expect(getProfileNames()).toEqual(['minimal', 'balanced', 'strict', 'smart'])
    })
  })

  describe('isValidProfileName', () => {
    it('accepts valid profile names', () => {
      expect(isValidProfileName('minimal')).toBe(true)
      expect(isValidProfileName('balanced')).toBe(true)
      expect(isValidProfileName('strict')).toBe(true)
      expect(isValidProfileName('smart')).toBe(true)
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
      expect(getProfile('smart')).toBe(smartProfile)
    })
  })

  describe('profiles registry', () => {
    it('contains all profiles', () => {
      expect(Object.keys(profiles)).toEqual(['minimal', 'balanced', 'strict', 'smart'])
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

  describe('smart profile', () => {
    it('has correct name', () => {
      expect(smartProfile.name).toBe('smart')
    })

    it('allows Write and Edit (unlike balanced)', () => {
      expect(smartProfile.allow).toContain('Write')
      expect(smartProfile.allow).toContain('Edit')
    })

    it('does not have bare Bash in allow', () => {
      expect(smartProfile.allow).not.toContain('Bash')
    })

    it('denies eval but not base64', () => {
      expect(smartProfile.deny).toContain('Bash(eval *)')
      expect(smartProfile.deny).not.toContain('Bash(base64 *)')
    })

    it('has base64 in ask (via SMART_ASK_RULES)', () => {
      expect(smartProfile.ask).toContain('Bash(base64 *)')
    })

    it('does not deny curl or wget', () => {
      expect(smartProfile.deny).not.toContain('Bash(curl *)')
      expect(smartProfile.deny).not.toContain('Bash(wget *)')
    })

    it('includes HARD_TO_REVERSE_ASK_RULES', () => {
      for (const rule of HARD_TO_REVERSE_ASK_RULES) {
        expect(smartProfile.ask).toContain(rule)
      }
    })

    it('includes STRICT_ONLY_ASK_RULES', () => {
      for (const rule of STRICT_ONLY_ASK_RULES) {
        expect(smartProfile.ask).toContain(rule)
      }
    })

    it('includes SMART_ASK_RULES', () => {
      for (const rule of SMART_ASK_RULES) {
        expect(smartProfile.ask).toContain(rule)
      }
    })

    it('has no overlap between deny and ask', () => {
      const denySet = new Set(smartProfile.deny)
      for (const rule of smartProfile.ask ?? []) {
        expect(denySet.has(rule)).toBe(false)
      }
    })

    it('denies sensitive file access', () => {
      expect(smartProfile.deny).toContain('Read(**/.env)')
      expect(smartProfile.deny).toContain('Write(**/secrets/**)')
    })

    it('does not enable sessionDiagnose', () => {
      expect(smartProfile.hooks.sessionDiagnose).toBe(false)
    })

    it('enables readOnlyBash', () => {
      expect(smartProfile.readOnlyBash).toBe(true)
    })
  })

  describe('getAllProfileDenyRules', () => {
    it('returns a Set containing all deny rules from every profile', () => {
      const allRules = getAllProfileDenyRules()
      const allNames: ProfileName[] = ['minimal', 'balanced', 'strict', 'smart']

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

    it('returns the same reference on consecutive calls (singleton cache)', () => {
      const first = getAllProfileDenyRules()
      const second = getAllProfileDenyRules()
      expect(first).toBe(second)
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
    const allNames: ProfileName[] = ['minimal', 'balanced', 'strict', 'smart']

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
