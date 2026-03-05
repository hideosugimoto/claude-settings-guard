import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { claudeSettingsSchema, type ClaudeSettings, type SettingsLayer } from '../types.js'
import { getGlobalSettingsPath, getLocalSettingsPath, getProjectSettingsPath } from '../utils/paths.js'

export async function readSettingsFile(filePath: string): Promise<ClaudeSettings | null> {
  if (!existsSync(filePath)) return null
  const raw = await readFile(filePath, 'utf-8')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(
      `Failed to parse ${filePath}: ${err instanceof Error ? err.message : String(err)}`
    )
  }
  try {
    return claudeSettingsSchema.parse(parsed)
  } catch (err) {
    throw new Error(
      `Invalid settings schema in ${filePath}: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}

export async function readGlobalSettings(): Promise<ClaudeSettings | null> {
  return readSettingsFile(getGlobalSettingsPath())
}

export async function readLocalSettings(): Promise<ClaudeSettings | null> {
  return readSettingsFile(getLocalSettingsPath())
}

export async function readProjectSettings(projectDir: string): Promise<ClaudeSettings | null> {
  return readSettingsFile(getProjectSettingsPath(projectDir))
}

export async function loadAllLayers(projectDir?: string): Promise<readonly SettingsLayer[]> {
  const layers: SettingsLayer[] = []

  const globalPath = getGlobalSettingsPath()
  const globalSettings = await readGlobalSettings()
  if (globalSettings) {
    layers.push({ path: globalPath, settings: globalSettings })
  }

  const localPath = getLocalSettingsPath()
  const localSettings = await readLocalSettings()
  if (localSettings) {
    layers.push({ path: localPath, settings: localSettings })
  }

  if (projectDir) {
    const projPath = getProjectSettingsPath(projectDir)
    const projSettings = await readProjectSettings(projectDir)
    if (projSettings) {
      layers.push({ path: projPath, settings: projSettings })
    }
  }

  return layers
}

function mergeStringArrays(
  base: readonly string[] | undefined,
  overlay: readonly string[] | undefined
): string[] | undefined {
  if (!overlay) return base ? [...base] : undefined
  if (!base) return [...overlay]
  return [...new Set([...base, ...overlay])]
}

export function mergeSettings(layers: readonly SettingsLayer[]): ClaudeSettings {
  const merged: ClaudeSettings = {}

  for (const layer of layers) {
    const s = layer.settings

    if (s.allowedTools) {
      merged.allowedTools = mergeStringArrays(merged.allowedTools, s.allowedTools)
    }
    if (s.deny) {
      merged.deny = mergeStringArrays(merged.deny, s.deny)
    }
    if (s.permissions) {
      const mp = merged.permissions ?? {}
      merged.permissions = {
        ...mp,
        allow: mergeStringArrays(mp.allow, s.permissions.allow),
        deny: mergeStringArrays(mp.deny, s.permissions.deny),
        ask: mergeStringArrays(mp.ask, s.permissions.ask),
      }
    }
  }

  return merged
}

export function extractAllRules(settings: ClaudeSettings): {
  readonly allowRules: readonly string[]
  readonly denyRules: readonly string[]
  readonly askRules: readonly string[]
  readonly legacyAllowedTools: readonly string[]
  readonly legacyDeny: readonly string[]
} {
  return {
    allowRules: settings.permissions?.allow ?? [],
    denyRules: settings.permissions?.deny ?? [],
    askRules: settings.permissions?.ask ?? [],
    legacyAllowedTools: settings.allowedTools ?? [],
    legacyDeny: settings.deny ?? [],
  }
}
