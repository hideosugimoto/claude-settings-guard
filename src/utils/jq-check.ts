import { execSync } from 'node:child_process'

export function isJqAvailable(): boolean {
  try {
    execSync('command -v jq', { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}
