import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

// Only scan directories where users intentionally install dev tools.
// System directories (/usr/bin, /bin, /sbin) contain hundreds of OS utilities
// that are not relevant for Claude Code permission management.
function isUserInstalledDir(dir: string): boolean {
  const home = homedir()

  // Homebrew (macOS/Linux)
  if (dir.startsWith('/opt/homebrew/') || dir === '/opt/homebrew/bin' || dir === '/opt/homebrew/sbin') return true
  if (dir.startsWith('/usr/local/bin') || dir === '/usr/local/bin') return true

  // User-local installs (~/.local/bin, ~/.cargo/bin, ~/.deno/bin, etc.)
  if (dir.startsWith(home)) return true

  // Linuxbrew
  if (dir.startsWith('/home/linuxbrew/')) return true

  // nix
  if (dir.startsWith('/nix/')) return true

  // volta, fnm, etc. in /opt
  if (dir.startsWith('/opt/') && !dir.startsWith('/opt/homebrew/')) return true

  return false
}

// Prefixes of binaries to skip (compilers, system tools, arch-specific)
const SKIP_PREFIXES = [
  'aarch64-', 'x86_64-', 'arm-', 'i686-',     // cross-compilers
  'llvm-', 'clang', 'gcc', 'g++', 'gfortran',  // compilers
  'lib',                                         // library tools
]

// Binaries to always skip (shells, system auth, low-level, macOS system)
const SKIP_BINARIES = new Set([
  // Shells
  'sh', 'bash', 'zsh', 'fish', 'csh', 'tcsh', 'ksh', 'dash',
  // System auth
  'login', 'su', 'sudo', 'passwd', 'chsh', 'chown', 'chgrp', 'doas',
  // Test utilities
  '[', 'test', 'true', 'false', 'yes',
  // macOS system tools (in /opt/homebrew but not dev tools)
  'ab', 'apachectl', 'apxs', 'aspell', 'aspell-import',
  'addbuiltin', 'addgnupghome', 'annotate', 'applygnupgdefaults',
  // Low-level / not relevant for AI coding sessions
  'as', 'ld', 'nm', 'ar', 'ranlib', 'strip', 'strings',
  'objdump', 'objcopy', 'size', 'addr2line', 'c++filt',
  'install_name_tool', 'otool', 'lipo', 'codesign',
])

function hasSkipPrefix(name: string): boolean {
  return SKIP_PREFIXES.some(prefix => name.startsWith(prefix))
}

/**
 * Scan PATH directories for user-installed executable binaries.
 * Only scans directories where users intentionally install tools (Homebrew, ~/.local, etc.).
 * Returns deduplicated binary names (first occurrence wins, matching shell behavior).
 */
export async function scanInstalledBinaries(): Promise<readonly string[]> {
  const pathDirs = (process.env.PATH ?? '').split(':').filter(Boolean)
  const seen = new Set<string>()
  const binaries: string[] = []

  for (const dir of pathDirs) {
    if (!isUserInstalledDir(dir)) continue

    try {
      const entries = await readdir(dir)
      for (const entry of entries) {
        if (seen.has(entry)) continue
        if (SKIP_BINARIES.has(entry)) continue
        if (entry.startsWith('.')) continue
        if (hasSkipPrefix(entry)) continue
        // Skip version-suffixed duplicates (e.g., python3.12, gcc-14)
        if (/\d+\.\d+/.test(entry)) continue
        // Skip names that look like internal tools (contain hyphens with numbers)
        if (/^[a-z]+-\d+$/.test(entry)) continue

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
