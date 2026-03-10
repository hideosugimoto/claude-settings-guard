export function exitWithError(message: string, code = 1): never {
  process.stderr.write(`Error: ${message}\n`)
  process.exit(code)
}

export function handleCommandError(err: unknown): never {
  exitWithError(err instanceof Error ? err.message : String(err))
}
