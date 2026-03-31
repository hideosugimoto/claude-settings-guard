import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync } from 'node:fs'
import { readFile, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { deploySlashCommands, migrateFromCommands } from '../src/commands/deploy-slash.js'

// Mock the paths module to use temp dir
const testDir = join(tmpdir(), `csg-test-${Date.now()}`)

vi.mock('../src/utils/paths.js', () => ({
  getSkillsDir: () => join(testDir, 'skills'),
  getLegacyCommandsDir: () => join(testDir, 'commands'),
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

    const skillsDir = join(testDir, 'skills')
    expect(existsSync(join(skillsDir, 'csg.md'))).toBe(true)
    expect(existsSync(join(skillsDir, 'csg-diagnose.md'))).toBe(true)
    expect(existsSync(join(skillsDir, 'csg-enforce.md'))).toBe(true)
  })

  it('always overwrites with latest template', async () => {
    const skillsDir = join(testDir, 'skills')
    await mkdir(skillsDir, { recursive: true })
    await writeFile(join(skillsDir, 'csg.md'), '# outdated content', 'utf-8')

    const result = await deploySlashCommands()

    expect(result.deployed).toHaveLength(3)

    const content = await readFile(join(skillsDir, 'csg.md'), 'utf-8')
    expect(content).toContain('# /csg')
    expect(content).not.toContain('outdated')
  })

  it('deployed files contain valid markdown', async () => {
    await deploySlashCommands()

    const skillsDir = join(testDir, 'skills')
    const content = await readFile(join(skillsDir, 'csg.md'), 'utf-8')

    expect(content).toContain('# /csg')
    expect(content).toContain('claude-settings-guard')
  })

  it('migrates files from legacy commands/ to skills/', async () => {
    const legacyDir = join(testDir, 'commands')
    await mkdir(legacyDir, { recursive: true })
    await writeFile(join(legacyDir, 'csg.md'), '# old csg', 'utf-8')
    await writeFile(join(legacyDir, 'csg-diagnose.md'), '# old diagnose', 'utf-8')

    const migrated = await migrateFromCommands()

    expect(migrated).toContain('csg.md')
    expect(migrated).toContain('csg-diagnose.md')
    expect(migrated).not.toContain('csg-enforce.md')

    const skillsDir = join(testDir, 'skills')
    expect(existsSync(join(skillsDir, 'csg.md'))).toBe(true)
    expect(existsSync(join(legacyDir, 'csg.md'))).toBe(false)
  })

  it('migration deletes commands/ file without overwriting skills/', async () => {
    const legacyDir = join(testDir, 'commands')
    const skillsDir = join(testDir, 'skills')
    await mkdir(legacyDir, { recursive: true })
    await mkdir(skillsDir, { recursive: true })
    await writeFile(join(legacyDir, 'csg.md'), '# old from commands', 'utf-8')
    await writeFile(join(skillsDir, 'csg.md'), '# existing in skills', 'utf-8')

    const migrated = await migrateFromCommands()

    expect(migrated).toContain('csg.md')
    expect(existsSync(join(legacyDir, 'csg.md'))).toBe(false)
    const content = await readFile(join(skillsDir, 'csg.md'), 'utf-8')
    expect(content).toBe('# existing in skills')
  })

  it('deploy cleans commands/ then writes latest templates to skills/', async () => {
    const legacyDir = join(testDir, 'commands')
    await mkdir(legacyDir, { recursive: true })
    await writeFile(join(legacyDir, 'csg.md'), '# old content', 'utf-8')

    const result = await deploySlashCommands()

    expect(result.migrated).toContain('csg.md')
    expect(result.deployed).toHaveLength(3)
    expect(existsSync(join(legacyDir, 'csg.md'))).toBe(false)

    const skillsDir = join(testDir, 'skills')
    const content = await readFile(join(skillsDir, 'csg.md'), 'utf-8')
    expect(content).toContain('# /csg')
  })
})
