import { describe, it, expect, vi } from 'vitest'
import { generateEnvironmentSuggestion } from '../src/core/environment-generator.js'
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('generateEnvironmentSuggestion', () => {
  it('detects nodejs project', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'csg-env-'))
    await writeFile(join(dir, 'package.json'), '{}')

    const suggestion = await generateEnvironmentSuggestion(dir)

    expect(suggestion.projectType).toBe('nodejs')
    expect(suggestion.entries.some(e => e.includes('TypeScript/Node.js'))).toBe(true)
  })

  it('detects rust project', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'csg-env-'))
    await writeFile(join(dir, 'Cargo.toml'), '')

    const suggestion = await generateEnvironmentSuggestion(dir)

    expect(suggestion.projectType).toBe('rust')
    expect(suggestion.entries.some(e => e.includes('Rust'))).toBe(true)
  })

  it('detects python project', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'csg-env-'))
    await writeFile(join(dir, 'pyproject.toml'), '')

    const suggestion = await generateEnvironmentSuggestion(dir)

    expect(suggestion.projectType).toBe('python')
    expect(suggestion.entries.some(e => e.includes('Python'))).toBe(true)
  })

  it('returns generic suggestion for unknown project type', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'csg-env-'))

    const suggestion = await generateEnvironmentSuggestion(dir)

    expect(suggestion.projectType).toBeNull()
    expect(suggestion.entries.some(e => e.includes('software development'))).toBe(true)
  })

  it('includes source control placeholder when no git remote', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'csg-env-'))

    const suggestion = await generateEnvironmentSuggestion(dir)

    expect(suggestion.gitRemote).toBeNull()
    expect(suggestion.entries.some(e => e.includes('Source control'))).toBe(true)
  })

  it('always includes at least 2 entries', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'csg-env-'))

    const suggestion = await generateEnvironmentSuggestion(dir)

    expect(suggestion.entries.length).toBeGreaterThanOrEqual(2)
  })
})
