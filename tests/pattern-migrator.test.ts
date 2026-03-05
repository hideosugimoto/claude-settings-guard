import { describe, it, expect } from 'vitest'
import {
  migrateColonToSpace,
  migrateAllPatterns,
  migrateStructure,
} from '../src/core/pattern-migrator.js'
import type { ClaudeSettings } from '../src/types.js'

describe('migrateColonToSpace', () => {
  it('converts colon syntax to space syntax', () => {
    const result = migrateColonToSpace('Bash(npm:*)')
    expect(result).not.toBeNull()
    expect(result!.migrated).toBe('Bash(npm *)')
    expect(result!.type).toBe('syntax')
  })

  it('handles multi-word commands', () => {
    const result = migrateColonToSpace('Bash(git status:*)')
    expect(result!.migrated).toBe('Bash(git status *)')
  })

  it('returns null for modern syntax', () => {
    expect(migrateColonToSpace('Bash(npm *)')).toBeNull()
  })

  it('returns null for bare tool names', () => {
    expect(migrateColonToSpace('Read')).toBeNull()
  })

  it('returns null for glob patterns', () => {
    expect(migrateColonToSpace('Read(**/.env)')).toBeNull()
  })
})

describe('migrateAllPatterns', () => {
  it('migrates all legacy patterns and keeps modern ones', () => {
    const input = ['Bash(npm:*)', 'Bash(git:*)', 'Read', 'Bash(npm *)']
    const { migrated, results } = migrateAllPatterns(input)

    expect(migrated).toEqual(['Bash(npm *)', 'Bash(git *)', 'Read', 'Bash(npm *)'])
    expect(results).toHaveLength(2) // only the 2 legacy ones
  })

  it('returns empty results for no legacy patterns', () => {
    const { results } = migrateAllPatterns(['Read', 'Write', 'Bash(npm *)'])
    expect(results).toHaveLength(0)
  })
})

describe('migrateStructure', () => {
  it('moves allowedTools to permissions.allow', () => {
    const settings: ClaudeSettings = {
      allowedTools: ['Read', 'Write'],
    }
    const { migrated } = migrateStructure(settings)

    expect(migrated.allowedTools).toBeUndefined()
    expect(migrated.permissions?.allow).toContain('Read')
    expect(migrated.permissions?.allow).toContain('Write')
  })

  it('moves top-level deny to permissions.deny', () => {
    const settings: ClaudeSettings = {
      deny: ['Bash(sudo:*)', 'Read(**/.env)'],
    }
    const { migrated } = migrateStructure(settings)

    expect(migrated.deny).toBeUndefined()
    expect(migrated.permissions?.deny).toContain('Bash(sudo *)')
    expect(migrated.permissions?.deny).toContain('Read(**/.env)')
  })

  it('migrates colon syntax during structure migration', () => {
    const settings: ClaudeSettings = {
      allowedTools: ['Bash(npm:*)', 'Bash(git:*)'],
    }
    const { migrated } = migrateStructure(settings)

    expect(migrated.permissions?.allow).toContain('Bash(npm *)')
    expect(migrated.permissions?.allow).toContain('Bash(git *)')
  })

  it('preserves existing permissions fields', () => {
    const settings: ClaudeSettings = {
      permissions: {
        allow: ['Glob'],
        deny: ['Bash(rm *)'],
      },
      allowedTools: ['Read'],
    }
    const { migrated } = migrateStructure(settings)

    expect(migrated.permissions?.allow).toContain('Glob')
    expect(migrated.permissions?.allow).toContain('Read')
    expect(migrated.permissions?.deny).toContain('Bash(rm *)')
  })

  it('deduplicates merged rules', () => {
    const settings: ClaudeSettings = {
      permissions: { allow: ['Read'] },
      allowedTools: ['Read'],
    }
    const { migrated } = migrateStructure(settings)

    const readCount = migrated.permissions!.allow!.filter(r => r === 'Read').length
    expect(readCount).toBe(1)
  })

  it('preserves non-permission fields', () => {
    const settings: ClaudeSettings = {
      language: '日本語',
      env: { FOO: 'bar' },
      allowedTools: ['Read'],
    }
    const { migrated } = migrateStructure(settings)

    expect(migrated.language).toBe('日本語')
    expect(migrated.env).toEqual({ FOO: 'bar' })
  })
})
