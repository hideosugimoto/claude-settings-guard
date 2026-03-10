import { writeFile, readFile, rename, unlink } from 'node:fs/promises'
import type { ClaudeSettings } from '../types.js'
import { createBackup } from '../utils/backup.js'
import { claudeSettingsSchema } from '../types.js'
import { debug } from '../utils/debug.js'

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

  debug(`Writing settings to ${filePath}`)
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

  // Create backup (catch ENOENT instead of existsSync to avoid TOCTOU race)
  let backupPath: string | undefined
  if (!options.skipBackup) {
    try {
      backupPath = await createBackup(filePath)
      if (backupPath) {
        debug(`Created backup at ${backupPath}`)
      }
    } catch (err: unknown) {
      const isNotFound = err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT'
      if (!isNotFound) {
        return {
          success: false,
          error: `Backup failed: ${err instanceof Error ? err.message : String(err)}`,
        }
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
    await rename(tempPath, filePath)
  } catch (err) {
    // Clean up temp file (catch ENOENT instead of existsSync to avoid TOCTOU race)
    try {
      await unlink(tempPath)
    } catch (cleanupError) {
      if (cleanupError instanceof Error && 'code' in cleanupError && (cleanupError as NodeJS.ErrnoException).code !== 'ENOENT') {
        process.stderr.write(`Warning: failed to clean up temp file ${tempPath}: ${(cleanupError as Error).message}\n`)
      }
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
