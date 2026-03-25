import { execSync } from 'node:child_process'

export interface AutoModeDefaults {
  readonly allow: readonly string[]
  readonly soft_deny: readonly string[]
  readonly environment: readonly string[]
}

/**
 * Fetch AutoMode default rules by running `claude auto-mode defaults`.
 * Returns null if the command is unavailable or fails.
 */
export function fetchAutoModeDefaults(): AutoModeDefaults | null {
  try {
    const output = execSync('claude auto-mode defaults 2>/dev/null', {
      encoding: 'utf-8',
      timeout: 10000,
    })
    const parsed = JSON.parse(output)
    return {
      allow: Array.isArray(parsed.allow) ? parsed.allow : [],
      soft_deny: Array.isArray(parsed.soft_deny) ? parsed.soft_deny : [],
      environment: Array.isArray(parsed.environment) ? parsed.environment : [],
    }
  } catch {
    return null
  }
}
