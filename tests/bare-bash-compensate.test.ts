import { describe, it, expect } from 'vitest'
import { SAFE_BASH_ALLOW_RULES } from '../src/constants.js'
import { applyProfileToSettings } from '../src/core/profile-applicator.js'
import { minimalProfile } from '../src/profiles/minimal.js'
import type { ClaudeSettings } from '../src/types.js'

// ============================================================
// SAFE_BASH_ALLOW_RULES constant
// ============================================================
describe('SAFE_BASH_ALLOW_RULES', () => {
  it('includes git commit', () => {
    expect(SAFE_BASH_ALLOW_RULES).toContain('Bash(git commit *)')
  })

  it('includes common git operations', () => {
    expect(SAFE_BASH_ALLOW_RULES).toContain('Bash(git add *)')
    expect(SAFE_BASH_ALLOW_RULES).toContain('Bash(git status *)')
    expect(SAFE_BASH_ALLOW_RULES).toContain('Bash(git diff *)')
    expect(SAFE_BASH_ALLOW_RULES).toContain('Bash(git log *)')
    expect(SAFE_BASH_ALLOW_RULES).toContain('Bash(git show *)')
    expect(SAFE_BASH_ALLOW_RULES).toContain('Bash(git fetch *)')
    expect(SAFE_BASH_ALLOW_RULES).toContain('Bash(git pull *)')
    expect(SAFE_BASH_ALLOW_RULES).toContain('Bash(git checkout *)')
    expect(SAFE_BASH_ALLOW_RULES).toContain('Bash(git switch *)')
    expect(SAFE_BASH_ALLOW_RULES).toContain('Bash(git merge *)')
  })

  it('includes common dev tools', () => {
    expect(SAFE_BASH_ALLOW_RULES).toContain('Bash(npm install *)')
    expect(SAFE_BASH_ALLOW_RULES).toContain('Bash(npm run *)')
    expect(SAFE_BASH_ALLOW_RULES).toContain('Bash(npx *)')
    expect(SAFE_BASH_ALLOW_RULES).toContain('Bash(node *)')
    expect(SAFE_BASH_ALLOW_RULES).toContain('Bash(ls *)')
    expect(SAFE_BASH_ALLOW_RULES).toContain('Bash(cat *)')
    expect(SAFE_BASH_ALLOW_RULES).toContain('Bash(echo *)')
  })

  it('does NOT include dangerous commands that are in ask', () => {
    const dangerous = [
      'Bash(git push *)', 'Bash(git push)',
      'Bash(git push --force *)',
      'Bash(git reset --hard *)',
      'Bash(git branch -D *)',
      'Bash(git clean -f *)',
      'Bash(git rebase *)',
      'Bash(git tag *)',
      'Bash(git stash drop *)',
      'Bash(npm publish *)', 'Bash(npm publish)',
      'Bash(pnpm publish *)', 'Bash(pnpm publish)',
      'Bash(yarn publish *)', 'Bash(yarn publish)',
      'Bash(bun publish *)', 'Bash(bun publish)',
      'Bash(cargo publish *)', 'Bash(cargo publish)',
    ]
    for (const cmd of dangerous) {
      expect(SAFE_BASH_ALLOW_RULES).not.toContain(cmd)
    }
  })

  it('does NOT include -C variants of dangerous commands', () => {
    const dangerousCVariants = [
      'Bash(git -C * push *)', 'Bash(git -C * push)',
      'Bash(git -C * push --force *)',
      'Bash(git -C * reset --hard *)',
      'Bash(git -C * branch -D *)',
      'Bash(git -C * clean -f *)',
      'Bash(git -C * rebase *)',
      'Bash(git -C * tag *)',
      'Bash(git -C * stash drop *)',
    ]
    for (const cmd of dangerousCVariants) {
      expect(SAFE_BASH_ALLOW_RULES).not.toContain(cmd)
    }
  })

  it('includes -C variants of safe git commands', () => {
    expect(SAFE_BASH_ALLOW_RULES).toContain('Bash(git -C * show *)')
    expect(SAFE_BASH_ALLOW_RULES).toContain('Bash(git -C * log *)')
    expect(SAFE_BASH_ALLOW_RULES).toContain('Bash(git -C * diff *)')
    expect(SAFE_BASH_ALLOW_RULES).toContain('Bash(git -C * status *)')
    expect(SAFE_BASH_ALLOW_RULES).toContain('Bash(git -C * add *)')
    expect(SAFE_BASH_ALLOW_RULES).toContain('Bash(git -C * commit *)')
  })

  it('does NOT include broad patterns that override ask rules', () => {
    // These broad patterns were removed because they match ask-protected commands
    const broad = [
      'Bash(npm *)',       // matches npm publish
      'Bash(git branch *)', // matches git branch -D
      'Bash(git stash *)',  // matches git stash drop
      'Bash(docker *)',     // matches docker push (strict)
      'Bash(pnpm *)',      // matches pnpm publish
      'Bash(yarn *)',      // matches yarn publish
      'Bash(bun *)',       // matches bun publish
      'Bash(cargo *)',     // matches cargo publish
      'Bash(chmod *)',     // matches chmod 777 / chmod +s
    ]
    for (const cmd of broad) {
      expect(SAFE_BASH_ALLOW_RULES).not.toContain(cmd)
    }
  })

  it('does NOT include commands that are in deny', () => {
    const denied = [
      'Bash(sudo *)', 'Bash(su *)',
      'Bash(rm -rf /*)', 'Bash(rm -rf ~*)',
      'Bash(eval *)', 'Bash(base64 *)',
      'Bash(chmod 777 *)', 'Bash(chmod +s *)',
      'Bash(chmod u+s *)', 'Bash(chmod g+s *)',
    ]
    for (const cmd of denied) {
      expect(SAFE_BASH_ALLOW_RULES).not.toContain(cmd)
    }
  })
})

