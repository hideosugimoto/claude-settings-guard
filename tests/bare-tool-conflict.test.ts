import { describe, it, expect } from 'vitest'
import { applyProfileToSettings } from '../src/core/profile-applicator.js'
import { checkBareToolConflicts } from '../src/core/pattern-validator.js'
import { minimalProfile } from '../src/profiles/minimal.js'
import { balancedProfile } from '../src/profiles/balanced.js'
import { strictProfile } from '../src/profiles/strict.js'
import type { ClaudeSettings } from '../src/types.js'

// ============================================================
// CRITICAL: bare tool in allow overrides specific ask patterns
// ============================================================
describe('Bare tool conflict: allow "Bash" overrides ask "Bash(git push *)"', () => {
  it('removes bare Bash from allow when ask has Bash(...) patterns', () => {
    const settings: ClaudeSettings = {
      permissions: {
        allow: ['Bash', 'Read', 'Write'],
      },
    }
    const result = applyProfileToSettings(settings, minimalProfile)
    // Bare Bash must be removed because ask has Bash(git push *) etc.
    expect(result.settings.permissions!.allow).not.toContain('Bash')
    // Other bare tools without ask conflicts should remain
    expect(result.settings.permissions!.allow).toContain('Read')
  })

  it('removes bare Edit from allow when ask has Edit', () => {
    // balanced/strict profiles have 'Edit' in ask
    const settings: ClaudeSettings = {
      permissions: {
        allow: ['Edit', 'Read'],
      },
    }
    const result = applyProfileToSettings(settings, balancedProfile)
    // bare Edit conflicts with ask 'Edit'
    expect(result.settings.permissions!.allow).not.toContain('Edit')
    expect(result.settings.permissions!.allow).toContain('Read')
  })

  it('removes bare Write from allow when ask has Write', () => {
    const settings: ClaudeSettings = {
      permissions: {
        allow: ['Write', 'Read'],
      },
    }
    const result = applyProfileToSettings(settings, balancedProfile)
    expect(result.settings.permissions!.allow).not.toContain('Write')
    expect(result.settings.permissions!.allow).toContain('Read')
  })

  it('keeps bare Read in allow when no Read patterns in ask', () => {
    const settings: ClaudeSettings = {
      permissions: {
        allow: ['Read', 'Bash'],
      },
    }
    const result = applyProfileToSettings(settings, minimalProfile)
    // Read has no ask patterns → stays in allow
    expect(result.settings.permissions!.allow).toContain('Read')
    // Bash has ask patterns → removed
    expect(result.settings.permissions!.allow).not.toContain('Bash')
  })

  it('counts bare tool removal in removedFromAllow', () => {
    const settings: ClaudeSettings = {
      permissions: {
        allow: ['Bash', 'Read'],
      },
    }
    const result = applyProfileToSettings(settings, minimalProfile)
    expect(result.removedFromAllow).toBeGreaterThanOrEqual(1)
  })

  it('real scenario: minimal profile with pre-existing bare Bash', () => {
    // This is exactly the user's scenario
    const settings: ClaudeSettings = {
      permissions: {
        allow: [
          'Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep',
          'Bash(git status *)', 'Bash(git diff *)', 'Bash(git commit *)',
        ],
        ask: [],
      },
    }
    const result = applyProfileToSettings(settings, minimalProfile)

    // Bare Bash removed (conflicts with ask Bash(git push *) etc.)
    expect(result.settings.permissions!.allow).not.toContain('Bash')

    // Specific Bash commands remain in allow
    expect(result.settings.permissions!.allow).toContain('Bash(git status *)')
    expect(result.settings.permissions!.allow).toContain('Bash(git diff *)')
    expect(result.settings.permissions!.allow).toContain('Bash(git commit *)')

    // ask rules are present
    expect(result.settings.permissions!.ask).toContain('Bash(git push *)')
    expect(result.settings.permissions!.ask).toContain('Bash(npm publish *)')
  })

  it('does not remove bare Bash from allow when profile has no ask rules', () => {
    // If a hypothetical profile had no ask rules, bare Bash should stay
    const noAskProfile = { ...minimalProfile, ask: undefined }
    const settings: ClaudeSettings = {
      permissions: {
        allow: ['Bash', 'Read'],
      },
    }
    const result = applyProfileToSettings(settings, noAskProfile)
    expect(result.settings.permissions!.allow).toContain('Bash')
  })

  it('strict profile removes bare Bash from allow (has many ask patterns)', () => {
    const settings: ClaudeSettings = {
      permissions: {
        allow: ['Bash', 'Read', 'Glob'],
      },
    }
    const result = applyProfileToSettings(settings, strictProfile)
    expect(result.settings.permissions!.allow).not.toContain('Bash')
    expect(result.settings.permissions!.allow).toContain('Read')
    expect(result.settings.permissions!.allow).toContain('Glob')
  })
})

