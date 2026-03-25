import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readGlobalSettings } from '../core/settings-reader.js'
import { writeSettings } from '../core/settings-writer.js'
import { extractManagedRules, saveManagedRules, loadManagedRules, getCsgRulesPath } from '../core/automode-switch.js'
import { getGlobalSettingsPath } from '../utils/paths.js'
import { printSuccess, printWarning, printError } from '../utils/display.js'
import type { ClaudeSettings } from '../types.js'
import type { CsgManagedRules } from '../core/automode-switch.js'

/**
 * Probe whether AutoMode is actually available on the current account.
 * Runs a short `claude --permission-mode auto --print` and checks stderr
 * for the "auto mode" banner that only appears on Team/Enterprise plans.
 */
function probeAutoMode(): boolean {
  const result = spawnSync('claude', ['--permission-mode', 'auto', '--print', 'ok'], {
    input: '',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 30_000,
  })
  const stderr = result.stderr?.toString() ?? ''
  return /auto\s*mode/i.test(stderr)
}

/**
 * Remove CSG-managed rules from settings, preserving user-added rules.
 */
function removeManagedRules(settings: ClaudeSettings, rules: CsgManagedRules): ClaudeSettings {
  const denySet = new Set(rules.deny)
  const allowSet = new Set(rules.allow)
  const askSet = new Set(rules.ask)

  const keptDeny = (settings.permissions?.deny ?? []).filter(r => !denySet.has(r))
  const keptAllow = (settings.permissions?.allow ?? []).filter(r => !allowSet.has(r))
  const keptAsk = (settings.permissions?.ask ?? []).filter(r => !askSet.has(r))

  // Destructure original deny/allow/ask out to prevent them from leaking
  // through the spread when keptXxx is empty
  const { deny: _d, allow: _a, ask: _k, ...restPermissions } = settings.permissions ?? {}

  return {
    ...settings,
    permissions: {
      ...restPermissions,
      ...(keptDeny.length > 0 ? { deny: keptDeny } : {}),
      ...(keptAllow.length > 0 ? { allow: keptAllow } : {}),
      ...(keptAsk.length > 0 ? { ask: keptAsk } : {}),
    },
  }
}

/**
 * Restore CSG-managed rules into settings, deduplicating.
 */
function restoreManagedRules(settings: ClaudeSettings, rules: CsgManagedRules): ClaudeSettings {
  const mergeUnique = (existing: readonly string[], added: readonly string[]): string[] =>
    [...new Set([...existing, ...added])].sort()

  return {
    ...settings,
    permissions: {
      ...settings.permissions,
      deny: mergeUnique(settings.permissions?.deny ?? [], rules.deny),
      allow: mergeUnique(settings.permissions?.allow ?? [], rules.allow),
      ask: mergeUnique(settings.permissions?.ask ?? [], rules.ask),
    },
  }
}

async function restore(): Promise<void> {
  const rules = await loadManagedRules()
  if (!rules) return

  const current = await readGlobalSettings()
  if (!current) return

  const restored = restoreManagedRules(current, rules)
  const result = await writeSettings(getGlobalSettingsPath(), restored, { skipBackup: true })
  if (result.success) {
    printSuccess('csg ルールを復元しました')
  }
}

export async function autoCommand(args: readonly string[]): Promise<void> {
  // Check if AutoMode is available on the current account
  process.stdout.write('AutoMode の利用可否を確認中...\n')
  if (!probeAutoMode()) {
    printError('AutoMode はこのアカウントでは利用できません。')
    printError('AutoMode には Team または Enterprise プランが必要です。')
    printError('詳細: https://docs.anthropic.com/en/docs/claude-code/auto-mode')
    process.exit(1)
  }

  // Check if another csg auto session is already running (csg-rules.json exists).
  // If so, skip rule extraction — rules are already backed up and removed.
  const alreadyRunning = existsSync(getCsgRulesPath())

  const settings = await readGlobalSettings()
  if (!settings) {
    printError('settings.json が見つかりません。先に csg setup を実行してください。')
    process.exit(1)
  }

  // Extract and save managed rules for later restoration
  let hasRules = false
  if (alreadyRunning) {
    printWarning('別の csg auto セッションが実行中です。ルール退避をスキップします。')
  } else {
    const rules = extractManagedRules(settings)
    hasRules = rules.deny.length > 0 || rules.allow.length > 0 || rules.ask.length > 0

    if (hasRules) {
      await saveManagedRules(rules)
      const cleaned = removeManagedRules(settings, rules)
      const writeResult = await writeSettings(getGlobalSettingsPath(), cleaned, { skipBackup: true })
      if (!writeResult.success) {
        printError(`settings.json の書き込みに失敗: ${writeResult.error}`)
        process.exit(1)
      }
      printSuccess(`csg ルールを一時解除 (deny:${rules.deny.length} allow:${rules.allow.length} ask:${rules.ask.length})`)
    } else {
      printWarning('解除する csg ルールがありません')
    }
  }

  process.stdout.write('claude --permission-mode auto を起動します...\n\n')

  const child = spawn('claude', ['--permission-mode', 'auto', ...args], {
    stdio: 'inherit',
    env: { ...process.env, CSG_PERMISSION_MODE: 'auto' },
  })

  let restored = false
  const doRestore = async (): Promise<void> => {
    if (restored || !hasRules) return
    restored = true
    await restore()
  }

  child.on('error', async (err) => {
    printError(`claude の起動に失敗: ${err.message}`)
    await doRestore()
    process.exit(1)
  })

  child.on('exit', async (code, signal) => {
    await doRestore()
    if (signal) {
      process.exit(128 + (signal === 'SIGINT' ? 2 : signal === 'SIGTERM' ? 15 : 1))
    }
    process.exit(code ?? 0)
  })

  // Forward signals to child, cleanup happens in 'exit' handler
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      child.kill(sig)
    })
  }
}
