import { existsSync } from 'node:fs'
import { readFile, writeFile, rename, unlink, rmdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getSkillsDir, getLegacyCommandsDir, ensureDir } from '../utils/paths.js'
import { printSuccess, printWarning } from '../utils/display.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

interface SlashCommand {
  readonly filename: string
  readonly templateName: string
}

const SLASH_COMMANDS: readonly SlashCommand[] = [
  { filename: 'csg.md', templateName: 'csg.md' },
  { filename: 'csg-diagnose.md', templateName: 'csg-diagnose.md' },
  { filename: 'csg-enforce.md', templateName: 'csg-enforce.md' },
]

export function validateTemplateName(name: string): boolean {
  if (!name) return false
  if (name.includes('..') || name.includes('/') || name.includes('\\')) return false
  if (name.startsWith('/')) return false
  return true
}

async function loadTemplate(templateName: string): Promise<string> {
  if (!validateTemplateName(templateName)) {
    throw new Error(`Invalid template name: ${templateName}`)
  }

  // Try dist/templates first (built), then project root templates (dev)
  const distPath = join(__dirname, '..', 'templates', templateName)
  const devPath = join(__dirname, '..', '..', 'templates', templateName)

  try {
    return await readFile(distPath, 'utf-8')
  } catch {
    return readFile(devPath, 'utf-8')
  }
}

export async function migrateFromCommands(): Promise<readonly string[]> {
  const legacyDir = getLegacyCommandsDir()
  if (!existsSync(legacyDir)) return []

  const skillsDir = getSkillsDir()
  await ensureDir(skillsDir)

  const migrated: string[] = []
  for (const cmd of SLASH_COMMANDS) {
    const legacyPath = join(legacyDir, cmd.filename)
    if (!existsSync(legacyPath)) continue

    const targetPath = join(skillsDir, cmd.filename)
    if (existsSync(targetPath)) {
      // skills/ に既にある場合は commands/ 側を削除するだけ
      await unlink(legacyPath)
    } else {
      await rename(legacyPath, targetPath)
    }
    migrated.push(cmd.filename)
  }

  // Remove legacy dir if empty
  try {
    await rmdir(legacyDir)
  } catch {
    // Not empty (user has other files) — leave it
  }

  return migrated
}

export interface DeployResult {
  readonly deployed: readonly string[]
  readonly migrated: readonly string[]
}

export async function deploySlashCommands(): Promise<DeployResult> {
  // Clean up legacy ~/.claude/commands/
  const migrated = await migrateFromCommands()

  const skillsDir = getSkillsDir()
  await ensureDir(skillsDir)

  // Always overwrite with latest templates
  await Promise.all(
    SLASH_COMMANDS.map(async (cmd) => {
      const targetPath = join(skillsDir, cmd.filename)
      const content = await loadTemplate(cmd.templateName)
      await writeFile(targetPath, content, 'utf-8')
    })
  )

  return {
    deployed: SLASH_COMMANDS.map(cmd => cmd.filename),
    migrated,
  }
}

export function printDeployResult(result: DeployResult): void {
  for (const file of result.migrated) {
    printSuccess(`/${file.replace('.md', '')} を commands/ → skills/ に移行しました`)
  }
  for (const file of result.deployed) {
    printSuccess(`/${file.replace('.md', '')} スキルをインストールしました`)
  }
}
