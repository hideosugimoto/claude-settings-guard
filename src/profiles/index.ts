import type { Profile, ProfileName } from '../types.js'
import { DEFAULT_DENY_RULES, SAFE_BASH_ALLOW_RULES, READ_ONLY_BASH_SAFE, READ_ONLY_BASH_FILE_READERS, HARD_TO_REVERSE_ASK_RULES, STRICT_ONLY_ASK_RULES, SMART_ASK_RULES } from '../constants.js'
import { minimalProfile } from './minimal.js'
import { balancedProfile } from './balanced.js'
import { strictProfile } from './strict.js'
import { smartProfile } from './smart.js'

export const profiles: Readonly<Record<ProfileName, Profile>> = {
  minimal: minimalProfile,
  balanced: balancedProfile,
  strict: strictProfile,
  smart: smartProfile,
}

export function getProfile(name: ProfileName): Profile {
  return profiles[name]
}

export function getProfileNames(): readonly ProfileName[] {
  return ['minimal', 'balanced', 'strict', 'smart']
}

export function isValidProfileName(name: string): name is ProfileName {
  return name === 'minimal' || name === 'balanced' || name === 'strict' || name === 'smart'
}

/**
 * Collect all deny rules from every profile plus DEFAULT_DENY_RULES.
 * Used to identify which deny rules are "profile-managed" vs user-added custom rules.
 * Uses lazy singleton cache to avoid creating a new Set on every call.
 */
let _cachedAllProfileDenyRules: ReadonlySet<string> | undefined

export function getAllProfileDenyRules(): ReadonlySet<string> {
  if (!_cachedAllProfileDenyRules) {
    const allRules = new Set<string>(DEFAULT_DENY_RULES)
    for (const profile of Object.values(profiles)) {
      for (const rule of profile.deny) {
        allRules.add(rule)
      }
    }
    _cachedAllProfileDenyRules = allRules
  }
  return _cachedAllProfileDenyRules
}

/**
 * Collect all managed rule sets (deny, allow, ask) across all profiles + constants.
 * Used by recommendation-applier to distinguish managed rules from user-added rules.
 */
export function collectManagedRuleSets(): {
  readonly managedDeny: ReadonlySet<string>
  readonly managedAllow: ReadonlySet<string>
  readonly managedAsk: ReadonlySet<string>
} {
  const managedDeny = new Set<string>(DEFAULT_DENY_RULES)
  const managedAllow = new Set<string>([
    ...SAFE_BASH_ALLOW_RULES,
    ...READ_ONLY_BASH_SAFE,
    ...READ_ONLY_BASH_FILE_READERS,
  ])
  const managedAsk = new Set<string>([
    ...HARD_TO_REVERSE_ASK_RULES,
    ...STRICT_ONLY_ASK_RULES,
    ...SMART_ASK_RULES,
  ])

  for (const profile of Object.values(profiles)) {
    for (const rule of profile.deny) managedDeny.add(rule)
    for (const rule of profile.allow) managedAllow.add(rule)
    for (const rule of profile.ask ?? []) managedAsk.add(rule)
  }

  return { managedDeny, managedAllow, managedAsk }
}
