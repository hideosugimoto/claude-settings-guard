import type { ClaudeSettings, Profile } from '../types.js'
import { DEFAULT_DENY_RULES } from '../constants.js'

export interface ApplyProfileResult {
  readonly settings: ClaudeSettings
  readonly addedDeny: number
  readonly addedAllow: number
  readonly addedAsk: number
}

function findMissing(
  existing: readonly string[],
  desired: readonly string[],
): readonly string[] {
  return desired.filter(rule => !existing.includes(rule))
}

export function applyProfileToSettings(
  settings: ClaudeSettings,
  profile: Profile,
): ApplyProfileResult {
  const existingDeny = [
    ...(settings.permissions?.deny ?? []),
    ...(settings.deny ?? []),
  ]

  const allDesiredDeny = [...new Set([...DEFAULT_DENY_RULES, ...profile.deny])]
  const missingDeny = findMissing(existingDeny, allDesiredDeny)

  const existingAllow = settings.permissions?.allow ?? []
  const missingAllow = findMissing(existingAllow, [...profile.allow])

  const existingAsk = settings.permissions?.ask ?? []
  const missingAsk = profile.ask ? findMissing(existingAsk, [...profile.ask]) : []

  const updatedPermissions = {
    ...settings.permissions,
    deny: [...(settings.permissions?.deny ?? []), ...missingDeny],
    allow: [...existingAllow, ...missingAllow],
    ...(profile.ask && missingAsk.length > 0
      ? { ask: [...existingAsk, ...missingAsk] }
      : {}),
  }

  return {
    settings: { ...settings, permissions: updatedPermissions },
    addedDeny: missingDeny.length,
    addedAllow: missingAllow.length,
    addedAsk: missingAsk.length,
  }
}
