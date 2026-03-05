import type { Profile, ProfileName } from '../types.js'
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
