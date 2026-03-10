import {
  KNOWN_TOOLS,
  LEGACY_COLON_PATTERN,
  MODERN_SPACE_PATTERN,
  BARE_TOOL_PATTERN,
  MCP_TOOL_PATTERN,
  FILE_READ_COMMANDS,
  FILE_WRITE_COMMANDS,
  PREFIX_COMMANDS,
} from '../constants.js'
import { checkPipeVulnerability } from '../utils/command-parser.js'
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
 * Check for Read deny rules that lack corresponding Edit/Write deny rules.
 * Emits info-level suggestions to help users close coverage gaps.
 */
export function checkMissingPairedDenyRules(
  denyRules: readonly string[]
): readonly DiagnosticIssue[] {
  const pairings: ReadonlyArray<{ readonly from: string; readonly to: string }> = [
    { from: 'Read', to: 'Edit' },
    { from: 'Read', to: 'Write' },
    { from: 'Read', to: 'Grep' },
  ]

  const issues: DiagnosticIssue[] = []

  for (const { from, to } of pairings) {
    const missingPatterns: string[] = []

    for (const rule of denyRules) {
      const parsed = parsePattern(rule, 'deny')
      if (parsed.toolName !== from || !parsed.argument) continue

      const expectedPattern = `${to}(${parsed.argument})`
      const hasPair = denyRules.some(r => {
        const p = parsePattern(r, 'deny')
        return p.toolName === to && p.argument === parsed.argument
      })

      if (!hasPair) {
        missingPatterns.push(expectedPattern)
      }
    }

    if (missingPatterns.length > 0) {
      issues.push({
        severity: 'info',
        code: 'MISSING_PAIRED_DENY',
        message: `${from} deny rules exist without matching ${to} deny rules. Consider adding ${to} deny rules for complete protection.`,
        details: missingPatterns,
        fix: `Add the suggested ${to} deny rules to close coverage gaps`,
      })
    }
  }

  return issues
}

// FILE_READ_COMMANDS, FILE_WRITE_COMMANDS, PREFIX_COMMANDS imported from constants

/**
 * Detect cross-tool bypass risks where Bash allow rules can access
 * files protected by Read/Write/Edit deny rules.
 */
export function checkCrossToolBypasses(
  allowRules: readonly string[],
  denyRules: readonly string[]
): readonly DiagnosticIssue[] {
  const parsedAllow = allowRules.map(r => parsePattern(r, 'allow'))
  const parsedDeny = denyRules.map(r => parsePattern(r, 'deny'))

  const bashAllowArgs = parsedAllow
    .filter(r => r.toolName === 'Bash' && r.argument)
    .map(r => {
      const firstWord = (r.argument ?? '').split(/\s+/)[0]
      return firstWord.toLowerCase()
    })

  if (bashAllowArgs.length === 0) return []

  const hasReadDeny = parsedDeny.some(r =>
    (r.toolName === 'Read' || r.toolName === 'Grep') && r.argument
  )
  const hasWriteDeny = parsedDeny.some(r =>
    (r.toolName === 'Write') && r.argument
  )
  const hasEditDeny = parsedDeny.some(r =>
    (r.toolName === 'Edit') && r.argument
  )

  if (!hasReadDeny && !hasWriteDeny && !hasEditDeny) return []

  const issues: DiagnosticIssue[] = []
  const reportedCommands: string[] = []

  for (const cmd of bashAllowArgs) {
    const isReadCmd = FILE_READ_COMMANDS.has(cmd)
    const isWriteCmd = FILE_WRITE_COMMANDS.has(cmd)

    const bypasses: string[] = []
    if (isReadCmd && hasReadDeny) bypasses.push('Read')
    if (isWriteCmd && hasWriteDeny) bypasses.push('Write')
    if (isWriteCmd && hasEditDeny) bypasses.push('Edit')
    // sed can both read and write
    if (cmd === 'sed' && hasReadDeny && !bypasses.includes('Read')) bypasses.push('Read')

    if (bypasses.length > 0 && !reportedCommands.includes(cmd)) {
      reportedCommands.push(cmd)
      issues.push({
        severity: 'warning',
        code: 'CROSS_TOOL_BYPASS',
        message: `Bash(${cmd} *) in allow can bypass ${bypasses.join('/')} deny rules`,
        details: [
          `"${cmd}" can access files that are protected by ${bypasses.join('/')} deny rules`,
          'Use `csg enforce` to generate a Layer 2 hook that inspects Bash file arguments',
        ],
        fix: 'Remove the broad Bash allow rule or install the Layer 2 enforcement hook',
      })
    }
  }

  return issues
}

/**
 * Detect prefix command bypass risks where wrapper commands in allow
 * can wrap denied commands to bypass Layer 1 matching.
 */
export function checkPrefixBypasses(
  allowRules: readonly string[],
  denyRules: readonly string[]
): readonly DiagnosticIssue[] {
  const parsedAllow = allowRules.map(r => parsePattern(r, 'allow'))
  const parsedDeny = denyRules.map(r => parsePattern(r, 'deny'))

  const hasBashDeny = parsedDeny.some(r => r.toolName === 'Bash' && r.argument)
  if (!hasBashDeny) return []

  const allowedPrefixes = parsedAllow
    .filter(r => r.toolName === 'Bash' && r.argument)
    .map(r => (r.argument ?? '').split(/\s+/)[0].toLowerCase())
    .filter(cmd => PREFIX_COMMANDS.has(cmd))

  if (allowedPrefixes.length === 0) return []

  return [{
    severity: 'info',
    code: 'PREFIX_BYPASS_RISK',
    message: `Bash allow rules for prefix commands (${allowedPrefixes.join(', ')}) may bypass Bash deny rules at Layer 1`,
    details: [
      `Prefix commands like "${allowedPrefixes[0]}" can wrap denied commands (e.g. "env sudo rm")`,
      'Layer 2 enforcement hook strips prefix commands before matching, mitigating this risk',
    ],
    fix: 'Install the Layer 2 enforce hook with `csg enforce` to mitigate prefix bypass',
  }]
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
