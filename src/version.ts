import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

function loadVersion(): string {
  const __dirname = dirname(fileURLToPath(import.meta.url))
  // Try package.json relative to dist (built) and src (dev)
  for (const rel of ['..', '../..']) {
    try {
      const pkg = JSON.parse(readFileSync(join(__dirname, rel, 'package.json'), 'utf-8'))
      return pkg.version as string
    } catch {
      continue
    }
  }
  return '0.0.0'
}

export const VERSION: string = loadVersion()
