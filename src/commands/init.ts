import { writeFile, chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { readGlobalSettings } from '../core/settings-reader.js'
import { writeSettings } from '../core/settings-writer.js'
import { generateEnforceScript, mergeHookIntoSettings } from '../core/hook-generator.js'
import { getGlobalSettingsPath, getHooksDir, ensureDir, expandHome } from '../utils/paths.js'
import { printHeader, printSuccess, printError } from '../utils/display.js'
import { deploySlashCommands, printDeployResult } from './deploy-slash.js'
import { isValidProfileName, getProfile } from '../profiles/index.js'
import { applyProfileToSettings } from '../core/profile-applicator.js'
import { installSessionHook } from '../core/session-hook.js'
import type { ClaudeSettings, ProfileName } from '../types.js'

export interface InitOptions {
  profile?: string
  force?: boolean
}

function resolveProfile(profileOption?: string): ProfileName {
  return isValidProfileName(profileOption ?? '') ? (profileOption as ProfileName) : 'balanced'
}

async function setupEnforceHook(settings: ClaudeSettings): Promise<ClaudeSettings> {
  const allDeny = [
    ...(settings.permissions?.deny ?? []),
    ...(settings.deny ?? []),
  ]

  const script = generateEnforceScript(allDeny)
  const hooksDir = getHooksDir()
  await ensureDir(hooksDir)
  const hookPath = join(hooksDir, 'enforce-permissions.sh')
  await writeFile(hookPath, script, 'utf-8')
  await chmod(hookPath, 0o755)
  printSuccess(`強制フックを生成: ${hookPath}`)

  const expandedHookPath = expandHome('~/.claude/hooks/enforce-permissions.sh')
  return mergeHookIntoSettings(settings, expandedHookPath)
}

export async function initCommand(options: InitOptions = {}): Promise<void> {
  printHeader('Claude Settings Guard - 初期セットアップ')

  process.stdout.write('スラッシュコマンドをデプロイ中...\n')
  const deployResult = await deploySlashCommands({ force: options.force })
  printDeployResult(deployResult)

  const profileName = resolveProfile(options.profile)
  if (options.profile) {
    process.stdout.write(`\nプロファイル: ${profileName}\n`)
  }

  const profile = getProfile(profileName)
  const settings = await readGlobalSettings()
  if (!settings) {
    printError('settings.json が見つかりません')
    return
  }

  const applied = applyProfileToSettings(settings, profile)
  if (applied.addedDeny > 0) {
    process.stdout.write(`\ndeny ルールを追加 (${applied.addedDeny}件)\n`)
  } else {
    printSuccess('deny ルールは全て設定済みです')
  }
  if (applied.addedAllow > 0) process.stdout.write(`allow ルールを追加 (${applied.addedAllow}件)\n`)
  if (applied.addedAsk > 0) process.stdout.write(`ask ルールを追加 (${applied.addedAsk}件)\n`)

  const withEnforce = profile.hooks.enforce
    ? await setupEnforceHook(applied.settings)
    : applied.settings

  const withSession = profile.hooks.sessionDiagnose
    ? await installSessionHook(withEnforce).then(r => {
        printSuccess(`SessionStart 診断フックを生成: ${r.hookPath}`)
        return r.settings
      })
    : withEnforce

  const result = await writeSettings(getGlobalSettingsPath(), withSession)
  if (result.success) {
    printSuccess('初期セットアップ完了')
    if (result.backupPath) process.stdout.write(`  バックアップ: ${result.backupPath}\n`)
  } else {
    printError(`設定の書き込みに失敗: ${result.error}`)
  }

  process.stdout.write('\n次のステップ:\n')
  process.stdout.write('  1. /csg          - Claude Code 内で設定診断\n')
  process.stdout.write('  2. /csg-diagnose - 詳細診断\n')
  process.stdout.write('  3. /csg-enforce  - 強制フック更新\n')
  process.stdout.write('  4. csg diagnose  - ターミナルから診断\n')
}
