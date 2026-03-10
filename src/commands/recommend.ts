import { readGlobalSettings, extractAllRules } from '../core/settings-reader.js'
import {
  loadTelemetryEvents,
  analyzePermissionEvents,
  generateRecommendations,
} from '../core/telemetry-analyzer.js'
import { printHeader, printRecommendation, printSuccess } from '../utils/display.js'
import { exitWithError } from '../utils/exit.js'
import { confirm } from '../utils/prompt.js'
import { applyRecommendations } from '../core/recommendation-applier.js'
import { regenerateEnforceHook, ensureHookRegistered } from '../core/hook-regenerator.js'
import { writeSettings } from '../core/settings-writer.js'
import { getGlobalSettingsPath } from '../utils/paths.js'
import type { Recommendation } from '../types.js'

export interface RecommendResult {
  readonly recommendations: readonly Recommendation[]
  readonly eventCount: number
}

export async function runRecommend(): Promise<RecommendResult> {
  const settings = await readGlobalSettings()
  if (!settings) {
    return { recommendations: [], eventCount: 0 }
  }

  const rules = extractAllRules(settings)
  const allAllow = [...rules.allowRules, ...rules.legacyAllowedTools]
  const allDeny = [...rules.denyRules, ...rules.legacyDeny]

  const { events, skippedLines } = await loadTelemetryEvents()
  if (events.length === 0) {
    return { recommendations: [], eventCount: 0 }
  }

  if (skippedLines > 0) {
    process.stderr.write(`  [warn] ${skippedLines} malformed telemetry lines skipped\n`)
  }

  const stats = analyzePermissionEvents(events)
  const recommendations = generateRecommendations(stats, allAllow, allDeny)

  return { recommendations, eventCount: events.length }
}

export async function recommendCommand(options: { yes?: boolean } = {}): Promise<void> {
  printHeader('Claude Settings Guard - テレメトリ分析')

  const settings = await readGlobalSettings()
  if (!settings) {
    exitWithError('settings.json が見つかりません')
  }

  const { recommendations, eventCount } = await runRecommend()

  if (eventCount === 0) {
    process.stdout.write('テレメトリデータが見つかりません\n')
    return
  }

  process.stdout.write(`  ${eventCount} イベントを分析中...\n\n`)

  if (recommendations.length === 0) {
    printSuccess('推薦事項はありません。現在の設定は適切です。')
    return
  }

  const allowRecs = recommendations.filter(r => r.action === 'add-allow')
  const denyRecs = recommendations.filter(r => r.action === 'add-deny')

  if (allowRecs.length > 0) {
    process.stdout.write(`Allow に追加推薦 (${allowRecs.length}件):\n`)
    for (const rec of allowRecs) {
      printRecommendation(rec)
    }
    process.stdout.write('\n')
  }

  if (denyRecs.length > 0) {
    process.stdout.write(`Deny に追加推薦 (${denyRecs.length}件):\n`)
    for (const rec of denyRecs) {
      printRecommendation(rec)
    }
    process.stdout.write('\n')
  }

  const autoYes = options.yes ?? false
  const interactive = process.stdin.isTTY && process.stdout.isTTY
  const shouldApply = autoYes || (interactive ? await confirm('推薦を適用しますか？') : false)

  if (!shouldApply) {
    return
  }

  const applied = applyRecommendations(settings, recommendations)

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
  const hookPath = hookInfo.hookPath
  const hookRulesCount = hookInfo.hookRulesCount

  const result = await writeSettings(getGlobalSettingsPath(), nextSettings)
  if (!result.success) {
    exitWithError(`設定の書き込みに失敗しました: ${result.error}`)
  }

  printSuccess('推薦を適用しました')
  if (applied.addedAllow.length > 0) {
    process.stdout.write(`  allow 追加 (${applied.addedAllow.length}件):\n`)
    for (const pattern of applied.addedAllow) process.stdout.write(`    - ${pattern}\n`)
  }
  if (applied.addedDeny.length > 0) {
    process.stdout.write(`  deny 追加 (${applied.addedDeny.length}件):\n`)
    for (const pattern of applied.addedDeny) process.stdout.write(`    - ${pattern}\n`)
  }
  if (result.backupPath) {
    process.stdout.write(`  バックアップ: ${result.backupPath}\n`)
  }
  if (applied.hasDenyChanges) {
    process.stdout.write(`  フック再生成: ${hookRulesCount > 0 ? '実行' : 'スキップ (denyルール0件)'}\n`)
    if (hookPath && hookRulesCount > 0) process.stdout.write(`  フック: ${hookPath}\n`)
  }
}
