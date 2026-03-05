import { readGlobalSettings, extractAllRules } from '../core/settings-reader.js'
import {
  loadTelemetryEvents,
  analyzePermissionEvents,
  generateRecommendations,
} from '../core/telemetry-analyzer.js'
import { printHeader, printRecommendation, printSuccess } from '../utils/display.js'
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

  const events = await loadTelemetryEvents()
  if (events.length === 0) {
    return { recommendations: [], eventCount: 0 }
  }

  const stats = analyzePermissionEvents(events)
  const recommendations = generateRecommendations(stats, allAllow, allDeny)

  return { recommendations, eventCount: events.length }
}

export async function recommendCommand(): Promise<void> {
  printHeader('Claude Settings Guard - テレメトリ分析')

  const settings = await readGlobalSettings()
  if (!settings) {
    process.stdout.write('settings.json が見つかりません\n')
    process.exit(1)
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

  process.stdout.write('推薦を適用するには設定を手動で更新してください。\n')
}
