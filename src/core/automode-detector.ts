import type { ClaudeSettings, DiagnosticIssue } from '../types.js'
import { fetchAutoModeDefaults } from './automode-defaults.js'

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

/**
 * Check autoMode configuration for dangerous patterns.
 * Detects when soft_deny or allow have been customized with fewer rules
 * than the defaults, which means default protections are lost.
 */
export function checkAutoModeConfig(settings: ClaudeSettings): readonly DiagnosticIssue[] {
  const autoModeStatus = detectAutoMode(settings)
  if (!autoModeStatus.enabled) return []

  const defaults = fetchAutoModeDefaults()
  if (!defaults) return []

  const issues: DiagnosticIssue[] = []

  // Check soft_deny override
  const userSoftDeny = settings.autoMode?.soft_deny
  if (userSoftDeny !== undefined) {
    const defaultCount = defaults.soft_deny.length
    const userCount = userSoftDeny.length
    if (userCount < defaultCount) {
      issues.push({
        severity: 'critical',
        code: 'AUTO_MODE_SOFT_DENY_OVERRIDE',
        message: `autoMode.soft_deny が設定されていますが、デフォルト(${defaultCount}件)より少ない(${userCount}件)です。${defaultCount - userCount}件のデフォルト保護ルールが無効化されています。`,
        fix: '`claude auto-mode defaults` でデフォルトを確認し、全ルールをコピーしてからカスタマイズしてください',
      })
    }
  }

  // Check allow override
  const userAllow = settings.autoMode?.allow
  if (userAllow !== undefined) {
    const defaultCount = defaults.allow.length
    const userCount = userAllow.length
    if (userCount > defaultCount) {
      issues.push({
        severity: 'warning',
        code: 'AUTO_MODE_ALLOW_OVERRIDE',
        message: `autoMode.allow がデフォルト(${defaultCount}件)より多い(${userCount}件)です。過剰な例外が追加されている可能性があります。`,
        fix: '`claude auto-mode critique` でカスタムルールの安全性を確認してください',
      })
    }
  }

  // Check missing environment
  const hasDefaultMode = settings.permissions?.defaultMode === 'auto'
  const userEnv = settings.autoMode?.environment
  const hasCustomEnv = userEnv !== undefined && userEnv.length > 0 &&
    userEnv.some(e => !e.startsWith('**'))  // default entries start with **
  if (hasDefaultMode && !hasCustomEnv) {
    issues.push({
      severity: 'info',
      code: 'AUTO_MODE_NO_ENVIRONMENT',
      message: 'AutoMode が有効ですが、autoMode.environment が未設定です。分類器が信頼するインフラを認識できません。',
      fix: 'autoMode.environment に Source control, Cloud buckets, Trusted domains 等を記述してください',
    })
  }

  return issues
}
