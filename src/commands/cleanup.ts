import { existsSync } from 'node:fs'
import { unlink, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readGlobalSettings } from '../core/settings-reader.js'
import { writeSettings } from '../core/settings-writer.js'
import { getAllProfileDenyRules } from '../profiles/index.js'
import { printHeader, printSuccess, printWarning } from '../utils/display.js'
import { exitWithError } from '../utils/exit.js'
import { getGlobalSettingsPath, getHooksDir, getCommandsDir, getClaudeMdPath } from '../utils/paths.js'
import { SAFE_BASH_ALLOW_RULES, READ_ONLY_BASH_SAFE, READ_ONLY_BASH_FILE_READERS, HARD_TO_REVERSE_ASK_RULES, STRICT_ONLY_ASK_RULES } from '../constants.js'
import type { ClaudeSettings } from '../types.js'

const CLAUDE_MD_BEGIN = '<!-- CSG:BASH_RULES:BEGIN -->'
const CLAUDE_MD_END = '<!-- CSG:BASH_RULES:END -->'

const SLASH_COMMAND_FILES = ['csg.md', 'csg-diagnose.md', 'csg-enforce.md'] as const

export interface CleanupResult {
  readonly removedHooks: readonly string[]
  readonly removedSlashCommands: readonly string[]
  readonly removedClaudeMdSection: boolean
  readonly removedDenyRules: readonly string[]
  readonly removedAllowRules: readonly string[]
  readonly removedAskRules: readonly string[]
  readonly removedHookRegistrations: readonly string[]
}

/**
 * Collect all rules managed by csg profiles.
 */
function collectManagedRules(): {
  readonly managedDeny: ReadonlySet<string>
  readonly managedAllow: ReadonlySet<string>
  readonly managedAsk: ReadonlySet<string>
} {
  const managedDeny = getAllProfileDenyRules()
  const managedAllow = new Set([
    ...SAFE_BASH_ALLOW_RULES,
    ...READ_ONLY_BASH_SAFE,
    ...READ_ONLY_BASH_FILE_READERS,
  ])
  const managedAsk = new Set([
    ...HARD_TO_REVERSE_ASK_RULES,
    ...STRICT_ONLY_ASK_RULES,
  ])
  return { managedDeny, managedAllow, managedAsk }
}

/**
 * Remove csg-managed rules from settings, preserving user-added custom rules.
 */
function cleanSettingsRules(settings: ClaudeSettings): {
  readonly cleaned: ClaudeSettings
  readonly removedDeny: readonly string[]
  readonly removedAllow: readonly string[]
  readonly removedAsk: readonly string[]
  readonly removedHookRegs: readonly string[]
} {
  const { managedDeny, managedAllow, managedAsk } = collectManagedRules()

  const existingDeny = settings.permissions?.deny ?? []
  const existingAllow = settings.permissions?.allow ?? []
  const existingAsk = settings.permissions?.ask ?? []

  const removedDeny = existingDeny.filter(r => managedDeny.has(r))
  const removedAllow = existingAllow.filter(r => managedAllow.has(r))
  const removedAsk = existingAsk.filter(r => managedAsk.has(r))

  const keptDeny = existingDeny.filter(r => !managedDeny.has(r))
  const keptAllow = existingAllow.filter(r => !managedAllow.has(r))
  const keptAsk = existingAsk.filter(r => !managedAsk.has(r))

  // Remove hook registrations (enforce-permissions, session-diagnose)
  const removedHookRegs: string[] = []

  const cleanHookArray = (
    hooks: ClaudeSettings['PreToolUse'],
    label: string,
  ): ClaudeSettings['PreToolUse'] => {
    if (!hooks) return undefined
    const filtered = hooks.filter(rule => {
      const hasCsgHook = rule.hooks.some(h =>
        h.command.includes('enforce-permissions') ||
        h.command.includes('session-diagnose')
      )
      if (hasCsgHook) removedHookRegs.push(`${label}: ${rule.matcher}`)
      return !hasCsgHook
    })
    return filtered.length > 0 ? filtered : undefined
  }

  const cleanedPreToolUse = cleanHookArray(settings.PreToolUse, 'PreToolUse')
  const cleanedSessionStart = cleanHookArray(settings.SessionStart, 'SessionStart')

  const { PreToolUse: _p, SessionStart: _s, ...restSettings } = settings

  const permissions = {
    ...(settings.permissions ?? {}),
    ...(keptDeny.length > 0 ? { deny: keptDeny } : {}),
    ...(keptAllow.length > 0 ? { allow: keptAllow } : {}),
    ...(keptAsk.length > 0 ? { ask: keptAsk } : {}),
  }

  // Remove empty arrays from permissions
  if (keptDeny.length === 0) delete (permissions as Record<string, unknown>).deny
  if (keptAllow.length === 0) delete (permissions as Record<string, unknown>).allow
  if (keptAsk.length === 0) delete (permissions as Record<string, unknown>).ask

  const hasPermissions = Object.keys(permissions).length > 0

  return {
    cleaned: {
      ...restSettings,
      ...(hasPermissions ? { permissions } : {}),
      ...(cleanedPreToolUse ? { PreToolUse: cleanedPreToolUse } : {}),
      ...(cleanedSessionStart ? { SessionStart: cleanedSessionStart } : {}),
    },
    removedDeny,
    removedAllow,
    removedAsk,
    removedHookRegs,
  }
}

