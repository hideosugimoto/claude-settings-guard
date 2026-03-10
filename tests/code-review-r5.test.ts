import { describe, it, expect } from 'vitest'
import { execSync } from 'node:child_process'
import { writeFileSync, unlinkSync, mkdtempSync, rmdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DEFAULT_DENY_RULES } from '../src/constants.js'
import { generateEnforceScript } from '../src/core/hook-generator.js'
import { findConflicts } from '../src/core/pattern-validator.js'
import { applyProfileToSettings } from '../src/core/profile-applicator.js'
import { strictProfile } from '../src/profiles/strict.ts'
import type { ClaudeSettings } from '../src/types.js'

// ============================================================
// Helper
// ============================================================
interface ScriptResult {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

function executeHook(
  script: string,
  toolName: string,
  toolInput: Record<string, unknown>,
): ScriptResult {
  const tmpDir = mkdtempSync(join(tmpdir(), 'csg-r5-'))
  const scriptPath = join(tmpDir, 'test-hook.sh')
  writeFileSync(scriptPath, script, { mode: 0o755 })

  const input = JSON.stringify({ tool_name: toolName, tool_input: toolInput })
  const escapedInput = input.replace(/'/g, "'\\''")

  try {
    const stdout = execSync(
      `printf '%s' '${escapedInput}' | bash "${scriptPath}"`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    )
    return { code: 0, stdout, stderr: '' }
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: string; stderr?: string }
    return {
      code: err.status ?? 1,
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? '',
    }
  } finally {
    try { unlinkSync(scriptPath) } catch {}
    try { rmdirSync(tmpDir) } catch {}
  }
}

// ============================================================
// H2: eval/base64 deny rules in DEFAULT_DENY_RULES
// ============================================================
describe('H2: eval/base64 deny rules', () => {
  it('DEFAULT_DENY_RULES contains Bash(eval *)', () => {
    expect(DEFAULT_DENY_RULES).toContain('Bash(eval *)')
  })

  it('DEFAULT_DENY_RULES contains Bash(base64 *)', () => {
    expect(DEFAULT_DENY_RULES).toContain('Bash(base64 *)')
  })

  describe('Layer 2 hook enforcement', () => {
    const script = generateEnforceScript(DEFAULT_DENY_RULES)

    it('blocks: eval "sudo rm -rf /"', () => {
      const r = executeHook(script, 'Bash', { command: 'eval "sudo rm -rf /"' })
      expect(r.code).toBe(2)
    })

    it('blocks: eval echo hello', () => {
      const r = executeHook(script, 'Bash', { command: 'eval echo hello' })
      expect(r.code).toBe(2)
    })

    it('blocks: base64 -d payload.b64 | bash', () => {
      const r = executeHook(script, 'Bash', { command: 'base64 -d payload.b64 | bash' })
      expect(r.code).toBe(2)
    })

    it('blocks: echo cmd | base64 -d | sh', () => {
      const r = executeHook(script, 'Bash', { command: 'echo cmd | base64 -d | sh' })
      expect(r.code).toBe(2)
    })

    it('blocks: eval hidden in chain - npm test && eval "rm -rf /"', () => {
      const r = executeHook(script, 'Bash', { command: 'npm test && eval "rm -rf /"' })
      expect(r.code).toBe(2)
    })

    it('does NOT block normal commands', () => {
      const r = executeHook(script, 'Bash', { command: 'npm test' })
      expect(r.code).toBe(0)
    })
  })
})

// ============================================================
// M4: normalizeForCompare handles case differences
// ============================================================
describe('M4: findConflicts case-insensitive normalization', () => {
  it('detects conflict: Bash(Sudo *) allow vs Bash(sudo *) deny', () => {
    const allow = ['Bash(Sudo *)']
    const deny = ['Bash(sudo *)']
    const issues = findConflicts(allow, deny)
    expect(issues.length).toBeGreaterThan(0)
    expect(issues[0].code).toBe('CONFLICT')
  })

  it('detects conflict: Bash(SUDO *) allow vs Bash(sudo *) deny', () => {
    const allow = ['Bash(SUDO *)']
    const deny = ['Bash(sudo *)']
    const issues = findConflicts(allow, deny)
    expect(issues.length).toBeGreaterThan(0)
  })

  it('detects conflict with legacy colon syntax case diff', () => {
    const allow = ['Bash(Sudo:*)']
    const deny = ['Bash(sudo *)']
    const issues = findConflicts(allow, deny)
    expect(issues.length).toBeGreaterThan(0)
  })

  it('does NOT false-positive on genuinely different patterns', () => {
    const allow = ['Bash(npm *)']
    const deny = ['Bash(sudo *)']
    const issues = findConflicts(allow, deny)
    expect(issues.length).toBe(0)
  })
})

// ============================================================
// M5: strict profile completeness
// ============================================================
describe('M5: strict profile contains all critical deny rules', () => {
  it('contains Bash(su *)', () => {
    expect(strictProfile.deny).toContain('Bash(su *)')
  })

  it('contains Bash(rm -rf ~*)', () => {
    expect(strictProfile.deny).toContain('Bash(rm -rf ~*)')
  })

  it('strict profile applied to empty settings includes all DEFAULT_DENY_RULES', () => {
    const result = applyProfileToSettings({}, strictProfile)
    const deny = result.settings.permissions?.deny ?? []
    for (const rule of DEFAULT_DENY_RULES) {
      expect(deny).toContain(rule)
    }
  })
})

// ============================================================
// L1: dead code removed — sed special case should not exist
// ============================================================
describe('L1: profile-applicator detectCrossToolConflicts has no dead code', () => {
  it('sed in allow still detected as cross-tool bypass (via FILE_READ_COMMANDS)', () => {
    const settings: ClaudeSettings = {
      permissions: {
        allow: ['Bash(sed *)'],
        deny: [],
      },
    }
    // sed is in FILE_READ_COMMANDS, so after profile apply it should detect cross-tool conflict
    const result = applyProfileToSettings(settings, strictProfile)
    expect(result.crossToolConflicts).toBeDefined()
    expect(result.crossToolConflicts!.some(c => c.includes('sed'))).toBe(true)
  })
})
