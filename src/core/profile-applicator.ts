import type { ClaudeSettings, Profile } from '../types.js'
import { DEFAULT_DENY_RULES, FILE_READ_COMMANDS, FILE_WRITE_COMMANDS } from '../constants.js'

export interface ApplyProfileResult {
  readonly settings: ClaudeSettings
  readonly addedDeny: number
  readonly addedAllow: number
  readonly addedAsk: number
  readonly removedFromAllow: number
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

  // Build final ask list first, so we can remove conflicts from allow
  const finalAsk = profile.ask
    ? [...new Set([...existingAsk, ...missingAsk, ...(profile.ask ?? [])])]
    : [...existingAsk]

  // Build final deny list before cleaning allow
  const finalDeny = [...(settings.permissions?.deny ?? []), ...missingDeny]

  // Find bare tool names that would override specific ask patterns
  // e.g., bare "Bash" in allow overrides "Bash(git push *)" in ask
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

  // Remove allow rules that conflict with ask, deny, or are bare tools overriding ask
  const askSet = new Set(finalAsk)
  const denySet = new Set(finalDeny)
  const mergedAllow = [...existingAllow, ...missingAllow]
  const cleanedAllow = mergedAllow.filter(rule =>
    !askSet.has(rule) && !denySet.has(rule) && !bareToolsOverridingAsk.has(rule)
  )
  const removedFromAllow = mergedAllow.length - cleanedAllow.length

  const updatedPermissions = {
    ...settings.permissions,
    deny: finalDeny,
    allow: cleanedAllow,
    ...(finalAsk.length > 0 ? { ask: finalAsk } : {}),
  }

  // Detect conflicts between final allow and deny lists
  const conflicts = detectConflicts(
    updatedPermissions.allow,
    updatedPermissions.deny,
  )

  // Detect cross-tool conflicts (Bash commands that bypass file deny rules)
  const crossToolConflicts = detectCrossToolConflicts(
    updatedPermissions.allow,
    updatedPermissions.deny,
  )

  return {
    settings: { ...settings, permissions: updatedPermissions },
    addedDeny: missingDeny.length,
    addedAllow: missingAllow.length,
    addedAsk: missingAsk.length,
    removedFromAllow,
    ...(conflicts.length > 0 ? { conflicts } : {}),
    ...(crossToolConflicts.length > 0 ? { crossToolConflicts } : {}),
  }
}
