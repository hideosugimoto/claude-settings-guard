import { describe, it, expect } from 'vitest'
import { execSync } from 'node:child_process'
import { writeFileSync, unlinkSync, mkdtempSync, rmdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { generateEnforceScript } from '../src/core/hook-generator.js'

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
  const tmpDir = mkdtempSync(join(tmpdir(), 'csg-cross-'))
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

function enforce(
  denyRules: readonly string[],
  toolName: string,
  toolInput: Record<string, unknown>,
): ScriptResult {
  return executeHook(generateEnforceScript(denyRules), toolName, toolInput)
}

// ============================================================
// ISSUE 1: Cross-tool bypass detection in diagnose
// ============================================================
describe('ISSUE 1: Cross-tool bypass detection in diagnose', () => {
  it('warns when Read deny exists and Bash(cat *) is allowed', async () => {
    const { checkCrossToolBypasses } = await import('../src/core/pattern-validator.js')

    const allowRules = ['Bash(cat *)', 'Bash(npm *)']
    const denyRules = ['Read(**/.env)', 'Read(**/secrets/**)']
    const issues = checkCrossToolBypasses(allowRules, denyRules)

    expect(issues.length).toBeGreaterThan(0)
    expect(issues[0].severity).toBe('warning')
    expect(issues[0].code).toBe('CROSS_TOOL_BYPASS')
  })

  it('warns for head/tail/less/more/grep/sed/awk/strings against Read deny', async () => {
    const { checkCrossToolBypasses } = await import('../src/core/pattern-validator.js')

    const readCommands = ['head', 'tail', 'less', 'more', 'grep', 'sed', 'awk', 'strings']

    for (const cmd of readCommands) {
      const allowRules = [`Bash(${cmd} *)`]
      const denyRules = ['Read(**/.env)']
      const issues = checkCrossToolBypasses(allowRules, denyRules)

      expect(issues.length).toBeGreaterThan(0, `Expected warning for ${cmd}`)
      expect(issues[0].code).toBe('CROSS_TOOL_BYPASS')
    }
  })

  it('warns for cp/mv/tee against Write deny', async () => {
    const { checkCrossToolBypasses } = await import('../src/core/pattern-validator.js')

    const writeCommands = ['cp', 'mv', 'tee']

    for (const cmd of writeCommands) {
      const allowRules = [`Bash(${cmd} *)`]
      const denyRules = ['Write(**/.env)']
      const issues = checkCrossToolBypasses(allowRules, denyRules)

      expect(issues.length).toBeGreaterThan(0, `Expected warning for ${cmd}`)
      expect(issues[0].code).toBe('CROSS_TOOL_BYPASS')
    }
  })

  it('warns for sed against Edit deny', async () => {
    const { checkCrossToolBypasses } = await import('../src/core/pattern-validator.js')

    const allowRules = ['Bash(sed *)']
    const denyRules = ['Edit(**/.env)']
    const issues = checkCrossToolBypasses(allowRules, denyRules)

    expect(issues.length).toBeGreaterThan(0)
    expect(issues[0].code).toBe('CROSS_TOOL_BYPASS')
  })

  it('does NOT warn when no file-based deny rules exist', async () => {
    const { checkCrossToolBypasses } = await import('../src/core/pattern-validator.js')

    const allowRules = ['Bash(cat *)']
    const denyRules = ['Bash(sudo *)']
    const issues = checkCrossToolBypasses(allowRules, denyRules)

    expect(issues.length).toBe(0)
  })

  it('does NOT warn when no Bash allow rules exist', async () => {
    const { checkCrossToolBypasses } = await import('../src/core/pattern-validator.js')

    const allowRules = ['Read(**/src/**)', 'Write(**/src/**)']
    const denyRules = ['Read(**/.env)']
    const issues = checkCrossToolBypasses(allowRules, denyRules)

    expect(issues.length).toBe(0)
  })

  it('includes the file pattern in the issue message or details', async () => {
    const { checkCrossToolBypasses } = await import('../src/core/pattern-validator.js')

    const allowRules = ['Bash(cat *)']
    const denyRules = ['Read(**/.env)']
    const issues = checkCrossToolBypasses(allowRules, denyRules)

    expect(issues.length).toBeGreaterThan(0)
    const issue = issues[0]
    const allText = `${issue.message} ${(issue.details ?? []).join(' ')}`
    expect(allText).toContain('cat')
  })
})

// ============================================================
// ISSUE 2: Layer 2 Bash file-path argument inspection
// ============================================================
describe('ISSUE 2: Layer 2 Bash file-path argument inspection', () => {
  const FILE_DENY_RULES = [
    'Read(**/.env)',
    'Read(**/.env.*)',
    'Read(**/secrets/**)',
    'Write(**/.env)',
    'Edit(**/.env)',
  ] as const

  it('blocks: cat .env (simple file read bypass)', () => {
    const r = enforce(FILE_DENY_RULES, 'Bash', { command: 'cat .env' })
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('BLOCKED')
  })

  it('blocks: head /app/.env', () => {
    const r = enforce(FILE_DENY_RULES, 'Bash', { command: 'head /app/.env' })
    expect(r.code).toBe(2)
  })

  it('blocks: tail -f /app/secrets/api.key', () => {
    const r = enforce(FILE_DENY_RULES, 'Bash', { command: 'tail -f /app/secrets/api.key' })
    expect(r.code).toBe(2)
  })

  it('blocks: grep password /app/.env', () => {
    const r = enforce(FILE_DENY_RULES, 'Bash', { command: 'grep password /app/.env' })
    expect(r.code).toBe(2)
  })

  it('blocks: cat ./.env (relative path)', () => {
    const r = enforce(FILE_DENY_RULES, 'Bash', { command: 'cat ./.env' })
    expect(r.code).toBe(2)
  })

  it('blocks: cat ../.env (parent relative path)', () => {
    const r = enforce(FILE_DENY_RULES, 'Bash', { command: 'cat ../.env' })
    expect(r.code).toBe(2)
  })

  it('blocks: cat /app/.env.local (matches .env.*)', () => {
    const r = enforce(FILE_DENY_RULES, 'Bash', { command: 'cat /app/.env.local' })
    expect(r.code).toBe(2)
  })

  it('allows: cat /app/.env.example (safe env suffix)', () => {
    const r = enforce(FILE_DENY_RULES, 'Bash', { command: 'cat /app/.env.example' })
    expect(r.code).toBe(0)
  })

  it('allows: cat /app/.env.sample (safe env suffix)', () => {
    const r = enforce(FILE_DENY_RULES, 'Bash', { command: 'cat /app/.env.sample' })
    expect(r.code).toBe(0)
  })

  it('allows: cat /app/src/index.ts (normal file)', () => {
    const r = enforce(FILE_DENY_RULES, 'Bash', { command: 'cat /app/src/index.ts' })
    expect(r.code).toBe(0)
  })

  it('allows: cat package.json (no path-like, not denied)', () => {
    const r = enforce(FILE_DENY_RULES, 'Bash', { command: 'cat package.json' })
    expect(r.code).toBe(0)
  })

  it('blocks: cat in compound command: ls && cat .env', () => {
    const r = enforce(FILE_DENY_RULES, 'Bash', { command: 'ls && cat .env' })
    expect(r.code).toBe(2)
  })

  it('blocks: cat with pipe: cat /app/.env | grep API', () => {
    const r = enforce(FILE_DENY_RULES, 'Bash', { command: 'cat /app/.env | grep API' })
    expect(r.code).toBe(2)
  })

  it('still blocks existing Bash deny rules', () => {
    const rules = ['Bash(sudo *)', ...FILE_DENY_RULES]
    const r = enforce(rules, 'Bash', { command: 'sudo rm -rf /' })
    expect(r.code).toBe(2)
  })

  it('still allows normal Bash commands', () => {
    const r = enforce(FILE_DENY_RULES, 'Bash', { command: 'npm install' })
    expect(r.code).toBe(0)
  })

  it('generated script is valid bash', () => {
    const script = generateEnforceScript([...FILE_DENY_RULES])
    const tmpDir = mkdtempSync(join(tmpdir(), 'csg-cross-'))
    const scriptPath = join(tmpDir, 'check.sh')
    writeFileSync(scriptPath, script, { mode: 0o755 })
    try {
      execSync(`bash -n "${scriptPath}"`, { encoding: 'utf-8' })
    } finally {
      try { unlinkSync(scriptPath) } catch {}
      try { rmdirSync(tmpDir) } catch {}
    }
  })

  it('generated script with mixed rules is valid bash', () => {
    const script = generateEnforceScript(['Bash(sudo *)', 'Read(**/.env)', 'Write(**/.env)'])
    const tmpDir = mkdtempSync(join(tmpdir(), 'csg-cross-'))
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

// ============================================================
// ISSUE 3: Prefix bypass detection in diagnose
// ============================================================
describe('ISSUE 3: Prefix bypass detection in diagnose', () => {
  it('warns when Bash(env *) is allowed and Bash deny rules exist', async () => {
    const { checkPrefixBypasses } = await import('../src/core/pattern-validator.js')

    const allowRules = ['Bash(env *)']
    const denyRules = ['Bash(sudo *)']
    const issues = checkPrefixBypasses(allowRules, denyRules)

    expect(issues.length).toBeGreaterThan(0)
    expect(issues[0].severity).toBe('info')
    expect(issues[0].code).toBe('PREFIX_BYPASS_RISK')
  })

  it('warns for all known prefix commands: env, command, nice, nohup, builtin, time', async () => {
    const { checkPrefixBypasses } = await import('../src/core/pattern-validator.js')

    const prefixCmds = ['env', 'command', 'nice', 'nohup', 'builtin', 'time']

    for (const prefix of prefixCmds) {
      const allowRules = [`Bash(${prefix} *)`]
      const denyRules = ['Bash(sudo *)']
      const issues = checkPrefixBypasses(allowRules, denyRules)

      expect(issues.length).toBeGreaterThan(0, `Expected warning for ${prefix}`)
      expect(issues[0].code).toBe('PREFIX_BYPASS_RISK')
    }
  })

  it('does NOT warn when no Bash deny rules exist', async () => {
    const { checkPrefixBypasses } = await import('../src/core/pattern-validator.js')

    const allowRules = ['Bash(env *)']
    const denyRules = ['Read(**/.env)']
    const issues = checkPrefixBypasses(allowRules, denyRules)

    expect(issues.length).toBe(0)
  })

  it('does NOT warn when no prefix command is in allow', async () => {
    const { checkPrefixBypasses } = await import('../src/core/pattern-validator.js')

    const allowRules = ['Bash(npm *)', 'Bash(cat *)']
    const denyRules = ['Bash(sudo *)']
    const issues = checkPrefixBypasses(allowRules, denyRules)

    expect(issues.length).toBe(0)
  })

  it('mentions Layer 2 mitigation in the issue message or fix', async () => {
    const { checkPrefixBypasses } = await import('../src/core/pattern-validator.js')

    const allowRules = ['Bash(env *)']
    const denyRules = ['Bash(sudo *)']
    const issues = checkPrefixBypasses(allowRules, denyRules)

    expect(issues.length).toBeGreaterThan(0)
    const issue = issues[0]
    const allText = `${issue.message} ${issue.fix ?? ''}`
    expect(allText).toMatch(/[Ll]ayer\s*2|enforce/)
  })
})