// ============================================================
// Diagnostic: checkBareToolConflicts
// ============================================================
describe('checkBareToolConflicts (diagnostics)', () => {
  it('detects bare Bash in allow when ask has Bash(...) patterns', () => {
    const allow = ['Bash', 'Read']
    const ask = ['Bash(git push *)', 'Bash(npm publish *)']
    const issues = checkBareToolConflicts(allow, ask)
    expect(issues.length).toBe(1)
    expect(issues[0].code).toBe('BARE_TOOL_OVERRIDE')
    expect(issues[0].severity).toBe('critical')
    expect(issues[0].details).toContain('Bash')
  })

  it('detects bare tool overriding bare tool in ask', () => {
    // ask has bare 'Edit', allow also has bare 'Edit'
    const allow = ['Edit', 'Read']
    const ask = ['Edit']
    const issues = checkBareToolConflicts(allow, ask)
    expect(issues.length).toBe(1)
    expect(issues[0].details).toContain('Edit')
  })

  it('detects multiple bare tool conflicts', () => {
    const allow = ['Bash', 'Edit', 'Write', 'Read']
    const ask = ['Bash(git push *)', 'Edit', 'Write']
    const issues = checkBareToolConflicts(allow, ask)
    expect(issues.length).toBe(1)
    expect(issues[0].details).toContain('Bash')
    expect(issues[0].details).toContain('Edit')
    expect(issues[0].details).toContain('Write')
    expect(issues[0].details).not.toContain('Read')
  })

  it('returns empty when no bare tool conflicts', () => {
    const allow = ['Read', 'Glob']
    const ask = ['Bash(git push *)']
    const issues = checkBareToolConflicts(allow, ask)
    expect(issues).toEqual([])
  })

  it('returns empty when ask is empty', () => {
    const allow = ['Bash', 'Read']
    const ask: string[] = []
    const issues = checkBareToolConflicts(allow, ask)
    expect(issues).toEqual([])
  })

  it('includes fix suggestion', () => {
    const allow = ['Bash']
    const ask = ['Bash(git push *)']
    const issues = checkBareToolConflicts(allow, ask)
    expect(issues[0].fix).toBeDefined()
    expect(issues[0].fix).toContain('allow')
  })
})

// ============================================================
// Integration: full user scenario
// ============================================================
describe('Integration: fix the actual user bug', () => {
  it('after setup, git push ask rule is effective (bare Bash removed)', () => {
    // Simulate the exact user scenario: 98 allow rules including bare Bash
    const settings: ClaudeSettings = {
      permissions: {
        allow: [
          'Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep',
          'MultiEdit', 'LS', 'WebFetch', 'WebSearch',
          'TodoRead', 'TodoWrite',
          'Bash(git status *)', 'Bash(git diff *)', 'Bash(git log *)',
          'Bash(git commit *)', 'Bash(git add *)', 'Bash(git branch *)',
        ],
      },
    }
    const result = applyProfileToSettings(settings, minimalProfile)

    // CRITICAL: bare Bash is gone
    expect(result.settings.permissions!.allow).not.toContain('Bash')

    // Safe git commands remain
    expect(result.settings.permissions!.allow).toContain('Bash(git status *)')
    expect(result.settings.permissions!.allow).toContain('Bash(git commit *)')

    // ask rules are effective now
    expect(result.settings.permissions!.ask).toContain('Bash(git push *)')
    expect(result.settings.permissions!.ask).toContain('Bash(npm publish *)')

    // Other bare tools without ask conflicts remain
    expect(result.settings.permissions!.allow).toContain('Read')
    expect(result.settings.permissions!.allow).toContain('Glob')
    expect(result.settings.permissions!.allow).toContain('Grep')
  })
})
