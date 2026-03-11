import { describe, it, expect } from 'vitest'
import { applyProfileToSettings } from '../src/core/profile-applicator.js'
import { checkAllowAskConflicts, checkAllowDenyConflicts } from '../src/core/pattern-validator.js'
import { minimalProfile } from '../src/profiles/minimal.js'
import { strictProfile } from '../src/profiles/strict.js'
import type { ClaudeSettings } from '../src/types.js'

// ============================================================
// profile-applicator: allow/ask 競合自動除去
// ============================================================
describe('applyProfileToSettings: allow/ask conflict resolution', () => {
  it('removes allow rules that conflict with ask rules', () => {
    const settings: ClaudeSettings = {
      permissions: {
        allow: ['Bash(git push *)', 'Bash(git rebase *)', 'Read', 'Bash(git status *)'],
      },
    }
    const result = applyProfileToSettings(settings, minimalProfile)
    // git push and git rebase should be removed from allow (they are in ask)
    expect(result.settings.permissions!.allow).not.toContain('Bash(git push *)')
    expect(result.settings.permissions!.allow).not.toContain('Bash(git rebase *)')
    // Read and git status should remain
    expect(result.settings.permissions!.allow).toContain('Read')
    expect(result.settings.permissions!.allow).toContain('Bash(git status *)')
  })

  it('reports removedFromAllow count', () => {
    const settings: ClaudeSettings = {
      permissions: {
        allow: ['Bash(git push *)', 'Bash(git tag *)', 'Bash(git clean -f *)', 'Read'],
      },
    }
    const result = applyProfileToSettings(settings, minimalProfile)
    // 3 exact ask matches + 1 bare Bash added by profile then removed + readOnlyBash rules filtered
    expect(result.removedFromAllow).toBeGreaterThanOrEqual(4)
  })

  it('removes bare Bash added by profile (bare tool override)', () => {
    const settings: ClaudeSettings = {
      permissions: {
        allow: ['Read', 'Write', 'Glob'],
      },
    }
    const result = applyProfileToSettings(settings, minimalProfile)
    // Profile adds bare Bash to allow, but ask has Bash(...) → bare Bash removed
    // readOnlyBash also adds rules, some of which get filtered by ask/deny pipeline
    expect(result.removedFromAllow).toBeGreaterThanOrEqual(1)
    expect(result.settings.permissions!.allow).not.toContain('Bash')
  })

  it('handles exact match between allow and ask', () => {
    const settings: ClaudeSettings = {
      permissions: {
        allow: ['Bash(git push *)'],
      },
    }
    const result = applyProfileToSettings(settings, minimalProfile)
    expect(result.settings.permissions!.allow).not.toContain('Bash(git push *)')
    expect(result.settings.permissions!.ask).toContain('Bash(git push *)')
  })

  it('removes broad Bash(git stash *) that overrides ask Bash(git stash drop *)', () => {
    const settings: ClaudeSettings = {
      permissions: {
        allow: ['Bash(git stash *)'],
      },
    }
    const result = applyProfileToSettings(settings, minimalProfile)
    // Broad pattern overrides specific ask rule, so it must be removed
    expect(result.settings.permissions!.allow).not.toContain('Bash(git stash *)')
  })

  it('removes allow rules that match strict-only ask rules', () => {
    const settings: ClaudeSettings = {
      permissions: {
        allow: ['Bash(ssh *)', 'Bash(kubectl delete *)', 'Read'],
      },
    }
    const result = applyProfileToSettings(settings, strictProfile)
    expect(result.settings.permissions!.allow).not.toContain('Bash(ssh *)')
    expect(result.settings.permissions!.allow).not.toContain('Bash(kubectl delete *)')
    expect(result.settings.permissions!.allow).toContain('Read')
  })

  it('removes broad allow patterns that override specific ask rules', () => {
    const settings: ClaudeSettings = {
      permissions: {
        allow: [
          'Bash(npm *)',        // overrides Bash(npm publish *)
          'Bash(git branch *)', // overrides Bash(git branch -D *)
          'Bash(git reset *)',  // overrides Bash(git reset --hard *)
          'Bash(git clean *)',  // overrides Bash(git clean -f *)
          'Read',
        ],
      },
    }
    const result = applyProfileToSettings(settings, minimalProfile)
    expect(result.settings.permissions!.allow).not.toContain('Bash(npm *)')
    expect(result.settings.permissions!.allow).not.toContain('Bash(git branch *)')
    expect(result.settings.permissions!.allow).not.toContain('Bash(git reset *)')
    expect(result.settings.permissions!.allow).not.toContain('Bash(git clean *)')
    expect(result.settings.permissions!.allow).toContain('Read')
  })

  it('removes broad allow patterns that override deny rules', () => {
    const settings: ClaudeSettings = {
      permissions: {
        allow: ['Bash(chmod *)', 'Read'],
      },
    }
    const result = applyProfileToSettings(settings, minimalProfile)
    // Bash(chmod *) overrides deny Bash(chmod 777 *) and Bash(chmod +s *)
    expect(result.settings.permissions!.allow).not.toContain('Bash(chmod *)')
    expect(result.settings.permissions!.allow).toContain('Read')
  })

  it('removes broad package manager patterns that override publish ask rules', () => {
    const settings: ClaudeSettings = {
      permissions: {
        allow: [
          'Bash(pnpm *)',
          'Bash(yarn *)',
          'Bash(bun *)',
          'Bash(cargo *)',
        ],
      },
    }
    const result = applyProfileToSettings(settings, minimalProfile)
    expect(result.settings.permissions!.allow).not.toContain('Bash(pnpm *)')
    expect(result.settings.permissions!.allow).not.toContain('Bash(yarn *)')
    expect(result.settings.permissions!.allow).not.toContain('Bash(bun *)')
    expect(result.settings.permissions!.allow).not.toContain('Bash(cargo *)')
  })

  it('keeps safe specific patterns that do not override ask/deny', () => {
    const settings: ClaudeSettings = {
      permissions: {
        allow: ['Bash(npm install *)', 'Bash(git branch -d *)'],
      },
    }
    const result = applyProfileToSettings(settings, minimalProfile)
    expect(result.settings.permissions!.allow).toContain('Bash(npm install *)')
    expect(result.settings.permissions!.allow).toContain('Bash(git branch -d *)')
  })

  it('preserves original settings immutability', () => {
    const settings: ClaudeSettings = {
      permissions: {
        allow: ['Bash(git push *)', 'Read'],
      },
    }
    const originalAllow = [...settings.permissions!.allow!]
    applyProfileToSettings(settings, minimalProfile)
    expect(settings.permissions!.allow).toEqual(originalAllow)
  })
})

