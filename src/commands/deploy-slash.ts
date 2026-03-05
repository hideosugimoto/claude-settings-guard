import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getCommandsDir, ensureDir } from '../utils/paths.js'
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

export interface DeployResult {
  readonly deployed: readonly string[]
  readonly skipped: readonly string[]
}

export async function deploySlashCommands(options: { force?: boolean } = {}): Promise<DeployResult> {
  const commandsDir = getCommandsDir()
  await ensureDir(commandsDir)

  const results = await Promise.all(
    SLASH_COMMANDS.map(async (cmd) => {
      const targetPath = join(commandsDir, cmd.filename)

      if (existsSync(targetPath) && !options.force) {
        return { filename: cmd.filename, action: 'skipped' as const }
      }

      const content = await loadTemplate(cmd.templateName)
      await writeFile(targetPath, content, 'utf-8')
      return { filename: cmd.filename, action: 'deployed' as const }
    })
  )

  return {
    deployed: results.filter(r => r.action === 'deployed').map(r => r.filename),
    skipped: results.filter(r => r.action === 'skipped').map(r => r.filename),
  }
}

export function printDeployResult(result: DeployResult): void {
  for (const file of result.deployed) {
    printSuccess(`/${file.replace('.md', '')} コマンドをインストールしました`)
  }
  for (const file of result.skipped) {
    printWarning(`/${file.replace('.md', '')} は既にインストール済み (--force で上書き)`)
  }
}
