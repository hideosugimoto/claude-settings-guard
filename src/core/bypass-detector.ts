import {
  FILE_READ_COMMANDS,
  FILE_WRITE_COMMANDS,
  PREFIX_COMMANDS,
} from '../constants.js'
import { parsePattern } from './pattern-parser.js'
import type { DiagnosticIssue } from '../types.js'

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
