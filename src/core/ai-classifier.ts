import { spawnSync } from 'node:child_process'
import { z } from 'zod'
import type { ProfileName, AiToolClassification, RiskLevel, Recommendation, RecommendAction } from '../types.js'

const PROFILE_DESCRIPTIONS: Record<ProfileName, string> = {
  minimal: `速度重視。ほとんどのツールは safe に分類せよ。外部への不可逆な変更（本番デプロイ、データ削除、リモートへの書き込み等）のみ needs-confirmation とし、特権昇格（sudo, su）やシステム破壊（rm -rf /）のみ dangerous とせよ。`,
  balanced: `開発の利便性とセキュリティのバランス。ローカル開発ツール（ビルド、テスト、lint、フォーマッタ）は safe。外部状態を変更するもの（DB操作、ネットワーク送信、デプロイ、publish）は needs-confirmation。特権昇格・壊滅的破壊操作は dangerous。`,
  smart: `AutoMode 相当の基準。ローカル開発（ビルド、テスト、lint、git操作）は safe。外部通信・インフラ変更・リモートシェル・クラウド操作・DB変更は needs-confirmation。特権昇格（sudo, su）・壊滅的破壊（rm -rf /）・コード実行難読化（eval）は dangerous。`,
  strict: `セキュリティ最優先。読み取り専用・純粋なローカル処理のみ safe。外部通信を含む全てのネットワーク操作・DB操作・インフラ変更・パッケージインストールは needs-confirmation。特権昇格・破壊操作・eval・base64 は dangerous。`,
}

const RISK_TO_ACTION: Record<ProfileName, Record<Exclude<RiskLevel, 'skip'>, RecommendAction>> = {
  minimal: { safe: 'add-allow', 'needs-confirmation': 'add-allow', dangerous: 'add-ask' },
  balanced: { safe: 'add-allow', 'needs-confirmation': 'add-ask', dangerous: 'add-ask' },
  smart: { safe: 'add-allow', 'needs-confirmation': 'add-ask', dangerous: 'add-deny' },
  strict: { safe: 'add-allow', 'needs-confirmation': 'add-ask', dangerous: 'add-deny' },
}

const subcommandSchema = z.object({
  pattern: z.string().optional(),
  subcommand: z.string().optional(),
  command: z.string().optional(),
  risk: z.enum(['safe', 'needs-confirmation', 'dangerous']),
  reason: z.string(),
}).transform(val => ({
  pattern: val.pattern ?? val.subcommand ?? val.command ?? '',
  risk: val.risk,
  reason: val.reason,
}))

const classificationSchema = z.object({
  tool: z.string(),
  risk: z.enum(['safe', 'needs-confirmation', 'dangerous', 'skip']),
  reason: z.string(),
  subcommands: z.array(subcommandSchema).optional(),
})

const responseSchema = z.array(classificationSchema)

function buildPrompt(tools: readonly string[], profile: ProfileName): string {
  const profileDesc = PROFILE_DESCRIPTIONS[profile]
  const toolList = tools.join('\n')

  return `You are a security classifier for Claude Code (an AI coding assistant that executes CLI commands).
Your job is to classify CLI tools that a developer has installed on their machine.

IMPORTANT: First, determine if each tool is relevant to an AI coding session. Many installed binaries are system utilities, media codecs, crypto test tools, or other programs that Claude Code would never need to execute. Classify those as "skip".

Profile: ${profile}
Criteria: ${profileDesc}

Risk levels:
- "skip": NOT a development tool. System utility, media codec, crypto test, hardware diagnostic, or other tool that Claude Code would never use in a coding session. Use this for the majority of obscure system binaries.
- "safe": Development tool that can be auto-allowed. Low risk, no side effects outside the project. Examples: linters, formatters, build tools, local test runners.
- "needs-confirmation": Development tool that requires user confirmation. Modifies external state, network operations, deployment, package installation from network. Examples: package managers (install), database clients, cloud CLIs.
- "dangerous": Tool that should be blocked. Privilege escalation, system destruction, or obfuscated execution.

For tools classified as safe/needs-confirmation/dangerous that have mixed-risk subcommands (e.g., brew list=safe, brew install=needs-confirmation), provide subcommand-level classification. Only add subcommands when the tool genuinely has different risk levels for different operations.

Classify these ${tools.length} tools:
${toolList}

Respond with ONLY a JSON array (no markdown, no explanation):
[{"tool":"name","risk":"skip|safe|needs-confirmation|dangerous","reason":"brief explanation"}]`
}

