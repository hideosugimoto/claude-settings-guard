import type { ClaudeSettings, Recommendation } from '../types.js'

export interface ApplyResult {
  readonly settings: ClaudeSettings
  readonly addedAllow: readonly string[]
  readonly addedDeny: readonly string[]
  readonly hasDenyChanges: boolean
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
  const allowTargets = recommendations
    .filter(rec => rec.action === 'add-allow')
    .map(rec => rec.pattern)
  const denyTargets = recommendations
    .filter(rec => rec.action === 'add-deny')
    .map(rec => rec.pattern)

  const currentPermissions = settings.permissions ?? {}
  const allow = uniqueAppend(currentPermissions.allow ?? [], allowTargets)
  const deny = uniqueAppend(currentPermissions.deny ?? [], denyTargets)
  const hasAllowChanges = allow.added.length > 0
  const hasDenyChanges = deny.added.length > 0
  if (!hasAllowChanges && !hasDenyChanges) {
    return {
      settings,
      addedAllow: [],
      addedDeny: [],
      hasDenyChanges: false,
    }
  }

  const nextAllow = hasAllowChanges || currentPermissions.allow ? allow.values : undefined
  const nextDeny = hasDenyChanges || currentPermissions.deny ? deny.values : undefined

  const updatedSettings: ClaudeSettings = {
    ...settings,
    permissions: {
      ...currentPermissions,
      ...(nextAllow ? { allow: [...nextAllow] } : {}),
      ...(nextDeny ? { deny: [...nextDeny] } : {}),
    },
  }

  return {
    settings: updatedSettings,
    addedAllow: allow.added,
    addedDeny: deny.added,
    hasDenyChanges,
  }
}
