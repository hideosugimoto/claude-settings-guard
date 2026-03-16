import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { generateBashRulesSection, updateClaudeMd } from '../src/core/claude-md-updater.js'

describe('claude-md-updater', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'csg-claude-md-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  describe('generateBashRulesSection', () => {
    it('contains begin and end markers', () => {
      const section = generateBashRulesSection()
      expect(section).toContain('<!-- CSG:BASH_RULES:BEGIN -->')
      expect(section).toContain('<!-- CSG:BASH_RULES:END -->')
    })

    it('begin marker appears before end marker', () => {
      const section = generateBashRulesSection()
      const beginIdx = section.indexOf('<!-- CSG:BASH_RULES:BEGIN -->')
      const endIdx = section.indexOf('<!-- CSG:BASH_RULES:END -->')
      expect(beginIdx).toBeLessThan(endIdx)
    })

    it('contains key rules about compound commands', () => {
      const section = generateBashRulesSection()
      expect(section).toContain('&&')
      expect(section).toContain('||')
      expect(section).toContain('git -C')
    })

    it('mentions pipe exception', () => {
      const section = generateBashRulesSection()
      expect(section).toContain('|')
      expect(section).toMatch(/パイプ|pipe/i)
    })

    it('contains file-based argument passing rule', () => {
      const section = generateBashRulesSection()
      expect(section).toContain('ファイル経由')
      expect(section).toContain('一時ファイル')
      expect(section).toContain('Write ツール')
    })

    it('contains bad and good examples for file-based passing', () => {
      const section = generateBashRulesSection()
      // Bad example: inline SQL and input redirect
      expect(section).toContain('-e "SELECT')
      expect(section).toContain('< /tmp/query.sql')
      // Good example: pipe instead of redirect
      expect(section).toContain('cat /tmp/query.sql |')
      expect(section).toContain('cat /tmp/payload.json |')
    })

    it('mentions obfuscation detection and input redirect as reasons', () => {
      const section = generateBashRulesSection()
      expect(section).toMatch(/難読化検出|obfuscation/i)
      expect(section).toContain("''")
      expect(section).toContain('""')
      expect(section).toContain('機密ファイル読み取り')
      expect(section).toContain('リダイレクト < は使わない')
    })
  })

  describe('updateClaudeMd', () => {
    it('creates file if not exists and returns added', async () => {
      const filePath = join(tempDir, 'CLAUDE.md')
      const result = await updateClaudeMd(filePath)

      expect(result.action).toBe('added')
      expect(result.filePath).toBe(filePath)

      const content = await readFile(filePath, 'utf-8')
      expect(content).toContain('<!-- CSG:BASH_RULES:BEGIN -->')
      expect(content).toContain('<!-- CSG:BASH_RULES:END -->')
    })

    it('creates parent directory if not exists', async () => {
      const filePath = join(tempDir, 'subdir', 'CLAUDE.md')
      const result = await updateClaudeMd(filePath)

      expect(result.action).toBe('added')
      const content = await readFile(filePath, 'utf-8')
      expect(content).toContain('<!-- CSG:BASH_RULES:BEGIN -->')
    })

    it('adds section to existing file with content', async () => {
      const filePath = join(tempDir, 'CLAUDE.md')
      const existingContent = '# My Project\n\nSome instructions here.'
      await writeFile(filePath, existingContent, 'utf-8')

      const result = await updateClaudeMd(filePath)

      expect(result.action).toBe('added')
      const content = await readFile(filePath, 'utf-8')
      expect(content).toContain(existingContent)
      expect(content).toContain('<!-- CSG:BASH_RULES:BEGIN -->')
    })

    it('appends with blank line separator when file has no trailing newline', async () => {
      const filePath = join(tempDir, 'CLAUDE.md')
      await writeFile(filePath, '# No trailing newline', 'utf-8')

      await updateClaudeMd(filePath)

      const content = await readFile(filePath, 'utf-8')
      // Should have blank line between existing content and new section
      expect(content).toMatch(/# No trailing newline\n\n<!-- CSG:BASH_RULES:BEGIN -->/)
    })

    it('skips if section is already identical', async () => {
      const filePath = join(tempDir, 'CLAUDE.md')

      // First call adds the section
      await updateClaudeMd(filePath)

      // Second call should skip
      const result = await updateClaudeMd(filePath)
      expect(result.action).toBe('skipped')
    })

    it('updates if section content has changed', async () => {
      const filePath = join(tempDir, 'CLAUDE.md')
      const outdatedSection = [
        '<!-- CSG:BASH_RULES:BEGIN -->',
        '## Old content that is outdated',
        '<!-- CSG:BASH_RULES:END -->',
      ].join('\n')
      await writeFile(filePath, outdatedSection, 'utf-8')

      const result = await updateClaudeMd(filePath)

      expect(result.action).toBe('updated')
      const content = await readFile(filePath, 'utf-8')
      expect(content).not.toContain('Old content that is outdated')
      expect(content).toContain('<!-- CSG:BASH_RULES:BEGIN -->')
      expect(content).toContain('<!-- CSG:BASH_RULES:END -->')
    })

    it('preserves content before and after CSG section', async () => {
      const filePath = join(tempDir, 'CLAUDE.md')
      const content = [
        '# Before section',
        '',
        '<!-- CSG:BASH_RULES:BEGIN -->',
        '## Old rules',
        '<!-- CSG:BASH_RULES:END -->',
        '',
        '# After section',
      ].join('\n')
      await writeFile(filePath, content, 'utf-8')

      await updateClaudeMd(filePath)

      const updated = await readFile(filePath, 'utf-8')
      expect(updated).toContain('# Before section')
      expect(updated).toContain('# After section')
      expect(updated).not.toContain('## Old rules')
    })

    it('treats missing END marker as no existing section and appends', async () => {
      const filePath = join(tempDir, 'CLAUDE.md')
      const content = '# Content\n\n<!-- CSG:BASH_RULES:BEGIN -->\n## Orphaned begin'
      await writeFile(filePath, content, 'utf-8')

      const result = await updateClaudeMd(filePath)

      expect(result.action).toBe('added')
      const updated = await readFile(filePath, 'utf-8')
      // Should have a proper section appended at the end
      const endMarkerCount = (updated.match(/<!-- CSG:BASH_RULES:END -->/g) ?? []).length
      expect(endMarkerCount).toBeGreaterThanOrEqual(1)
    })

    it('adds section to empty file', async () => {
      const filePath = join(tempDir, 'CLAUDE.md')
      await writeFile(filePath, '', 'utf-8')

      const result = await updateClaudeMd(filePath)

      expect(result.action).toBe('added')
      const content = await readFile(filePath, 'utf-8')
      expect(content).toContain('<!-- CSG:BASH_RULES:BEGIN -->')
    })
  })
})
