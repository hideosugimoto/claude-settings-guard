import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { writeFile } from 'node:fs/promises'
import type { ClaudeSettings } from '../src/types.js'

// We need to mock the backup utility so createBackup writes to our temp dir
// instead of ~/.claude/backups/
let mockBackupDir: string

vi.mock('../src/utils/backup.js', async () => {
  const { copyFile } = await import('node:fs/promises')
  const { mkdirSync, existsSync } = await import('node:fs')
  const { join } = await import('node:path')
  return {
    createBackup: vi.fn(async (filePath: string) => {
      if (!existsSync(mockBackupDir)) {
        mkdirSync(mockBackupDir, { recursive: true })
      }
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const fileName = filePath.split('/').pop() ?? 'settings.json'
      const backupPath = join(mockBackupDir, `${fileName}.${timestamp}.bak`)
      await copyFile(filePath, backupPath)
      return backupPath
    }),
  }
})

import { writeSettings } from '../src/core/settings-writer.js'

describe('file-operations-robustness', () => {
  let tempDir: string
  let settingsPath: string

  const minimalSettings: ClaudeSettings = {
    permissions: {
      allow: ['Read'],
      deny: ['Bash(sudo *)'],
    },
  }

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'csg-robustness-'))
    settingsPath = join(tempDir, 'settings.json')
    mockBackupDir = join(tempDir, 'backups')
    vi.clearAllMocks()
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  // 1. Atomic write succeeds: write settings, verify file is valid JSON
  it('atomic write produces valid JSON', async () => {
    const result = await writeSettings(settingsPath, minimalSettings, { skipBackup: true })

    expect(result.success).toBe(true)
    expect(existsSync(settingsPath)).toBe(true)

    const content = readFileSync(settingsPath, 'utf-8')
    const parsed = JSON.parse(content)
    expect(parsed.permissions.allow).toEqual(['Read'])
    expect(parsed.permissions.deny).toEqual(['Bash(sudo *)'])
  })

  // 2. Backup is created: write settings, verify backup file exists
  it('creates backup when file already exists', async () => {
    // Write initial file so backup has something to copy
    writeFileSync(settingsPath, JSON.stringify(minimalSettings, null, 2), 'utf-8')

    const updatedSettings: ClaudeSettings = {
      permissions: {
        allow: ['Read', 'Glob'],
        deny: ['Bash(sudo *)'],
      },
    }

    const result = await writeSettings(settingsPath, updatedSettings)

    expect(result.success).toBe(true)
    expect(result.backupPath).toBeDefined()
    expect(existsSync(result.backupPath!)).toBe(true)

    // Verify backup contains original content
    const backupContent = JSON.parse(readFileSync(result.backupPath!, 'utf-8'))
    expect(backupContent.permissions.allow).toEqual(['Read'])

    // Verify main file has updated content
    const mainContent = JSON.parse(readFileSync(settingsPath, 'utf-8'))
    expect(mainContent.permissions.allow).toEqual(['Read', 'Glob'])
  })

  // 3. Temp file cleaned on error: mock writeFile to fail, verify .tmp is cleaned up
  it('cleans up temp file when write fails', async () => {
    const tempPath = `${settingsPath}.tmp`

    // Create a directory at the settings path to cause rename to fail
    // (can't rename a file onto a directory)
    mkdirSync(settingsPath, { recursive: true })

    const result = await writeSettings(settingsPath, minimalSettings, { skipBackup: true })

    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
    // Temp file should be cleaned up
    expect(existsSync(tempPath)).toBe(false)
  })

  // 4. Orphaned tmp detection: create a .tmp file, write settings, verify success
  it('succeeds even when orphaned .tmp file exists', async () => {
    const tempPath = `${settingsPath}.tmp`
    writeFileSync(tempPath, '{"orphaned": true}', 'utf-8')

    const result = await writeSettings(settingsPath, minimalSettings, { skipBackup: true })

    expect(result.success).toBe(true)
    // The .tmp file should be gone (overwritten then renamed)
    expect(existsSync(tempPath)).toBe(false)
    // Main file should be valid
    const content = JSON.parse(readFileSync(settingsPath, 'utf-8'))
    expect(content.permissions.allow).toEqual(['Read'])
  })

  // 5. Concurrent writes don't corrupt: run 2 writeSettings in parallel, verify valid JSON
  it('concurrent writes produce valid JSON (no corruption)', async () => {
    const settingsA: ClaudeSettings = {
      permissions: {
        allow: ['Read'],
        deny: ['Bash(sudo *)'],
      },
    }

    const settingsB: ClaudeSettings = {
      permissions: {
        allow: ['Glob', 'Bash(git *)'],
        deny: ['Bash(rm -rf *)'],
      },
    }

    // Run both writes concurrently
    const [resultA, resultB] = await Promise.all([
      writeSettings(settingsPath, settingsA, { skipBackup: true }),
      writeSettings(settingsPath, settingsB, { skipBackup: true }),
    ])

    // At least one should succeed (both may succeed due to atomic rename)
    const anySuccess = resultA.success || resultB.success
    expect(anySuccess).toBe(true)

    // The final file must be valid JSON (not corrupted)
    const content = readFileSync(settingsPath, 'utf-8')
    const parsed = JSON.parse(content)
    expect(parsed).toBeDefined()
    expect(parsed.permissions).toBeDefined()

    // It should be one of the two settings, not a mix
    const isA = JSON.stringify(parsed.permissions.allow) === JSON.stringify(['Read'])
    const isB = JSON.stringify(parsed.permissions.allow) === JSON.stringify(['Glob', 'Bash(git *)'])
    expect(isA || isB).toBe(true)
  })

  // 6. Empty/minimal settings write: verify valid file
  it('writes empty settings as valid JSON', async () => {
    const emptySettings: ClaudeSettings = {}

    const result = await writeSettings(settingsPath, emptySettings, { skipBackup: true })

    expect(result.success).toBe(true)
    const content = readFileSync(settingsPath, 'utf-8')
    const parsed = JSON.parse(content)
    expect(parsed).toEqual({})
  })

  it('writes settings with only permissions.allow', async () => {
    const settings: ClaudeSettings = {
      permissions: { allow: ['Read'] },
    }

    const result = await writeSettings(settingsPath, settings, { skipBackup: true })

    expect(result.success).toBe(true)
    const parsed = JSON.parse(readFileSync(settingsPath, 'utf-8'))
    expect(parsed.permissions.allow).toEqual(['Read'])
  })

  // 7. Large settings write: 100+ rules, verify completeness
  it('writes large settings with 100+ rules completely', async () => {
    const manyRules = Array.from({ length: 150 }, (_, i) => `Bash(command-${i} *)`)
    const largeSettings: ClaudeSettings = {
      permissions: {
        allow: manyRules.slice(0, 50),
        deny: manyRules.slice(50, 100),
        ask: manyRules.slice(100, 150),
      },
    }

    const result = await writeSettings(settingsPath, largeSettings, { skipBackup: true })

    expect(result.success).toBe(true)
    const parsed = JSON.parse(readFileSync(settingsPath, 'utf-8'))
    expect(parsed.permissions.allow).toHaveLength(50)
    expect(parsed.permissions.deny).toHaveLength(50)
    expect(parsed.permissions.ask).toHaveLength(50)

    // Verify first and last entries to ensure no truncation
    expect(parsed.permissions.allow[0]).toBe('Bash(command-0 *)')
    expect(parsed.permissions.allow[49]).toBe('Bash(command-49 *)')
    expect(parsed.permissions.ask[49]).toBe('Bash(command-149 *)')
  })

  // Additional edge cases

  it('returns error for invalid settings (schema validation)', async () => {
    // Force an invalid settings object past TypeScript
    const invalid = { permissions: { allow: 'not-an-array' } } as unknown as ClaudeSettings

    const result = await writeSettings(settingsPath, invalid, { skipBackup: true })

    expect(result.success).toBe(false)
    expect(result.error).toContain('Validation failed')
    // File should not be created
    expect(existsSync(settingsPath)).toBe(false)
  })

  it('does not leave .tmp file after validation failure', async () => {
    const invalid = { permissions: { allow: 123 } } as unknown as ClaudeSettings
    const tempPath = `${settingsPath}.tmp`

    await writeSettings(settingsPath, invalid, { skipBackup: true })

    expect(existsSync(tempPath)).toBe(false)
  })

  it('writes to nested directory that already exists', async () => {
    const nestedDir = join(tempDir, 'a', 'b', 'c')
    mkdirSync(nestedDir, { recursive: true })
    const nestedPath = join(nestedDir, 'settings.json')

    const result = await writeSettings(nestedPath, minimalSettings, { skipBackup: true })

    expect(result.success).toBe(true)
    expect(existsSync(nestedPath)).toBe(true)
  })

  it('dry run does not create any files', async () => {
    const result = await writeSettings(settingsPath, minimalSettings, {
      dryRun: true,
      skipBackup: true,
    })

    expect(result.success).toBe(true)
    expect(existsSync(settingsPath)).toBe(false)
    expect(existsSync(`${settingsPath}.tmp`)).toBe(false)
  })

  it('overwrites existing file atomically', async () => {
    // Write initial
    writeFileSync(settingsPath, JSON.stringify({ permissions: { allow: ['Read'] } }, null, 2), 'utf-8')

    const updated: ClaudeSettings = {
      permissions: {
        allow: ['Glob'],
        deny: ['Bash(rm *)'],
      },
    }

    const result = await writeSettings(settingsPath, updated, { skipBackup: true })

    expect(result.success).toBe(true)
    const parsed = JSON.parse(readFileSync(settingsPath, 'utf-8'))
    expect(parsed.permissions.allow).toEqual(['Glob'])
    expect(parsed.permissions.deny).toEqual(['Bash(rm *)'])
  })

  it('file ends with newline', async () => {
    await writeSettings(settingsPath, minimalSettings, { skipBackup: true })

    const content = readFileSync(settingsPath, 'utf-8')
    expect(content.endsWith('\n')).toBe(true)
  })

  it('written file is properly indented with 2 spaces', async () => {
    await writeSettings(settingsPath, minimalSettings, { skipBackup: true })

    const content = readFileSync(settingsPath, 'utf-8')
    // Should contain 2-space indentation, not tabs
    expect(content).toContain('  "permissions"')
    expect(content).not.toContain('\t')
  })
})
