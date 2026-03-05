import chalk from 'chalk'
import { runDiagnose } from './diagnose.js'
import { checkMigration, applyMigration } from './migrate.js'
import { runRecommend } from './recommend.js'
import { initCommand } from './init.js'
import { confirm } from '../utils/prompt.js'
import { printHeader, printIssue, printMigration, printRecommendation, printSuccess, printWarning } from '../utils/display.js'

export async function setupCommand(options: { yes?: boolean }): Promise<void> {
  printHeader('Claude Settings Guard - セットアップ')
  process.stdout.write('対話型ガイドで設定を最適化します。\n\n')

  // Step 1: Diagnose
  process.stdout.write(chalk.bold.cyan('Step 1/4: 診断\n'))
  process.stdout.write(chalk.dim('─'.repeat(40)) + '\n')

  const { issues, totalPatterns } = await runDiagnose()

  if (totalPatterns === 0 && issues.length === 0) {
    printWarning('settings.json が見つかりません。init でデフォルト設定を行います。')
  } else if (issues.length === 0) {
    printSuccess('問題は見つかりませんでした')
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

  // Step 2: Migration
  process.stdout.write(chalk.bold.cyan('Step 2/4: マイグレーション\n'))
  process.stdout.write(chalk.dim('─'.repeat(40)) + '\n')

  const migrateCheck = await checkMigration()

  if (!migrateCheck || migrateCheck.results.length === 0) {
    printSuccess('移行が必要なパターンはありません')
  } else {
    const syntaxChanges = migrateCheck.results.filter(r => r.type === 'syntax')
    const structureChanges = migrateCheck.results.filter(r => r.type === 'structure')

    if (structureChanges.length > 0) {
      process.stdout.write(`構造移行: ${structureChanges.length} 件\n`)
      for (const r of structureChanges.slice(0, 5)) {
        printMigration(r)
      }
      if (structureChanges.length > 5) {
        process.stdout.write(chalk.dim(`  ... 他 ${structureChanges.length - 5} 件\n`))
      }
    }

    if (syntaxChanges.length > 0) {
      process.stdout.write(`構文移行: ${syntaxChanges.length} 件\n`)
      for (const r of syntaxChanges.slice(0, 5)) {
        printMigration(r)
      }
      if (syntaxChanges.length > 5) {
        process.stdout.write(chalk.dim(`  ... 他 ${syntaxChanges.length - 5} 件\n`))
      }
    }

    const shouldMigrate = options.yes || await confirm('マイグレーションを適用しますか?')
    if (shouldMigrate) {
      const result = await applyMigration(migrateCheck.migrated)
      if (result.success) {
        printSuccess('マイグレーション完了')
        if (result.backupPath) {
          process.stdout.write(`  バックアップ: ${result.backupPath}\n`)
        }
      } else {
        printWarning(`マイグレーション失敗: ${result.error}`)
      }
    } else {
      process.stdout.write('スキップしました。後で `csg migrate` で実行できます。\n')
    }
  }
  process.stdout.write('\n')

  // Step 3: Recommend
  process.stdout.write(chalk.bold.cyan('Step 3/4: テレメトリ推薦\n'))
  process.stdout.write(chalk.dim('─'.repeat(40)) + '\n')

  const { recommendations, eventCount } = await runRecommend()

  if (eventCount === 0) {
    process.stdout.write('テレメトリデータが見つかりません。使用後に `csg recommend` で再確認してください。\n')
  } else if (recommendations.length === 0) {
    printSuccess('推薦事項はありません。現在の設定は適切です。')
  } else {
    process.stdout.write(`${eventCount} イベントから ${recommendations.length} 件の推薦:\n`)
    for (const rec of recommendations.slice(0, 5)) {
      printRecommendation(rec)
    }
    if (recommendations.length > 5) {
      process.stdout.write(chalk.dim(`  ... 他 ${recommendations.length - 5} 件\n`))
    }
    process.stdout.write('詳細は `csg recommend` で確認してください。\n')
  }
  process.stdout.write('\n')

  // Step 4: Init (deny rules + enforce hook)
  process.stdout.write(chalk.bold.cyan('Step 4/4: 二重防御セットアップ\n'))
  process.stdout.write(chalk.dim('─'.repeat(40)) + '\n')
  process.stdout.write('デフォルト deny ルールの追加と強制フックの生成を行います。\n')

  const shouldInit = options.yes || await confirm('二重防御をセットアップしますか?')
  if (shouldInit) {
    await initCommand()
  } else {
    process.stdout.write('スキップしました。後で `csg init` で実行できます。\n')
  }
  process.stdout.write('\n')

  // Summary
  process.stdout.write(chalk.bold.cyan('━'.repeat(40)) + '\n')
  printSuccess('セットアップ完了!')
  process.stdout.write('\n利用可能なコマンド:\n')
  process.stdout.write('  csg diagnose   - 設定を診断\n')
  process.stdout.write('  csg migrate    - レガシー構文を移行\n')
  process.stdout.write('  csg recommend  - テレメトリから推薦\n')
  process.stdout.write('  csg enforce    - 強制フックを再生成\n')
  process.stdout.write('  csg init       - 初期セットアップ再実行\n')
}
