import { describe, it, expect } from 'vitest'
import {
  parsePattern,
  isLegacySyntax,
  isValidToolName,
  validatePatterns,
  findConflicts,
} from '../src/core/pattern-validator.js'

describe('parsePattern', () => {
  it('parses bare tool names', () => {
    const result = parsePattern('Read', 'allow')
    expect(result.toolName).toBe('Read')
    expect(result.isLegacy).toBe(false)
    expect(result.argument).toBeUndefined()
  })

  it('parses legacy colon syntax', () => {
    const result = parsePattern('Bash(npm:*)', 'allowedTools')
    expect(result.toolName).toBe('Bash')
    expect(result.isLegacy).toBe(true)
    expect(result.argument).toBe('npm:*')
  })

  it('parses modern space syntax', () => {
    const result = parsePattern('Bash(npm *)', 'allow')
    expect(result.toolName).toBe('Bash')
    expect(result.isLegacy).toBe(false)
    expect(result.argument).toBe('npm *')
  })

  it('parses Read with glob pattern', () => {
    const result = parsePattern('Read(**/.env)', 'deny')
    expect(result.toolName).toBe('Read')
    expect(result.isLegacy).toBe(false)
    expect(result.argument).toBe('**/.env')
  })

  it('parses MCP tool patterns', () => {
    const result = parsePattern('mcp__github__search_code', 'allow')
    expect(result.toolName).toBe('mcp__github__search_code')
    expect(result.isLegacy).toBe(false)
  })

  it('preserves source field', () => {
    expect(parsePattern('Read', 'deny').source).toBe('deny')
    expect(parsePattern('Read', 'allow').source).toBe('allow')
    expect(parsePattern('Read', 'allowedTools').source).toBe('allowedTools')
  })
})

describe('isLegacySyntax', () => {
  it('detects colon syntax', () => {
    expect(isLegacySyntax('Bash(npm:*)')).toBe(true)
    expect(isLegacySyntax('Bash(git status:*)')).toBe(true)
    expect(isLegacySyntax('Bash(sudo:*)')).toBe(true)
  })

  it('rejects modern syntax', () => {
    expect(isLegacySyntax('Bash(npm *)')).toBe(false)
    expect(isLegacySyntax('Read(**/.env)')).toBe(false)
    expect(isLegacySyntax('Read')).toBe(false)
  })
})

describe('isValidToolName', () => {
  it('recognizes known tools', () => {
    expect(isValidToolName('Bash')).toBe(true)
    expect(isValidToolName('Read')).toBe(true)
    expect(isValidToolName('Write')).toBe(true)
    expect(isValidToolName('Edit')).toBe(true)
    expect(isValidToolName('Glob')).toBe(true)
    expect(isValidToolName('Grep')).toBe(true)
  })

  it('recognizes MCP tools', () => {
    expect(isValidToolName('mcp__github__search_code')).toBe(true)
    expect(isValidToolName('mcp__codex__codex')).toBe(true)
  })

  it('rejects unknown tools', () => {
    expect(isValidToolName('FakeTool')).toBe(false)
    expect(isValidToolName('Unknown')).toBe(false)
  })
})

describe('validatePatterns', () => {
  it('detects legacy patterns', () => {
    const issues = validatePatterns(
      ['Bash(npm:*)', 'Bash(git status:*)', 'Read'],
      'allowedTools'
    )
    expect(issues.length).toBe(1)
    expect(issues[0].code).toBe('LEGACY_SYNTAX')
    expect(issues[0].severity).toBe('critical')
    expect(issues[0].details).toHaveLength(2)
  })

  it('returns empty for valid patterns', () => {
    const issues = validatePatterns(
      ['Bash(npm *)', 'Read', 'Write'],
      'allow'
    )
    expect(issues).toHaveLength(0)
  })

  it('detects unknown tool names', () => {
    const issues = validatePatterns(['FakeTool(something)'], 'allow')
    expect(issues.some(i => i.code === 'INVALID_TOOL')).toBe(true)
  })
})

describe('findConflicts', () => {
  it('finds patterns in both allow and deny', () => {
    const issues = findConflicts(
      ['Bash(npm *)', 'Read'],
      ['Bash(npm *)', 'Bash(sudo *)']
    )
    expect(issues).toHaveLength(1)
    expect(issues[0].code).toBe('CONFLICT')
    expect(issues[0].details).toContain('Bash(npm *)')
  })

  it('normalizes legacy syntax for comparison', () => {
    const issues = findConflicts(
      ['Bash(npm:*)'],
      ['Bash(npm *)']
    )
    expect(issues).toHaveLength(1)
  })

  it('returns empty when no conflicts', () => {
    const issues = findConflicts(['Read', 'Write'], ['Bash(sudo *)'])
    expect(issues).toHaveLength(0)
  })
})
