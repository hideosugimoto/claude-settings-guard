import { describe, it, expect } from 'vitest'
import {
  resolveReadOnlyBashRules,
  type ReadOnlyBashResult,
} from '../src/core/readonly-bash-resolver.js'
import {
  READ_ONLY_BASH_SAFE,
  READ_ONLY_BASH_FILE_READERS,
  DEFAULT_DENY_RULES,
  HARD_TO_REVERSE_ASK_RULES,
  FILE_READ_COMMANDS,
  FILE_WRITE_COMMANDS,
} from '../src/constants.js'

describe('READ_ONLY_BASH_SAFE constants', () => {
  it('has no overlap with DEFAULT_DENY_RULES', () => {
    const denySet = new Set(DEFAULT_DENY_RULES)
    const overlaps = READ_ONLY_BASH_SAFE.filter(r => denySet.has(r))
    expect(overlaps).toEqual([])
  })

  it('has no overlap with HARD_TO_REVERSE_ASK_RULES', () => {
    const askSet = new Set(HARD_TO_REVERSE_ASK_RULES)
    const overlaps = READ_ONLY_BASH_SAFE.filter(r => askSet.has(r))
    expect(overlaps).toEqual([])
  })

  it('contains only Bash commands', () => {
    for (const rule of READ_ONLY_BASH_SAFE) {
      expect(rule).toMatch(/^Bash\(/)
    }
  })

  it('does not include env command (prefix bypass risk)', () => {
    const hasEnv = READ_ONLY_BASH_SAFE.some(r => r.startsWith('Bash(env'))
    expect(hasEnv).toBe(false)
  })

  it('includes -C variants for git read-only commands', () => {
    expect(READ_ONLY_BASH_SAFE).toContain('Bash(git -C * show *)')
    expect(READ_ONLY_BASH_SAFE).toContain('Bash(git -C * log *)')
    expect(READ_ONLY_BASH_SAFE).toContain('Bash(git -C * diff *)')
    expect(READ_ONLY_BASH_SAFE).toContain('Bash(git -C * status *)')
    expect(READ_ONLY_BASH_SAFE).toContain('Bash(git -C * blame *)')
  })
})

describe('READ_ONLY_BASH_FILE_READERS constants', () => {
  it('file-reader commands (except sed) are in FILE_READ_COMMANDS set', () => {
    for (const rule of READ_ONLY_BASH_FILE_READERS) {
      const match = rule.match(/^Bash\((\w+)/)
      expect(match).not.toBeNull()
      const cmd = match![1]
      expect(FILE_READ_COMMANDS.has(cmd)).toBe(true)
    }
  })

  it('sed is in FILE_WRITE_COMMANDS set', () => {
    const hasSed = READ_ONLY_BASH_FILE_READERS.some(r => r === 'Bash(sed *)')
    expect(hasSed).toBe(true)
    expect(FILE_WRITE_COMMANDS.has('sed')).toBe(true)
  })

  it('does not include env command (prefix bypass risk)', () => {
    const hasEnv = READ_ONLY_BASH_FILE_READERS.some(r => r.startsWith('Bash(env'))
    expect(hasEnv).toBe(false)
  })
})

describe('resolveReadOnlyBashRules', () => {
  it('returns all safe + file-reader commands when no deny rules', () => {
    const result = resolveReadOnlyBashRules([])

    const expectedCount = READ_ONLY_BASH_SAFE.length + READ_ONLY_BASH_FILE_READERS.length
    expect(result.allowed).toHaveLength(expectedCount)
    expect(result.excluded).toHaveLength(0)
    expect(result.warnings).toHaveLength(0)
  })

  it('always includes safe commands regardless of deny rules', () => {
    const result = resolveReadOnlyBashRules([
      'Read(**/.env)',
      'Write(**/.env)',
      'Edit(**/.env)',
      'Grep(**/.env)',
    ])

    for (const rule of READ_ONLY_BASH_SAFE) {
      expect(result.allowed).toContain(rule)
    }
  })

  it('git read-only commands are always included', () => {
    const gitRules = READ_ONLY_BASH_SAFE.filter(r => r.startsWith('Bash(git '))
    expect(gitRules.length).toBeGreaterThan(0)

    const result = resolveReadOnlyBashRules([
      'Read(**/.env)',
      'Write(**/.env)',
      'Grep(**/.env)',
    ])

    for (const rule of gitRules) {
      expect(result.allowed).toContain(rule)
    }
  })

  it('excludes file-readers when Read deny rules exist', () => {
    const result = resolveReadOnlyBashRules(['Read(**/.env)'])

    for (const rule of READ_ONLY_BASH_FILE_READERS) {
      expect(result.excluded).toContain(rule)
      expect(result.allowed).not.toContain(rule)
    }
  })

  it('excludes file-readers when Grep deny rules exist', () => {
    const result = resolveReadOnlyBashRules(['Grep(**/.env)'])

    for (const rule of READ_ONLY_BASH_FILE_READERS) {
      expect(result.excluded).toContain(rule)
      expect(result.allowed).not.toContain(rule)
    }
  })

  it('excludes sed when Write deny exists but no Read deny', () => {
    const result = resolveReadOnlyBashRules(['Write(**/.env)'])

    expect(result.excluded).toContain('Bash(sed *)')
    expect(result.allowed).not.toContain('Bash(sed *)')
  })

  it('excludes sed when Edit deny exists but no Read deny', () => {
    const result = resolveReadOnlyBashRules(['Edit(**/.env)'])

    expect(result.excluded).toContain('Bash(sed *)')
    expect(result.allowed).not.toContain('Bash(sed *)')
  })

  it('includes non-sed file-readers when only Write/Edit deny exists', () => {
    const result = resolveReadOnlyBashRules(['Write(**/.env)', 'Edit(**/.env)'])

    const nonSedReaders = READ_ONLY_BASH_FILE_READERS.filter(r => r !== 'Bash(sed *)')
    for (const rule of nonSedReaders) {
      expect(result.allowed).toContain(rule)
    }
  })

  it('returns warnings for excluded commands', () => {
    const result = resolveReadOnlyBashRules(['Read(**/.env)'])

    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.warnings.length).toBe(result.excluded.length)
  })

  it('returns warning mentioning sed -i bypass when sed excluded due to Write deny', () => {
    const result = resolveReadOnlyBashRules(['Write(**/.env)'])

    const sedWarning = result.warnings.find(w => w.includes('sed'))
    expect(sedWarning).toBeDefined()
    expect(sedWarning).toContain('sed -i')
  })

  it('result is readonly-compatible (allowed, excluded, warnings are arrays)', () => {
    const result: ReadOnlyBashResult = resolveReadOnlyBashRules([])

    expect(Array.isArray(result.allowed)).toBe(true)
    expect(Array.isArray(result.excluded)).toBe(true)
    expect(Array.isArray(result.warnings)).toBe(true)
  })

  it('handles deny rules for unrelated tools without affecting results', () => {
    const result = resolveReadOnlyBashRules(['WebFetch(*)', 'Agent(*)'])

    const expectedCount = READ_ONLY_BASH_SAFE.length + READ_ONLY_BASH_FILE_READERS.length
    expect(result.allowed).toHaveLength(expectedCount)
    expect(result.excluded).toHaveLength(0)
  })
})
