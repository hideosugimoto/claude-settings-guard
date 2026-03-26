import { readGlobalSettings, extractAllRules } from '../core/settings-reader.js'
import {
  loadTelemetryEvents,
  analyzePermissionEvents,
  generateRecommendations,
} from '../core/telemetry-analyzer.js'
import { scanInstalledBinaries } from '../core/path-scanner.js'
import { isClaudeAvailable, classifyTools, classificationsToRecommendations } from '../core/ai-classifier.js'
import { detectProfile } from '../core/profile-detector.js'
import { getProfile, isValidProfileName } from '../profiles/index.js'
import { collectManagedBashBinaries } from '../core/rule-coverage-checker.js'
import { DEFAULT_DENY_RULES, HARD_TO_REVERSE_ASK_RULES, SAFE_BASH_ALLOW_RULES, READ_ONLY_BASH_SAFE, READ_ONLY_BASH_FILE_READERS } from '../constants.js'
import { printHeader, printRecommendation, printSuccess, printWarning, printError } from '../utils/display.js'
import { exitWithError } from '../utils/exit.js'
import { confirm } from '../utils/prompt.js'
import { applyRecommendations } from '../core/recommendation-applier.js'
import { regenerateEnforceHook, ensureHookRegistered } from '../core/hook-regenerator.js'
import { writeSettings } from '../core/settings-writer.js'
import { getGlobalSettingsPath } from '../utils/paths.js'
import type { ProfileName, Recommendation } from '../types.js'

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

/**
 * Build recommendations from profile constants (DEFAULT_DENY_RULES, profile deny/ask, etc.)
 * These are the baseline rules that always apply regardless of AI scan.
 */
function buildProfileBaselineRecommendations(profile: ProfileName): readonly Recommendation[] {
  const profileDef = getProfile(profile)
  const recommendations: Recommendation[] = []

  // Profile deny rules + DEFAULT_DENY_RULES
  const profileAskSet = new Set(profileDef.ask ?? [])
  const allDeny = [...new Set([
    ...DEFAULT_DENY_RULES.filter(r => !profileAskSet.has(r)),
    ...profileDef.deny,
  ])]
  for (const pattern of allDeny) {
    recommendations.push({ action: 'add-deny', pattern, reason: 'プロファイル基本ルール', source: 'ai-scan' })
  }

  // Profile ask rules
  for (const pattern of profileDef.ask ?? []) {
    recommendations.push({ action: 'add-ask', pattern, reason: 'プロファイル基本ルール', source: 'ai-scan' })
  }

  // Profile allow rules (bare tools like Read, Write, Edit, Glob, Grep)
  for (const pattern of profileDef.allow) {
    recommendations.push({ action: 'add-allow', pattern, reason: 'プロファイル基本ルール', source: 'ai-scan' })
  }

  // Safe Bash allow rules (compensation for profiles without bare Bash)
  if (profileDef.readOnlyBash) {
    for (const pattern of READ_ONLY_BASH_SAFE) {
      recommendations.push({ action: 'add-allow', pattern, reason: '読み取り専用コマンド', source: 'ai-scan' })
    }
    for (const pattern of READ_ONLY_BASH_FILE_READERS) {
      recommendations.push({ action: 'add-allow', pattern, reason: 'ファイル読み取りコマンド', source: 'ai-scan' })
    }
  }

  // SAFE_BASH_ALLOW_RULES (git, npm, docker safe commands etc.)
  const askSet = new Set(profileDef.ask ?? [])
  const denySet = new Set(allDeny)
  for (const pattern of SAFE_BASH_ALLOW_RULES) {
    if (!askSet.has(pattern) && !denySet.has(pattern)) {
      recommendations.push({ action: 'add-allow', pattern, reason: '安全なBashコマンド', source: 'ai-scan' })
    }
  }

  return recommendations
}

async function runToolScan(profile: ProfileName): Promise<{ recommendations: readonly Recommendation[]; scanned: number; found: number }> {
  process.stdout.write('  インストール済みツールをスキャン中...\n')

  const allBinaries = await scanInstalledBinaries()
  process.stdout.write(`  ${allBinaries.length} バイナリを検出\n`)

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

  // Step 1: Build baseline from profile constants
  const baselineRecs = buildProfileBaselineRecommendations(profile)

  // Step 2: Run AI tool scan for uncovered tools
  let scanRecommendations: readonly Recommendation[] = []
  try {
    const scanResult = await runToolScan(profile)
    scanRecommendations = scanResult.recommendations
  } catch (err) {
    printWarning(`ツールスキャンでエラー: ${err instanceof Error ? err.message : String(err)}`)
  }

  // Step 3: Merge baseline + AI scan (deduplicate, AI takes precedence)
  const aiPatterns = new Set(scanRecommendations.map(r => r.pattern))
  const allRecommendations = [
    ...baselineRecs.filter(r => !aiPatterns.has(r.pattern)),
    ...scanRecommendations,
  ]

  // Display the full picture: what settings.json will look like after apply
  const allowRecs = allRecommendations.filter(r => r.action === 'add-allow')
  const askRecs = allRecommendations.filter(r => r.action === 'add-ask')
  const denyRecs = allRecommendations.filter(r => r.action === 'add-deny')

  process.stdout.write('\n')
  process.stdout.write(`  === 再構成結果（CSG管理ルールをクリアして再設定） ===\n\n`)

  if (denyRecs.length > 0) {
    process.stdout.write(`Deny (${denyRecs.length}件):\n`)
    for (const rec of denyRecs) printRecommendation(rec)
    process.stdout.write('\n')
  }
  if (askRecs.length > 0) {
    process.stdout.write(`Ask (${askRecs.length}件):\n`)
    for (const rec of askRecs) printRecommendation(rec)
    process.stdout.write('\n')
  }
  if (allowRecs.length > 0) {
    process.stdout.write(`Allow (${allowRecs.length}件):\n`)
    for (const rec of allowRecs) printRecommendation(rec)
    process.stdout.write('\n')
  }

  process.stdout.write(`  合計: deny=${denyRecs.length} ask=${askRecs.length} allow=${allowRecs.length}\n`)

  if (options.dryRun) {
    process.stdout.write('\n(dry-run: 変更は適用されません)\n')
    return
  }

  const autoYes = options.yes ?? false
  const interactive = process.stdin.isTTY && process.stdout.isTTY
  const shouldApply = autoYes || (interactive ? await confirm('\nCSG管理ルールをクリアして再構成しますか？') : false)

  if (!shouldApply) return

  const applied = applyRecommendations(settings, allRecommendations)

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

  printSuccess('ルールを再構成しました')
  process.stdout.write(`  deny: ${applied.finalDeny.length}件\n`)
  process.stdout.write(`  ask:  ${applied.finalAsk.length}件\n`)
  process.stdout.write(`  allow: ${applied.finalAllow.length}件\n`)
  if (result.backupPath) {
    process.stdout.write(`  バックアップ: ${result.backupPath}\n`)
  }
  if (applied.hasDenyChanges && hookInfo.hookPath) {
    process.stdout.write(`  フック再生成: ${hookInfo.hookRulesCount} ルール\n`)
  }
}
