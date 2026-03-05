import { runDiagnose, type DiagnoseResult } from '../commands/diagnose.js'
import { runEnforce, type EnforceResult } from '../commands/enforce.js'
import { getProfile, isValidProfileName, getProfileNames } from '../profiles/index.js'
import type { Profile } from '../types.js'

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

export async function handleDiagnose(): Promise<McpToolResult> {
  const result: DiagnoseResult = await runDiagnose()

  if (result.totalPatterns === 0 && result.issues.length === 0) {
    return textResult('settings.json が見つかりません', true)
  }

  if (result.issues.length === 0) {
    return textResult(`全 ${result.totalPatterns} パターンを診断: 問題なし`)
  }

  const lines = result.issues.map(issue =>
    `[${issue.severity.toUpperCase()}] ${issue.message}${issue.fix ? ` (Fix: ${issue.fix})` : ''}`
  )
  lines.push(`\n合計: ${result.totalPatterns} パターン, ${result.issues.length} 件の問題`)

  return textResult(lines.join('\n'))
}

export async function handleRecommend(args: { profile?: string }): Promise<McpToolResult> {
  const profileName = args.profile ?? 'balanced'

  if (!isValidProfileName(profileName)) {
    return textResult(
      `不明なプロファイル: ${profileName}。有効な値: ${getProfileNames().join(', ')}`,
      true
    )
  }

  const profile: Profile = getProfile(profileName)

  const lines = [
    `プロファイル: ${profile.name} - ${profile.description}`,
    '',
    `deny ルール (${profile.deny.length}件):`,
    ...profile.deny.map(r => `  - ${r}`),
    '',
    `allow ルール (${profile.allow.length}件):`,
    ...profile.allow.map(r => `  - ${r}`),
  ]

  if (profile.ask && profile.ask.length > 0) {
    lines.push('', `ask ルール (${profile.ask.length}件):`)
    lines.push(...profile.ask.map(r => `  - ${r}`))
  }

  lines.push(
    '',
    `フック: enforce=${profile.hooks.enforce}, sessionDiagnose=${profile.hooks.sessionDiagnose}`,
    '',
    `適用するには: npx claude-settings-guard init --profile ${profile.name}`
  )

  return textResult(lines.join('\n'))
}

export async function handleEnforce(args: { dryRun?: boolean }): Promise<McpToolResult> {
  const result: EnforceResult | null = await runEnforce()

  if (!result) {
    return textResult('settings.json が見つかりません', true)
  }

  if (result.denyRules.length === 0) {
    return textResult('deny ルールがないため、フック生成をスキップしました')
  }

  if (args.dryRun) {
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

export async function handleSetup(args: { profile?: string }): Promise<McpToolResult> {
  const profileName = args.profile ?? 'balanced'

  if (!isValidProfileName(profileName)) {
    return textResult(
      `不明なプロファイル: ${profileName}。有効な値: ${getProfileNames().join(', ')}`,
      true
    )
  }

  return textResult(
    `プロファイル "${profileName}" を適用するには以下を実行してください:\n\n` +
    `npx claude-settings-guard init --profile ${profileName}\n\n` +
    'MCP ツールからの直接適用はセキュリティ上の理由で無効化されています。'
  )
}
