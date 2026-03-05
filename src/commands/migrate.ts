import { readGlobalSettings } from '../core/settings-reader.js'
import { migrateStructure } from '../core/pattern-migrator.js'
import { writeSettings, generateDiff } from '../core/settings-writer.js'
import { printHeader, printMigration, printSuccess, printError } from '../utils/display.js'
import { getGlobalSettingsPath } from '../utils/paths.js'
import type { ClaudeSettings, MigrationResult } from '../types.js'

export interface MigrateCheckResult {
  readonly results: readonly MigrationResult[]
  readonly migrated: ClaudeSettings
  readonly original: ClaudeSettings
  readonly diff: string
}

export async function checkMigration(): Promise<MigrateCheckResult | null> {
  const settings = await readGlobalSettings()
  if (!settings) return null

  const { migrated, results } = migrateStructure(settings)
  const diff = generateDiff(settings, migrated)

  return { results, migrated, original: settings, diff }
}

export async function applyMigration(migrated: ClaudeSettings): Promise<{ success: boolean; backupPath?: string; error?: string }> {
  const settingsPath = getGlobalSettingsPath()
  return writeSettings(settingsPath, migrated)
}

export async function migrateCommand(options: { dryRun?: boolean }): Promise<void> {
  printHeader('Claude Settings Guard - マイグレーション')

  const check = await checkMigration()
  if (!check) {
    printError('settings.json が見つかりません')
    process.exit(1)
  }

  const { results, migrated, original } = check

  if (results.length === 0) {
    printSuccess('移行が必要なパターンはありません')
    return
  }

  const syntaxChanges = results.filter(r => r.type === 'syntax')
  const structureChanges = results.filter(r => r.type === 'structure')

  process.stdout.write('以下の変更を適用します:\n')
  process.stdout.write('━'.repeat(40) + '\n')

  if (structureChanges.length > 0) {
    process.stdout.write(`\n[構造] ${structureChanges.length} 個のルールを移行\n`)
    for (const result of structureChanges.slice(0, 10)) {
      printMigration(result)
    }
    if (structureChanges.length > 10) {
      process.stdout.write(`  ... and ${structureChanges.length - 10} more\n`)
    }
  }

  if (syntaxChanges.length > 0) {
    process.stdout.write(`\n[構文] ${syntaxChanges.length} 個のレガシーパターンを変換\n`)
    for (const result of syntaxChanges.slice(0, 10)) {
      printMigration(result)
    }
    if (syntaxChanges.length > 10) {
      process.stdout.write(`  ... and ${syntaxChanges.length - 10} more\n`)
    }
  }

  if (options.dryRun) {
    process.stdout.write('\n--- Diff (dry-run) ---\n')
    process.stdout.write(generateDiff(original, migrated))
    process.stdout.write('\n\n--dry-run モードです。変更は適用されていません。\n')
    process.stdout.write('実際に適用するには: csg migrate\n')
    return
  }

  const result = await applyMigration(migrated)

  if (result.success) {
    printSuccess('マイグレーション完了')
    if (result.backupPath) {
      process.stdout.write(`  バックアップ: ${result.backupPath}\n`)
    }
  } else {
    printError(`マイグレーション失敗: ${result.error}`)
    process.exit(1)
  }
}
