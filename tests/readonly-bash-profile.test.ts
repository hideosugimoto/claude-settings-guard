import { describe, it, expect } from 'vitest'
import { applyProfileToSettings } from '../src/core/profile-applicator.js'
import { minimalProfile } from '../src/profiles/minimal.js'
import { balancedProfile } from '../src/profiles/balanced.js'
import { strictProfile } from '../src/profiles/strict.js'
import { READ_ONLY_BASH_SAFE, READ_ONLY_BASH_FILE_READERS } from '../src/constants.js'
import { resolveReadOnlyBashRules } from '../src/core/readonly-bash-resolver.js'
import type { ClaudeSettings, Profile } from '../src/types.js'

describe('readOnlyBash profile integration', () => {
  describe('profile definitions', () => {
    it('minimal profile has readOnlyBash: true', () => {
      expect(minimalProfile.readOnlyBash).toBe(true)
    })

    it('balanced profile has readOnlyBash: true', () => {
      expect(balancedProfile.readOnlyBash).toBe(true)
    })

    it('strict profile has readOnlyBash: false', () => {
      expect(strictProfile.readOnlyBash).toBe(false)
    })
  })

  describe('applyProfileToSettings with readOnlyBash', () => {
    it('balanced profile adds read-only safe commands to allow (those not filtered by ask/deny)', () => {
      const settings: ClaudeSettings = {}
      const result = applyProfileToSettings(settings, balancedProfile)
      const allow = result.settings.permissions?.allow ?? []

      // Core safe commands that do not conflict with any ask rules should be present
      expect(allow).toContain('Bash(ls *)')
      expect(allow).toContain('Bash(find *)')
      expect(allow).toContain('Bash(wc *)')
      expect(allow).toContain('Bash(which *)')
      expect(allow).toContain('Bash(pwd)')
      expect(allow).toContain('Bash(git status *)')
      expect(allow).toContain('Bash(git log *)')
      expect(allow).toContain('Bash(git diff *)')
    })

    it('strict profile does NOT add read-only commands', () => {
      const settings: ClaudeSettings = {}
      const result = applyProfileToSettings(settings, strictProfile)
      const allow = result.settings.permissions?.allow ?? []

      for (const rule of READ_ONLY_BASH_SAFE) {
        expect(allow).not.toContain(rule)
      }
    })

    it('balanced profile excludes file-reader commands because allDesiredDeny has Read deny rules', () => {
      // balanced has Read(**/.env) and Read(**/secrets/**) in deny
      // Plus DEFAULT_DENY_RULES adds more Read deny rules
      const settings: ClaudeSettings = {}
      const result = applyProfileToSettings(settings, balancedProfile)
      const allow = result.settings.permissions?.allow ?? []

      for (const rule of READ_ONLY_BASH_FILE_READERS) {
        expect(allow).not.toContain(rule)
      }
    })

    it('minimal profile still has file-reader commands via compensation (bare Bash removed)', () => {
      // minimal has bare 'Bash' in allow, which gets removed when ask rules exist.
      // SAFE_BASH_ALLOW_RULES compensation kicks in and adds Bash(cat *) etc.
      // readOnlyBash resolver excludes file readers, but compensation adds them independently.
      const settings: ClaudeSettings = {}
      const result = applyProfileToSettings(settings, minimalProfile)
      const allow = result.settings.permissions?.allow ?? []

      // cat, head, tail etc. are in SAFE_BASH_ALLOW_RULES, so they persist via compensation
      expect(allow).toContain('Bash(cat *)')
      expect(allow).toContain('Bash(head *)')
      expect(allow).toContain('Bash(tail *)')
    })

    it('profile with no Read deny at all includes file-reader commands', () => {
      // Custom profile with readOnlyBash but no Read deny in profile.deny
      // AND we need to verify using resolveReadOnlyBashRules with no Read deny
      const result = resolveReadOnlyBashRules(['Bash(sudo *)'])

      for (const rule of READ_ONLY_BASH_FILE_READERS) {
        expect(result.allowed).toContain(rule)
      }
      expect(result.warnings.length).toBe(0)
    })

    it('does not produce duplicate rules when both compensation and readOnlyBash fire', () => {
      // minimal has bare 'Bash' in allow, which triggers compensation rules
      // readOnlyBash also adds rules - there should be no duplicates
      const settings: ClaudeSettings = {}
      const result = applyProfileToSettings(settings, minimalProfile)
      const allow = result.settings.permissions?.allow ?? []

      const seen = new Set<string>()
      for (const rule of allow) {
        expect(seen.has(rule)).toBe(false)
        seen.add(rule)
      }
    })

    it('readOnlyBash safe rules do not appear in ask or deny for balanced', () => {
      const settings: ClaudeSettings = {}
      const result = applyProfileToSettings(settings, balancedProfile)
      const ask = result.settings.permissions?.ask ?? []
      const deny = result.settings.permissions?.deny ?? []

      // Check rules that should be in allow (non-conflicting ones)
      const safeNonConflicting = ['Bash(ls *)', 'Bash(find *)', 'Bash(wc *)', 'Bash(pwd)']
      for (const rule of safeNonConflicting) {
        expect(ask).not.toContain(rule)
        expect(deny).not.toContain(rule)
      }
    })

    it('generates warnings for excluded file-reader commands (balanced)', () => {
      const settings: ClaudeSettings = {}
      const result = applyProfileToSettings(settings, balancedProfile)

      expect(result.readOnlyBashWarnings).toBeDefined()
      expect(result.readOnlyBashWarnings!.length).toBeGreaterThan(0)
      for (const rule of READ_ONLY_BASH_FILE_READERS) {
        const hasWarning = result.readOnlyBashWarnings!.some(w => w.includes(rule))
        expect(hasWarning).toBe(true)
      }
    })

    it('generates warnings for minimal too (DEFAULT_DENY_RULES has Read deny)', () => {
      const settings: ClaudeSettings = {}
      const result = applyProfileToSettings(settings, minimalProfile)

      expect(result.readOnlyBashWarnings).toBeDefined()
      expect(result.readOnlyBashWarnings!.length).toBeGreaterThan(0)
    })

    it('strict profile does not generate readOnlyBash warnings', () => {
      const settings: ClaudeSettings = {}
      const result = applyProfileToSettings(settings, strictProfile)

      expect(result.readOnlyBashWarnings).toBeUndefined()
    })

    it('does not add readOnlyBash rules that already exist in allow', () => {
      const settings: ClaudeSettings = {
        permissions: {
          allow: ['Bash(ls *)', 'Bash(git status *)'],
        },
      }
      const result = applyProfileToSettings(settings, balancedProfile)
      const allow = result.settings.permissions?.allow ?? []

      const lsCount = allow.filter(r => r === 'Bash(ls *)').length
      expect(lsCount).toBe(1)
    })

    it('readOnlyBash rules filtered by ask pipeline do not leak into ask', () => {
      // Bash(git tag *) is in HARD_TO_REVERSE_ASK_RULES
      // Bash(git branch *) would override Bash(git branch -D *) in ask
      // These should NOT end up in ask just because readOnlyBash tried to add them
      const settings: ClaudeSettings = {}
      const result = applyProfileToSettings(settings, balancedProfile)
      const ask = result.settings.permissions?.ask ?? []

      // git tag * is in ask via HARD_TO_REVERSE_ASK_RULES
      expect(ask).toContain('Bash(git tag *)')
      // The readOnlyBash version should be filtered, not duplicated
    })

    it('ApplyProfileResult includes readOnlyBashWarnings field when present', () => {
      const settings: ClaudeSettings = {}
      const result = applyProfileToSettings(settings, balancedProfile)

      // readOnlyBashWarnings should be a readonly array
      expect(Array.isArray(result.readOnlyBashWarnings)).toBe(true)
    })

    it('ApplyProfileResult omits readOnlyBashWarnings when readOnlyBash is false', () => {
      const settings: ClaudeSettings = {}
      const result = applyProfileToSettings(settings, strictProfile)

      expect(result.readOnlyBashWarnings).toBeUndefined()
    })
  })
})
