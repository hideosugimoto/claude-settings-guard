import { copyFile, readdir } from 'node:fs/promises'
import { getBackupDir, getBackupPath, ensureDir } from './paths.js'

export async function createBackup(filePath: string): Promise<string> {
  const backupDir = getBackupDir()
  await ensureDir(backupDir)
  const backupPath = getBackupPath(filePath)
  await copyFile(filePath, backupPath)
  return backupPath
}

export async function listBackups(): Promise<readonly string[]> {
  const backupDir = getBackupDir()
  try {
    const files = await readdir(backupDir)
    return files
      .filter(f => f.endsWith('.bak'))
      .sort()
      .reverse()
  } catch {
    return []
  }
}

