import type { ClaudeSettings, Profile } from '../types.js'
import { DEFAULT_DENY_RULES, FILE_READ_COMMANDS, FILE_WRITE_COMMANDS, SAFE_BASH_ALLOW_RULES } from '../constants.js'
import { getAllProfileDenyRules } from '../profiles/index.js'

export interface ApplyProfileResult {
  readonly settings: ClaudeSettings
  readonly addedDeny: number
  readonly addedAllow: number
  readonly addedAsk: number
  readonly removedFromAllow: number
  readonly removedFromDeny: readonly string[]
  readonly removedFromAsk: readonly string[]
  readonly conflicts?: readonly string[]
  readonly crossToolConflicts?: readonly string[]
}

function findMissing(
  existing: readonly string[],
  desired: readonly string[],
): readonly string[] {
  return desired.filter(rule => !existing.includes(rule))
}

/**
 * Detect patterns that appear in both allow and deny after merging.
 */
function detectConflicts(
  allow: readonly string[],
  deny: readonly string[],
): readonly string[] {
  const denySet = new Set(deny)
  return allow.filter(rule => denySet.has(rule))
}

// Detect cross-tool conflicts: Bash allow rules that can bypass file deny rules.
function detectCrossToolConflicts(
  allow: readonly string[],
  deny: readonly string[],
): readonly string[] {
  const hasReadDeny = deny.some(d => d.startsWith('Read(') || d.startsWith('Grep('))
  const hasWriteDeny = deny.some(d => d.startsWith('Write('))
  const hasEditDeny = deny.some(d => d.startsWith('Edit('))

  if (!hasReadDeny && !hasWriteDeny && !hasEditDeny) return []

  const conflicts: string[] = []

  for (const rule of allow) {
    const match = rule.match(/^Bash\((\S+)/)
    if (!match) continue
    const cmd = match[1].toLowerCase()

    const bypasses: string[] = []
    if (FILE_READ_COMMANDS.has(cmd) && hasReadDeny) bypasses.push('Read/Grep')
    if (FILE_WRITE_COMMANDS.has(cmd) && hasWriteDeny) bypasses.push('Write')
    if (FILE_WRITE_COMMANDS.has(cmd) && hasEditDeny) bypasses.push('Edit')

    if (bypasses.length > 0) {
      conflicts.push(`Bash(${cmd} *) can bypass ${bypasses.join('/')} deny rules`)
    }
  }

  return conflicts
}

function buildFinalAskList(
  existingAsk: readonly string[],
  missingAsk: readonly string[],
  profile: Profile,
): { readonly finalAsk: readonly string[]; readonly removedFromAsk: readonly string[] } {
  const profileAllowSet = new Set(profile.allow)
  const mergedAsk = profile.ask
    ? [...new Set([...existingAsk, ...missingAsk, ...(profile.ask ?? [])])]
    : [...existingAsk]
  const finalAsk = mergedAsk.filter(rule => !profileAllowSet.has(rule))
  const removedFromAsk = mergedAsk.filter(rule => profileAllowSet.has(rule))
  return { finalAsk, removedFromAsk }
}

function buildFinalDenyList(
  settings: ClaudeSettings,
  missingDeny: readonly string[],
  profile: Profile,
): { readonly finalDeny: readonly string[]; readonly removedFromDeny: readonly string[] } {
  const mergedDeny = [...new Set([...(settings.permissions?.deny ?? []), ...missingDeny])]
  const profileDenySet = new Set([...DEFAULT_DENY_RULES, ...profile.deny])
  const allProfileDenyRules = getAllProfileDenyRules()
  const finalDeny = mergedDeny.filter(rule =>
    profileDenySet.has(rule) || !allProfileDenyRules.has(rule)
  )
  const removedFromDeny = mergedDeny.filter(rule =>
    !profileDenySet.has(rule) && allProfileDenyRules.has(rule)
  )
  return { finalDeny, removedFromDeny }
}

function buildFinalAllowList(
  existingAllow: readonly string[],
  missingAllow: readonly string[],
  askSet: ReadonlySet<string>,
  denySet: ReadonlySet<string>,
  profile: Profile,
): { readonly cleanedAllow: readonly string[]; readonly removedFromAllow: number } {
  const finalAsk = [...askSet]

  // Find bare tool names that would override specific ask patterns
  const bareToolsOverridingAsk = new Set(
    finalAsk.length > 0
      ? [...new Set(
          [...existingAllow, ...missingAllow]
            .filter(rule => /^\w+$/.test(rule))
            .filter(bareTool =>
              finalAsk.some(askRule =>
                askRule === bareTool || askRule.startsWith(`${bareTool}(`)
              )
            )
        )]
      : []
  )

  // Compensate: when bare "Bash" is removed, add safe Bash patterns
  const compensateRules = bareToolsOverridingAsk.has('Bash')
    ? SAFE_BASH_ALLOW_RULES.filter(rule => !askSet.has(rule) && !denySet.has(rule))
    : []

  // Check if an allow rule is a broad pattern that could override
  // a more specific ask or deny rule.
  const isBroadPatternOverridingAskOrDeny = (rule: string): boolean => {
    const match = rule.match(/^(\w+)\((.+)\s\*\)$/)
    if (!match) return false
    const [, tool, prefix] = match
    const rulePrefix = `${tool}(${prefix} `
    return [...askSet, ...denySet].some(protectedRule =>
      protectedRule.startsWith(rulePrefix) && protectedRule !== rule
    )
  }

  const mergedAllow = [...existingAllow, ...missingAllow, ...compensateRules]
  const cleanedAllow = [...new Set(mergedAllow)].filter(rule =>
    !askSet.has(rule) &&
    !denySet.has(rule) &&
    !bareToolsOverridingAsk.has(rule) &&
    !isBroadPatternOverridingAskOrDeny(rule)
  )
  const removedFromAllow = mergedAllow.length - cleanedAllow.length

  return { cleanedAllow, removedFromAllow }
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

  const { finalAsk, removedFromAsk } = buildFinalAskList(existingAsk, missingAsk, profile)
  const { finalDeny, removedFromDeny } = buildFinalDenyList(settings, missingDeny, profile)

  const askSet = new Set(finalAsk)
  const denySet = new Set(finalDeny)

  const { cleanedAllow, removedFromAllow } = buildFinalAllowList(
    existingAllow, missingAllow, askSet, denySet, profile,
  )

  const { ask: _existingAskProp, ...permissionsWithoutAsk } = settings.permissions ?? {}
  const updatedPermissions = {
    ...permissionsWithoutAsk,
    deny: finalDeny,
    allow: cleanedAllow,
    ...(finalAsk.length > 0 ? { ask: finalAsk } : {}),
  }

  const conflicts = detectConflicts(updatedPermissions.allow, updatedPermissions.deny)
  const crossToolConflicts = detectCrossToolConflicts(updatedPermissions.allow, updatedPermissions.deny)

  return {
    settings: { ...settings, permissions: updatedPermissions },
    addedDeny: missingDeny.length,
    addedAllow: missingAllow.length,
    addedAsk: missingAsk.length,
    removedFromAllow,
    removedFromDeny,
    removedFromAsk,
    ...(conflicts.length > 0 ? { conflicts } : {}),
    ...(crossToolConflicts.length > 0 ? { crossToolConflicts } : {}),
  }
}
