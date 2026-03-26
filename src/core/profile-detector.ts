import type { ClaudeSettings, ProfileName } from '../types.js'
import { SMART_ASK_RULES } from '../constants.js'

/**
 * Detect the active CSG profile from current settings.json by checking signature rules.
 */
export function detectProfile(settings: ClaudeSettings): ProfileName {
  const deny = settings.permissions?.deny ?? []
  const allow = settings.permissions?.allow ?? []
  const ask = settings.permissions?.ask ?? []
  const denySet = new Set(deny)
  const askSet = new Set(ask)
  const allowSet = new Set(allow)

  // strict: curl/wget in deny
  if (denySet.has('Bash(curl *)') && denySet.has('Bash(wget *)')) {
    return 'strict'
  }

  // smart: SMART_ASK_RULES present in ask
  const smartRuleCount = SMART_ASK_RULES.filter(r => askSet.has(r)).length
  if (smartRuleCount >= 5) {
    return 'smart'
  }

  // minimal: Write/Edit in allow (not in ask)
  if (allowSet.has('Write') && allowSet.has('Edit') && !askSet.has('Write') && !askSet.has('Edit')) {
    return 'minimal'
  }

  // default
  return 'balanced'
}