/**
 * Remove csg section from CLAUDE.md
 */
async function cleanClaudeMd(): Promise<boolean> {
  const claudeMdPath = getClaudeMdPath()

  let content: string
  try {
    content = await readFile(claudeMdPath, 'utf-8')
  } catch {
    return false
  }

  const beginIdx = content.indexOf(CLAUDE_MD_BEGIN)
  const endIdx = content.indexOf(CLAUDE_MD_END)

  if (beginIdx === -1 || endIdx === -1 || beginIdx >= endIdx) {
    return false
  }

  const before = content.slice(0, beginIdx)
  const after = content.slice(endIdx + CLAUDE_MD_END.length)
  const cleaned = (before + after).replace(/\n{3,}/g, '\n\n').trim()

  if (cleaned.length === 0) {
    await unlink(claudeMdPath)
  } else {
    await writeFile(claudeMdPath, cleaned + '\n', 'utf-8')
  }

  return true
}

/**
 * Remove hook script files
 */
async function cleanHookFiles(): Promise<readonly string[]> {
  const hooksDir = getHooksDir()
  const hookFiles = ['enforce-permissions.sh', 'session-diagnose.sh'] as const
  const removed: string[] = []

  for (const file of hookFiles) {
    const path = join(hooksDir, file)
    if (existsSync(path)) {
      await unlink(path)
      removed.push(file)
    }
  }

  return removed
}

/**
 * Remove slash command files
 */
async function cleanSlashCommands(): Promise<readonly string[]> {
  const commandsDir = getCommandsDir()
  const removed: string[] = []

  for (const file of SLASH_COMMAND_FILES) {
    const path = join(commandsDir, file)
    if (existsSync(path)) {
      await unlink(path)
      removed.push(file)
    }
  }

  return removed
}

