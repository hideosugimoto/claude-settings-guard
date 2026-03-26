import { readGlobalSettings, extractAllRules } from '../core/settings-reader.js'
import {
  loadTelemetryEvents,
  analyzePermissionEvents,
  generateRecommendations,
} from '../core/telemetry-analyzer.js'
import { scanInstalledBinaries } from '../core/path-scanner.js'
import { isClaudeAvailable, classifyTools, classificationsToRecommendations } from '../core/ai-classifier.js'
import { detectProfile } from '../core/profile-detector.js'
import { isValidProfileName } from '../profiles/index.js'
import { collectManagedBashBinaries } from '../core/rule-coverage-checker.js'
import { printHeader, printRecommendation, printSuccess, printWarning, printError } from '../utils/display.js'
import { exitWithError } from '../utils/exit.js'
import { confirm } from '../utils/prompt.js'
import { applyRecommendations } from '../core/recommendation-applier.js'
import { regenerateEnforceHook, ensureHookRegistered } from '../core/hook-regenerator.js'
import { writeSettings } from '../core/settings-writer.js'
import { getGlobalSettingsPath } from '../utils/paths.js'
import type { ProfileName, Recommendation } from '../types.js'

export interface RecommendResult {
  readonly recommendations: readonly Recommendation[]
  readonly scanCount: number
  readonly profile: ProfileName
}

export async function runTelemetryRecommend(): Promise<{ recommendations: readonly Recommendation[]; eventCount: number }> {
  const settings = await readGlobalSettings()
  if (!settings) return { recommendations: [], eventCount: 0 }

  const rules = extractAllRules(settings)
  const allAllow = [...rules.allowRules, ...rules.legacyAllowedTools]
  const allDeny = [...rules.denyRules, ...rules.legacyDeny]

  const { events } = await loadTelemetryEvents()
  if (events.length === 0) return { recommendations: [], eventCount: 0 }

  const stats = analyzePermissionEvents(events)
  const recommendations = generateRecommendations(stats, allAllow, allDeny)
  return { recommendations, eventCount: events.length }
}

async function runToolScan(profile: ProfileName): Promise<{ recommendations: readonly Recommendation[]; scanned: number; found: number }> {
  process.stdout.write('  インストール済みツールをスキャン中...\n')

  const allBinaries = await scanInstalledBinaries()
  process.stdout.write(`  ${allBinaries.length} バイナリを検出\n`)

  // Filter out binaries already covered by existing rules
  const coveredBinaries = collectManagedBashBinaries()
  const uncoveredBinaries = allBinaries.filter(b => !coveredBinaries.has(b))
  process.stdout.write(`  ${uncoveredBinaries.length} ツールが未カバー（${allBinaries.length - uncoveredBinaries.length} 件はCSGルールでカバー済み）\n`)

  if (uncoveredBinaries.length === 0) {
    return { recommendations: [], scanned: allBinaries.length, found: 0 }
  }

  process.stdout.write(`  Claude AI で分類中（プロファイル: ${profile}）...\n`)
  const classifications = classifyTools(uncoveredBinaries, profile)
  const skipped = classifications.filter(c => c.risk === 'skip').length
  const devTools = classifications.filter(c => c.risk !== 'skip').length
  process.stdout.write(`  AI分類完了: ${devTools} 件の開発ツール検出（${skipped} 件は開発無関係としてスキップ）\n`)
  const recommendations = classificationsToRecommendations(classifications, profile)

  return { recommendations, scanned: allBinaries.length, found: uncoveredBinaries.length }
}

