import { FILE_READ_COMMANDS, FILE_WRITE_COMMANDS, PREFIX_COMMANDS } from '../constants.js'
import { collectManagedRuleSets } from '../profiles/index.js'
import type { ClaudeSettings, Recommendation } from '../types.js'

export interface ApplyResult {
  readonly settings: ClaudeSettings
  readonly finalAllow: readonly string[]
  readonly finalAsk: readonly string[]
  readonly finalDeny: readonly string[]
  readonly addedAllow: readonly string[]
  readonly addedDeny: readonly string[]
  readonly addedAsk: readonly string[]
  readonly hasDenyChanges: boolean
}

/**
 * Check if an allow pattern conflicts with any deny rules.
 */
function conflictsWithDeny(allowPattern: string, denyPatterns: readonly string[]): boolean {
  if (denyPatterns.includes(allowPattern)) return true

  const bashMatch = allowPattern.match(/^Bash\((\S+)/)
  if (!bashMatch) return false

  const cmd = bashMatch[1].toLowerCase()
  const hasReadDeny = denyPatterns.some(d => d.startsWith('Read(') || d.startsWith('Grep('))
  const hasWriteDeny = denyPatterns.some(d => d.startsWith('Write('))
  const hasEditDeny = denyPatterns.some(d => d.startsWith('Edit('))

  if (FILE_READ_COMMANDS.has(cmd) && hasReadDeny) return true
  if (FILE_WRITE_COMMANDS.has(cmd) && (hasWriteDeny || hasEditDeny)) return true

  const hasBashDeny = denyPatterns.some(d => d.startsWith('Bash('))
  if (PREFIX_COMMANDS.has(cmd) && hasBashDeny) return true

  return false
}

/**
 * Identify which existing rules are CSG-managed (from profiles/constants)
 * vs user-added custom rules.
 */
function separateUserRules(
  existing: readonly string[],
  managedSet: ReadonlySet<string>,
): { managed: readonly string[]; userAdded: readonly string[] } {
  const managed = existing.filter(r => managedSet.has(r))
  const userAdded = existing.filter(r => !managedSet.has(r))
  return { managed, userAdded }
}

/**
 * Apply recommendations by clearing CSG-managed rules and rebuilding.
 * User-added custom rules are preserved.
 *
 * Flow:
 * 1. Identify CSG-managed rules in current settings
 * 2. Remove CSG-managed rules (keep user-added rules)
 * 3. Build new allow/ask/deny from recommendations
 * 4. Merge with preserved user rules
 */
export function applyRecommendations(
  settings: ClaudeSettings,
  recommendations: readonly Recommendation[]
): ApplyResult {
  const currentPermissions = settings.permissions ?? {}
  const { managedAllow, managedAsk, managedDeny } = collectManagedRuleSets()

  // Collect all managed patterns into single sets
  const allManagedAllow = new Set([...managedAllow])
  const allManagedAsk = new Set([...managedAsk])
  const allManagedDeny = new Set([...managedDeny])

  // Separate user-added rules from CSG-managed rules
  const existingAllow = separateUserRules(currentPermissions.allow ?? [], allManagedAllow)
  const existingAsk = separateUserRules(currentPermissions.ask ?? [], allManagedAsk)
  const existingDeny = separateUserRules(currentPermissions.deny ?? [], allManagedDeny)

  // Build new rules from recommendations
  const recDeny = recommendations
    .filter(rec => rec.action === 'add-deny')
    .map(rec => rec.pattern)

  const recAsk = recommendations
    .filter(rec => rec.action === 'add-ask')
    .map(rec => rec.pattern)

  const recAllow = recommendations
    .filter(rec => rec.action === 'add-allow')
    .map(rec => rec.pattern)

  // Merge: user-added rules + new recommendations (deduplicated)
  const finalDeny = [...new Set([...existingDeny.userAdded, ...recDeny])].sort()
  const denySet = new Set(finalDeny)

  const finalAsk = [...new Set([
    ...existingAsk.userAdded,
    ...recAsk.filter(r => !denySet.has(r)),
  ])].sort()
  const askSet = new Set(finalAsk)

  const finalAllow = [...new Set([
    ...existingAllow.userAdded,
    ...recAllow
      .filter(r => !denySet.has(r))
      .filter(r => !askSet.has(r))
      .filter(r => !conflictsWithDeny(r, finalDeny)),
  ])].sort()

  // Check if deny changed compared to original
  const originalDenySet = new Set(currentPermissions.deny ?? [])
  const hasDenyChanges = finalDeny.length !== originalDenySet.size ||
    finalDeny.some(r => !originalDenySet.has(r))

  const updatedSettings: ClaudeSettings = {
    ...settings,
    permissions: {
      ...currentPermissions,
      allow: finalAllow,
      deny: finalDeny,
      ask: finalAsk,
    },
  }

  // Compute added (new vs original) for backward compat
  const originalAllowSet = new Set(currentPermissions.allow ?? [])
  const originalAskSet = new Set(currentPermissions.ask ?? [])
  const addedAllow = finalAllow.filter(r => !originalAllowSet.has(r))
  const addedDeny = finalDeny.filter(r => !originalDenySet.has(r))
  const addedAsk = finalAsk.filter(r => !originalAskSet.has(r))

  return {
    settings: updatedSettings,
    finalAllow,
    finalAsk,
    finalDeny,
    addedAllow,
    addedDeny,
    addedAsk,
    hasDenyChanges,
  }
}
