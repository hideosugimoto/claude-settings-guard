import { writeFile, chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { generateEnforceScript, mergeHookIntoSettings } from './hook-generator.js'
import { extractAllRules } from './settings-reader.js'
import { getHooksDir, ensureDir, expandHome } from '../utils/paths.js'
import type { ClaudeSettings } from '../types.js'

export interface HookRegenerationResult {
  readonly hookPath: string
  readonly rulesCount: number
}

export async function regenerateEnforceHook(
  settings: ClaudeSettings
): Promise<HookRegenerationResult> {
  const rules = extractAllRules(settings)
  const allDeny = [...rules.denyRules, ...rules.legacyDeny]
  const hookPath = join(getHooksDir(), 'enforce-permissions.sh')

  if (allDeny.length === 0) {
    return { hookPath, rulesCount: 0 }
  }

  const script = generateEnforceScript(allDeny)
  await ensureDir(getHooksDir())
  await writeFile(hookPath, script, 'utf-8')
  await chmod(hookPath, 0o755)

  return { hookPath, rulesCount: allDeny.length }
}

export function ensureHookRegistered(settings: ClaudeSettings): ClaudeSettings {
  const hookPath = expandHome('~/.claude/hooks/enforce-permissions.sh')
  return mergeHookIntoSettings(settings, hookPath)
}
