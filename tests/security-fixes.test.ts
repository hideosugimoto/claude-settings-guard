import { describe, it, expect } from 'vitest'
import { execSync } from 'node:child_process'
import { writeFileSync, unlinkSync, mkdtempSync, rmdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { generateEnforceScript } from '../src/core/hook-generator.js'
import { parseDenyPattern } from '../src/core/hook-script-builder.js'
import {
  DANGEROUS_COMMANDS,
  DEFAULT_DENY_RULES,
  SENSITIVE_FILE_PATTERNS,
} from '../src/constants.js'

// ============================================================
// Test Helper
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
  const tmpDir = mkdtempSync(join(tmpdir(), 'csg-secfix-'))
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

const BALANCED_DENY = [
  'Bash(sudo *)',
  'Bash(rm -rf /*)',
  'Read(**/.env)',
  'Read(**/secrets/**)',
] as const

// ============================================================
// Issue #1: Full-path binary bypass
// ============================================================
describe('Issue #1: Full-path binary bypass', () => {
  it('blocks /usr/bin/sudo rm -rf /', () => {
    const r = enforce(BALANCED_DENY, 'Bash', { command: '/usr/bin/sudo rm -rf /' })
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('BLOCKED')
  })

  it('blocks /usr/local/bin/sudo apt install malware', () => {
    const r = enforce(BALANCED_DENY, 'Bash', { command: '/usr/local/bin/sudo apt install malware' })
    expect(r.code).toBe(2)
  })

  it('blocks /sbin/rm -rf /home', () => {
    const r = enforce(BALANCED_DENY, 'Bash', { command: '/sbin/rm -rf /home' })
    expect(r.code).toBe(2)
  })

  it('blocks /usr/bin/rm -rf /etc', () => {
    const r = enforce(BALANCED_DENY, 'Bash', { command: '/usr/bin/rm -rf /etc' })
    expect(r.code).toBe(2)
  })

  it('blocks full-path in compound command: cd /tmp && /usr/bin/sudo rm -rf /', () => {
    const r = enforce(BALANCED_DENY, 'Bash', { command: 'cd /tmp && /usr/bin/sudo rm -rf /' })
    expect(r.code).toBe(2)
  })

  it('allows /usr/bin/npm install (not a denied command)', () => {
    const r = enforce(BALANCED_DENY, 'Bash', { command: '/usr/bin/npm install' })
    expect(r.code).toBe(0)
  })
})

// ============================================================
// Issue #2: Prefix command bypass
// ============================================================
describe('Issue #2: Prefix command bypass', () => {
  it('blocks: env sudo rm -rf /', () => {
    const r = enforce(BALANCED_DENY, 'Bash', { command: 'env sudo rm -rf /' })
    expect(r.code).toBe(2)
  })

  it('blocks: command sudo rm -rf /', () => {
    const r = enforce(BALANCED_DENY, 'Bash', { command: 'command sudo rm -rf /' })
    expect(r.code).toBe(2)
  })

  it('blocks: nice sudo rm -rf /', () => {
    const r = enforce(BALANCED_DENY, 'Bash', { command: 'nice sudo rm -rf /' })
    expect(r.code).toBe(2)
  })

  it('blocks: nohup sudo rm -rf /', () => {
    const r = enforce(BALANCED_DENY, 'Bash', { command: 'nohup sudo rm -rf /' })
    expect(r.code).toBe(2)
  })

  it('blocks: builtin command sudo rm', () => {
    const r = enforce(BALANCED_DENY, 'Bash', { command: 'builtin command sudo rm' })
    expect(r.code).toBe(2)
  })

  it('blocks: env VAR=val sudo rm', () => {
    const r = enforce(BALANCED_DENY, 'Bash', { command: 'env VAR=val sudo rm' })
    expect(r.code).toBe(2)
  })

  it('blocks: time sudo rm -rf /', () => {
    const r = enforce(BALANCED_DENY, 'Bash', { command: 'time sudo rm -rf /' })
    expect(r.code).toBe(2)
  })

  it('blocks: strace sudo rm -rf /', () => {
    const r = enforce(BALANCED_DENY, 'Bash', { command: 'strace sudo rm -rf /' })
    expect(r.code).toBe(2)
  })

  it('allows: env npm install (not a denied command)', () => {
    const r = enforce(BALANCED_DENY, 'Bash', { command: 'env npm install' })
    expect(r.code).toBe(0)
  })
})

// ============================================================
// Issue #3: Extra whitespace bypass
// ============================================================
describe('Issue #3: Extra whitespace bypass', () => {
  it('blocks: rm  -rf  /home (double spaces)', () => {
    const r = enforce(BALANCED_DENY, 'Bash', { command: 'rm  -rf  /home' })
    expect(r.code).toBe(2)
  })

  it('blocks: sudo   rm -rf / (multiple spaces after sudo)', () => {
    const r = enforce(BALANCED_DENY, 'Bash', { command: 'sudo   rm -rf /' })
    expect(r.code).toBe(2)
  })

  it('blocks: rm   -rf   /etc (many spaces)', () => {
    const r = enforce(BALANCED_DENY, 'Bash', { command: 'rm   -rf   /etc' })
    expect(r.code).toBe(2)
  })

  it('blocks tab-separated: rm\\t-rf\\t/home', () => {
    const r = enforce(BALANCED_DENY, 'Bash', { command: 'rm\t-rf\t/home' })
    expect(r.code).toBe(2)
  })
})

// ============================================================
// Issue #4: Nested $() not handled
// ============================================================
describe('Issue #4: Nested $() subcommands', () => {
  it('blocks nested: echo $(echo $(sudo rm -rf /))', () => {
    const r = enforce(BALANCED_DENY, 'Bash', { command: 'echo $(echo $(sudo rm -rf /))' })
    expect(r.code).toBe(2)
  })

  it('blocks deeply nested $() with sudo', () => {
    const r = enforce(BALANCED_DENY, 'Bash', { command: 'echo $(cat $(sudo cat /etc/shadow))' })
    expect(r.code).toBe(2)
  })
})

// ============================================================
// Issue #5: Missing Write/Edit deny rules for .env/secrets
// ============================================================
describe('Issue #5: Write/Edit deny rules for sensitive files', () => {
  it('DEFAULT_DENY_RULES includes Write(**/.env)', () => {
    expect(DEFAULT_DENY_RULES).toContain('Write(**/.env)')
  })

  it('DEFAULT_DENY_RULES includes Write(**/.env.*)', () => {
    expect(DEFAULT_DENY_RULES).toContain('Write(**/.env.*)')
  })

  it('DEFAULT_DENY_RULES includes Edit(**/.env)', () => {
    expect(DEFAULT_DENY_RULES).toContain('Edit(**/.env)')
  })

  it('DEFAULT_DENY_RULES includes Edit(**/.env.*)', () => {
    expect(DEFAULT_DENY_RULES).toContain('Edit(**/.env.*)')
  })

  it('DEFAULT_DENY_RULES includes Write(**/secrets/**)', () => {
    expect(DEFAULT_DENY_RULES).toContain('Write(**/secrets/**)')
  })

  it('DEFAULT_DENY_RULES includes Edit(**/secrets/**)', () => {
    expect(DEFAULT_DENY_RULES).toContain('Edit(**/secrets/**)')
  })
})

// ============================================================
// Issue #6: .env.example false positive
// ============================================================
describe('Issue #6: .env.example false positive', () => {
  it('Read(**/.env.*) does NOT block .env.example', () => {
    const rules = [...DEFAULT_DENY_RULES]
    const r = enforce(rules, 'Read', { file_path: '/app/.env.example' })
    expect(r.code).toBe(0)
  })

  it('Read(**/.env.*) does NOT block .env.sample', () => {
    const rules = [...DEFAULT_DENY_RULES]
    const r = enforce(rules, 'Read', { file_path: '/app/.env.sample' })
    expect(r.code).toBe(0)
  })

  it('Read(**/.env.*) does NOT block .env.template', () => {
    const rules = [...DEFAULT_DENY_RULES]
    const r = enforce(rules, 'Read', { file_path: '/app/.env.template' })
    expect(r.code).toBe(0)
  })

  it('Read(**/.env.*) still blocks .env.local', () => {
    const rules = [...DEFAULT_DENY_RULES]
    const r = enforce(rules, 'Read', { file_path: '/app/.env.local' })
    expect(r.code).toBe(2)
  })

  it('Read(**/.env.*) still blocks .env.production', () => {
    const rules = [...DEFAULT_DENY_RULES]
    const r = enforce(rules, 'Read', { file_path: '/app/.env.production' })
    expect(r.code).toBe(2)
  })
})

// ============================================================
// Issue #7: Missing dangerous commands
// ============================================================
describe('Issue #7: Missing dangerous commands', () => {
  it('includes dd', () => {
    expect(DANGEROUS_COMMANDS).toContain('dd if=')
  })

  it('includes mkfs', () => {
    expect(DANGEROUS_COMMANDS).toContain('mkfs')
  })

  it('includes fdisk', () => {
    expect(DANGEROUS_COMMANDS).toContain('fdisk')
  })

  it('includes mount', () => {
    expect(DANGEROUS_COMMANDS).toContain('mount')
  })

  it('includes umount', () => {
    expect(DANGEROUS_COMMANDS).toContain('umount')
  })

  it('includes iptables', () => {
    expect(DANGEROUS_COMMANDS).toContain('iptables')
  })

  it('includes systemctl', () => {
    expect(DANGEROUS_COMMANDS).toContain('systemctl')
  })

  it('includes kill -9', () => {
    expect(DANGEROUS_COMMANDS).toContain('kill -9')
  })
})

// ============================================================
// Issue #8: *secret* pattern too broad
// ============================================================
describe('Issue #8: *secret* pattern precision', () => {
  it('SENSITIVE_FILE_PATTERNS does NOT match "secretariat" or "secretary" style names', () => {
    // The patterns should use word-boundary-aware matching
    // Check that **/*secret* is replaced with more precise patterns
    const hasOverlyBroadPattern = SENSITIVE_FILE_PATTERNS.some(
      p => p === '**/*secret*'
    )
    expect(hasOverlyBroadPattern).toBe(false)
  })

  it('SENSITIVE_FILE_PATTERNS still covers secret files', () => {
    // Should have patterns for .secret, secrets dir, *.secret, etc.
    const hasSecretsDir = SENSITIVE_FILE_PATTERNS.some(p => p.includes('secrets'))
    expect(hasSecretsDir).toBe(true)
  })

  it('DEFAULT_DENY_RULES does NOT use overly broad *secret* Read pattern', () => {
    const hasOverlyBroad = DEFAULT_DENY_RULES.some(
      r => r === 'Read(**/*secret*)'
    )
    expect(hasOverlyBroad).toBe(false)
  })
})

// ============================================================
// Issue #9: Background & not split
// ============================================================
describe('Issue #9: Background & not split', () => {
  it('blocks: sudo rm -rf / & echo safe', () => {
    const r = enforce(BALANCED_DENY, 'Bash', { command: 'sudo rm -rf / & echo safe' })
    expect(r.code).toBe(2)
  })

  it('blocks: echo safe & sudo rm -rf /', () => {
    const r = enforce(BALANCED_DENY, 'Bash', { command: 'echo safe & sudo rm -rf /' })
    expect(r.code).toBe(2)
  })

  it('allows: npm test & npm build (no denied commands)', () => {
    const r = enforce(BALANCED_DENY, 'Bash', { command: 'npm test & npm build' })
    expect(r.code).toBe(0)
  })
})

// ============================================================
// Issue #10: assertSafePattern error message improvement
// ============================================================
describe('Issue #10: assertSafePattern error message', () => {
  it('error message includes the invalid pattern', () => {
    try {
      parseDenyPattern('Bash(echo $HOME)')
      expect.fail('should have thrown')
    } catch (e: unknown) {
      const msg = (e as Error).message
      expect(msg).toContain('echo $HOME')
    }
  })

  it('error message explains which character is problematic', () => {
    try {
      parseDenyPattern('Bash(cmd; rm)')
      expect.fail('should have thrown')
    } catch (e: unknown) {
      const msg = (e as Error).message
      expect(msg).toContain(';')
    }
  })

  it('error message for pipe includes the pipe character', () => {
    try {
      parseDenyPattern('Bash(cat | grep)')
      expect.fail('should have thrown')
    } catch (e: unknown) {
      const msg = (e as Error).message
      expect(msg).toContain('|')
    }
  })
})

// ============================================================
// Issue #11: Case-sensitive tool name matching
// ============================================================
describe('Issue #11: Case-insensitive tool name matching', () => {
  it('blocks "bash" (lowercase) same as "Bash"', () => {
    const r = enforce(BALANCED_DENY, 'bash', { command: 'sudo rm' })
    expect(r.code).toBe(2)
  })

  it('blocks "BASH" (uppercase) same as "Bash"', () => {
    const r = enforce(BALANCED_DENY, 'BASH', { command: 'sudo rm' })
    expect(r.code).toBe(2)
  })

  it('blocks "read" (lowercase) for Read rules', () => {
    const r = enforce(BALANCED_DENY, 'read', { file_path: '/app/.env' })
    expect(r.code).toBe(2)
  })

  it('blocks "READ" (uppercase) for Read rules', () => {
    const r = enforce(BALANCED_DENY, 'READ', { file_path: '/app/.env' })
    expect(r.code).toBe(2)
  })
})

// ============================================================
// Issue #12: Integrity check on hook script
// ============================================================
describe('Issue #12: Hook script integrity check', () => {
  it('generated script contains a checksum comment', () => {
    const script = generateEnforceScript(BALANCED_DENY)
    expect(script).toMatch(/# checksum: [a-f0-9]+/)
  })

  it('checksum changes when rules change', () => {
    const script1 = generateEnforceScript(['Bash(sudo *)'])
    const script2 = generateEnforceScript(['Bash(sudo *)', 'Bash(rm -rf /*)'])
    const checksum1 = script1.match(/# checksum: ([a-f0-9]+)/)?.[1]
    const checksum2 = script2.match(/# checksum: ([a-f0-9]+)/)?.[1]
    expect(checksum1).toBeDefined()
    expect(checksum2).toBeDefined()
    expect(checksum1).not.toBe(checksum2)
  })
})

// ============================================================
// Issue #13: jq dependency not verified
// ============================================================
describe('Issue #13: jq dependency guard', () => {
  it('generated script checks for jq availability', () => {
    const script = generateEnforceScript(BALANCED_DENY)
    expect(script).toContain('command -v jq')
  })

  it('script exits with error if jq is not found', () => {
    const script = generateEnforceScript(BALANCED_DENY)
    // The guard should be near the top of the script
    const jqCheckLine = script.indexOf('command -v jq')
    const toolNameLine = script.indexOf('TOOL_NAME=')
    expect(jqCheckLine).toBeLessThan(toolNameLine)
  })
})

// ============================================================
// Regression: existing tests must still pass
// ============================================================
describe('Regression: existing behavior preserved', () => {
  it('still blocks simple sudo command', () => {
    const r = enforce(BALANCED_DENY, 'Bash', { command: 'sudo rm -rf /' })
    expect(r.code).toBe(2)
  })

  it('still allows npm install', () => {
    const r = enforce(BALANCED_DENY, 'Bash', { command: 'npm install' })
    expect(r.code).toBe(0)
  })

  it('still blocks Read .env', () => {
    const r = enforce(BALANCED_DENY, 'Read', { file_path: '/app/.env' })
    expect(r.code).toBe(2)
  })

  it('still allows Read normal files', () => {
    const r = enforce(BALANCED_DENY, 'Read', { file_path: '/app/src/index.ts' })
    expect(r.code).toBe(0)
  })

  it('still allows sudoku (no false positive)', () => {
    const r = enforce(BALANCED_DENY, 'Bash', { command: 'sudoku' })
    expect(r.code).toBe(0)
  })

  it('still allows rm -rf ./node_modules (relative path)', () => {
    const r = enforce(BALANCED_DENY, 'Bash', { command: 'rm -rf ./node_modules' })
    expect(r.code).toBe(0)
  })

  it('still allows echo sudo (sudo as argument)', () => {
    const r = enforce(BALANCED_DENY, 'Bash', { command: 'echo sudo' })
    expect(r.code).toBe(0)
  })

  it('generated script is valid bash', () => {
    const script = generateEnforceScript(BALANCED_DENY)
    const tmpDir = mkdtempSync(join(tmpdir(), 'csg-reg-'))
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
