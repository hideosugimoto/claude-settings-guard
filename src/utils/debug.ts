let _debugEnabled = false

export function enableDebug(): void {
  _debugEnabled = true
}

export function isDebugEnabled(): boolean {
  return _debugEnabled || process.env.CSG_DEBUG === '1'
}

export function debug(message: string): void {
  if (isDebugEnabled()) {
    process.stderr.write(`[CSG DEBUG] ${message}\n`)
  }
}
