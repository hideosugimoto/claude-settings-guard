import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

// Directories to skip (admin-only, not development relevant)
const SKIP_DIRS = new Set([
  '/sbin',
  '/usr/sbin',
])

// Binaries to always skip (shells, system auth — these are never
// something Claude Code should be asked to classify)
const SKIP_BINARIES = new Set([
  'sh', 'bash', 'zsh', 'fish', 'csh', 'tcsh', 'ksh', 'dash',
  'login', 'su', 'sudo', 'passwd', 'chsh', 'chown', 'chgrp', 'doas',
  '[', 'test', 'true', 'false', 'yes',
])

/**
 * Scan all PATH directories for executable binaries.
 * Returns deduplicated binary names (first occurrence wins, matching shell behavior).
 * AI classifier handles skip/safe/risky classification — we only exclude
 * the most basic system binaries here.
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
        // Skip version-suffixed duplicates (e.g., python3.12, gcc-14)
        if (/\d+\.\d+/.test(entry)) continue

        try {
          const fullPath = join(dir, entry)
          const s = await stat(fullPath)
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
