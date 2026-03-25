import { spawn } from 'node:child_process'
import { readGlobalSettings } from '../core/settings-reader.js'
import { writeSettings } from '../core/settings-writer.js'
import { extractManagedRules, saveManagedRules, loadManagedRules } from '../core/automode-switch.js'
import { getGlobalSettingsPath } from '../utils/paths.js'
import { printSuccess, printWarning, printError } from '../utils/display.js'
import type { ClaudeSettings } from '../types.js'
import type { CsgManagedRules } from '../core/automode-switch.js'

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

  return {
    ...settings,
    permissions: {
      ...settings.permissions,
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
  const settings = await readGlobalSettings()
  if (!settings) {
    printError('settings.json が見つかりません。先に csg setup を実行してください。')
    process.exit(1)
  }

  // Extract and save managed rules for later restoration
  const rules = extractManagedRules(settings)
  const hasRules = rules.deny.length > 0 || rules.allow.length > 0 || rules.ask.length > 0

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
