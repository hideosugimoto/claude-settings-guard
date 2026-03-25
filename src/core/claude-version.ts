import { execSync } from 'node:child_process'

/**
 * Check if the installed Claude Code supports AutoMode.
 * Detects by checking if `claude --help` output contains "auto" permission mode.
 */
export function isAutoModeSupported(): boolean {
  try {
    const output = execSync('claude --help 2>/dev/null', {
      encoding: 'utf-8',
      timeout: 5000,
    })
    return output.includes('"auto"') || output.includes('auto-mode')
  } catch {
    return false
  }
}
