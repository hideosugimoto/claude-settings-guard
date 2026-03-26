import { spawnSync } from 'node:child_process'
import { z } from 'zod'
import type { ProfileName, AiToolClassification, RiskLevel, Recommendation, RecommendAction } from '../types.js'

const PROFILE_DESCRIPTIONS: Record<ProfileName, string> = {
  minimal: `速度重視。ほとんどのツールは safe に分類せよ。外部への不可逆な変更（本番デプロイ、データ削除、リモートへの書き込み等）のみ needs-confirmation とし、特権昇格（sudo, su）やシステム破壊（rm -rf /）のみ dangerous とせよ。`,
  balanced: `開発の利便性とセキュリティのバランス。ローカル開発ツール（ビルド、テスト、lint、フォーマッタ）は safe。外部状態を変更するもの（DB操作、ネットワーク送信、デプロイ、publish）は needs-confirmation。特権昇格・壊滅的破壊操作は dangerous。`,
  smart: `AutoMode 相当の基準。ローカル開発（ビルド、テスト、lint、git操作）は safe。外部通信・インフラ変更・リモートシェル・クラウド操作・DB変更は needs-confirmation。特権昇格（sudo, su）・壊滅的破壊（rm -rf /）・コード実行難読化（eval）は dangerous。`,
  strict: `セキュリティ最優先。読み取り専用・純粋なローカル処理のみ safe。外部通信を含む全てのネットワーク操作・DB操作・インフラ変更・パッケージインストールは needs-confirmation。特権昇格・破壊操作・eval・base64 は dangerous。`,
}

const RISK_TO_ACTION: Record<ProfileName, Record<RiskLevel, RecommendAction>> = {
  minimal: { safe: 'add-allow', 'needs-confirmation': 'add-allow', dangerous: 'add-ask' },
  balanced: { safe: 'add-allow', 'needs-confirmation': 'add-ask', dangerous: 'add-ask' },
  smart: { safe: 'add-allow', 'needs-confirmation': 'add-ask', dangerous: 'add-deny' },
  strict: { safe: 'add-allow', 'needs-confirmation': 'add-ask', dangerous: 'add-deny' },
}

const subcommandSchema = z.object({
  pattern: z.string(),
  risk: z.enum(['safe', 'needs-confirmation', 'dangerous']),
  reason: z.string(),
})

const classificationSchema = z.object({
  tool: z.string(),
  risk: z.enum(['safe', 'needs-confirmation', 'dangerous']),
  reason: z.string(),
  subcommands: z.array(subcommandSchema).optional(),
})

const responseSchema = z.array(classificationSchema)

function buildPrompt(tools: readonly string[], profile: ProfileName): string {
  const profileDesc = PROFILE_DESCRIPTIONS[profile]
  const toolList = tools.join('\n')

  return `You are a security classifier for Claude Code (an AI coding assistant that executes CLI commands).
Classify each CLI tool by risk level for use inside an AI coding session.

Profile: ${profile}
Criteria: ${profileDesc}

Risk levels:
- "safe": The tool can be auto-allowed. Low risk, no side effects outside the project.
- "needs-confirmation": The tool requires user confirmation before execution. Modifies external state or has potential for damage.
- "dangerous": The tool should be blocked. Privilege escalation, system destruction, or obfuscated execution.

For tools with mixed-risk subcommands (e.g., kubectl get=safe, kubectl delete=needs-confirmation), provide subcommand-level classification in the "subcommands" array. Use the format "toolname subcommand" for the pattern field (e.g., "kubectl get *", "kubectl delete *"). Only add subcommands when the tool genuinely has different risk levels for different operations.

Classify these ${tools.length} tools:
${toolList}

Respond with ONLY a JSON array (no markdown, no explanation):
[{"tool":"name","risk":"safe|needs-confirmation|dangerous","reason":"brief explanation","subcommands":[{"pattern":"name subcommand *","risk":"safe|needs-confirmation|dangerous","reason":"brief"}]}]`
}

function stripMarkdownFences(raw: string): string {
  return raw
    .replace(/^```(?:json)?\s*\n?/gm, '')
    .replace(/\n?```\s*$/gm, '')
    .trim()
}

function parseResponse(raw: string): readonly AiToolClassification[] {
  const cleaned = stripMarkdownFences(raw)

  // Try to find JSON array in the response
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

/**
 * Classify tools using Claude CLI.
 * Batches into groups of 30 to avoid token limits.
 */
export async function classifyTools(
  tools: readonly string[],
  profile: ProfileName,
): Promise<readonly AiToolClassification[]> {
  const batchSize = 30
  const results: AiToolClassification[] = []

  for (let i = 0; i < tools.length; i += batchSize) {
    const batch = tools.slice(i, i + batchSize)
    const prompt = buildPrompt(batch, profile)
    const batchResults = callClaude(prompt)
    results.push(...batchResults)
  }

  return results
}

function callClaude(prompt: string): readonly AiToolClassification[] {
  const result = spawnSync('claude', ['--print', '--output-format', 'json', '-p', prompt], {
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

  try {
    // --output-format json wraps in {"result":"..."}
    const outer = JSON.parse(stdout)
    const inner = typeof outer.result === 'string' ? outer.result : stdout
    return parseResponse(inner)
  } catch {
    // Fallback: try parsing stdout directly
    return parseResponse(stdout)
  }
}

/**
 * Convert AI classifications to Recommendation objects based on profile.
 */
export function classificationsToRecommendations(
  classifications: readonly AiToolClassification[],
  profile: ProfileName,
): readonly Recommendation[] {
  const mapping = RISK_TO_ACTION[profile]
  const recommendations: Recommendation[] = []

  for (const classification of classifications) {
    if (classification.subcommands && classification.subcommands.length > 0) {
      // Subcommand-level recommendations
      for (const sub of classification.subcommands) {
        const pattern = sub.pattern.startsWith('Bash(')
          ? sub.pattern
          : `Bash(${sub.pattern})`
        recommendations.push({
          action: mapping[sub.risk],
          pattern,
          reason: `${classification.tool}: ${sub.reason}`,
          source: 'ai-scan',
        })
      }
    } else {
      // Tool-level recommendation
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
