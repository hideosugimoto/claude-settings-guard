import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

// Directories to skip (system utilities, not dev tools)
const SKIP_DIRS = new Set([
  '/sbin',
  '/usr/sbin',
  '/usr/libexec',
])

// Binaries to skip (too common/low-level to be useful for classification)
const SKIP_BINARIES = new Set([
  '[', 'test', 'true', 'false', 'yes', 'sh', 'bash', 'zsh', 'fish',
  'login', 'su', 'sudo', 'passwd', 'chsh', 'chown', 'chgrp',
])

/**
 * Scan PATH directories for installed executable binaries.
 * Returns deduplicated binary names (first occurrence wins, matching shell behavior).
 */
export async function scanInstalledBinaries(): Promise<readonly string[]> {
  const pathDirs = (process.env.PATH ?? '').split(':').filter(Boolean)
  const seen = new Set<string>()
  const binaries: string[] = []

  for (const dir of pathDirs) {
    if (SKIP_DIRS.has(dir)) continue

    try {
      const entries = await readdir(dir)
      for (const entry of entries) {
        if (seen.has(entry)) continue
        if (SKIP_BINARIES.has(entry)) continue
        if (entry.startsWith('.')) continue

        try {
          const fullPath = join(dir, entry)
          const s = await stat(fullPath)
          // Check if it's a file and executable
          if (s.isFile() && (s.mode & 0o111) !== 0) {
            seen.add(entry)
            binaries.push(entry)
          }
        } catch {
          // Skip files we can't stat
        }
      }
    } catch {
      // Skip directories we can't read
    }
  }

  return binaries.sort()
}
