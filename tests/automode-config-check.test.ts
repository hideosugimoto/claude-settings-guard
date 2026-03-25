import { describe, it, expect, vi, afterEach } from 'vitest'
import { checkAutoModeConfig } from '../src/core/automode-detector.js'
import type { ClaudeSettings } from '../src/types.js'

// Mock fetchAutoModeDefaults
vi.mock('../src/core/automode-defaults.js', () => ({
  fetchAutoModeDefaults: vi.fn(() => ({
    allow: ['rule1', 'rule2', 'rule3', 'rule4', 'rule5', 'rule6', 'rule7'],
    soft_deny: Array.from({ length: 25 }, (_, i) => `default-deny-rule-${i + 1}`),
    environment: ['**Trusted repo: ...', '**Source control: ...'],
  })),
}))

describe('checkAutoModeConfig', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns no issues when AutoMode is disabled', () => {
    const settings: ClaudeSettings = {
      permissions: { allow: ['Read'] },
    }
    const issues = checkAutoModeConfig(settings)
    expect(issues).toEqual([])
  })

  it('detects soft_deny override with fewer rules than defaults', () => {
    const settings: ClaudeSettings = {
      permissions: { defaultMode: 'auto' },
      autoMode: {
        soft_deny: ['Never run sudo', 'Never delete files'],
      },
    }
    const issues = checkAutoModeConfig(settings)

    const softDenyIssue = issues.find(i => i.code === 'AUTO_MODE_SOFT_DENY_OVERRIDE')
    expect(softDenyIssue).toBeDefined()
    expect(softDenyIssue?.severity).toBe('critical')
    expect(softDenyIssue?.message).toContain('25')
    expect(softDenyIssue?.message).toContain('2')
  })

  it('does not flag soft_deny when count matches or exceeds defaults', () => {
    const settings: ClaudeSettings = {
      permissions: { defaultMode: 'auto' },
      autoMode: {
        soft_deny: Array.from({ length: 25 }, (_, i) => `rule-${i + 1}`),
      },
    }
    const issues = checkAutoModeConfig(settings)

    const softDenyIssue = issues.find(i => i.code === 'AUTO_MODE_SOFT_DENY_OVERRIDE')
    expect(softDenyIssue).toBeUndefined()
  })

  it('detects allow override with more rules than defaults', () => {
    const settings: ClaudeSettings = {
      permissions: { defaultMode: 'auto' },
      autoMode: {
        allow: Array.from({ length: 10 }, (_, i) => `custom-allow-${i + 1}`),
      },
    }
    const issues = checkAutoModeConfig(settings)

    const allowIssue = issues.find(i => i.code === 'AUTO_MODE_ALLOW_OVERRIDE')
    expect(allowIssue).toBeDefined()
    expect(allowIssue?.severity).toBe('warning')
    expect(allowIssue?.message).toContain('7')
    expect(allowIssue?.message).toContain('10')
  })

  it('does not flag allow when count is within defaults', () => {
    const settings: ClaudeSettings = {
      permissions: { defaultMode: 'auto' },
      autoMode: {
        allow: ['rule1', 'rule2'],
      },
    }
    const issues = checkAutoModeConfig(settings)

    const allowIssue = issues.find(i => i.code === 'AUTO_MODE_ALLOW_OVERRIDE')
    expect(allowIssue).toBeUndefined()
  })

  it('detects missing environment when defaultMode is auto', () => {
    const settings: ClaudeSettings = {
      permissions: { defaultMode: 'auto' },
    }
    const issues = checkAutoModeConfig(settings)

    const envIssue = issues.find(i => i.code === 'AUTO_MODE_NO_ENVIRONMENT')
    expect(envIssue).toBeDefined()
    expect(envIssue?.severity).toBe('info')
  })

  it('does not flag environment when custom entries exist', () => {
    const settings: ClaudeSettings = {
      permissions: { defaultMode: 'auto' },
      autoMode: {
        environment: ['Source control: github.com/my-org'],
      },
    }
    const issues = checkAutoModeConfig(settings)

    const envIssue = issues.find(i => i.code === 'AUTO_MODE_NO_ENVIRONMENT')
    expect(envIssue).toBeUndefined()
  })

  it('detects multiple issues simultaneously', () => {
    const settings: ClaudeSettings = {
      permissions: { defaultMode: 'auto' },
      autoMode: {
        soft_deny: ['one rule only'],
        allow: Array.from({ length: 15 }, (_, i) => `allow-${i}`),
      },
    }
    const issues = checkAutoModeConfig(settings)

    expect(issues.some(i => i.code === 'AUTO_MODE_SOFT_DENY_OVERRIDE')).toBe(true)
    expect(issues.some(i => i.code === 'AUTO_MODE_ALLOW_OVERRIDE')).toBe(true)
    expect(issues.some(i => i.code === 'AUTO_MODE_NO_ENVIRONMENT')).toBe(true)
  })

  it('works when autoMode config exists but only has environment', () => {
    const settings: ClaudeSettings = {
      autoMode: {
        environment: ['My dev machine'],
      },
    }
    const issues = checkAutoModeConfig(settings)

    // No soft_deny or allow overrides
    expect(issues.find(i => i.code === 'AUTO_MODE_SOFT_DENY_OVERRIDE')).toBeUndefined()
    expect(issues.find(i => i.code === 'AUTO_MODE_ALLOW_OVERRIDE')).toBeUndefined()
  })
})
