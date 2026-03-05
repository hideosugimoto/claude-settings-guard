import {
  KNOWN_TOOLS,
  LEGACY_COLON_PATTERN,
  MODERN_SPACE_PATTERN,
  BARE_TOOL_PATTERN,
  MCP_TOOL_PATTERN,
} from '../constants.js'
import type { PermissionRule, DiagnosticIssue } from '../types.js'

export function parsePattern(
  pattern: string,
  source: PermissionRule['source']
): PermissionRule {
  // Bare tool name: "Read", "Write", etc.
  const bareMatch = pattern.match(BARE_TOOL_PATTERN)
  if (bareMatch && !pattern.includes('(')) {
    return {
      pattern,
      source,
      isLegacy: false,
      toolName: bareMatch[1],
    }
  }

  // MCP tool: "mcp__server__tool"
  if (MCP_TOOL_PATTERN.test(pattern)) {
    return {
      pattern,
      source,
      isLegacy: false,
      toolName: pattern,
    }
  }

  // Legacy colon syntax: "Bash(npm:*)"
  const legacyMatch = pattern.match(LEGACY_COLON_PATTERN)
  if (legacyMatch) {
    return {
      pattern,
      source,
      isLegacy: true,
      toolName: legacyMatch[1],
      argument: `${legacyMatch[2]}:${legacyMatch[3]}`,
    }
  }

  // Modern space syntax: "Bash(npm *)" or "Read(**/.env)"
  const modernMatch = pattern.match(MODERN_SPACE_PATTERN)
  if (modernMatch) {
    return {
      pattern,
      source,
      isLegacy: false,
      toolName: modernMatch[1],
      argument: modernMatch[2],
    }
  }

  // Fallback: treat as unknown
  return {
    pattern,
    source,
    isLegacy: false,
    toolName: pattern,
  }
}

export function isLegacySyntax(pattern: string): boolean {
  return LEGACY_COLON_PATTERN.test(pattern)
}

export function isValidToolName(name: string): boolean {
  if (MCP_TOOL_PATTERN.test(name)) return true
  return (KNOWN_TOOLS as readonly string[]).includes(name)
}

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

  return issues
}

export function findConflicts(
  allowRules: readonly string[],
  denyRules: readonly string[]
): readonly DiagnosticIssue[] {
  const normalizeForCompare = (p: string): string =>
    p.replace(LEGACY_COLON_PATTERN, '$1($2 $3)')

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
