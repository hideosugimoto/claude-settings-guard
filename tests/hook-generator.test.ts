import { describe, it, expect } from 'vitest'
import {
  generateEnforceScript,
  mergeHookIntoSettings,
} from '../src/core/hook-generator.js'
import type { ClaudeSettings } from '../src/types.js'

describe('generateEnforceScript', () => {
  it('generates a valid bash script', () => {
    const script = generateEnforceScript(['Bash(sudo *)'])
    expect(script).toContain('#!/bin/bash')
    expect(script).toContain('TOOL_NAME')
    expect(script).toContain('exit 2')
    expect(script).toContain('exit 0')
  })

  it('handles Bash deny rules', () => {
    const script = generateEnforceScript(['Bash(sudo *)', 'Bash(rm -rf /*)'])
    expect(script).toContain('TOOL_NAME" = "Bash"')
    expect(script).toContain('command')
    expect(script).toContain('sudo')
    expect(script).toContain('rm -rf')
  })

  it('handles Read deny rules', () => {
    const script = generateEnforceScript(['Read(**/.env)', 'Read(**/secrets/**)'])
    expect(script).toContain('TOOL_NAME" = "Read"')
    expect(script).toContain('file_path')
  })

  it('handles legacy colon syntax', () => {
    const script = generateEnforceScript(['Bash(sudo:*)'])
    expect(script).toContain('#!/bin/bash')
    expect(script).toContain('sudo')
  })

  it('handles mixed tool types', () => {
    const script = generateEnforceScript([
      'Bash(sudo *)',
      'Read(**/.env)',
      'Bash(rm -rf /*)',
    ])
    expect(script).toContain('TOOL_NAME" = "Bash"')
    expect(script).toContain('TOOL_NAME" = "Read"')
  })

  it('generates empty checks for empty rules', () => {
    const script = generateEnforceScript([])
    expect(script).toContain('#!/bin/bash')
    expect(script).toContain('exit 0')
  })
})

describe('mergeHookIntoSettings', () => {
  it('adds hook to empty PreToolUse', () => {
    const settings: ClaudeSettings = {}
    const result = mergeHookIntoSettings(settings, '/path/to/enforce-permissions.sh')

    expect(result.PreToolUse).toHaveLength(1)
    expect(result.PreToolUse![0].matcher).toBe('*')
    expect(result.PreToolUse![0].hooks[0].command).toBe('/path/to/enforce-permissions.sh')
  })

  it('appends to existing PreToolUse hooks', () => {
    const settings: ClaudeSettings = {
      PreToolUse: [{
        matcher: 'tool == "Bash"',
        hooks: [{ type: 'command', command: 'other-hook.sh' }],
      }],
    }
    const result = mergeHookIntoSettings(settings, '/path/to/enforce-permissions.sh')

    expect(result.PreToolUse).toHaveLength(2)
  })

  it('does not duplicate if already registered', () => {
    const settings: ClaudeSettings = {
      PreToolUse: [{
        matcher: '*',
        hooks: [{ type: 'command', command: '/path/to/enforce-permissions.sh' }],
      }],
    }
    const result = mergeHookIntoSettings(settings, '/path/to/enforce-permissions.sh')

    expect(result.PreToolUse).toHaveLength(1)
  })

  it('does not mutate original settings', () => {
    const settings: ClaudeSettings = { PreToolUse: [] }
    const result = mergeHookIntoSettings(settings, '/path/to/hook.sh')

    expect(result.PreToolUse).toHaveLength(1)
    expect(settings.PreToolUse).toHaveLength(0)
  })
})
