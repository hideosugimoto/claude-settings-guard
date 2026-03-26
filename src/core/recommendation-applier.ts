import { FILE_READ_COMMANDS, FILE_WRITE_COMMANDS, PREFIX_COMMANDS } from '../constants.js'
import type { ClaudeSettings, Recommendation } from '../types.js'

export interface ApplyResult {
  readonly settings: ClaudeSettings
  readonly addedAllow: readonly string[]
  readonly addedDeny: readonly string[]
  readonly addedAsk: readonly string[]
  readonly hasDenyChanges: boolean
}

/**
 * Check if an allow pattern conflicts with any deny rules.
 * Handles both direct conflicts (same pattern) and cross-tool bypasses.
 */
function conflictsWithDeny(allowPattern: string, denyPatterns: readonly string[]): boolean {
  // Direct conflict: exact same pattern in deny
  if (denyPatterns.includes(allowPattern)) return true

  // Cross-tool bypass: Bash file commands vs Read/Write/Edit deny
  const bashMatch = allowPattern.match(/^Bash\((\S+)/)
  if (!bashMatch) return false

  const cmd = bashMatch[1].toLowerCase()
  const hasReadDeny = denyPatterns.some(d => d.startsWith('Read(') || d.startsWith('Grep('))
  const hasWriteDeny = denyPatterns.some(d => d.startsWith('Write('))
  const hasEditDeny = denyPatterns.some(d => d.startsWith('Edit('))

  if (FILE_READ_COMMANDS.has(cmd) && hasReadDeny) return true
  if (FILE_WRITE_COMMANDS.has(cmd) && (hasWriteDeny || hasEditDeny)) return true

  // Prefix bypass: prefix commands vs Bash deny
  const hasBashDeny = denyPatterns.some(d => d.startsWith('Bash('))
  if (PREFIX_COMMANDS.has(cmd) && hasBashDeny) return true

  return false
}

function uniqueAppend(
  base: readonly string[],
  additions: readonly string[]
): { readonly values: readonly string[]; readonly added: readonly string[] } {
  const baseSet = new Set(base)
  const added = additions.filter(item => !baseSet.has(item))
  return {
    values: [...base, ...added],
    added,
  }
}

export function applyRecommendations(
  settings: ClaudeSettings,
  recommendations: readonly Recommendation[]
): ApplyResult {
  // Process deny first so we can filter allow against the full deny set
  const denyTargets = recommendations
    .filter(rec => rec.action === 'add-deny')
    .map(rec => rec.pattern)

  const currentPermissions = settings.permissions ?? {}
  const deny = uniqueAppend(currentPermissions.deny ?? [], denyTargets)

  // Build the complete deny set (existing + newly added)
  const allDenyPatterns = deny.values

  // Process ask targets
  const askTargets = recommendations
    .filter(rec => rec.action === 'add-ask')
    .map(rec => rec.pattern)
    .filter(pattern => !allDenyPatterns.includes(pattern))

  const ask = uniqueAppend(currentPermissions.ask ?? [], askTargets)

  // Filter allow targets: remove any that conflict with deny or ask rules
  const allAskPatterns = ask.values
  const allowTargets = recommendations
    .filter(rec => rec.action === 'add-allow')
    .map(rec => rec.pattern)
    .filter(pattern => !conflictsWithDeny(pattern, allDenyPatterns))
    .filter(pattern => !allAskPatterns.includes(pattern))

  const allow = uniqueAppend(currentPermissions.allow ?? [], allowTargets)
  const hasAllowChanges = allow.added.length > 0
  const hasDenyChanges = deny.added.length > 0
  const hasAskChanges = ask.added.length > 0
  if (!hasAllowChanges && !hasDenyChanges && !hasAskChanges) {
    return {
      settings,
      addedAllow: [],
      addedDeny: [],
      addedAsk: [],
      hasDenyChanges: false,
    }
  }

  const nextAllow = hasAllowChanges || currentPermissions.allow ? allow.values : undefined
  const nextDeny = hasDenyChanges || currentPermissions.deny ? deny.values : undefined
  const nextAsk = hasAskChanges || currentPermissions.ask ? ask.values : undefined

  const updatedSettings: ClaudeSettings = {
    ...settings,
    permissions: {
      ...currentPermissions,
      ...(nextAllow ? { allow: [...nextAllow] } : {}),
      ...(nextDeny ? { deny: [...nextDeny] } : {}),
      ...(nextAsk ? { ask: [...nextAsk] } : {}),
    },
  }

  return {
    settings: updatedSettings,
    addedAllow: allow.added,
    addedDeny: deny.added,
    addedAsk: ask.added,
    hasDenyChanges,
  }
}