// ============================================================
// pattern-validator: allow/ask 競合検出（診断用）
// ============================================================
describe('checkAllowAskConflicts (diagnostics)', () => {
  it('detects exact allow/ask conflicts', () => {
    const allow = ['Bash(git push *)', 'Read', 'Bash(git tag *)']
    const ask = ['Bash(git push *)', 'Bash(git tag *)']
    const issues = checkAllowAskConflicts(allow, ask)
    expect(issues.length).toBe(1)
    expect(issues[0].code).toBe('ALLOW_ASK_CONFLICT')
    expect(issues[0].severity).toBe('warning')
    expect(issues[0].details).toContain('Bash(git push *)')
    expect(issues[0].details).toContain('Bash(git tag *)')
  })

  it('returns empty when no conflicts', () => {
    const allow = ['Read', 'Write', 'Glob']
    const ask = ['Bash(git push *)']
    const issues = checkAllowAskConflicts(allow, ask)
    expect(issues).toEqual([])
  })

  it('returns empty when ask is empty', () => {
    const allow = ['Read', 'Bash(git push *)']
    const ask: string[] = []
    const issues = checkAllowAskConflicts(allow, ask)
    expect(issues).toEqual([])
  })

  it('includes fix suggestion to remove from allow', () => {
    const allow = ['Bash(npm publish *)']
    const ask = ['Bash(npm publish *)']
    const issues = checkAllowAskConflicts(allow, ask)
    expect(issues[0].fix).toBeDefined()
    expect(issues[0].fix).toContain('allow')
  })
})

