import { existsSync } from 'node:fs'
import { readGlobalSettings, extractAllRules } from '../core/settings-reader.js'
import { validatePatterns, findConflicts, checkAllowAskConflicts, checkAllowDenyConflicts, checkBareToolConflicts, checkMissingPairedDenyRules, checkCrossToolBypasses, checkPrefixBypasses } from '../core/pattern-validator.js'
import { printHeader, printIssue, printSuccess } from '../utils/display.js'
import { exitWithError } from '../utils/exit.js'
import { getHooksDir } from '../utils/paths.js'
import { isJqAvailable } from '../utils/jq-check.js'
import { join } from 'node:path'
import type { DiagnosticIssue } from '../types.js'

export interface DiagnoseResult {
  readonly issues: readonly DiagnosticIssue[]
  readonly totalPatterns: number
}

/**
 * Downgrade CROSS_TOOL_BYPASS and PREFIX_BYPASS_RISK issues when
 * the Layer 2 enforce hook is already installed, since the hook
 * mitigates these risks at runtime.
 */
export function downgradeIfHookInstalled(
  issues: readonly DiagnosticIssue[],
  hookInstalled: boolean,
): readonly DiagnosticIssue[] {
  if (!hookInstalled) return [...issues]

  const DOWNGRADE_CODES: ReadonlySet<string> = new Set([
    'CROSS_TOOL_BYPASS',
    'PREFIX_BYPASS_RISK',
  ])

  return issues.map(issue => {
    if (!DOWNGRADE_CODES.has(issue.code)) return { ...issue }

    return {
      ...issue,
      severity: 'info' as const,
      fix: 'Layer 2 enforce フックがインストール済みのため、ランタイムで保護されています',
    }
  })
}

export async function runDiagnose(): Promise<DiagnoseResult> {
  const settings = await readGlobalSettings()
  if (!settings) {
    return { issues: [], totalPatterns: 0 }
  }

  const rules = extractAllRules(settings)

  const structureIssues: readonly DiagnosticIssue[] = [
    ...(rules.legacyAllowedTools.length > 0 ? [{
      severity: 'warning' as const,
      code: 'STRUCTURE_ISSUE' as const,
      message: `allowedTools (トップレベル) に ${rules.legacyAllowedTools.length} 個のルールがあります`,
      fix: '`csg migrate` で permissions.allow に移行してください',
    }] : []),
    ...(rules.legacyDeny.length > 0 ? [{
      severity: 'warning' as const,
      code: 'STRUCTURE_ISSUE' as const,
      message: `deny (トップレベル) に ${rules.legacyDeny.length} 個のルールがあります`,
      fix: '`csg migrate` で permissions.deny に移行してください',
    }] : []),
  ]

  const allIssues: readonly DiagnosticIssue[] = [
    ...structureIssues,
    ...validatePatterns(rules.legacyAllowedTools, 'allowedTools'),
    ...validatePatterns(rules.legacyDeny, 'deny'),
    ...validatePatterns(rules.allowRules, 'allow'),
    ...validatePatterns(rules.denyRules, 'deny'),
    ...findConflicts(
      [...rules.allowRules, ...rules.legacyAllowedTools],
      [...rules.denyRules, ...rules.legacyDeny],
    ),
    ...checkMissingPairedDenyRules([...rules.denyRules, ...rules.legacyDeny]),
    ...checkCrossToolBypasses(
      [...rules.allowRules, ...rules.legacyAllowedTools],
      [...rules.denyRules, ...rules.legacyDeny],
    ),
    ...checkPrefixBypasses(
      [...rules.allowRules, ...rules.legacyAllowedTools],
      [...rules.denyRules, ...rules.legacyDeny],
    ),
    ...checkAllowAskConflicts(
      [...rules.allowRules, ...rules.legacyAllowedTools],
      rules.askRules,
    ),
    ...checkAllowDenyConflicts(
      [...rules.allowRules, ...rules.legacyAllowedTools],
      [...rules.denyRules, ...rules.legacyDeny],
    ),
    ...checkBareToolConflicts(
      [...rules.allowRules, ...rules.legacyAllowedTools],
      rules.askRules,
    ),
  ]

  // Check if Layer 2 enforce hook is installed
  const hookPath = join(getHooksDir(), 'enforce-permissions.sh')
  const hookInstalled = existsSync(hookPath) ||
    (settings.PreToolUse ?? []).some(rule =>
      rule.hooks.some(h => h.command.includes('enforce-permissions'))
    )

  const adjustedIssues = downgradeIfHookInstalled(allIssues, hookInstalled)

  const jqIssues: readonly DiagnosticIssue[] = (hookInstalled && !isJqAvailable())
    ? [{
      severity: 'info' as const,
      code: 'JQ_NOT_FOUND' as const,
      message: 'jq がインストールされていません。enforce フックの実行に jq が必要です。',
      fix: 'インストール: brew install jq (macOS) / apt install jq (Ubuntu)',
    }]
    : []

  const severityOrder = { critical: 0, warning: 1, info: 2 }
  const sorted = [...adjustedIssues, ...jqIssues].sort(
    (a, b) => severityOrder[a.severity] - severityOrder[b.severity]
  )

  const totalPatterns =
    rules.legacyAllowedTools.length +
    rules.legacyDeny.length +
    rules.allowRules.length +
    rules.denyRules.length

  return { issues: sorted, totalPatterns }
}

export function shouldExitWithError(issues: readonly DiagnosticIssue[]): boolean {
  return issues.some(i => i.severity === 'critical' || i.severity === 'warning')
}

export interface DiagnoseCommandOptions {
  json?: boolean
  quiet?: boolean
}

export async function diagnoseCommand(options: DiagnoseCommandOptions = {}): Promise<void> {
  const { issues, totalPatterns } = await runDiagnose()

  // --json mode: output machine-readable JSON
  if (options.json) {
    const filteredIssues = options.quiet
      ? issues.filter(i => i.severity === 'critical' || i.severity === 'warning')
      : issues

    const output = {
      totalPatterns,
      issues: filteredIssues,
      summary: {
        critical: issues.filter(i => i.severity === 'critical').length,
        warning: issues.filter(i => i.severity === 'warning').length,
        info: issues.filter(i => i.severity === 'info').length,
      },
    }

    process.stdout.write(JSON.stringify(output, null, 2) + '\n')

    if (shouldExitWithError(filteredIssues)) {
      process.exit(1)
    }
    return
  }

  printHeader('Claude Settings Guard - 診断レポート')

  if (totalPatterns === 0 && issues.length === 0) {
    exitWithError('settings.json が見つかりません')
  }

  if (issues.length === 0) {
    printSuccess('問題は見つかりませんでした')
    return
  }

  for (const issue of issues) {
    printIssue(issue)
  }

  const critical = issues.filter(i => i.severity === 'critical').length
  const warnings = issues.filter(i => i.severity === 'warning').length
  const info = issues.filter(i => i.severity === 'info').length

  process.stdout.write('\n--- サマリー ---\n')
  if (critical > 0) process.stdout.write(`  CRITICAL: ${critical}\n`)
  if (warnings > 0) process.stdout.write(`  WARNING: ${warnings}\n`)
  if (info > 0) process.stdout.write(`  INFO: ${info}\n`)

  process.stdout.write(`\n  合計パターン数: ${totalPatterns}\n`)
}
