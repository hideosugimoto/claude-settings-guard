import {
  BARE_TOOL_PATTERN,
  LEGACY_COLON_PATTERN,
  MODERN_SPACE_PATTERN,
} from '../constants.js'
import { checkPipeVulnerability } from '../utils/command-parser.js'
import { parsePattern, isValidToolName } from './pattern-parser.js'
import type { PermissionRule, DiagnosticIssue } from '../types.js'

// Re-export from pattern-parser for backward compatibility
export { parsePattern, isLegacySyntax, isValidToolName } from './pattern-parser.js'

// Re-export from bypass-detector for backward compatibility
export {
  checkMissingPairedDenyRules,
  checkCrossToolBypasses,
  checkPrefixBypasses,
} from './bypass-detector.js'

export function validatePatterns(
  patterns: readonly string[],
  source: PermissionRule['source']
): readonly DiagnosticIssue[] {
  const issues: DiagnosticIssue[] = []
  const legacyPatterns: string[] = []
  const invalidTools: string[] = []

  for (const pattern of patterns) {
    const rule = parsePattern(pattern, source)

    if (rule.isLegacy) {
      legacyPatterns.push(pattern)
    }

    if (!isValidToolName(rule.toolName)) {
      invalidTools.push(`${pattern} (unknown tool: ${rule.toolName})`)
    }
  }

  if (legacyPatterns.length > 0) {
    issues.push({
      severity: 'critical',
      code: 'LEGACY_SYNTAX',
      message: `Legacy colon syntax detected in ${source} (${legacyPatterns.length} patterns)`,
      details: legacyPatterns,
      fix: '`csg migrate` で一括変換できます',
    })
  }

  if (invalidTools.length > 0) {
    issues.push({
      severity: 'warning',
      code: 'INVALID_TOOL',
      message: `Unknown tool names in ${source}`,
      details: invalidTools,
    })
  }

  // Check for pipe vulnerability in deny Bash patterns
  if (source === 'deny') {
    const vulnerablePatterns: string[] = []
    for (const pattern of patterns) {
      const issue = checkPipeVulnerability(pattern)
      if (issue !== null) {
        vulnerablePatterns.push(pattern)
      }
    }
    if (vulnerablePatterns.length > 0) {
      issues.push({
        severity: 'info',
        code: 'PIPE_VULNERABLE',
        message: `Bash deny patterns can be bypassed via pipes, chains (&&, ||), or command substitution`,
        details: vulnerablePatterns,
        fix: '`csg enforce` で合成コマンド対応のフックを生成してください',
      })
    }
  }

  return issues
}

/**
 * Detect bare tool names in allow that override specific ask patterns.
 * e.g., bare "Bash" in allow overrides "Bash(git push *)" in ask.
 */
export function checkBareToolConflicts(
  allowRules: readonly string[],
  askRules: readonly string[],
): readonly DiagnosticIssue[] {
  if (askRules.length === 0) return []

  // Find bare tool names in allow (no parentheses, e.g. "Bash", "Edit")
  const bareToolsInAllow = allowRules.filter(rule => BARE_TOOL_PATTERN.test(rule))
  if (bareToolsInAllow.length === 0) return []

  // Check which bare tools conflict with ask rules
  const conflicting = bareToolsInAllow.filter(bareTool => {
    return askRules.some(askRule => {
      // bare "Bash" conflicts with "Bash(git push *)" or bare "Bash"
      return askRule === bareTool || askRule.startsWith(`${bareTool}(`)
    })
  })

  if (conflicting.length === 0) return []

  return [{
    severity: 'critical',
    code: 'BARE_TOOL_OVERRIDE',
    message: `${conflicting.length} bare tool names in allow override specific ask patterns (ask rules are ignored)`,
    details: conflicting,
    fix: 'allow からベアツール名を削除してください。`csg setup` で自動除去できます。',
  }]
}

/**
 * Detect allow rules that conflict with deny rules.
 * deny wins at runtime, but having both is redundant and risky if behavior changes.
 */
export function checkAllowDenyConflicts(
  allowRules: readonly string[],
  denyRules: readonly string[],
): readonly DiagnosticIssue[] {
  if (denyRules.length === 0) return []

  const denySet = new Set(denyRules)
  const conflicts = allowRules.filter(rule => denySet.has(rule))

  if (conflicts.length === 0) return []

  return [{
    severity: 'warning',
    code: 'ALLOW_DENY_CONFLICT',
    message: `${conflicts.length} patterns found in both allow and deny (redundant, deny wins)`,
    details: conflicts,
    fix: 'allow から該当ルールを削除してください。`csg setup` で自動除去できます。',
  }]
}

/**
 * Detect allow rules that conflict with ask rules.
 * When both exist, allow takes priority and ask is ignored — this is likely unintended.
 */
export function checkAllowAskConflicts(
  allowRules: readonly string[],
  askRules: readonly string[],
): readonly DiagnosticIssue[] {
  if (askRules.length === 0) return []

  const askSet = new Set(askRules)
  const conflicts = allowRules.filter(rule => askSet.has(rule))

  if (conflicts.length === 0) return []

  return [{
    severity: 'warning',
    code: 'ALLOW_ASK_CONFLICT',
    message: `${conflicts.length} patterns found in both allow and ask (allow takes priority, ask is ignored)`,
    details: conflicts,
    fix: 'allow から該当ルールを削除してください。`csg setup` で自動除去できます。',
  }]
}

export function findConflicts(
  allowRules: readonly string[],
  denyRules: readonly string[]
): readonly DiagnosticIssue[] {
  const normalizeForCompare = (p: string): string => {
    const migrated = p.replace(LEGACY_COLON_PATTERN, '$1($2 $3)')
    // Case-insensitive: normalize tool arguments to lowercase for comparison
    const match = migrated.match(MODERN_SPACE_PATTERN)
    if (match) {
      return `${match[1]}(${match[2].toLowerCase()})`
    }
    return migrated.toLowerCase()
  }

  const normalizedAllow = new Set(allowRules.map(normalizeForCompare))
  const conflicts: string[] = []

  for (const deny of denyRules) {
    const normalized = normalizeForCompare(deny)
    if (normalizedAllow.has(normalized)) {
      conflicts.push(deny)
    }
  }

  if (conflicts.length === 0) return []

  return [{
    severity: 'warning',
    code: 'CONFLICT',
    message: `${conflicts.length} patterns found in both allow and deny`,
    details: conflicts,
    fix: 'Remove from either allow or deny to resolve the conflict',
  }]
}