export async function runCleanup(options: { dryRun?: boolean }): Promise<CleanupResult> {
  const settings = await readGlobalSettings()

  // Clean settings rules
  const settingsResult = settings
    ? cleanSettingsRules(settings)
    : { cleaned: {}, removedDeny: [], removedAllow: [], removedAsk: [], removedHookRegs: [] }

  if (options.dryRun) {
    // For dry-run, detect what WOULD be removed without actually removing
    const hooksDir = getHooksDir()
    const commandsDir = getCommandsDir()
    const claudeMdPath = getClaudeMdPath()

    const hookFiles = ['enforce-permissions.sh', 'session-diagnose.sh'].filter(f =>
      existsSync(join(hooksDir, f))
    )
    const slashFiles = SLASH_COMMAND_FILES.filter(f =>
      existsSync(join(commandsDir, f))
    )

    let hasClaudeMdSection = false
    try {
      const content = await readFile(claudeMdPath, 'utf-8')
      hasClaudeMdSection = content.includes(CLAUDE_MD_BEGIN)
    } catch {
      // file doesn't exist
    }

    return {
      removedHooks: hookFiles,
      removedSlashCommands: slashFiles,
      removedClaudeMdSection: hasClaudeMdSection,
      removedDenyRules: settingsResult.removedDeny,
      removedAllowRules: settingsResult.removedAllow,
      removedAskRules: settingsResult.removedAsk,
      removedHookRegistrations: settingsResult.removedHookRegs,
    }
  }

  // Actually remove
  const removedHooks = await cleanHookFiles()
  const removedSlashCommands = await cleanSlashCommands()
  const removedClaudeMdSection = await cleanClaudeMd()

  if (settings) {
    await writeSettings(getGlobalSettingsPath(), settingsResult.cleaned)
  }

  return {
    removedHooks,
    removedSlashCommands,
    removedClaudeMdSection,
    removedDenyRules: settingsResult.removedDeny,
    removedAllowRules: settingsResult.removedAllow,
    removedAskRules: settingsResult.removedAsk,
    removedHookRegistrations: settingsResult.removedHookRegs,
  }
}

function hasAnythingToClean(result: CleanupResult): boolean {
  return (
    result.removedHooks.length > 0 ||
    result.removedSlashCommands.length > 0 ||
    result.removedClaudeMdSection ||
    result.removedDenyRules.length > 0 ||
    result.removedAllowRules.length > 0 ||
    result.removedAskRules.length > 0 ||
    result.removedHookRegistrations.length > 0
  )
}

function printCleanupResult(result: CleanupResult): void {
  if (result.removedHooks.length > 0) {
    process.stdout.write(`  フックスクリプト: ${result.removedHooks.join(', ')}\n`)
  }
  if (result.removedHookRegistrations.length > 0) {
    process.stdout.write(`  フック登録: ${result.removedHookRegistrations.join(', ')}\n`)
  }
  if (result.removedSlashCommands.length > 0) {
    process.stdout.write(`  スラッシュコマンド: ${result.removedSlashCommands.map(f => '/' + f.replace('.md', '')).join(', ')}\n`)
  }
  if (result.removedClaudeMdSection) {
    process.stdout.write(`  CLAUDE.md: Bash コマンドルールセクション\n`)
  }
  if (result.removedDenyRules.length > 0) {
    process.stdout.write(`  deny ルール: ${result.removedDenyRules.length}件\n`)
  }
  if (result.removedAllowRules.length > 0) {
    process.stdout.write(`  allow ルール: ${result.removedAllowRules.length}件\n`)
  }
  if (result.removedAskRules.length > 0) {
    process.stdout.write(`  ask ルール: ${result.removedAskRules.length}件\n`)
  }
}

export async function cleanupCommand(options: { dryRun?: boolean }): Promise<void> {
  printHeader('Claude Settings Guard - クリーンアップ')

  process.stdout.write('csg が管理する設定を全て除去します。\n')
  process.stdout.write('ユーザーが独自に追加したルールは保持されます。\n')
  process.stdout.write('━'.repeat(40) + '\n\n')

  const result = await runCleanup({ dryRun: options.dryRun })

  if (!hasAnythingToClean(result)) {
    printSuccess('csg が管理する設定は見つかりませんでした。既にクリーンです。')
    return
  }

  if (options.dryRun) {
    process.stdout.write('除去される設定:\n')
    printCleanupResult(result)
    process.stdout.write('\n--dry-run モードです。変更は適用されていません。\n')
    process.stdout.write('実際に適用するには: csg cleanup\n')
    return
  }

  process.stdout.write('除去した設定:\n')
  printCleanupResult(result)

  printSuccess('\nクリーンアップ完了')

  // Show autoMode.environment hint
  process.stdout.write('\nAutoMode で git push やクラウド連携を使う場合は、\n')
  process.stdout.write('autoMode.environment に信頼するインフラを設定してください。\n')
  process.stdout.write('ローカル開発のみなら設定不要です。\n')
  process.stdout.write('  詳細: claude auto-mode config\n')

  process.stdout.write('\ncsg を再度セットアップするには: csg setup\n')
}
