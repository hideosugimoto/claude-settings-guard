import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { mkdir } from 'node:fs/promises'

export function expandHome(filePath: string): string {
  if (filePath.startsWith('~/')) {
    return join(homedir(), filePath.slice(2))
  }
  return resolve(filePath)
}

export function getGlobalSettingsPath(): string {
  return join(homedir(), '.claude', 'settings.json')
}

export function getLocalSettingsPath(): string {
  return join(homedir(), '.claude', 'settings.local.json')
}

export function getProjectSettingsPath(projectDir: string): string {
  return join(projectDir, '.claude', 'settings.json')
}

export function getBackupDir(): string {
  return join(homedir(), '.claude', 'backups')
}

export function getHooksDir(): string {
  return join(homedir(), '.claude', 'hooks')
}

export function getCommandsDir(): string {
  return join(homedir(), '.claude', 'commands')
}

export function getTelemetryDir(): string {
  return join(homedir(), '.claude', 'telemetry')
}

export function getBackupPath(originalPath: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const fileName = originalPath.split('/').pop() ?? 'settings.json'
  return join(getBackupDir(), `${fileName}.${timestamp}.bak`)
}

export function getClaudeMdPath(): string {
  return join(homedir(), '.claude', 'CLAUDE.md')
}

export async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true })
}
