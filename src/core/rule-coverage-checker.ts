import { SAFE_BASH_ALLOW_RULES, HARD_TO_REVERSE_ASK_RULES, STRICT_ONLY_ASK_RULES, SMART_ASK_RULES, DEFAULT_DENY_RULES } from '../constants.js'

/**
 * Extract binary names from all CSG-managed Bash rule patterns.
 * e.g. "Bash(git add *)" → "git", "Bash(npm install *)" → "npm"
 */
export function collectManagedBashBinaries(): ReadonlySet<string> {
  const allRules = [
    ...SAFE_BASH_ALLOW_RULES,
    ...HARD_TO_REVERSE_ASK_RULES,
    ...STRICT_ONLY_ASK_RULES,
    ...SMART_ASK_RULES,
    ...DEFAULT_DENY_RULES,
  ]

  const binaries = new Set<string>()
  for (const rule of allRules) {
    const match = rule.match(/^Bash\((\S+)/)
    if (match) {
      binaries.add(match[1])
    }
  }

  return binaries
}
