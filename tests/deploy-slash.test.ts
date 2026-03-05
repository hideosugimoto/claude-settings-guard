import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync } from 'node:fs'
import { readFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { deploySlashCommands } from '../src/commands/deploy-slash.js'

// Mock the paths module to use temp dir
const testDir = join(tmpdir(), `csg-test-${Date.now()}`)

vi.mock('../src/utils/paths.js', () => ({
  getCommandsDir: () => join(testDir, 'commands'),
  ensureDir: async (dir: string) => { await mkdir(dir, { recursive: true }) },
}))

describe('deploy-slash', () => {
  beforeEach(async () => {
    await mkdir(testDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  it('deploys all slash commands to empty directory', async () => {
    const result = await deploySlashCommands()

    expect(result.deployed).toContain('csg.md')
    expect(result.deployed).toContain('csg-diagnose.md')
    expect(result.deployed).toContain('csg-enforce.md')
    expect(result.skipped).toHaveLength(0)

    const commandsDir = join(testDir, 'commands')
    expect(existsSync(join(commandsDir, 'csg.md'))).toBe(true)
    expect(existsSync(join(commandsDir, 'csg-diagnose.md'))).toBe(true)
    expect(existsSync(join(commandsDir, 'csg-enforce.md'))).toBe(true)
  })

  it('skips existing files without force', async () => {
    // Deploy once
    await deploySlashCommands()

    // Deploy again
    const result = await deploySlashCommands()

    expect(result.deployed).toHaveLength(0)
    expect(result.skipped).toHaveLength(3)
  })

  it('overwrites existing files with force', async () => {
    // Deploy once
    await deploySlashCommands()

    // Deploy again with force
    const result = await deploySlashCommands({ force: true })

    expect(result.deployed).toHaveLength(3)
    expect(result.skipped).toHaveLength(0)
  })

  it('deployed files contain valid markdown', async () => {
    await deploySlashCommands()

    const commandsDir = join(testDir, 'commands')
    const content = await readFile(join(commandsDir, 'csg.md'), 'utf-8')

    expect(content).toContain('# /csg')
    expect(content).toContain('claude-settings-guard')
  })
})
