import { readGlobalSettings, extractAllRules } from '../core/settings-reader.js'
import { generateEnforceScript } from '../core/hook-generator.js'
import { writeSettings } from '../core/settings-writer.js'
import { detectAutoMode } from '../core/automode-detector.js'
import { printHeader, printSuccess, printError, printWarning } from '../utils/display.js'
import { getGlobalSettingsPath } from '../utils/paths.js'
import { regenerateEnforceHook, ensureHookRegistered } from '../core/hook-regenerator.js'
import { exitWithError } from '../utils/exit.js'
import { isJqAvailable } from '../utils/jq-check.js'
import type { ClaudeSettings } from '../types.js'

export interface EnforceResult {
  readonly denyRules: readonly string[]
  readonly script: string
}

export async function runEnforce(): Promise<EnforceResult | null> {
  const settings = await readGlobalSettings()
  if (!settings) return null

  const rules = extractAllRules(settings)
  const allDeny = [...rules.denyRules, ...rules.legacyDeny]

  if (allDeny.length === 0) {
    return { denyRules: [], script: '' }
  }

  const script = generateEnforceScript(allDeny)
  return { denyRules: allDeny, script }
}

export async function applyEnforce(settings: ClaudeSettings): Promise<{ success: boolean; hookPath: string; backupPath?: string; error?: string }> {
  const hookResult = await regenerateEnforceHook(settings)
  const updatedSettings = hookResult.rulesCount > 0
    ? ensureHookRegistered(settings)
    : settings

  const settingsPath = getGlobalSettingsPath()
  const result = await writeSettings(settingsPath, updatedSettings)

  return {
    success: result.success,
    hookPath: hookResult.hookPath,
    backupPath: result.backupPath,
    error: result.error,
  }
}

export async function enforceCommand(options: { dryRun?: boolean; force?: boolean }): Promise<void> {
  printHeader('Claude Settings Guard - 強制フック生成')

  // Check AutoMode compatibility
  const currentSettings = await readGlobalSettings()
  if (currentSettings) {
    const autoModeStatus = detectAutoMode(currentSettings)
    if (autoModeStatus.enabled && !options.force) {
      printWarning('AutoMode が有効です。enforce フックは AutoMode の分類器と競合する可能性があります。')
      printWarning('AutoMode 使用時は enforce フックは不要です。')
      process.stdout.write('\n強制的に生成するには: csg enforce --force\n')
      process.stdout.write('AutoMode に完全移行するには: csg migrate --to-automode\n')
      return
    }
    if (autoModeStatus.enabled && options.force) {
      printWarning('AutoMode が有効ですが、--force により enforce フックを生成します。')
    }
  }

  const enforceResult = await runEnforce()
  if (!enforceResult) {
    exitWithError('settings.json が見つかりません')
  }

  const { denyRules, script } = enforceResult

  if (denyRules.length === 0) {
    printWarning('deny ルールがありません。フック生成をスキップします。')
    return
  }

  if (!isJqAvailable()) {
    printWarning('jq がインストールされていません。enforce フックの実行に jq が必要です。')
    printWarning('インストール: brew install jq (macOS) / apt install jq (Ubuntu)')
  }

  process.stdout.write(`deny ルールから強制フックを生成中...\n`)
  process.stdout.write('━'.repeat(40) + '\n\n')

  process.stdout.write(`対象 deny ルール (${denyRules.length}件):\n`)
  for (const rule of denyRules) {
    process.stdout.write(`  - ${rule}\n`)
  }

  if (options.dryRun) {
    process.stdout.write('\n--- 生成されるスクリプト ---\n')
    process.stdout.write(script)
    process.stdout.write('\n--dry-run モードです。ファイルは作成されていません。\n')
    return
  }

  const latestSettings = currentSettings ?? await readGlobalSettings()
  if (!latestSettings) {
    exitWithError('settings.json が見つかりません')
  }

  const result = await applyEnforce(latestSettings)

  if (result.success) {
    printSuccess('強制フックを生成・登録しました')
    process.stdout.write(`  フック: ${result.hookPath}\n`)
    if (result.backupPath) {
      process.stdout.write(`  バックアップ: ${result.backupPath}\n`)
    }
  } else {
    printError(`settings.json の更新に失敗: ${result.error}`)
    process.stdout.write(`フックスクリプトは作成済み: ${result.hookPath}\n`)
    process.stdout.write('手動で settings.json の PreToolUse にフックを登録してください。\n')
  }
}
