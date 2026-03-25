import type { ClaudeSettings } from '../types.js'

export interface AutoModeStatus {
  readonly enabled: boolean
  readonly hasConfig: boolean
  readonly hasEnforceHook: boolean
  readonly defaultMode?: string
}

/**
 * Detect whether AutoMode is configured in the given settings.
 *
 * AutoMode is considered "enabled" when:
 * - permissions.defaultMode is set to "auto", OR
 * - an autoMode config block exists
 */
export function detectAutoMode(settings: ClaudeSettings): AutoModeStatus {
  const defaultMode = settings.permissions?.defaultMode
  const hasAutoModeConfig = settings.autoMode !== undefined &&
    (
      (settings.autoMode.environment !== undefined && settings.autoMode.environment.length > 0) ||
      (settings.autoMode.allow !== undefined && settings.autoMode.allow.length > 0) ||
      (settings.autoMode.soft_deny !== undefined && settings.autoMode.soft_deny.length > 0)
    )

  const enabled = defaultMode === 'auto' || hasAutoModeConfig

  const hasEnforceHook =
    (settings.PreToolUse ?? []).some(rule =>
      rule.hooks.some(h => h.command.includes('enforce-permissions'))
    )

  return {
    enabled,
    hasConfig: hasAutoModeConfig,
    hasEnforceHook,
    defaultMode,
  }
}

/**
 * Detect broad permission rules that AutoMode will strip when entering auto mode.
 * These include blanket shell access like Bash(*), wildcarded interpreters, etc.
 */
export function findAutoModeStrippedRules(settings: ClaudeSettings): readonly string[] {
  const allow = settings.permissions?.allow ?? []

  const broadPatterns = [
    /^Bash$/,                      // bare Bash
    /^Bash\(\*\)$/,                // Bash(*)
    /^Bash\(python\*\)$/,          // Bash(python*)
    /^Bash\(node\*\)$/,            // Bash(node*)
    /^Bash\(npm run \*\)$/,        // Bash(npm run *)
    /^Bash\(pnpm run \*\)$/,
    /^Bash\(yarn run \*\)$/,
    /^Agent$/,                     // bare Agent
    /^Agent\(\*\)$/,               // Agent(*)
  ]

  return allow.filter(rule =>
    broadPatterns.some(pattern => pattern.test(rule))
  )
}
