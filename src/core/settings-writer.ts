import { writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import type { ClaudeSettings } from '../types.js'
import { createBackup } from '../utils/backup.js'
import { claudeSettingsSchema } from '../types.js'

export interface WriteResult {
  readonly success: boolean
  readonly backupPath?: string
  readonly error?: string
}

export async function writeSettings(
  filePath: string,
  settings: ClaudeSettings,
  options: { dryRun?: boolean; skipBackup?: boolean } = {}
): Promise<WriteResult> {
  // Validate before writing
  try {
    claudeSettingsSchema.parse(settings)
  } catch (err) {
    return {
      success: false,
      error: `Validation failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  const json = JSON.stringify(settings, null, 2) + '\n'

  // Verify it's valid JSON by round-tripping
  try {
    JSON.parse(json)
  } catch {
    return { success: false, error: 'Generated JSON is invalid' }
  }

  if (options.dryRun) {
    return { success: true }
  }

  // Create backup
  let backupPath: string | undefined
  if (!options.skipBackup && existsSync(filePath)) {
    try {
      backupPath = await createBackup(filePath)
    } catch (err) {
      return {
        success: false,
        error: `Backup failed: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  }

  // Write atomically: write to temp, then rename
  const tempPath = `${filePath}.tmp`
  try {
    await writeFile(tempPath, json, 'utf-8')
    // Verify written content
    const written = await readFile(tempPath, 'utf-8')
    JSON.parse(written) // Validate
    // Move into place
    const { rename } = await import('node:fs/promises')
    await rename(tempPath, filePath)
  } catch (err) {
    // Clean up temp file
    try {
      const { unlink } = await import('node:fs/promises')
      if (existsSync(tempPath)) await unlink(tempPath)
    } catch {
      // ignore cleanup errors
    }
    return {
      success: false,
      error: `Write failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  return { success: true, backupPath }
}

export function generateDiff(
  original: ClaudeSettings,
  modified: ClaudeSettings
): string {
  const originalJson = JSON.stringify(original, null, 2)
  const modifiedJson = JSON.stringify(modified, null, 2)

  if (originalJson === modifiedJson) {
    return 'No changes'
  }

  const originalLines = originalJson.split('\n')
  const modifiedLines = modifiedJson.split('\n')
  const diff: string[] = []

  const maxLines = Math.max(originalLines.length, modifiedLines.length)

  for (let i = 0; i < maxLines; i++) {
    const orig = originalLines[i]
    const mod = modifiedLines[i]

    if (orig === mod) {
      diff.push(`  ${orig ?? ''}`)
    } else {
      if (orig !== undefined) diff.push(`- ${orig}`)
      if (mod !== undefined) diff.push(`+ ${mod}`)
    }
  }

  return diff.join('\n')
}
