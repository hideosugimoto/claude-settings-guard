import { describe, it, expect } from 'vitest'
import { HARD_TO_REVERSE_ASK_RULES, STRICT_ONLY_ASK_RULES } from '../src/constants.js'
import { minimalProfile } from '../src/profiles/minimal.js'
import { balancedProfile } from '../src/profiles/balanced.js'
import { strictProfile } from '../src/profiles/strict.js'
import { applyProfileToSettings } from '../src/core/profile-applicator.js'
import type { ClaudeSettings } from '../src/types.js'

// ============================================================
// HARD_TO_REVERSE_ASK_RULES constant (全プロファイル共通)
// ============================================================
describe('HARD_TO_REVERSE_ASK_RULES', () => {
  it('includes git push rules', () => {
    expect(HARD_TO_REVERSE_ASK_RULES).toContain('Bash(git push *)')
    expect(HARD_TO_REVERSE_ASK_RULES).toContain('Bash(git push)')
  })

  it('includes git force/destructive rules', () => {
    expect(HARD_TO_REVERSE_ASK_RULES).toContain('Bash(git push --force *)')
    expect(HARD_TO_REVERSE_ASK_RULES).toContain('Bash(git reset --hard *)')
    expect(HARD_TO_REVERSE_ASK_RULES).toContain('Bash(git branch -D *)')
    expect(HARD_TO_REVERSE_ASK_RULES).toContain('Bash(git clean -f *)')
  })

  it('includes -C variants of dangerous git commands', () => {
    expect(HARD_TO_REVERSE_ASK_RULES).toContain('Bash(git -C * push *)')
    expect(HARD_TO_REVERSE_ASK_RULES).toContain('Bash(git -C * push)')
    expect(HARD_TO_REVERSE_ASK_RULES).toContain('Bash(git -C * push --force *)')
    expect(HARD_TO_REVERSE_ASK_RULES).toContain('Bash(git -C * reset --hard *)')
    expect(HARD_TO_REVERSE_ASK_RULES).toContain('Bash(git -C * branch -D *)')
    expect(HARD_TO_REVERSE_ASK_RULES).toContain('Bash(git -C * clean -f *)')
    expect(HARD_TO_REVERSE_ASK_RULES).toContain('Bash(git -C * rebase *)')
    expect(HARD_TO_REVERSE_ASK_RULES).toContain('Bash(git -C * tag *)')
    expect(HARD_TO_REVERSE_ASK_RULES).toContain('Bash(git -C * stash drop *)')
  })

  it('includes git history-rewriting rules', () => {
    expect(HARD_TO_REVERSE_ASK_RULES).toContain('Bash(git rebase *)')
    expect(HARD_TO_REVERSE_ASK_RULES).toContain('Bash(git tag *)')
    expect(HARD_TO_REVERSE_ASK_RULES).toContain('Bash(git stash drop *)')
  })

  it('includes npm publish rules', () => {
    expect(HARD_TO_REVERSE_ASK_RULES).toContain('Bash(npm publish *)')
    expect(HARD_TO_REVERSE_ASK_RULES).toContain('Bash(npm publish)')
  })

  it('does NOT include git commit (allowed)', () => {
    const hasCommit = HARD_TO_REVERSE_ASK_RULES.some(r => r.includes('git commit'))
    expect(hasCommit).toBe(false)
  })

  it('does NOT include git status/diff/log (safe read commands)', () => {
    const hasSafe = HARD_TO_REVERSE_ASK_RULES.some(r =>
      r.includes('git status') || r.includes('git diff') || r.includes('git log')
    )
    expect(hasSafe).toBe(false)
  })

  it('does NOT include git add (safe staging command)', () => {
    const hasAdd = HARD_TO_REVERSE_ASK_RULES.some(r => r.includes('git add'))
    expect(hasAdd).toBe(false)
  })
})

// ============================================================
// STRICT_ONLY_ASK_RULES constant (strict プロファイル限定)
// ============================================================
describe('STRICT_ONLY_ASK_RULES', () => {
  it('includes ssh/scp for remote access', () => {
    expect(STRICT_ONLY_ASK_RULES).toContain('Bash(ssh *)')
    expect(STRICT_ONLY_ASK_RULES).toContain('Bash(scp *)')
  })

  it('includes docker push for image publishing', () => {
    expect(STRICT_ONLY_ASK_RULES).toContain('Bash(docker push *)')
  })

  it('includes kubectl/terraform for infra changes', () => {
    expect(STRICT_ONLY_ASK_RULES).toContain('Bash(kubectl delete *)')
    expect(STRICT_ONLY_ASK_RULES).toContain('Bash(kubectl apply *)')
    expect(STRICT_ONLY_ASK_RULES).toContain('Bash(terraform apply *)')
    expect(STRICT_ONLY_ASK_RULES).toContain('Bash(terraform destroy *)')
  })

  it('does NOT overlap with HARD_TO_REVERSE_ASK_RULES', () => {
    const overlap = STRICT_ONLY_ASK_RULES.filter(r => HARD_TO_REVERSE_ASK_RULES.includes(r))
    expect(overlap).toEqual([])
  })
})

