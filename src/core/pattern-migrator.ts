import { LEGACY_COLON_PATTERN } from '../constants.js'
import type { MigrationResult, ClaudeSettings } from '../types.js'

export function migrateColonToSpace(pattern: string): MigrationResult | null {
  const match = pattern.match(LEGACY_COLON_PATTERN)
  if (!match) return null

  const [, toolName, argument] = match
  const migrated = `${toolName}(${argument} *)`
  return {
    original: pattern,
    migrated,
    type: 'syntax',
  }
}

export function migrateAllPatterns(patterns: readonly string[]): {
  readonly migrated: readonly string[]
  readonly results: readonly MigrationResult[]
} {
  const migratedList: string[] = []
  const results: MigrationResult[] = []

  for (const pattern of patterns) {
    const result = migrateColonToSpace(pattern)
    if (result) {
      migratedList.push(result.migrated)
      results.push(result)
    } else {
      migratedList.push(pattern)
    }
  }

  return { migrated: migratedList, results }
}

export function migrateStructure(settings: ClaudeSettings): {
  readonly migrated: ClaudeSettings
  readonly results: readonly MigrationResult[]
} {
  const results: MigrationResult[] = []

  const existingAllow = settings.permissions?.allow ?? []
  const existingDeny = settings.permissions?.deny ?? []

  // Migrate allowedTools -> permissions.allow
  const legacyAllow = settings.allowedTools ?? []
  const { migrated: migratedAllow, results: allowResults } = migrateAllPatterns(legacyAllow)
  results.push(...allowResults)

  // Track structural migrations for allowedTools
  for (const pattern of legacyAllow) {
    const syntaxResult = allowResults.find(r => r.original === pattern)
    if (!syntaxResult) {
      // No syntax change needed, but still a structural migration
      results.push({
        original: `allowedTools: ${pattern}`,
        migrated: `permissions.allow: ${pattern}`,
        type: 'structure',
      })
    } else {
      results.push({
        original: `allowedTools: ${pattern}`,
        migrated: `permissions.allow: ${syntaxResult.migrated}`,
        type: 'structure',
      })
    }
  }

  // Migrate top-level deny -> permissions.deny
  const legacyDeny = settings.deny ?? []
  const { migrated: migratedDeny, results: denyResults } = migrateAllPatterns(legacyDeny)
  results.push(...denyResults)

  for (const pattern of legacyDeny) {
    const syntaxResult = denyResults.find(r => r.original === pattern)
    if (!syntaxResult) {
      results.push({
        original: `deny: ${pattern}`,
        migrated: `permissions.deny: ${pattern}`,
        type: 'structure',
      })
    } else {
      results.push({
        original: `deny: ${pattern}`,
        migrated: `permissions.deny: ${syntaxResult.migrated}`,
        type: 'structure',
      })
    }
  }

  // Migrate patterns inside existing permissions
  const { migrated: migratedExistingAllow, results: existingAllowResults } =
    migrateAllPatterns(existingAllow)
  results.push(...existingAllowResults)

  const { migrated: migratedExistingDeny, results: existingDenyResults } =
    migrateAllPatterns(existingDeny)
  results.push(...existingDenyResults)

  // Merge all allow rules, deduplicate
  const allAllow = [...new Set([...migratedExistingAllow, ...migratedAllow])]
  const allDeny = [...new Set([...migratedExistingDeny, ...migratedDeny])]

  // Build new settings without legacy fields
  const { allowedTools: _a, deny: _d, ...rest } = settings

  const migrated: ClaudeSettings = {
    ...rest,
    permissions: {
      ...settings.permissions,
      allow: allAllow.length > 0 ? allAllow : undefined,
      deny: allDeny.length > 0 ? allDeny : undefined,
    },
  }

  return { migrated, results }
}
