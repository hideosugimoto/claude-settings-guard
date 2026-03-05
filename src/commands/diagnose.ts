import { readGlobalSettings, extractAllRules } from '../core/settings-reader.js'
import { validatePatterns, findConflicts } from '../core/pattern-validator.js'
import { printHeader, printIssue, printSuccess } from '../utils/display.js'
import type { DiagnosticIssue } from '../types.js'

export interface DiagnoseResult {
  readonly issues: readonly DiagnosticIssue[]
  readonly totalPatterns: number
}

export async function runDiagnose(): Promise<DiagnoseResult> {
  const settings = await readGlobalSettings()
  if (!settings) {
    return { issues: [], totalPatterns: 0 }
  }

  const rules = extractAllRules(settings)
  const allIssues: DiagnosticIssue[] = []

  if (rules.legacyAllowedTools.length > 0) {
    allIssues.push({
      severity: 'warning',
      code: 'STRUCTURE_ISSUE',
      message: `allowedTools (トップレベル) に ${rules.legacyAllowedTools.length} 個のルールがあります`,
      fix: '`csg migrate` で permissions.allow に移行してください',
    })
  }

  if (rules.legacyDeny.length > 0) {
    allIssues.push({
      severity: 'warning',
      code: 'STRUCTURE_ISSUE',
      message: `deny (トップレベル) に ${rules.legacyDeny.length} 個のルールがあります`,
      fix: '`csg migrate` で permissions.deny に移行してください',
    })
  }

  allIssues.push(...validatePatterns(rules.legacyAllowedTools, 'allowedTools'))
  allIssues.push(...validatePatterns(rules.legacyDeny, 'deny'))
  allIssues.push(...validatePatterns(rules.allowRules, 'allow'))
  allIssues.push(...validatePatterns(rules.denyRules, 'deny'))

  const allAllow = [...rules.allowRules, ...rules.legacyAllowedTools]
  const allDeny = [...rules.denyRules, ...rules.legacyDeny]
  allIssues.push(...findConflicts(allAllow, allDeny))

  const severityOrder = { critical: 0, warning: 1, info: 2 }
  const sorted = [...allIssues].sort(
    (a, b) => severityOrder[a.severity] - severityOrder[b.severity]
  )

  const totalPatterns =
    rules.legacyAllowedTools.length +
    rules.legacyDeny.length +
    rules.allowRules.length +
    rules.denyRules.length

  return { issues: sorted, totalPatterns }
}

export async function diagnoseCommand(): Promise<void> {
  printHeader('Claude Settings Guard - 診断レポート')

  const { issues, totalPatterns } = await runDiagnose()

  if (totalPatterns === 0 && issues.length === 0) {
    process.stdout.write('settings.json が見つかりません\n')
    process.exit(1)
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
