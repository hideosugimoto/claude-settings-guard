import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect } from 'vitest'
import { detectProject } from '../src/core/project-detector.js'

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'csg-project-detector-'))
  try {
    await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe('detectProject', () => {
  it('detects nodejs from package.json', async () => {
    await withTempDir(async dir => {
      await writeFile(join(dir, 'package.json'), '{"name":"x"}')

      const context = await detectProject(dir)

      expect(context.detectedType).toBe('nodejs')
      expect(context.indicators).toContain('package.json found')
      expect(context.suggestedToolPatterns).toEqual([
        'Bash(npm *)',
        'Bash(npx *)',
        'Bash(node *)',
      ])
    })
  })

  it('detects rust from Cargo.toml', async () => {
    await withTempDir(async dir => {
      await writeFile(join(dir, 'Cargo.toml'), '[package]\nname="x"')

      const context = await detectProject(dir)

      expect(context.detectedType).toBe('rust')
      expect(context.indicators).toContain('Cargo.toml found')
      expect(context.suggestedToolPatterns).toEqual(['Bash(cargo *)'])
    })
  })

  it('uses first hit type and includes all indicators for multiple markers', async () => {
    await withTempDir(async dir => {
      await writeFile(join(dir, 'package.json'), '{"name":"x"}')
      await writeFile(join(dir, 'Cargo.toml'), '[package]\nname="x"')
      await writeFile(join(dir, 'tsconfig.json'), '{}')

      const context = await detectProject(dir)

      expect(context.detectedType).toBe('nodejs')
      expect(context.indicators).toEqual([
        'package.json found',
        'tsconfig.json found',
        'Cargo.toml found',
      ])
    })
  })

  it('returns null and empty indicators when no markers are found', async () => {
    await withTempDir(async dir => {
      const context = await detectProject(dir)

      expect(context.detectedType).toBeNull()
      expect(context.indicators).toEqual([])
      expect(context.suggestedToolPatterns).toEqual([])
    })
  })
})