// ============================================================
// Profile ask rules
// ============================================================
describe('Profile ask rules for hard-to-reverse commands', () => {
  describe('minimal profile', () => {
    it('has ask rules defined', () => {
      expect(minimalProfile.ask).toBeDefined()
      expect(minimalProfile.ask!.length).toBeGreaterThan(0)
    })

    it('includes all HARD_TO_REVERSE_ASK_RULES', () => {
      for (const rule of HARD_TO_REVERSE_ASK_RULES) {
        expect(minimalProfile.ask).toContain(rule)
      }
    })

    it('does NOT include STRICT_ONLY_ASK_RULES', () => {
      for (const rule of STRICT_ONLY_ASK_RULES) {
        expect(minimalProfile.ask).not.toContain(rule)
      }
    })
  })

  describe('balanced profile', () => {
    it('includes all HARD_TO_REVERSE_ASK_RULES', () => {
      for (const rule of HARD_TO_REVERSE_ASK_RULES) {
        expect(balancedProfile.ask).toContain(rule)
      }
    })

    it('does NOT include STRICT_ONLY_ASK_RULES', () => {
      for (const rule of STRICT_ONLY_ASK_RULES) {
        expect(balancedProfile.ask).not.toContain(rule)
      }
    })

    it('retains existing broad ask rules (Bash, Edit, Write)', () => {
      expect(balancedProfile.ask).toContain('Bash')
      expect(balancedProfile.ask).toContain('Edit')
      expect(balancedProfile.ask).toContain('Write')
    })
  })

  describe('strict profile', () => {
    it('includes all HARD_TO_REVERSE_ASK_RULES', () => {
      for (const rule of HARD_TO_REVERSE_ASK_RULES) {
        expect(strictProfile.ask).toContain(rule)
      }
    })

    it('includes all STRICT_ONLY_ASK_RULES', () => {
      for (const rule of STRICT_ONLY_ASK_RULES) {
        expect(strictProfile.ask).toContain(rule)
      }
    })

    it('retains existing broad ask rules (Bash, Edit, Write)', () => {
      expect(strictProfile.ask).toContain('Bash')
      expect(strictProfile.ask).toContain('Edit')
      expect(strictProfile.ask).toContain('Write')
    })
  })
})

// ============================================================
// Integration: applyProfileToSettings with ask rules
// ============================================================
describe('applyProfileToSettings with ask rules', () => {
  const emptySettings: ClaudeSettings = {}

  it('adds ask rules from minimal profile to empty settings', () => {
    const result = applyProfileToSettings(emptySettings, minimalProfile)
    expect(result.settings.permissions?.ask).toBeDefined()
    expect(result.settings.permissions!.ask).toContain('Bash(git push *)')
    expect(result.addedAsk).toBeGreaterThan(0)
  })

  it('adds STRICT_ONLY rules only from strict profile', () => {
    const result = applyProfileToSettings(emptySettings, strictProfile)
    expect(result.settings.permissions!.ask).toContain('Bash(ssh *)')
    expect(result.settings.permissions!.ask).toContain('Bash(kubectl delete *)')
  })

  it('does NOT add STRICT_ONLY rules from minimal profile', () => {
    const result = applyProfileToSettings(emptySettings, minimalProfile)
    expect(result.settings.permissions!.ask).not.toContain('Bash(ssh *)')
    expect(result.settings.permissions!.ask).not.toContain('Bash(kubectl delete *)')
  })

  it('does not duplicate existing ask rules', () => {
    const settings: ClaudeSettings = {
      permissions: {
        ask: ['Bash(git push *)'],
      },
    }
    const result = applyProfileToSettings(settings, minimalProfile)
    const pushCount = result.settings.permissions!.ask!.filter(r => r === 'Bash(git push *)').length
    expect(pushCount).toBe(1)
  })

  it('merges ask rules with existing ones', () => {
    const settings: ClaudeSettings = {
      permissions: {
        ask: ['Bash(docker push *)'],
      },
    }
    const result = applyProfileToSettings(settings, minimalProfile)
    expect(result.settings.permissions!.ask).toContain('Bash(docker push *)')
    expect(result.settings.permissions!.ask).toContain('Bash(git push *)')
  })

  it('git commit is NOT in ask rules (stays auto-allowed)', () => {
    const result = applyProfileToSettings(emptySettings, minimalProfile)
    const hasCommit = (result.settings.permissions?.ask ?? []).some(r => r.includes('git commit'))
    expect(hasCommit).toBe(false)
  })

  it('strict profile adds more ask rules than minimal', () => {
    const minResult = applyProfileToSettings(emptySettings, minimalProfile)
    const strictResult = applyProfileToSettings(emptySettings, strictProfile)
    const minAskCount = minResult.settings.permissions!.ask!.length
    const strictAskCount = strictResult.settings.permissions!.ask!.length
    expect(strictAskCount).toBeGreaterThan(minAskCount)
  })
})
