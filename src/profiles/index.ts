import type { Profile, ProfileName } from '../types.js'
import { DEFAULT_DENY_RULES } from '../constants.js'
import { minimalProfile } from './minimal.js'
import { balancedProfile } from './balanced.js'
import { strictProfile } from './strict.js'

export const profiles: Readonly<Record<ProfileName, Profile>> = {
  minimal: minimalProfile,
  balanced: balancedProfile,
  strict: strictProfile,
}

export function getProfile(name: ProfileName): Profile {
  return profiles[name]
}

export function getProfileNames(): readonly ProfileName[] {
  return ['minimal', 'balanced', 'strict']
}

export function isValidProfileName(name: string): name is ProfileName {
  return name === 'minimal' || name === 'balanced' || name === 'strict'
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