// ============================================================
// Integration: real user scenario
// ============================================================
describe('Integration: user has pre-existing allow rules conflicting with ask', () => {
  it('full scenario: user with broad git allow + minimal profile', () => {
    // Simulates a user who auto-allowed many git commands, then applies minimal profile
    const settings: ClaudeSettings = {
      permissions: {
        allow: [
          'Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep',
          'Bash(git push *)',
          'Bash(git rebase *)',
          'Bash(git tag *)',
          'Bash(git clean -f *)',
          'Bash(git status *)',
          'Bash(git diff *)',
          'Bash(git commit *)',
        ],
      },
    }
    const result = applyProfileToSettings(settings, minimalProfile)

    // Dangerous commands removed from allow (exact match with ask rules)
    expect(result.settings.permissions!.allow).not.toContain('Bash(git push *)')
    expect(result.settings.permissions!.allow).not.toContain('Bash(git rebase *)')
    expect(result.settings.permissions!.allow).not.toContain('Bash(git tag *)')
    expect(result.settings.permissions!.allow).not.toContain('Bash(git clean -f *)')

    // Safe commands remain in allow
    expect(result.settings.permissions!.allow).toContain('Bash(git status *)')
    expect(result.settings.permissions!.allow).toContain('Bash(git diff *)')
    expect(result.settings.permissions!.allow).toContain('Bash(git commit *)')

    // Dangerous commands are in ask
    expect(result.settings.permissions!.ask).toContain('Bash(git push *)')
    expect(result.settings.permissions!.ask).toContain('Bash(git rebase *)')
    expect(result.settings.permissions!.ask).toContain('Bash(git tag *)')

    // removedFromAllow: 4 exact + 1 bare Bash + compensated rules that overlap ask
    expect(result.removedFromAllow).toBeGreaterThanOrEqual(5)
  })
})

// ============================================================
// profile-applicator: allow/deny 競合自動除去
// ============================================================
describe('applyProfileToSettings: allow/deny conflict resolution', () => {
  it('removes allow rules that conflict with deny rules', () => {
    const settings: ClaudeSettings = {
      permissions: {
        allow: ['Bash(sudo *)', 'Bash(rm -rf /*)', 'Read', 'Bash(git status *)'],
      },
    }
    const result = applyProfileToSettings(settings, minimalProfile)
    expect(result.settings.permissions!.allow).not.toContain('Bash(sudo *)')
    expect(result.settings.permissions!.allow).not.toContain('Bash(rm -rf /*)')
    expect(result.settings.permissions!.allow).toContain('Read')
    expect(result.settings.permissions!.allow).toContain('Bash(git status *)')
  })

  it('reports removedFromAllow count including deny conflicts', () => {
    const settings: ClaudeSettings = {
      permissions: {
        allow: ['Bash(sudo *)', 'Read'],
      },
    }
    const result = applyProfileToSettings(settings, minimalProfile)
    expect(result.removedFromAllow).toBeGreaterThanOrEqual(1)
  })

  it('removes allow rules matching DEFAULT_DENY_RULES', () => {
    const settings: ClaudeSettings = {
      permissions: {
        allow: ['Read(**/.env)', 'Write(**/.env)', 'Edit(**/.env)', 'Read'],
      },
    }
    const result = applyProfileToSettings(settings, minimalProfile)
    expect(result.settings.permissions!.allow).not.toContain('Read(**/.env)')
    expect(result.settings.permissions!.allow).not.toContain('Write(**/.env)')
    expect(result.settings.permissions!.allow).not.toContain('Edit(**/.env)')
    expect(result.settings.permissions!.allow).toContain('Read')
  })

  it('removes allow rules matching strict deny rules', () => {
    const settings: ClaudeSettings = {
      permissions: {
        allow: ['Bash(curl *)', 'Bash(wget *)', 'Read'],
      },
    }
    const result = applyProfileToSettings(settings, strictProfile)
    expect(result.settings.permissions!.allow).not.toContain('Bash(curl *)')
    expect(result.settings.permissions!.allow).not.toContain('Bash(wget *)')
    expect(result.settings.permissions!.allow).toContain('Read')
  })

  it('handles combined ask + deny conflict removal', () => {
    const settings: ClaudeSettings = {
      permissions: {
        allow: [
          'Bash(sudo *)',       // in deny → remove
          'Bash(git push *)',   // in ask → remove
          'Bash(git status *)', // safe → keep
          'Read',               // safe → keep
        ],
      },
    }
    const result = applyProfileToSettings(settings, minimalProfile)
    expect(result.settings.permissions!.allow).not.toContain('Bash(sudo *)')
    expect(result.settings.permissions!.allow).not.toContain('Bash(git push *)')
    expect(result.settings.permissions!.allow).toContain('Bash(git status *)')
    expect(result.settings.permissions!.allow).toContain('Read')
    // 2 exact + 1 bare Bash + compensated rules that overlap ask/deny
    expect(result.removedFromAllow).toBeGreaterThanOrEqual(3)
  })

  it('does not remove allow rules from deny list (deny stays intact)', () => {
    const settings: ClaudeSettings = {
      permissions: {
        allow: ['Bash(sudo *)'],
        deny: ['Bash(sudo *)'],
      },
    }
    const result = applyProfileToSettings(settings, minimalProfile)
    expect(result.settings.permissions!.deny).toContain('Bash(sudo *)')
    expect(result.settings.permissions!.allow).not.toContain('Bash(sudo *)')
  })
})

