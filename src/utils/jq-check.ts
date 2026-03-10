import { execSync } from 'node:child_process'

let _cached: boolean | undefined

export function isJqAvailable(): boolean {
  if (_cached !== undefined) return _cached
  try {
    execSync('command -v jq', { stdio: 'pipe' })
    _cached = true
  } catch {
    _cached = false
  }
  return _cached
}

export function resetJqCache(): void {
  _cached = undefined
}
