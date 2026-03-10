import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readSettingsFile } from '../src/core/settings-reader.js'

// ============================================================
// Helper
// ============================================================
async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'csg-robust-'))
  try {
    await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

// ============================================================
// Issue 2: Non-UTF-8 / corrupted settings files crash reader
// ============================================================
describe('settings-reader: corrupted file handling', () => {
  it('returns null for binary/corrupted file content', async () => {
    await withTempDir(async (dir) => {
      const filePath = join(dir, 'settings.json')
      const binaryBuffer = Buffer.from([0x00, 0x01, 0x80, 0xff, 0xfe, 0x89, 0x50])
      await writeFile(filePath, binaryBuffer)

      const result = await readSettingsFile(filePath)
      expect(result).toBeNull()
    })
  })

  it('returns null for invalid JSON content', async () => {
    await withTempDir(async (dir) => {
      const filePath = join(dir, 'settings.json')
      await writeFile(filePath, '{ this is not valid json }}}', 'utf-8')

      const result = await readSettingsFile(filePath)
      expect(result).toBeNull()
    })
  })

  it('returns null for valid JSON that fails schema validation', async () => {
    await withTempDir(async (dir) => {
      const filePath = join(dir, 'settings.json')
      await writeFile(filePath, '{"permissions": {"allow": 123}}', 'utf-8')

      const result = await readSettingsFile(filePath)
      expect(result).toBeNull()
    })
  })

  it('still returns null for non-existent file (ENOENT)', async () => {
    const result = await readSettingsFile('/tmp/nonexistent-csg-test-file.json')
    expect(result).toBeNull()
  })

  it('still parses valid settings files correctly', async () => {
    await withTempDir(async (dir) => {
      const filePath = join(dir, 'settings.json')
      await writeFile(filePath, JSON.stringify({ permissions: { allow: ['Read'] } }), 'utf-8')

      const result = await readSettingsFile(filePath)
      expect(result).not.toBeNull()
      expect(result?.permissions?.allow).toEqual(['Read'])
    })
  })
})