// ============================================================
// pattern-validator: allow/deny 競合検出（診断用）
// ============================================================
describe('checkAllowDenyConflicts (diagnostics)', () => {
  it('detects exact allow/deny conflicts', () => {
    const allow = ['Bash(sudo *)', 'Read', 'Read(**/.env)']
    const deny = ['Bash(sudo *)', 'Read(**/.env)']
    const issues = checkAllowDenyConflicts(allow, deny)
    expect(issues.length).toBe(1)
    expect(issues[0].code).toBe('ALLOW_DENY_CONFLICT')
    expect(issues[0].severity).toBe('warning')
    expect(issues[0].details).toContain('Bash(sudo *)')
    expect(issues[0].details).toContain('Read(**/.env)')
  })

  it('returns empty when no conflicts', () => {
    const allow = ['Read', 'Write']
    const deny = ['Bash(sudo *)']
    const issues = checkAllowDenyConflicts(allow, deny)
    expect(issues).toEqual([])
  })

  it('returns empty when deny is empty', () => {
    const allow = ['Bash(sudo *)']
    const deny: string[] = []
    const issues = checkAllowDenyConflicts(allow, deny)
    expect(issues).toEqual([])
  })

  it('includes fix suggestion', () => {
    const allow = ['Bash(sudo *)']
    const deny = ['Bash(sudo *)']
    const issues = checkAllowDenyConflicts(allow, deny)
    expect(issues[0].fix).toBeDefined()
    expect(issues[0].fix).toContain('allow')
  })
})

// ============================================================
// Integration: full scenario with all three conflict types
// ============================================================
describe('Integration: allow/deny + allow/ask combined cleanup', () => {
  it('removes both deny-conflicting and ask-conflicting rules from allow', () => {
    const settings: ClaudeSettings = {
      permissions: {
        allow: [
          'Read', 'Write', 'Bash', 'Glob', 'Grep',
          'Bash(sudo *)',         // deny conflict
          'Bash(eval *)',         // deny conflict
          'Read(**/.env)',        // deny conflict
          'Bash(git push *)',     // ask conflict
          'Bash(git rebase *)',   // ask conflict
          'Bash(git status *)',   // safe
          'Bash(git commit *)',   // safe
        ],
      },
    }
    const result = applyProfileToSettings(settings, minimalProfile)

    // deny-conflicting removed
    expect(result.settings.permissions!.allow).not.toContain('Bash(sudo *)')
    expect(result.settings.permissions!.allow).not.toContain('Bash(eval *)')
    expect(result.settings.permissions!.allow).not.toContain('Read(**/.env)')

    // ask-conflicting removed
    expect(result.settings.permissions!.allow).not.toContain('Bash(git push *)')
    expect(result.settings.permissions!.allow).not.toContain('Bash(git rebase *)')

    // bare Bash also removed (overrides ask patterns)
    expect(result.settings.permissions!.allow).not.toContain('Bash')

    // safe rules remain
    expect(result.settings.permissions!.allow).toContain('Read')
    expect(result.settings.permissions!.allow).toContain('Bash(git status *)')
    expect(result.settings.permissions!.allow).toContain('Bash(git commit *)')

    // 3 (deny) + 2 (ask exact) + 1 (bare Bash) + compensated overlaps
    expect(result.removedFromAllow).toBeGreaterThanOrEqual(6)
  })
})
