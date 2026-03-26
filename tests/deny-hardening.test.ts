import { describe, it, expect } from 'vitest'
import { execSync } from 'node:child_process'
import { writeFileSync, unlinkSync, mkdtempSync, rmdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { generateEnforceScript } from '../src/core/hook-generator.js'
import { generateRecommendations } from '../src/core/telemetry-analyzer.js'
import { applyRecommendations } from '../src/core/recommendation-applier.js'
import { applyProfileToSettings } from '../src/core/profile-applicator.js'
import { balancedProfile } from '../src/profiles/balanced.js'
import { strictProfile } from '../src/profiles/strict.js'
import {
  DEFAULT_DENY_RULES,
  FILE_READ_COMMANDS,
  FILE_WRITE_COMMANDS,
  PREFIX_COMMANDS,
} from '../src/constants.js'
import type { ToolStats } from '../src/core/telemetry-analyzer.js'
import type { ClaudeSettings, Recommendation } from '../src/types.js'

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
  const tmpDir = mkdtempSync(join(tmpdir(), 'csg-deny-'))
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

function createStats(entries: Array<{ pattern: string; allowed: number; denied: number }>): ReadonlyMap<string, ToolStats> {
  const map = new Map<string, ToolStats>()
  for (const e of entries) {
    const tool = e.pattern.split('(')[0]
    map.set(e.pattern, { tool, pattern: e.pattern, allowed: e.allowed, denied: e.denied, prompted: 0 })
  }
  return map
}

// ============================================================
// C1: Recommendation engine cross-tool conflict validation
// ============================================================
describe('C1: Recommendation engine filters cross-tool bypass allow rules', () => {
  it('does NOT recommend Bash(cat *) when Read deny exists', () => {
    const stats = createStats([
      { pattern: 'Bash(cat *)', allowed: 10, denied: 0 },
    ])
    const existingAllow: string[] = []
    const existingDeny = ['Read(**/.env)']

    const recs = generateRecommendations(stats, existingAllow, existingDeny)
    const catRec = recs.find(r => r.pattern === 'Bash(cat *)')

    expect(catRec).toBeUndefined()
  })

  it('does NOT recommend Bash(head *) when Read deny exists', () => {
    const stats = createStats([
      { pattern: 'Bash(head *)', allowed: 5, denied: 0 },
    ])
    const recs = generateRecommendations(stats, [], ['Read(**/.env)'])
    expect(recs.find(r => r.pattern === 'Bash(head *)')).toBeUndefined()
  })

  it('does NOT recommend Bash(sed *) when Write or Edit deny exists', () => {
    const stats = createStats([
      { pattern: 'Bash(sed *)', allowed: 5, denied: 0 },
    ])
    const recs = generateRecommendations(stats, [], ['Write(**/.env)', 'Edit(**/.env)'])
    expect(recs.find(r => r.pattern === 'Bash(sed *)')).toBeUndefined()
  })

  it('does NOT recommend Bash(cp *) when Write deny exists', () => {
    const stats = createStats([
      { pattern: 'Bash(cp *)', allowed: 5, denied: 0 },
    ])
    const recs = generateRecommendations(stats, [], ['Write(**/.env)'])
    expect(recs.find(r => r.pattern === 'Bash(cp *)')).toBeUndefined()
  })

  it('still recommends Bash(npm *) when Read deny exists (npm is not a file read cmd)', () => {
    const stats = createStats([
      { pattern: 'Bash(npm *)', allowed: 10, denied: 0 },
    ])
    const recs = generateRecommendations(stats, [], ['Read(**/.env)'])
    const npmRec = recs.find(r => r.pattern === 'Bash(npm *)')
    expect(npmRec).toBeDefined()
  })

  it('does NOT recommend Bash(env *) when Bash deny rules exist (prefix bypass)', () => {
    const stats = createStats([
      { pattern: 'Bash(env *)', allowed: 5, denied: 0 },
    ])
    const recs = generateRecommendations(stats, [], ['Bash(sudo *)'])
    expect(recs.find(r => r.pattern === 'Bash(env *)')).toBeUndefined()
  })

  it('does NOT recommend Bash(command *) when Bash deny rules exist', () => {
    const stats = createStats([
      { pattern: 'Bash(command *)', allowed: 5, denied: 0 },
    ])
    const recs = generateRecommendations(stats, [], ['Bash(rm -rf /*)'])
    expect(recs.find(r => r.pattern === 'Bash(command *)')).toBeUndefined()
  })
})

// ============================================================
// C2: recommendation-applier deny-priority check
// ============================================================
describe('C2: recommendation-applier filters conflicting allow recommendations', () => {
  it('deny in recommendations takes precedence over allow', () => {
    const settings: ClaudeSettings = {}
    const recs: Recommendation[] = [
      { action: 'add-deny', pattern: 'Read(**/.env)', reason: 'test' },
      { action: 'add-allow', pattern: 'Read(**/.env)', reason: 'test' },
    ]
    const result = applyRecommendations(settings, recs)
    expect(result.finalDeny).toContain('Read(**/.env)')
    expect(result.finalAllow).not.toContain('Read(**/.env)')
  })

  it('allows non-conflicting allow rules through', () => {
    const settings: ClaudeSettings = {}
    const recs: Recommendation[] = [
      { action: 'add-deny', pattern: 'Read(**/.env)', reason: 'test' },
      { action: 'add-allow', pattern: 'Bash(npm *)', reason: 'test' },
    ]
    const result = applyRecommendations(settings, recs)
    expect(result.finalAllow).toContain('Bash(npm *)')
  })

  it('filters cross-tool conflicting allow (Bash(cat *) vs Read deny)', () => {
    const settings: ClaudeSettings = {}
    const recs: Recommendation[] = [
      { action: 'add-deny', pattern: 'Read(**/.env)', reason: 'test' },
      { action: 'add-allow', pattern: 'Bash(cat *)', reason: 'test' },
    ]
    const result = applyRecommendations(settings, recs)
    expect(result.finalAllow).not.toContain('Bash(cat *)')
  })
})

// ============================================================
// C3: Grep tool enforcement in hook
// ============================================================
describe('C3: Grep tool enforcement in Layer 2 hook', () => {
  const DENY_WITH_GREP = [
    'Read(**/.env)',
    'Grep(**/.env)',
    'Grep(**/secrets/**)',
  ]

  it('blocks Grep with file_path matching deny pattern', () => {
    const r = enforce(DENY_WITH_GREP, 'Grep', { pattern: 'API_KEY', path: '/app/.env' })
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('BLOCKED')
  })

  it('blocks Grep with path in secrets directory', () => {
    const r = enforce(DENY_WITH_GREP, 'Grep', { pattern: 'password', path: '/app/secrets/db.yml' })
    expect(r.code).toBe(2)
  })

  it('allows Grep on non-denied paths', () => {
    const r = enforce(DENY_WITH_GREP, 'Grep', { pattern: 'TODO', path: '/app/src/index.ts' })
    expect(r.code).toBe(0)
  })

  it('blocks Grep with case-insensitive path', () => {
    const r = enforce(DENY_WITH_GREP, 'Grep', { pattern: 'key', path: '/app/.ENV' })
    expect(r.code).toBe(2)
  })

  it('allows Grep on .env.example (safe suffix)', () => {
    const r = enforce(DENY_WITH_GREP, 'Grep', { pattern: 'key', path: '/app/.env.example' })
    expect(r.code).toBe(0)
  })

  it('generated script with Grep rules is valid bash', () => {
    const script = generateEnforceScript(DENY_WITH_GREP)
    const tmpDir = mkdtempSync(join(tmpdir(), 'csg-grep-'))
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
// H1: balanced profile has Write/Edit deny for .env
// ============================================================
describe('H1: balanced profile Write/Edit deny for .env', () => {
  it('includes Write(**/.env) in balanced deny', () => {
    expect(balancedProfile.deny).toContain('Write(**/.env)')
  })

  it('includes Edit(**/.env) in balanced deny', () => {
    expect(balancedProfile.deny).toContain('Edit(**/.env)')
  })

  it('includes Write(**/secrets/**) in balanced deny', () => {
    expect(balancedProfile.deny).toContain('Write(**/secrets/**)')
  })

  it('includes Edit(**/secrets/**) in balanced deny', () => {
    expect(balancedProfile.deny).toContain('Edit(**/secrets/**)')
  })
})

// ============================================================
// H2: strict profile has Edit(**/.env) deny
// ============================================================
describe('H2: strict profile Edit deny for .env', () => {
  it('includes Edit(**/.env) in strict deny', () => {
    expect(strictProfile.deny).toContain('Edit(**/.env)')
  })

  it('includes Edit(**/secrets/**) in strict deny', () => {
    expect(strictProfile.deny).toContain('Edit(**/secrets/**)')
  })

  it('includes Write(**/secrets/**) in strict deny', () => {
    expect(strictProfile.deny).toContain('Write(**/secrets/**)')
  })
})

// ============================================================
// H3: Profile applicator conflict warning
// ============================================================
describe('H3: Profile applicator returns conflict warnings', () => {
  it('auto-removes allow rules that conflict with deny (no conflicts reported)', () => {
    const settings: ClaudeSettings = {
      permissions: {
        allow: ['Read(**/.env)'],
        deny: [],
      },
    }
    const result = applyProfileToSettings(settings, balancedProfile)
    // Conflict is auto-resolved: Read(**/.env) removed from allow
    expect(result.settings.permissions!.allow).not.toContain('Read(**/.env)')
    expect(result.removedFromAllow).toBeGreaterThanOrEqual(1)
    // No unresolved conflicts remain
    expect(result.conflicts).toBeUndefined()
  })

  it('returns no conflicts for clean settings', () => {
    const settings: ClaudeSettings = {
      permissions: { allow: [], deny: [] },
    }
    const result = applyProfileToSettings(settings, balancedProfile)
    expect(result.conflicts ?? []).toHaveLength(0)
  })
})

// ============================================================
// H4: File-arg check strips quotes from arguments
// ============================================================
describe('H4: File-arg check strips quotes from Bash arguments', () => {
  const DENY_RULES = ['Read(**/.env)', 'Write(**/.env)', 'Edit(**/.env)']

  it('blocks: cat ".env" (double-quoted path)', () => {
    const r = enforce(DENY_RULES, 'Bash', { command: 'cat ".env"' })
    expect(r.code).toBe(2)
  })

  it("blocks: cat '.env' (single-quoted path)", () => {
    const r = enforce(DENY_RULES, 'Bash', { command: "cat '.env'" })
    expect(r.code).toBe(2)
  })

  it('blocks: cat "/app/.env" (quoted absolute path)', () => {
    const r = enforce(DENY_RULES, 'Bash', { command: 'cat "/app/.env"' })
    expect(r.code).toBe(2)
  })
})

// ============================================================
// M1: DEFAULT_DENY_RULES includes Grep deny
// ============================================================
describe('M1: DEFAULT_DENY_RULES includes Grep patterns', () => {
  it('includes Grep(**/.env)', () => {
    expect(DEFAULT_DENY_RULES).toContain('Grep(**/.env)')
  })

  it('includes Grep(**/.env.*)', () => {
    expect(DEFAULT_DENY_RULES).toContain('Grep(**/.env.*)')
  })

  it('includes Grep(**/secrets/**)', () => {
    expect(DEFAULT_DENY_RULES).toContain('Grep(**/secrets/**)')
  })
})

// ============================================================
// M2: Profiles include secrets Write/Edit deny
// ============================================================
describe('M2: Profiles include secrets Write/Edit deny', () => {
  it('strict profile has Write(**/secrets/**)', () => {
    expect(strictProfile.deny).toContain('Write(**/secrets/**)')
  })

  it('balanced profile has Write(**/secrets/**)', () => {
    expect(balancedProfile.deny).toContain('Write(**/secrets/**)')
  })
})

// ============================================================
// M3: --yes flag respects deny conflicts
// ============================================================
describe('M3: applyRecommendations never adds patterns that are in deny', () => {
  it('even with multiple recs, deny always wins', () => {
    const settings: ClaudeSettings = {}
    const recs: Recommendation[] = [
      { action: 'add-deny', pattern: 'Read(**/.env)', reason: 'deny' },
      { action: 'add-deny', pattern: 'Bash(sudo *)', reason: 'deny' },
      { action: 'add-allow', pattern: 'Read(**/.env)', reason: 'frequent' },
      { action: 'add-allow', pattern: 'Bash(sudo *)', reason: 'frequent' },
      { action: 'add-allow', pattern: 'Bash(npm *)', reason: 'frequent' },
    ]
    const result = applyRecommendations(settings, recs)

    expect(result.finalAllow).not.toContain('Read(**/.env)')
    expect(result.finalAllow).not.toContain('Bash(sudo *)')
    expect(result.finalAllow).toContain('Bash(npm *)')
  })
})

// ============================================================
// H1: FILE_READ/WRITE/PREFIX_COMMANDS centralized in constants
// ============================================================
describe('H1: Command sets exported from constants', () => {
  it('FILE_READ_COMMANDS is a ReadonlySet with known entries', () => {
    expect(FILE_READ_COMMANDS).toBeInstanceOf(Set)
    expect(FILE_READ_COMMANDS.has('cat')).toBe(true)
    expect(FILE_READ_COMMANDS.has('head')).toBe(true)
    expect(FILE_READ_COMMANDS.has('grep')).toBe(true)
    expect(FILE_READ_COMMANDS.has('sed')).toBe(true)
  })

  it('FILE_WRITE_COMMANDS is a ReadonlySet with known entries', () => {
    expect(FILE_WRITE_COMMANDS).toBeInstanceOf(Set)
    expect(FILE_WRITE_COMMANDS.has('sed')).toBe(true)
    expect(FILE_WRITE_COMMANDS.has('tee')).toBe(true)
    expect(FILE_WRITE_COMMANDS.has('cp')).toBe(true)
  })

  it('PREFIX_COMMANDS is a ReadonlySet with known entries', () => {
    expect(PREFIX_COMMANDS).toBeInstanceOf(Set)
    expect(PREFIX_COMMANDS.has('env')).toBe(true)
    expect(PREFIX_COMMANDS.has('command')).toBe(true)
    expect(PREFIX_COMMANDS.has('nohup')).toBe(true)
  })
})

// ============================================================
// H2: Grep hook checks glob parameter
// ============================================================
describe('H2: Grep hook checks glob parameter for deny bypass', () => {
  const DENY_RULES = ['Grep(**/.env)', 'Grep(**/secrets/**)']

  it('blocks Grep with glob matching deny pattern', () => {
    const r = enforce(DENY_RULES, 'Grep', { pattern: 'API_KEY', path: '.', glob: '**/.env' })
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('BLOCKED')
  })

  it('blocks Grep with glob matching secrets pattern', () => {
    const r = enforce(DENY_RULES, 'Grep', { pattern: 'password', path: '/app', glob: '**/secrets/**' })
    expect(r.code).toBe(2)
  })

  it('allows Grep with non-matching glob', () => {
    const r = enforce(DENY_RULES, 'Grep', { pattern: 'TODO', path: '.', glob: '**/*.ts' })
    expect(r.code).toBe(0)
  })

  it('blocks Grep even when path is safe but glob is denied', () => {
    const r = enforce(DENY_RULES, 'Grep', { pattern: 'key', path: '/app/src', glob: '**/.env' })
    expect(r.code).toBe(2)
  })
})

// ============================================================
// H3: checkMissingPairedDenyRules detects Read → Grep gap
// ============================================================
describe('H3: Missing paired Grep deny detection', () => {
  it('warns when Read deny exists without matching Grep deny', async () => {
    const { checkMissingPairedDenyRules } = await import('../src/core/pattern-validator.js')

    const denyRules = ['Read(**/.env)']
    const issues = checkMissingPairedDenyRules(denyRules)

    const grepIssue = issues.find(i =>
      i.code === 'MISSING_PAIRED_DENY' && i.message.includes('Grep')
    )
    expect(grepIssue).toBeDefined()
    expect(grepIssue!.details).toContain('Grep(**/.env)')
  })

  it('does NOT warn when Grep deny already exists', async () => {
    const { checkMissingPairedDenyRules } = await import('../src/core/pattern-validator.js')

    const denyRules = ['Read(**/.env)', 'Grep(**/.env)']
    const issues = checkMissingPairedDenyRules(denyRules)

    const grepIssue = issues.find(i =>
      i.code === 'MISSING_PAIRED_DENY' &&
      i.message.includes('Grep') &&
      (i.details ?? []).includes('Grep(**/.env)')
    )
    expect(grepIssue).toBeUndefined()
  })
})

// ============================================================
// M1: recommendation-applier blocks prefix commands
// ============================================================
describe('M1: recommendation-applier blocks prefix bypass allow rules', () => {
  it('does not add Bash(env *) when Bash deny is in recommendations', () => {
    const settings: ClaudeSettings = {}
    const recs: Recommendation[] = [
      { action: 'add-deny', pattern: 'Bash(sudo *)', reason: 'deny' },
      { action: 'add-allow', pattern: 'Bash(env *)', reason: 'frequent' },
    ]
    const result = applyRecommendations(settings, recs)
    expect(result.finalAllow).not.toContain('Bash(env *)')
  })

  it('does not add Bash(command *) when Bash deny is in recommendations', () => {
    const settings: ClaudeSettings = {}
    const recs: Recommendation[] = [
      { action: 'add-deny', pattern: 'Bash(rm -rf /*)', reason: 'deny' },
      { action: 'add-allow', pattern: 'Bash(command *)', reason: 'frequent' },
    ]
    const result = applyRecommendations(settings, recs)
    expect(result.finalAllow).not.toContain('Bash(command *)')
  })
})

// ============================================================
// M2: Grep deny rules included in Bash file-arg check
// ============================================================
describe('M2: Grep deny rules feed into Bash file-arg cross-tool check', () => {
  it('blocks cat .env when only Grep deny exists (no Read deny)', () => {
    const denyRules = ['Grep(**/.env)']
    const r = enforce(denyRules, 'Bash', { command: 'cat .env' })
    expect(r.code).toBe(2)
  })

  it('allows cat index.ts when only Grep deny exists', () => {
    const denyRules = ['Grep(**/.env)']
    const r = enforce(denyRules, 'Bash', { command: 'cat /app/src/index.ts' })
    expect(r.code).toBe(0)
  })
})

// ============================================================
// R3-H1: Grep deny included in cross-tool bypass detection
// ============================================================
describe('R3-H1: Grep deny triggers cross-tool bypass detection', () => {
  it('recommendation engine does NOT recommend Bash(grep *) when Grep deny exists', () => {
    const stats = createStats([
      { pattern: 'Bash(grep *)', allowed: 10, denied: 0 },
    ])
    const recs = generateRecommendations(stats, [], ['Grep(**/.env)'])
    expect(recs.find(r => r.pattern === 'Bash(grep *)')).toBeUndefined()
  })

  it('recommendation engine does NOT recommend Bash(cat *) when Grep deny exists', () => {
    const stats = createStats([
      { pattern: 'Bash(cat *)', allowed: 10, denied: 0 },
    ])
    const recs = generateRecommendations(stats, [], ['Grep(**/.env)'])
    expect(recs.find(r => r.pattern === 'Bash(cat *)')).toBeUndefined()
  })

  it('recommendation applier blocks Bash(cat *) when Grep deny is in recommendations', () => {
    const settings: ClaudeSettings = {}
    const recs: Recommendation[] = [
      { action: 'add-deny', pattern: 'Grep(**/.env)', reason: 'deny' },
      { action: 'add-allow', pattern: 'Bash(cat *)', reason: 'test' },
    ]
    const result = applyRecommendations(settings, recs)
    expect(result.finalAllow).not.toContain('Bash(cat *)')
  })

  it('diagnose checkCrossToolBypasses warns for Bash(cat *) vs Grep deny', async () => {
    const { checkCrossToolBypasses } = await import('../src/core/pattern-validator.js')
    const issues = checkCrossToolBypasses(['Bash(cat *)'], ['Grep(**/.env)'])
    expect(issues.length).toBeGreaterThan(0)
    expect(issues[0].code).toBe('CROSS_TOOL_BYPASS')
  })

  it('still allows Bash(npm *) when only Grep deny exists', () => {
    const stats = createStats([
      { pattern: 'Bash(npm *)', allowed: 10, denied: 0 },
    ])
    const recs = generateRecommendations(stats, [], ['Grep(**/.env)'])
    expect(recs.find(r => r.pattern === 'Bash(npm *)')).toBeDefined()
  })
})

// ============================================================
// R3-H2: PREFIX_COMMANDS includes all hook prefix commands
// ============================================================
describe('R3-H2: PREFIX_COMMANDS includes hook prefix commands', () => {
  const hookPrefixes = ['strace', 'ltrace', 'ionice', 'taskset', 'chrt']

  for (const cmd of hookPrefixes) {
    it(`includes ${cmd} in PREFIX_COMMANDS`, () => {
      expect(PREFIX_COMMANDS.has(cmd)).toBe(true)
    })
  }

  it('recommendation applier blocks Bash(strace *) when Bash deny is in recommendations', () => {
    const stats = createStats([
      { pattern: 'Bash(strace *)', allowed: 5, denied: 0 },
    ])
    const recs = generateRecommendations(stats, [], ['Bash(sudo *)'])
    expect(recs.find(r => r.pattern === 'Bash(strace *)')).toBeUndefined()
  })

  it('recommendation applier blocks Bash(strace *) when Bash deny exists', () => {
    const settings: ClaudeSettings = {}
    const recs: Recommendation[] = [
      { action: 'add-deny', pattern: 'Bash(sudo *)', reason: 'deny' },
      { action: 'add-allow', pattern: 'Bash(strace *)', reason: 'test' },
    ]
    const result = applyRecommendations(settings, recs)
    expect(result.finalAllow).not.toContain('Bash(strace *)')
  })
})

// ============================================================
// R3-M1: Profile applicator detects cross-tool conflicts
// ============================================================
describe('R3-M1: Profile applicator detects cross-tool conflicts', () => {
  it('detects Bash(cat *) in allow vs Read deny from profile', () => {
    const settings: ClaudeSettings = {
      permissions: { allow: ['Bash(cat *)'], deny: [] },
    }
    const result = applyProfileToSettings(settings, balancedProfile)
    expect(result.crossToolConflicts).toBeDefined()
    expect(result.crossToolConflicts!.length).toBeGreaterThan(0)
    expect(result.crossToolConflicts!.some(c => c.includes('cat'))).toBe(true)
  })

  it('no cross-tool conflicts for clean settings', () => {
    const settings: ClaudeSettings = {
      permissions: { allow: ['Bash(npm *)'], deny: [] },
    }
    const result = applyProfileToSettings(settings, balancedProfile)
    expect(result.crossToolConflicts ?? []).toHaveLength(0)
  })

  it('detects Bash(sed *) vs Write deny as cross-tool conflict', () => {
    const settings: ClaudeSettings = {
      permissions: { allow: ['Bash(sed *)'], deny: [] },
    }
    const result = applyProfileToSettings(settings, balancedProfile)
    expect(result.crossToolConflicts).toBeDefined()
    expect(result.crossToolConflicts!.some(c => c.includes('sed'))).toBe(true)
  })
})
