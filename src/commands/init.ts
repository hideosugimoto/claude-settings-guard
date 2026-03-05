import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readGlobalSettings } from '../core/settings-reader.js'
import { writeSettings } from '../core/settings-writer.js'
import { generateEnforceScript, mergeHookIntoSettings } from '../core/hook-generator.js'
import { DEFAULT_DENY_RULES } from '../constants.js'
import {
  getGlobalSettingsPath, getCommandsDir, getHooksDir, ensureDir, expandHome,
} from '../utils/paths.js'
import { printHeader, printSuccess, printWarning, printError } from '../utils/display.js'
import { chmod } from 'node:fs/promises'

const IMPROVE_SETTINGS_MD = `# /improve-settings

Claude Code の settings.json 権限設定を診断・最適化するコマンドです。

以下の手順で実行してください:

1. まず診断を実行:
\`\`\`bash
npx claude-settings-guard diagnose
\`\`\`

2. レガシー構文があれば移行:
\`\`\`bash
npx claude-settings-guard migrate --dry-run
npx claude-settings-guard migrate
\`\`\`

3. テレメトリから推薦を取得:
\`\`\`bash
npx claude-settings-guard recommend
\`\`\`

4. 強制フックを生成:
\`\`\`bash
npx claude-settings-guard enforce
\`\`\`

各コマンドの結果を確認し、必要に応じて設定を調整してください。
`

export async function initCommand(): Promise<void> {
  printHeader('Claude Settings Guard - 初期セットアップ')

  // 1. Install slash command
  const commandsDir = getCommandsDir()
  await ensureDir(commandsDir)
  const commandPath = join(commandsDir, 'improve-settings.md')

  if (existsSync(commandPath)) {
    printWarning('/improve-settings コマンドは既にインストール済みです')
  } else {
    await writeFile(commandPath, IMPROVE_SETTINGS_MD, 'utf-8')
    printSuccess(`/improve-settings コマンドをインストールしました: ${commandPath}`)
  }

  // 2. Ensure default deny rules
  const settings = await readGlobalSettings()
  if (!settings) {
    printError('settings.json が見つかりません')
    return
  }

  const existingDeny = [
    ...(settings.permissions?.deny ?? []),
    ...(settings.deny ?? []),
  ]

  const missingDeny = DEFAULT_DENY_RULES.filter(
    rule => !existingDeny.some(existing => existing === rule)
  )

  let updatedSettings = { ...settings }

  if (missingDeny.length > 0) {
    process.stdout.write(`\nデフォルト deny ルールを追加 (${missingDeny.length}件):\n`)
    for (const rule of missingDeny) {
      process.stdout.write(`  + ${rule}\n`)
    }

    updatedSettings = {
      ...updatedSettings,
      permissions: {
        ...updatedSettings.permissions,
        deny: [
          ...(updatedSettings.permissions?.deny ?? []),
          ...missingDeny,
        ],
      },
    }
  } else {
    printSuccess('デフォルト deny ルールは全て設定済みです')
  }

  // 3. Generate enforce hook
  const allDeny = [
    ...(updatedSettings.permissions?.deny ?? []),
    ...(updatedSettings.deny ?? []),
  ]

  const script = generateEnforceScript(allDeny)
  const hooksDir = getHooksDir()
  await ensureDir(hooksDir)
  const hookPath = join(hooksDir, 'enforce-permissions.sh')
  await writeFile(hookPath, script, 'utf-8')
  await chmod(hookPath, 0o755)
  printSuccess(`強制フックを生成: ${hookPath}`)

  // 4. Register hook
  const expandedHookPath = expandHome('~/.claude/hooks/enforce-permissions.sh')
  updatedSettings = mergeHookIntoSettings(updatedSettings, expandedHookPath)

  const settingsPath = getGlobalSettingsPath()
  const result = await writeSettings(settingsPath, updatedSettings)

  if (result.success) {
    printSuccess('初期セットアップ完了')
    if (result.backupPath) {
      process.stdout.write(`  バックアップ: ${result.backupPath}\n`)
    }
  } else {
    printError(`設定の書き込みに失敗: ${result.error}`)
  }

  process.stdout.write('\n次のステップ:\n')
  process.stdout.write('  1. csg diagnose  - 現在の設定を診断\n')
  process.stdout.write('  2. csg migrate   - レガシー構文を移行\n')
  process.stdout.write('  3. csg recommend - テレメトリから推薦を取得\n')
}
