import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect } from 'vitest'
import {
  handleDiagnose,
  handleRecommend,
  handleAssessRisk,
  handleEnforce,
  handleSetup,
} from '../src/mcp/tools.js'

function parseJsonText(text: string): Record<string, unknown> {
  return JSON.parse(text) as Record<string, unknown>
}

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'csg-mcp-tools-'))
  try {
    await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe('mcp/tools', () => {
  describe('handleDiagnose', () => {
    it('returns structured diagnose result', async () => {
      const result = await handleDiagnose({})
      expect(result.content).toHaveLength(1)

      const payload = parseJsonText(result.content[0].text)
      expect(typeof payload.message).toBe('string')
      expect(typeof payload.summary).toBe('object')
      expect(Array.isArray(payload.issues)).toBe(true)
      expect(typeof payload.rules).toBe('object')
      expect(typeof payload.hooks).toBe('object')
      expect(typeof payload.settingsFiles).toBe('object')
    })
  })

  describe('handleRecommend', () => {
    it('returns structured recommendation result', async () => {
      const result = await handleRecommend({})
      expect(result.isError).toBeUndefined()

      const payload = parseJsonText(result.content[0].text)
      expect(typeof payload.currentRules).toBe('object')
      expect(typeof payload.telemetry).toBe('object')
      expect(Array.isArray(payload.groupedPatterns)).toBe(true)
      expect(Array.isArray(payload.recommendations)).toBe(true)
      expect(typeof payload.projectContext).toBe('object')
    })

    it('detects project context from cwd', async () => {
      await withTempDir(async dir => {
        await writeFile(join(dir, 'package.json'), '{"name":"demo"}')

        const result = await handleRecommend({ cwd: dir })
        const payload = parseJsonText(result.content[0].text)
        const projectContext = payload.projectContext as Record<string, unknown>

        expect(projectContext.detectedType).toBe('nodejs')
        expect(Array.isArray(projectContext.suggestedToolPatterns)).toBe(true)
      })
    })
  })

  describe('handleAssessRisk', () => {
    it('returns structured risk assessment', async () => {
      const result = await handleAssessRisk({ denyRules: ['Bash(sudo *)'] })
      const payload = parseJsonText(result.content[0].text)

      expect(typeof payload.overallRiskLevel).toBe('string')
      expect(typeof payload.denyRulesAnalyzed).toBe('number')
      expect(Array.isArray(payload.ruleAnalysis)).toBe(true)
      expect(typeof payload.mitigations).toBe('object')
      expect(Array.isArray(payload.suggestions)).toBe(true)
    })
  })

  describe('handleEnforce', () => {
    it('returns a result for dry-run', async () => {
      const result = await handleEnforce({ dryRun: true })
      expect(result.content).toHaveLength(1)
      expect(typeof result.content[0].text).toBe('string')
    })

    it('returns a result for non dry-run', async () => {
      const result = await handleEnforce({})
      expect(result.content).toHaveLength(1)
      expect(typeof result.content[0].text).toBe('string')
    })
  })

  describe('handleSetup', () => {
    it('returns instruction for valid profile', async () => {
      const result = await handleSetup({ profile: 'strict' })
      expect(result.isError).toBeUndefined()
      expect(result.content[0].text).toContain('strict')
      expect(result.content[0].text).toContain('npx claude-settings-guard init')
    })

    it('defaults to balanced', async () => {
      const result = await handleSetup({})
      expect(result.content[0].text).toContain('balanced')
    })

    it('returns error for invalid profile', async () => {
      const result = await handleSetup({ profile: 'invalid' })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('不明なプロファイル')
    })
  })
})
