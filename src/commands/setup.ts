import chalk from 'chalk'
import { runDiagnose } from './diagnose.js'
import { checkMigration, applyMigration } from './migrate.js'
import { runRecommend } from './recommend.js'
import { initCommand } from './init.js'
import { confirm, select } from '../utils/prompt.js'
import { printHeader, printIssue, printMigration, printRecommendation, printSuccess, printWarning } from '../utils/display.js'
import { getProfileNames, getProfile } from '../profiles/index.js'
import type { ClaudeSettings, ProfileName } from '../types.js'

function countPatterns(settings: ClaudeSettings): number {
  return (
    (settings.permissions?.allow?.length ?? 0) +
    (settings.permissions?.deny?.length ?? 0) +
    (settings.permissions?.ask?.length ?? 0) +
    (settings.allowedTools?.length ?? 0) +
    (settings.deny?.length ?? 0)
  )
}

function printStepHeader(step: number, title: string): void {
  process.stdout.write(chalk.bold.cyan(`Step ${step}/5: ${title}\n`))
  process.stdout.write(chalk.dim('─'.repeat(40)) + '\n')
}

async function stepDiagnose(): Promise<void> {
  printStepHeader(1, '診断')
  const { issues, totalPatterns } = await runDiagnose()

  if (totalPatterns === 0 && issues.length === 0) {
    printWarning('settings.json が見つかりません。init でデフォルト設定を行います。')
  } else if (issues.length === 0) {
    printSuccess(`${totalPatterns} パターンを検査 → 問題は見つかりませんでした`)
  } else {
    process.stdout.write(`${issues.length} 件の問題を検出:\n`)
    for (const issue of issues.slice(0, 5)) {
      printIssue(issue)
    }
    if (issues.length > 5) {
      process.stdout.write(chalk.dim(`  ... 他 ${issues.length - 5} 件 (詳細: csg diagnose)\n`))
    }
  }
  process.stdout.write('\n')
}

async function stepMigration(autoYes: boolean): Promise<void> {
  printStepHeader(2, 'マイグレーション')
  const migrateCheck = await checkMigration()

  if (!migrateCheck) {
    printSuccess('設定ファイルなし → スキップ')
    process.stdout.write('\n')
    return
  }

  const patternCount = countPatterns(migrateCheck.original)

  if (migrateCheck.results.length === 0) {
    printSuccess(`${patternCount} パターンを検査 → 移行が必要なパターンはありません`)
    process.stdout.write('\n')
    return
  }

  for (const type of ['structure', 'syntax'] as const) {
    const changes = migrateCheck.results.filter(r => r.type === type)
    if (changes.length === 0) continue
    const label = type === 'structure' ? '構造移行' : '構文移行'
    process.stdout.write(`${label}: ${changes.length} 件\n`)
    for (const r of changes.slice(0, 5)) printMigration(r)
    if (changes.length > 5) process.stdout.write(chalk.dim(`  ... 他 ${changes.length - 5} 件\n`))
  }

  const shouldMigrate = autoYes || await confirm('マイグレーションを適用しますか?')
  if (shouldMigrate) {
    const result = await applyMigration(migrateCheck.migrated)
    if (result.success) {
      printSuccess('マイグレーション完了')
      if (result.backupPath) process.stdout.write(`  バックアップ: ${result.backupPath}\n`)
    } else {
      printWarning(`マイグレーション失敗: ${result.error}`)
    }
  } else {
    process.stdout.write('スキップしました。後で `csg migrate` で実行できます。\n')
  }
  process.stdout.write('\n')
}

async function stepRecommend(): Promise<void> {
  printStepHeader(3, 'テレメトリ推薦')
  const { recommendations, eventCount } = await runRecommend()

  if (eventCount === 0) {
    printSuccess('テレメトリデータなし → スキップ (使用後に `csg recommend` で再確認)')
  } else if (recommendations.length === 0) {
    printSuccess(`${eventCount} イベントを分析 → 推薦事項はありません`)
  } else {
    process.stdout.write(`${eventCount} イベントから ${recommendations.length} 件の推薦:\n`)
    for (const rec of recommendations.slice(0, 5)) printRecommendation(rec)
    if (recommendations.length > 5) {
      process.stdout.write(chalk.dim(`  ... 他 ${recommendations.length - 5} 件\n`))
    }
    process.stdout.write('詳細は `csg recommend` で確認してください。\n')
  }
  process.stdout.write('\n')
}

async function stepProfileSelect(autoYes: boolean): Promise<ProfileName> {
  printStepHeader(4, 'プロファイル選択')

  if (autoYes) {
    process.stdout.write('プロファイル: balanced (デフォルト)\n\n')
    return 'balanced'
  }

  const profileNames = getProfileNames()
  for (const name of profileNames) {
    const p = getProfile(name)
    const marker = name === 'balanced' ? chalk.green(' (推奨)') : ''
    process.stdout.write(`  ${chalk.bold(name)}${marker}: ${p.description}\n`)
  }
  const chosen = await select('プロファイルを選択してください', [...profileNames], 'balanced')
  process.stdout.write('\n')
  return chosen as ProfileName
}

async function stepInit(autoYes: boolean, profileName: ProfileName): Promise<void> {
  printStepHeader(5, '二重防御セットアップ')
  process.stdout.write('スラッシュコマンド、deny ルール、強制フックをセットアップします。\n')

  const shouldInit = autoYes || await confirm('セットアップを実行しますか?')
  if (shouldInit) {
    await initCommand({ profile: profileName })
  } else {
    process.stdout.write('スキップしました。後で `csg init --profile <name>` で実行できます。\n')
  }
  process.stdout.write('\n')
}

function printSummary(): void {
  process.stdout.write(chalk.bold.cyan('━'.repeat(40)) + '\n')
  printSuccess('セットアップ完了!')
  process.stdout.write('\n利用可能なコマンド:\n')
  process.stdout.write('  /csg             - Claude Code 内で設定診断\n')
  process.stdout.write('  /csg-diagnose    - Claude Code 内で詳細診断\n')
  process.stdout.write('  /csg-enforce     - Claude Code 内で強制フック更新\n')
  process.stdout.write('  csg diagnose     - 設定を診断\n')
  process.stdout.write('  csg migrate      - レガシー構文を移行\n')
  process.stdout.write('  csg recommend    - テレメトリから推薦\n')
  process.stdout.write('  csg enforce      - 強制フックを再生成\n')
  process.stdout.write('  csg init         - 初期セットアップ再実行\n')
}

export async function setupCommand(options: { yes?: boolean }): Promise<void> {
  printHeader('Claude Settings Guard - セットアップ')
  process.stdout.write('対話型ガイドで設定を最適化します。\n\n')

  const autoYes = options.yes ?? false

  await stepDiagnose()
  await stepMigration(autoYes)
  await stepRecommend()
  const selectedProfile = await stepProfileSelect(autoYes)
  await stepInit(autoYes, selectedProfile)
  printSummary()
}
