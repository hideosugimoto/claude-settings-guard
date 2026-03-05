import {
  LEGACY_COLON_PATTERN,
  MODERN_SPACE_PATTERN,
} from '../constants.js'
import type { DiagnosticIssue } from '../types.js'

/**
 * Split a shell command string into individual subcommands.
 * Handles pipes, AND/OR chains, semicolons, $() substitutions,
 * backtick substitutions, subshells, and brace groups.
 */
export function splitShellCommand(command: string): readonly string[] {
  const trimmed = command.trim()
  if (trimmed === '') return []

  // Step 1: Extract $(), <(), and backtick contents
  const extracted: string[] = []

  // Extract $(...) contents (non-greedy, non-nested)
  const dollarParenRegex = /\$\(([^)]+)\)/g
  let match: RegExpExecArray | null
  let cleaned = trimmed

  match = dollarParenRegex.exec(cleaned)
  while (match !== null) {
    extracted.push(match[1])
    match = dollarParenRegex.exec(cleaned)
  }
  cleaned = cleaned.replace(/\$\([^)]+\)/g, '')

  // Extract <(...) process substitution contents
  const processSubRegex = /<\(([^)]+)\)/g
  match = processSubRegex.exec(cleaned)
  while (match !== null) {
    extracted.push(match[1])
    match = processSubRegex.exec(cleaned)
  }
  cleaned = cleaned.replace(/<\([^)]+\)/g, '')

  // Extract backtick contents
  const backtickRegex = /`([^`]+)`/g
  match = backtickRegex.exec(cleaned)
  while (match !== null) {
    extracted.push(match[1])
    match = backtickRegex.exec(cleaned)
  }
  cleaned = cleaned.replace(/`[^`]+`/g, '')

  // Step 2: Remove subshell parens and brace group markers
  cleaned = cleaned.replace(/^\s*\(\s*/, '').replace(/\s*\)\s*$/, '')
  cleaned = cleaned.replace(/^\s*\{\s*/, '').replace(/\s*\}\s*$/, '')

  // Step 3: Split by operators (multi-char first to avoid partial matches)
  // Replace operators with a unique delimiter
  const DELIM = '\x00'
  cleaned = cleaned
    .replace(/&&/g, DELIM)
    .replace(/\|\|/g, DELIM)
    .replace(/\|/g, DELIM)
    .replace(/;/g, DELIM)
    .replace(/\n/g, DELIM)

  // Step 4: Split, trim, and filter
  const mainParts = cleaned
    .split(DELIM)
    .map(s => s.trim())
    .filter(s => s !== '')

  // Step 5: Recursively split extracted subcommands
  const extractedParts = extracted.flatMap(e => [...splitShellCommand(e)])

  // Step 6: Combine and deduplicate
  const all = [...mainParts, ...extractedParts]
  const seen = new Set<string>()
  const result: string[] = []
  for (const part of all) {
    if (!seen.has(part)) {
      seen.add(part)
      result.push(part)
    }
  }

  return result
}

/**
 * Check if a deny pattern is vulnerable to pipe/chain bypass.
 * Returns a diagnostic issue if vulnerable, null otherwise.
 */
export function checkPipeVulnerability(pattern: string): DiagnosticIssue | null {
  const legacyMatch = pattern.match(LEGACY_COLON_PATTERN)
  const modernMatch = pattern.match(MODERN_SPACE_PATTERN)
  const toolName = legacyMatch?.[1] ?? modernMatch?.[1]

  if (toolName !== 'Bash') return null

  return {
    severity: 'info',
    code: 'PIPE_VULNERABLE',
    message: `Bash deny pattern "${pattern}" only checks the first command — pipes, chains (&&, ||), and subshells can bypass it`,
    fix: '`csg enforce` で合成コマンド対応のフックを生成してください',
  }
}
