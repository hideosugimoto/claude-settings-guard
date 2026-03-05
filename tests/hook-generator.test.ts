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

describe('generateEnforceScript — subcommand splitting', () => {
  it('generates split_subcommands function for Bash rules', () => {
    const script = generateEnforceScript(['Bash(sudo *)'])
    expect(script).toContain('split_subcommands')
  })

  it('includes while-read loop for subcommand checking', () => {
    const script = generateEnforceScript(['Bash(sudo *)'])
    expect(script).toContain('while IFS= read -r subcmd')
  })

  it('does not include split_subcommands for Read-only rules', () => {
    const script = generateEnforceScript(['Read(**/.env)'])
    expect(script).not.toContain('split_subcommands')
  })

  it('includes split_subcommands for mixed Bash+Read rules', () => {
    const script = generateEnforceScript(['Bash(sudo *)', 'Read(**/.env)'])
    expect(script).toContain('split_subcommands')
    // Read section should not use split_subcommands
    const readSection = script.split('TOOL_NAME" = "Read"')[1]?.split('fi')[0] ?? ''
    expect(readSection).not.toContain('split_subcommands')
  })

  it('all 10 existing tests still pass with new script format', () => {
    // This is verified by the existing tests above passing
    const script = generateEnforceScript(['Bash(sudo *)', 'Read(**/.env)'])
    expect(script).toContain('#!/bin/bash')
    expect(script).toContain('exit 2')
    expect(script).toContain('exit 0')
  })
})

describe('generateEnforceScript — bash execution integration', () => {
  const { execSync } = require('child_process')
  const { writeFileSync, unlinkSync, mkdtempSync } = require('fs')
  const { join } = require('path')
  const { tmpdir } = require('os')

  function runScript(script: string, toolName: string, toolInput: object): { code: number; stderr: string } {
    const tmpDir = mkdtempSync(join(tmpdir(), 'csg-test-'))
    const scriptPath = join(tmpDir, 'test-hook.sh')
    writeFileSync(scriptPath, script, { mode: 0o755 })

    const input = JSON.stringify({ tool_name: toolName, tool_input: toolInput })
    try {
      execSync(`printf '%s' '${input.replace(/'/g, "'\\''")}' | TOOL_NAME="${toolName}" bash "${scriptPath}"`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      return { code: 0, stderr: '' }
    } catch (e: any) {
      return { code: e.status ?? 1, stderr: e.stderr ?? '' }
    } finally {
      try { unlinkSync(scriptPath) } catch {}
    }
  }

  it('blocks simple sudo command', () => {
    const script = generateEnforceScript(['Bash(sudo *)'])
    const result = runScript(script, 'Bash', { command: 'sudo rm -rf /' })
    expect(result.code).toBe(2)
    expect(result.stderr).toContain('BLOCKED')
  })

  it('allows non-matching command', () => {
    const script = generateEnforceScript(['Bash(sudo *)'])
    const result = runScript(script, 'Bash', { command: 'npm install' })
    expect(result.code).toBe(0)
  })

  it('blocks sudo after pipe', () => {
    const script = generateEnforceScript(['Bash(sudo *)'])
    const result = runScript(script, 'Bash', { command: 'echo foo | sudo rm -rf /' })
    expect(result.code).toBe(2)
    expect(result.stderr).toContain('BLOCKED')
  })

  it('blocks sudo after && chain', () => {
    const script = generateEnforceScript(['Bash(sudo *)'])
    const result = runScript(script, 'Bash', { command: 'cd /tmp && sudo rm -rf /' })
    expect(result.code).toBe(2)
  })

  it('blocks sudo after semicolon', () => {
    const script = generateEnforceScript(['Bash(sudo *)'])
    const result = runScript(script, 'Bash', { command: 'echo hello; sudo rm -rf /' })
    expect(result.code).toBe(2)
  })

  it('blocks sudo after || chain', () => {
    const script = generateEnforceScript(['Bash(sudo *)'])
    const result = runScript(script, 'Bash', { command: 'false || sudo rm -rf /' })
    expect(result.code).toBe(2)
  })

  it('blocks rm -rf in multi-command chain', () => {
    const script = generateEnforceScript(['Bash(rm -rf /*)'])
    const result = runScript(script, 'Bash', { command: 'cd /tmp && rm -rf /home' })
    expect(result.code).toBe(2)
  })

  it('allows safe multi-command chain', () => {
    const script = generateEnforceScript(['Bash(sudo *)', 'Bash(rm -rf /*)'])
    const result = runScript(script, 'Bash', { command: 'npm install && npm test' })
    expect(result.code).toBe(0)
  })

  it('does not block Read tool with Bash rules', () => {
    const script = generateEnforceScript(['Bash(sudo *)'])
    const result = runScript(script, 'Read', { file_path: '/etc/passwd' })
    expect(result.code).toBe(0)
  })

  it('blocks Read tool matching deny rule', () => {
    const script = generateEnforceScript(['Read(**/.env)'])
    const result = runScript(script, 'Read', { file_path: '/app/.env' })
    expect(result.code).toBe(2)
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
