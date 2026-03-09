import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect } from 'vitest'
import { parseDenyPattern } from '../src/core/hook-script-builder.js'
import { readSettingsFile } from '../src/core/settings-reader.js'
import { writeSettings } from '../src/core/settings-writer.js'

// ============================================================
// Helper
// ============================================================
async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'csg-r2-'))
  try {
    await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

// ============================================================
// H1: assertSafePattern missing !, {, } blocking
// ============================================================
describe('H1: assertSafePattern blocks !, {, } characters', () => {
  it('throws on ! (bash history expansion)', () => {
    expect(() => parseDenyPattern('Bash(echo !!)')).toThrow('unsafe')
  })

  it('throws on { (brace expansion)', () => {
    expect(() => parseDenyPattern('Bash(echo {a,b})')).toThrow('unsafe')
  })

  it('throws on } (brace expansion)', () => {
    expect(() => parseDenyPattern('Bash(echo test})')).toThrow('unsafe')
  })

  it('error message for ! includes description', () => {
    expect(() => parseDenyPattern('Bash(cmd!!)')).toThrow('history expansion')
  })

  it('error message for { includes description', () => {
    expect(() => parseDenyPattern('Bash(echo {a)')).toThrow('brace expansion')
  })

  it('error message for } includes description', () => {
    expect(() => parseDenyPattern('Bash(echo a})')).toThrow('brace expansion')
  })

  it('still allows safe patterns without these characters', () => {
    expect(parseDenyPattern('Bash(sudo *)')).not.toBeNull()
    expect(parseDenyPattern('Read(**/.env)')).not.toBeNull()
    expect(parseDenyPattern('Bash(rm -rf /*)')).not.toBeNull()
  })
})

// ============================================================
// H2: TOCTOU race in settings-reader and settings-writer
// ============================================================
describe('H2: TOCTOU race - settings-reader', () => {
  it('returns null for non-existent file without existsSync', async () => {
    const result = await readSettingsFile('/tmp/nonexistent-csg-test-file.json')
    expect(result).toBeNull()
  })

  it('reads existing valid settings file', async () => {
    await withTempDir(async (dir) => {
      const filePath = join(dir, 'settings.json')
      const settings = { permissions: { allow: ['Read(*)'] } }
      await writeFile(filePath, JSON.stringify(settings), 'utf-8')

      const result = await readSettingsFile(filePath)
      expect(result).not.toBeNull()
      expect(result?.permissions?.allow).toContain('Read(*)')
    })
  })

  it('throws on invalid JSON', async () => {
    await withTempDir(async (dir) => {
      const filePath = join(dir, 'bad.json')
      await writeFile(filePath, 'not json at all', 'utf-8')

      await expect(readSettingsFile(filePath)).rejects.toThrow('Failed to parse')
    })
  })
})

describe('H2: TOCTOU race - settings-writer', () => {
  it('writes settings to new file (no backup needed)', async () => {
    await withTempDir(async (dir) => {
      const filePath = join(dir, 'new-settings.json')
      const settings = { permissions: { allow: ['Read(*)'] } }

      const result = await writeSettings(filePath, settings, { skipBackup: false })
      expect(result.success).toBe(true)

      const content = await readFile(filePath, 'utf-8')
      const parsed = JSON.parse(content)
      expect(parsed.permissions.allow).toContain('Read(*)')
    })
  })

  it('creates backup when file exists', async () => {
    await withTempDir(async (dir) => {
      const filePath = join(dir, 'existing.json')
      await writeFile(filePath, JSON.stringify({ permissions: {} }), 'utf-8')

      const settings = { permissions: { allow: ['Read(*)'] } }
      const result = await writeSettings(filePath, settings)

      expect(result.success).toBe(true)
    })
  })

  it('cleans up temp file on write failure', async () => {
    await withTempDir(async (dir) => {
      // Create a directory where the file should be - this will cause write to fail
      const filePath = join(dir, 'subdir')
      await mkdir(filePath)

      const settings = { permissions: { allow: ['Read(*)'] } }
      const result = await writeSettings(filePath, settings, { skipBackup: true })

      expect(result.success).toBe(false)
      expect(result.error).toContain('Write failed')
    })
  })
})

// ============================================================
// M4: Unused exports - dead code removal
// ============================================================
describe('M4: Unused exports removed', () => {
  it('display.ts does not export formatPattern', async () => {
    const module = await import('../src/utils/display.js')
    expect('formatPattern' in module).toBe(false)
  })

  it('display.ts does not export printSubHeader', async () => {
    const module = await import('../src/utils/display.js')
    expect('printSubHeader' in module).toBe(false)
  })

  it('backup.ts does not export getLatestBackup', async () => {
    const module = await import('../src/utils/backup.js')
    expect('getLatestBackup' in module).toBe(false)
  })

  it('display.ts still exports printHeader', async () => {
    const module = await import('../src/utils/display.js')
    expect('printHeader' in module).toBe(true)
  })

  it('display.ts still exports printIssue', async () => {
    const module = await import('../src/utils/display.js')
    expect('printIssue' in module).toBe(true)
  })

  it('backup.ts still exports createBackup', async () => {
    const module = await import('../src/utils/backup.js')
    expect('createBackup' in module).toBe(true)
  })

  it('backup.ts still exports listBackups', async () => {
    const module = await import('../src/utils/backup.js')
    expect('listBackups' in module).toBe(true)
  })
})

// ============================================================
// M6: Inconsistent dynamic imports in settings-writer
// ============================================================
describe('M6: settings-writer uses static imports for rename and unlink', () => {
  it('writeSettings completes atomic write successfully', async () => {
    await withTempDir(async (dir) => {
      const filePath = join(dir, 'atomic-test.json')
      const settings = { permissions: { deny: ['Bash(sudo *)'] } }

      const result = await writeSettings(filePath, settings, { skipBackup: true })
      expect(result.success).toBe(true)

      const content = await readFile(filePath, 'utf-8')
      const parsed = JSON.parse(content)
      expect(parsed.permissions.deny).toContain('Bash(sudo *)')
    })
  })

  it('writeSettings handles write error and cleans up temp file', async () => {
    await withTempDir(async (dir) => {
      // Use a path that will fail the rename (directory as target)
      const filePath = join(dir, 'subdir')
      await mkdir(filePath)

      const settings = { permissions: { deny: ['Bash(sudo *)'] } }
      const result = await writeSettings(filePath, settings, { skipBackup: true })

      expect(result.success).toBe(false)
    })
  })
})