export async function recommendCommand(options: {
  yes?: boolean
  profile?: string
  dryRun?: boolean
} = {}): Promise<void> {
  printHeader('Claude Settings Guard - ツール推薦')

  const settings = await readGlobalSettings()
  if (!settings) {
    exitWithError('settings.json が見つかりません')
  }

  // Determine profile
  let profile: ProfileName
  if (options.profile) {
    if (!isValidProfileName(options.profile)) {
      exitWithError(`無効なプロファイル: ${options.profile}（minimal, balanced, strict, smart のいずれか）`)
    }
    profile = options.profile as ProfileName
  } else {
    profile = detectProfile(settings)
  }
  process.stdout.write(`  プロファイル: ${profile}${options.profile ? '' : '（自動検出）'}\n\n`)

  // Check Claude CLI availability
  if (!isClaudeAvailable()) {
    printError('Claude CLI が見つかりません。ツールスキャンにはClaude Codeが必要です。')
    return
  }

  // Run tool scan (primary)
  let scanRecommendations: readonly Recommendation[] = []
  try {
    const scanResult = await runToolScan(profile)
    scanRecommendations = scanResult.recommendations
  } catch (err) {
    printWarning(`ツールスキャンでエラー: ${err instanceof Error ? err.message : String(err)}`)
  }

  // Run telemetry analysis (secondary)
  const telemetryResult = await runTelemetryRecommend()
  const telemetryRecommendations = telemetryResult.recommendations

  // Merge: deduplicate by pattern, scan takes precedence
  const seenPatterns = new Set(scanRecommendations.map(r => r.pattern))
  const mergedRecommendations = [
    ...scanRecommendations,
    ...telemetryRecommendations.filter(r => !seenPatterns.has(r.pattern)),
  ]

  if (mergedRecommendations.length === 0) {
    process.stdout.write('\n')
    printSuccess('推薦事項はありません。現在の設定は適切です。')
    return
  }

  // Display grouped by action
  process.stdout.write('\n')
  const allowRecs = mergedRecommendations.filter(r => r.action === 'add-allow')
  const askRecs = mergedRecommendations.filter(r => r.action === 'add-ask')
  const denyRecs = mergedRecommendations.filter(r => r.action === 'add-deny')

  if (allowRecs.length > 0) {
    process.stdout.write(`Allow に追加推薦 (${allowRecs.length}件):\n`)
    for (const rec of allowRecs) printRecommendation(rec)
    process.stdout.write('\n')
  }
  if (askRecs.length > 0) {
    process.stdout.write(`Ask に追加推薦 (${askRecs.length}件):\n`)
    for (const rec of askRecs) printRecommendation(rec)
    process.stdout.write('\n')
  }
  if (denyRecs.length > 0) {
    process.stdout.write(`Deny に追加推薦 (${denyRecs.length}件):\n`)
    for (const rec of denyRecs) printRecommendation(rec)
    process.stdout.write('\n')
  }

  if (options.dryRun) {
    process.stdout.write('(dry-run: 変更は適用されません)\n')
    return
  }

  const autoYes = options.yes ?? false
  const interactive = process.stdin.isTTY && process.stdout.isTTY
  const shouldApply = autoYes || (interactive ? await confirm('推薦を適用しますか？') : false)

  if (!shouldApply) return

  const applied = applyRecommendations(settings, mergedRecommendations)

  const hookInfo = applied.hasDenyChanges
    ? await (async () => {
        const hookResult = await regenerateEnforceHook(applied.settings)
        return {
          settings: ensureHookRegistered(applied.settings),
          hookPath: hookResult.hookPath,
          hookRulesCount: hookResult.rulesCount,
        }
      })()
    : { settings: applied.settings, hookPath: undefined, hookRulesCount: 0 }

  const nextSettings = hookInfo.settings
  const result = await writeSettings(getGlobalSettingsPath(), nextSettings)
  if (!result.success) {
    exitWithError(`設定の書き込みに失敗しました: ${result.error}`)
  }

  printSuccess('推薦を適用しました')
  if (applied.addedAllow.length > 0) {
    process.stdout.write(`  allow 追加 (${applied.addedAllow.length}件)\n`)
  }
  if (applied.addedAsk.length > 0) {
    process.stdout.write(`  ask 追加 (${applied.addedAsk.length}件)\n`)
  }
  if (applied.addedDeny.length > 0) {
    process.stdout.write(`  deny 追加 (${applied.addedDeny.length}件)\n`)
  }
  if (result.backupPath) {
    process.stdout.write(`  バックアップ: ${result.backupPath}\n`)
  }
  if (applied.hasDenyChanges && hookInfo.hookPath) {
    process.stdout.write(`  フック再生成: ${hookInfo.hookRulesCount} ルール\n`)
  }
}