// ============================================================
// Profile applicator: compensate when bare Bash removed
// ============================================================
describe('applyProfileToSettings: compensate bare Bash removal', () => {
  it('adds safe Bash patterns when bare Bash is removed', () => {
    const settings: ClaudeSettings = {
      permissions: {
        allow: ['Bash', 'Read'],
      },
    }
    const result = applyProfileToSettings(settings, minimalProfile)
    // Bare Bash removed
    expect(result.settings.permissions!.allow).not.toContain('Bash')
    // Safe patterns added as compensation
    expect(result.settings.permissions!.allow).toContain('Bash(git commit *)')
    expect(result.settings.permissions!.allow).toContain('Bash(git add *)')
    expect(result.settings.permissions!.allow).toContain('Bash(npm install *)')
  })

  it('does not duplicate existing safe Bash patterns', () => {
    const settings: ClaudeSettings = {
      permissions: {
        allow: ['Bash', 'Read', 'Bash(git add *)', 'Bash(npm *)'],
      },
    }
    const result = applyProfileToSettings(settings, minimalProfile)
    const addCount = result.settings.permissions!.allow!.filter(r => r === 'Bash(git add *)').length
    expect(addCount).toBe(1)
  })

  it('does not add safe Bash patterns when bare Bash is NOT removed', () => {
    // Profile with no ask rules → bare Bash stays → no compensation needed
    const noAskProfile = { ...minimalProfile, ask: undefined }
    const settings: ClaudeSettings = {
      permissions: {
        allow: ['Bash', 'Read'],
      },
    }
    const result = applyProfileToSettings(settings, noAskProfile)
    expect(result.settings.permissions!.allow).toContain('Bash')
    // Should NOT add safe patterns when bare Bash was kept
  })

  it('real scenario: user with bare Bash gets compensated', () => {
    const settings: ClaudeSettings = {
      permissions: {
        allow: [
          'Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep',
          'Bash(git status *)', 'Bash(git diff *)',
        ],
      },
    }
    const result = applyProfileToSettings(settings, minimalProfile)

    // Bare Bash removed
    expect(result.settings.permissions!.allow).not.toContain('Bash')

    // git commit compensated (was missing)
    expect(result.settings.permissions!.allow).toContain('Bash(git commit *)')

    // Existing patterns preserved
    expect(result.settings.permissions!.allow).toContain('Bash(git status *)')
    expect(result.settings.permissions!.allow).toContain('Bash(git diff *)')

    // ask rules still present
    expect(result.settings.permissions!.ask).toContain('Bash(git push *)')
  })
})