function stripMarkdownFences(raw: string): string {
  return raw
    .replace(/^```(?:json)?\s*\n?/gm, '')
    .replace(/\n?```\s*$/gm, '')
    .trim()
}

function parseResponse(raw: string): readonly AiToolClassification[] {
  const cleaned = stripMarkdownFences(raw)

  const jsonStart = cleaned.indexOf('[')
  const jsonEnd = cleaned.lastIndexOf(']')
  if (jsonStart === -1 || jsonEnd === -1) return []

  const jsonStr = cleaned.slice(jsonStart, jsonEnd + 1)
  const parsed: unknown = JSON.parse(jsonStr)
  return responseSchema.parse(parsed)
}

/**
 * Check if Claude CLI is available.
 */
export function isClaudeAvailable(): boolean {
  const result = spawnSync('which', ['claude'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 5_000,
  })
  return result.status === 0
}

const MAX_TOOLS = 200
const BATCH_SIZE = 100

/**
 * Classify tools using Claude CLI.
 * Limits to MAX_TOOLS and batches into groups of BATCH_SIZE.
 */
export function classifyTools(
  tools: readonly string[],
  profile: ProfileName,
): readonly AiToolClassification[] {
  const limited = tools.length > MAX_TOOLS
    ? tools.slice(0, MAX_TOOLS)
    : tools

  const results: AiToolClassification[] = []

  for (let i = 0; i < limited.length; i += BATCH_SIZE) {
    const batch = limited.slice(i, i + BATCH_SIZE)
    process.stdout.write(`  バッチ ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(limited.length / BATCH_SIZE)} (${batch.length}ツール)...\n`)
    try {
      const prompt = buildPrompt(batch, profile)
      const batchResults = callClaude(prompt)
      results.push(...batchResults)
    } catch (err) {
      process.stderr.write(`  [warn] バッチ ${Math.floor(i / BATCH_SIZE) + 1} の分類に失敗、スキップ: ${err instanceof Error ? err.message : String(err)}\n`)
    }
  }

  if (tools.length > MAX_TOOLS) {
    process.stdout.write(`  ※ ${tools.length - MAX_TOOLS} ツールはスキップされました（上限: ${MAX_TOOLS}）\n`)
  }

  return results
}

function callClaude(prompt: string): readonly AiToolClassification[] {
  // Use --output-format text to avoid JSON wrapping issues with escaped characters
  const result = spawnSync('claude', ['--print', '-p', prompt], {
    input: '',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 120_000,
    maxBuffer: 1024 * 1024,
  })

  if (result.status !== 0) {
    const stderr = result.stderr?.toString() ?? ''
    throw new Error(`Claude CLI failed (exit ${result.status}): ${stderr.slice(0, 200)}`)
  }

  const stdout = result.stdout?.toString() ?? ''
  if (!stdout.trim()) {
    throw new Error('Claude CLI returned empty response')
  }

  return parseResponse(stdout)
}

/**
 * Convert AI classifications to Recommendation objects based on profile.
 * Skips tools classified as "skip".
 */
export function classificationsToRecommendations(
  classifications: readonly AiToolClassification[],
  profile: ProfileName,
): readonly Recommendation[] {
  const mapping = RISK_TO_ACTION[profile]
  const recommendations: Recommendation[] = []

  for (const classification of classifications) {
    // Skip tools AI determined are not relevant for coding sessions
    if (classification.risk === 'skip') continue

    if (classification.subcommands && classification.subcommands.length > 0) {
      for (const sub of classification.subcommands) {
        // Skip empty patterns from AI response
        if (!sub.pattern) continue

        // Ensure pattern includes the tool name prefix
        let pattern: string
        if (sub.pattern.startsWith('Bash(')) {
          pattern = sub.pattern
        } else if (sub.pattern.startsWith(classification.tool)) {
          pattern = `Bash(${sub.pattern})`
        } else {
          // AI returned just the subcommand (e.g., "list" instead of "brew list")
          const suffix = sub.pattern.endsWith(' *') || sub.pattern.endsWith(')')
            ? sub.pattern
            : `${sub.pattern} *`
          pattern = `Bash(${classification.tool} ${suffix})`
        }
        recommendations.push({
          action: mapping[sub.risk],
          pattern,
          reason: `${classification.tool}: ${sub.reason}`,
          source: 'ai-scan',
        })
      }
    } else {
      recommendations.push({
        action: mapping[classification.risk],
        pattern: `Bash(${classification.tool} *)`,
        reason: classification.reason,
        source: 'ai-scan',
      })
    }
  }

  return recommendations
}
