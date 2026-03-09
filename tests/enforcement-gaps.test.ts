import { describe, it, expect } from 'vitest'
import { execSync } from 'node:child_process'
import { writeFileSync, unlinkSync, mkdtempSync, rmdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { generateEnforceScript } from '../src/core/hook-generator.js'
import { runDiagnose } from '../src/commands/diagnose.js'

// ============================================================
// Test Helper (same pattern as security-fixes.test.ts)
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
  const tmpDir = mkdtempSync(join(tmpdir(), 'csg-gaps-'))
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

/**
 * Execute raw string as stdin to the hook script (for malformed input testing)
 */
function executeHookRaw(
  script: string,
  rawInput: string,
): ScriptResult {
  const tmpDir = mkdtempSync(join(tmpdir(), 'csg-gaps-'))
  const scriptPath = join(tmpDir, 'test-hook.sh')
  writeFileSync(scriptPath, script, { mode: 0o755 })

  const escapedInput = rawInput.replace(/'/g, "'\\''")

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

function enforce(
  denyRules: readonly string[],
  toolName: string,
  toolInput: Record<string, unknown>,
): ScriptResult {
  return executeHook(generateEnforceScript(denyRules), toolName, toolInput)
}

const BALANCED_DENY = [
  'Bash(sudo *)',
  'Bash(rm -rf /*)',
  'Read(**/.env)',
  'Read(**/secrets/**)',
  'Edit(**/.env)',
  'Edit(**/secrets/**)',
] as const

// ============================================================
// GAP 1 (CRITICAL): fail-open on invalid input
// ============================================================
describe('GAP 1: fail-closed on invalid input', () => {
  const script = generateEnforceScript(BALANCED_DENY)

  it('rejects empty JSON object (no tool_name field)', () => {
    const r = executeHookRaw(script, '{}')
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('could not parse tool_name')
  })

  it('rejects malformed JSON input', () => {
    const r = executeHookRaw(script, 'not-valid-json')
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('could not parse tool_name')
  })

  it('rejects empty string input', () => {
    const r = executeHookRaw(script, '')
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('could not parse tool_name')
  })

  it('rejects JSON with empty tool_name', () => {
    const r = executeHookRaw(script, '{"tool_name": ""}')
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('could not parse tool_name')
  })

  it('rejects JSON with null tool_name', () => {
    const r = executeHookRaw(script, '{"tool_name": null}')
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('could not parse tool_name')
  })

  it('still allows valid input with recognized tool', () => {
    const r = executeHook(script, 'Bash', { command: 'npm test' })
    expect(r.code).toBe(0)
  })

  it('still allows valid input with unrecognized tool', () => {
    const r = executeHook(script, 'WebFetch', { url: 'https://example.com' })
    expect(r.code).toBe(0)
  })
})

// ============================================================
// GAP 2 (HIGH): MultiEdit bypasses Edit deny rules
// ============================================================
describe('GAP 2: MultiEdit must be treated as Edit for deny rules', () => {
  const script = generateEnforceScript(BALANCED_DENY)

  it('blocks MultiEdit on .env files (same as Edit deny)', () => {
    const r = executeHook(script, 'MultiEdit', { file_path: '/app/.env' })
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('BLOCKED')
  })

  it('blocks MultiEdit on secrets directory (same as Edit deny)', () => {
    const r = executeHook(script, 'MultiEdit', { file_path: '/app/secrets/api.key' })
    expect(r.code).toBe(2)
  })

  it('allows MultiEdit on normal files', () => {
    const r = executeHook(script, 'MultiEdit', { file_path: '/app/src/index.ts' })
    expect(r.code).toBe(0)
  })

  it('blocks multiedit (lowercase) on .env files', () => {
    const r = executeHook(script, 'multiedit', { file_path: '/app/.env' })
    expect(r.code).toBe(2)
  })

  it('still blocks Edit on .env files (regression check)', () => {
    const r = executeHook(script, 'Edit', { file_path: '/app/.env' })
    expect(r.code).toBe(2)
  })
})

// ============================================================
// GAP 3 (HIGH): file_path case-insensitive matching
// ============================================================
describe('GAP 3: file_path case-insensitive matching', () => {
  const script = generateEnforceScript(BALANCED_DENY)

  it('blocks Read of /app/.ENV (uppercase)', () => {
    const r = executeHook(script, 'Read', { file_path: '/app/.ENV' })
    expect(r.code).toBe(2)
  })

  it('blocks Read of /app/.Env (mixed case)', () => {
    const r = executeHook(script, 'Read', { file_path: '/app/.Env' })
    expect(r.code).toBe(2)
  })

  it('blocks Edit of /app/.ENV (uppercase)', () => {
    const r = executeHook(script, 'Edit', { file_path: '/app/.ENV' })
    expect(r.code).toBe(2)
  })

  it('blocks Read of /APP/SECRETS/key (uppercase path)', () => {
    const r = executeHook(script, 'Read', { file_path: '/APP/SECRETS/key' })
    expect(r.code).toBe(2)
  })

  it('blocks Read of /app/Secrets/API.key (mixed case)', () => {
    const r = executeHook(script, 'Read', { file_path: '/app/Secrets/API.key' })
    expect(r.code).toBe(2)
  })

  it('still allows normal files (regression check)', () => {
    const r = executeHook(script, 'Read', { file_path: '/app/src/index.ts' })
    expect(r.code).toBe(0)
  })

  it('still blocks lowercase .env (regression check)', () => {
    const r = executeHook(script, 'Read', { file_path: '/app/.env' })
    expect(r.code).toBe(2)
  })
})

// ============================================================
// GAP 4 (MEDIUM): diagnose warns about missing paired deny rules
// ============================================================
describe('GAP 4: diagnose warns about missing paired deny rules', () => {
  it('emits info when Read(**/.env) exists but Edit(**/.env) is missing', async () => {
    // Mock settings with Read deny but no Edit deny
    const { validatePatterns, findConflicts } = await import('../src/core/pattern-validator.js')
    const { checkMissingPairedDenyRules } = await import('../src/core/pattern-validator.js')

    const denyRules = ['Read(**/.env)', 'Read(**/secrets/**)']
    const issues = checkMissingPairedDenyRules(denyRules)

    expect(issues.length).toBeGreaterThan(0)
    expect(issues[0].severity).toBe('info')
    expect(issues[0].code).toBe('MISSING_PAIRED_DENY')
    expect(issues[0].message).toContain('Edit')
  })

  it('does NOT emit warning when Read, Edit, and Write deny all exist', async () => {
    const { checkMissingPairedDenyRules } = await import('../src/core/pattern-validator.js')

    const denyRules = [
      'Read(**/.env)',
      'Edit(**/.env)',
      'Write(**/.env)',
      'Grep(**/.env)',
      'Read(**/secrets/**)',
      'Edit(**/secrets/**)',
      'Write(**/secrets/**)',
      'Grep(**/secrets/**)',
    ]
    const issues = checkMissingPairedDenyRules(denyRules)

    expect(issues.length).toBe(0)
  })

  it('suggests adding Edit deny when only Read deny exists for .env.*', async () => {
    const { checkMissingPairedDenyRules } = await import('../src/core/pattern-validator.js')

    const denyRules = ['Read(**/.env.*)', 'Write(**/.env.*)']
    const issues = checkMissingPairedDenyRules(denyRules)

    // Should suggest Edit deny is missing
    const editSuggestion = issues.find(i =>
      i.message.includes('Edit') && i.details?.some(d => d.includes('.env'))
    )
    expect(editSuggestion).toBeDefined()
  })

  it('suggests adding Write deny when only Read deny exists', async () => {
    const { checkMissingPairedDenyRules } = await import('../src/core/pattern-validator.js')

    const denyRules = ['Read(**/.env)']
    const issues = checkMissingPairedDenyRules(denyRules)

    // Should mention Write or Edit
    const hasWriteOrEditSuggestion = issues.some(i =>
      i.message.includes('Edit') || i.message.includes('Write')
    )
    expect(hasWriteOrEditSuggestion).toBe(true)
  })
})

// ============================================================
// Regression: generated script is still valid bash after changes
// ============================================================
describe('Regression: script validity after gap fixes', () => {
  it('generated script is valid bash', () => {
    const script = generateEnforceScript(BALANCED_DENY)
    const tmpDir = mkdtempSync(join(tmpdir(), 'csg-gaps-'))
    const scriptPath = join(tmpDir, 'check.sh')
    writeFileSync(scriptPath, script, { mode: 0o755 })
    try {
      execSync(`bash -n "${scriptPath}"`, { encoding: 'utf-8' })
    } finally {
      try { unlinkSync(scriptPath) } catch {}
      try { rmdirSync(tmpDir) } catch {}
    }
  })

  it('generated script with only Read rules is valid bash', () => {
    const script = generateEnforceScript(['Read(**/.env)'])
    const tmpDir = mkdtempSync(join(tmpdir(), 'csg-gaps-'))
    const scriptPath = join(tmpDir, 'check.sh')
    writeFileSync(scriptPath, script, { mode: 0o755 })
    try {
      execSync(`bash -n "${scriptPath}"`, { encoding: 'utf-8' })
    } finally {
      try { unlinkSync(scriptPath) } catch {}
      try { rmdirSync(tmpDir) } catch {}
    }
  })
})
