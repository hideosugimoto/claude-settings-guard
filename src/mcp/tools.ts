import { existsSync, statSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { runDiagnose, type DiagnoseResult } from '../commands/diagnose.js'
import { runEnforce, type EnforceResult } from '../commands/enforce.js'
import { readGlobalSettings, extractAllRules } from '../core/settings-reader.js'
import {
  loadTelemetryEvents,
  analyzePermissionEvents,
  generateRecommendations,
  getAnalysisPeriod,
} from '../core/telemetry-analyzer.js'
import { groupStatsByPrefix } from '../core/pattern-grouper.js'
import { detectProject } from '../core/project-detector.js'
import { analyzeBypassRisks } from '../core/bypass-analyzer.js'
import { getProfile, isValidProfileName, getProfileNames } from '../profiles/index.js'
import { detectAutoMode } from '../core/automode-detector.js'
import { getGlobalSettingsPath, getLocalSettingsPath, getProjectSettingsPath } from '../utils/paths.js'
import type { Profile, ClaudeSettings } from '../types.js'

export interface McpToolResult {
  readonly content: ReadonlyArray<{ readonly type: 'text'; readonly text: string }>
  readonly isError?: boolean
}

function textResult(text: string, isError = false): McpToolResult {
  return {
    content: [{ type: 'text', text }],
    ...(isError ? { isError: true } : {}),
  }
}

function toJsonResult(value: unknown, isError = false): McpToolResult {
  return textResult(JSON.stringify(value, null, 2), isError)
}

const MAX_DENY_RULES = 100

function sanitizeCwd(args: Record<string, unknown>): string | McpToolResult {
  const raw = args.cwd
  if (raw === undefined || raw === null) return process.cwd()
  if (typeof raw !== 'string') return textResult('Invalid cwd: must be a string', true)
  if (!isAbsolute(raw)) return textResult('Invalid cwd: must be an absolute path', true)
  try {
    const stat = statSync(raw)
    if (!stat.isDirectory()) return textResult('Invalid cwd: path is not a directory', true)
  } catch {
    return textResult('Invalid cwd: path does not exist', true)
  }
  return raw
}

function getRulesFromSettings(settings: ClaudeSettings | null): {
  readonly allowRules: readonly string[]
  readonly denyRules: readonly string[]
  readonly askRules: readonly string[]
  readonly legacyAllowedTools: readonly string[]
  readonly legacyDeny: readonly string[]
} {
  if (!settings) {
    return {
      allowRules: [],
      denyRules: [],
      askRules: [],
      legacyAllowedTools: [],
      legacyDeny: [],
    }
  }
  return extractAllRules(settings)
}

function isAlreadyCovered(
  wildcardPattern: string,
  allowRules: readonly string[],
  denyRules: readonly string[]
): boolean {
  return allowRules.includes(wildcardPattern) || denyRules.includes(wildcardPattern)
}

function hasHookCommand(
  rules: readonly { readonly hooks: readonly { readonly command: string }[] }[] | undefined,
  commandKeyword: string
): boolean {
  if (!rules) return false
  return rules.some(rule =>
    rule.hooks.some(hook => hook.command.includes(commandKeyword))
  )
}

function checkEnforceHookInstalled(settings: ClaudeSettings | null): boolean {
  if (!settings) return false

  const preToolUse = settings.PreToolUse
  const preToolUseLegacy = settings.hooks?.PreToolUse

  return hasHookCommand(preToolUse, 'enforce-permissions') ||
    hasHookCommand(preToolUseLegacy, 'enforce-permissions')
}

function checkSessionDiagnoseHookInstalled(settings: ClaudeSettings | null): boolean {
  if (!settings) return false

  const sessionStart = settings.SessionStart
  const sessionStartLegacy = settings.hooks?.SessionStart

  return hasHookCommand(sessionStart, 'session-diagnose') ||
    hasHookCommand(sessionStartLegacy, 'session-diagnose')
}

export async function handleDiagnose(args: Record<string, unknown> = {}): Promise<McpToolResult> {
  const cwdResult = sanitizeCwd(args)
  if (typeof cwdResult !== 'string') return cwdResult

  const result: DiagnoseResult = await runDiagnose()
  const settings = await readGlobalSettings()
  const rules = getRulesFromSettings(settings)

  const cwd = cwdResult
  const globalSettingsPath = getGlobalSettingsPath()
  const localSettingsPath = getLocalSettingsPath()
  const projectSettingsPath = getProjectSettingsPath(cwd)

  const message =
    result.totalPatterns === 0 && result.issues.length === 0
      ? 'settings.json が見つかりません'
      : result.issues.length === 0
        ? `全 ${result.totalPatterns} パターンを診断: 問題なし`
        : `合計: ${result.totalPatterns} パターン, ${result.issues.length} 件の問題`

  const output = {
    message,
    summary: {
      totalPatterns: result.totalPatterns,
      issueCount: result.issues.length,
      critical: result.issues.filter(issue => issue.severity === 'critical').length,
      warning: result.issues.filter(issue => issue.severity === 'warning').length,
      info: result.issues.filter(issue => issue.severity === 'info').length,
    },
    issues: result.issues,
    rules: {
      allow: rules.allowRules,
      deny: rules.denyRules,
      ask: rules.askRules,
      legacyAllowedTools: rules.legacyAllowedTools,
      legacyDeny: rules.legacyDeny,
    },
    hooks: {
      enforceHookInstalled: checkEnforceHookInstalled(settings),
      sessionDiagnoseHookInstalled: checkSessionDiagnoseHookInstalled(settings),
    },
    autoMode: settings ? detectAutoMode(settings) : { enabled: false, hasConfig: false, hasEnforceHook: false },
    settingsFiles: {
      global: { path: globalSettingsPath, exists: existsSync(globalSettingsPath) },
      local: { path: localSettingsPath, exists: existsSync(localSettingsPath) },
      project: { path: projectSettingsPath, exists: existsSync(projectSettingsPath) },
    },
  }

  return toJsonResult(output, result.totalPatterns === 0 && result.issues.length === 0)
}

export async function handleRecommend(args: Record<string, unknown>): Promise<McpToolResult> {
  const settings = await readGlobalSettings()
  const rules = getRulesFromSettings(settings)
  const allow = rules.allowRules
  const deny = rules.denyRules
  const ask = rules.askRules
  const legacyAllowedTools = rules.legacyAllowedTools
  const legacyDeny = rules.legacyDeny

  const allAllow = [...allow, ...legacyAllowedTools]
  const allDeny = [...deny, ...legacyDeny]

  const { events, skippedLines } = await loadTelemetryEvents()
  const stats = analyzePermissionEvents(events)
  const period = getAnalysisPeriod(events)

  const grouped = groupStatsByPrefix(stats)
  const recommendations = generateRecommendations(stats, allAllow, allDeny)

  const cwdResult = sanitizeCwd(args)
  if (typeof cwdResult !== 'string') return cwdResult
  const cwd = cwdResult
  const projectContext = await detectProject(cwd)

  const toolStats = [...stats.values()]
    .sort((a, b) => {
      const aTotal = a.allowed + a.denied + a.prompted
      const bTotal = b.allowed + b.denied + b.prompted
      return bTotal - aTotal
    })

  return toJsonResult({
    currentRules: {
      allow,
      deny,
      ask,
      legacyAllowedTools,
      legacyDeny,
    },
    telemetry: {
      totalEvents: events.length,
      skippedLines,
      analyzedPeriod: period,
      toolStats,
    },
    groupedPatterns: grouped.map(group => ({
      ...group,
      alreadyCovered: isAlreadyCovered(group.wildcardPattern, allAllow, allDeny),
    })),
    recommendations,
    projectContext,
  })
}

export async function handleAssessRisk(args: Record<string, unknown>): Promise<McpToolResult> {
  const denyRules = Array.isArray(args.denyRules)
    ? args.denyRules.filter((rule): rule is string => typeof rule === 'string').slice(0, MAX_DENY_RULES)
    : null

  const settings = await readGlobalSettings()
  const rules = getRulesFromSettings(settings)
  const effectiveRules = denyRules ?? [...rules.denyRules, ...rules.legacyDeny].slice(0, MAX_DENY_RULES)

  const assessment = analyzeBypassRisks(effectiveRules, checkEnforceHookInstalled(settings))
  return toJsonResult(assessment)
}

export async function handleEnforce(args: Record<string, unknown>): Promise<McpToolResult> {
  const dryRun = typeof args.dryRun === 'boolean' ? args.dryRun : false
  const result: EnforceResult | null = await runEnforce()

  if (!result) {
    return textResult('settings.json が見つかりません', true)
  }

  if (result.denyRules.length === 0) {
    return textResult('deny ルールがないため、フック生成をスキップしました')
  }

  if (dryRun) {
    const lines = [
      `deny ルール (${result.denyRules.length}件):`,
      ...result.denyRules.map(r => `  - ${r}`),
      '',
      '--- 生成されるスクリプト (dry-run) ---',
      result.script,
    ]
    return textResult(lines.join('\n'))
  }

  return textResult(
    `${result.denyRules.length} 件の deny ルールから強制フックを生成しました。\n` +
    '適用するには: npx claude-settings-guard enforce'
  )
}

export async function handleSetup(args: Record<string, unknown>): Promise<McpToolResult> {
  const profileName = typeof args.profile === 'string' ? args.profile : 'balanced'

  if (!isValidProfileName(profileName)) {
    const safeProfileName = profileName.slice(0, 50)
    return textResult(
      `不明なプロファイル: ${safeProfileName}。有効な値: ${getProfileNames().join(', ')}`,
      true
    )
  }

  const profile: Profile = getProfile(profileName)

  return textResult(
    `プロファイル "${profile.name}" を適用するには以下を実行してください:\n\n` +
    `npx claude-settings-guard init --profile ${profile.name}\n\n` +
    'MCP ツールからの直接適用はセキュリティ上の理由で無効化されています。\n' +
    '`csg init` を実行すると CLAUDE.md も自動的に更新されます。'
  )
}
