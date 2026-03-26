import { describe, it, expect } from 'vitest'
import {
  analyzePermissionEvents,
  generateRecommendations,
  getAnalysisPeriod,
  isTelemetryEvent,
} from '../src/core/telemetry-analyzer.js'
import type { TelemetryEvent } from '../src/types.js'

function createEvent(
  eventName: string,
  toolName: string,
  command?: string
): TelemetryEvent {
  return {
    event_type: 'ClaudeCodeInternalEvent',
    event_data: {
      event_name: eventName,
      client_timestamp: new Date().toISOString(),
      additional_metadata: JSON.stringify({
        toolName,
        ...(command ? { command } : {}),
      }),
    },
  }
}

describe('analyzePermissionEvents', () => {
  it('counts allowed events (user manually approved)', () => {
    const events = [
      createEvent('tengu_tool_use_granted_in_prompt_temporary', 'Bash', 'npm install'),
      createEvent('tengu_tool_use_granted_in_prompt_temporary', 'Bash', 'npm install'),
      createEvent('tengu_tool_use_granted_in_prompt_permanent', 'Bash', 'npm install'),
    ]

    const stats = analyzePermissionEvents(events)
    const npmStats = stats.get('Bash(npm install)')
    expect(npmStats?.allowed).toBe(3)
    expect(npmStats?.denied).toBe(0)
  })

  it('counts denied events', () => {
    const events = [
      createEvent('tengu_tool_use_denied_in_config', 'Bash', 'sudo rm'),
      createEvent('tengu_tool_use_rejected_in_prompt', 'Bash', 'sudo rm'),
    ]

    const stats = analyzePermissionEvents(events)
    const sudoStats = stats.get('Bash(sudo rm)')
    expect(sudoStats?.denied).toBe(2)
    expect(sudoStats?.allowed).toBe(0)
  })

  it('counts prompted events', () => {
    const events = [
      createEvent('tengu_tool_use_show_permission_request', 'Edit'),
    ]

    const stats = analyzePermissionEvents(events)
    const editStats = stats.get('Edit')
    expect(editStats?.prompted).toBe(1)
  })

  it('counts bare tool name when no command in metadata', () => {
    const events = [
      createEvent('tengu_tool_use_granted_in_prompt_temporary', 'Bash'),
      createEvent('tengu_tool_use_granted_in_prompt_temporary', 'Bash'),
      createEvent('tengu_tool_use_granted_in_prompt_temporary', 'Bash'),
    ]

    const stats = analyzePermissionEvents(events)
    const bashStats = stats.get('Bash')
    expect(bashStats?.allowed).toBe(3)
  })

  it('ignores non-permission events', () => {
    const events: TelemetryEvent[] = [{
      event_type: 'ClaudeCodeInternalEvent',
      event_data: {
        event_name: 'tengu_tool_use_success',
        client_timestamp: new Date().toISOString(),
        additional_metadata: JSON.stringify({ toolName: 'Bash' }),
      },
    }]

    const stats = analyzePermissionEvents(events)
    expect(stats.size).toBe(0)
  })

  it('handles events without metadata', () => {
    const events: TelemetryEvent[] = [{
      event_type: 'ClaudeCodeInternalEvent',
      event_data: {
        event_name: 'tengu_tool_use_granted_in_prompt_temporary',
        client_timestamp: new Date().toISOString(),
      },
    }]

    const stats = analyzePermissionEvents(events)
    expect(stats.size).toBe(0)
  })
})

describe('generateRecommendations', () => {
  it('recommends allow for frequently approved tools', () => {
    const stats = new Map([
      ['Bash(npm install)', {
        tool: 'Bash',
        pattern: 'Bash(npm install)',
        allowed: 5,
        denied: 0,
        prompted: 3,
      }],
    ])

    const recs = generateRecommendations(stats, [], [])
    expect(recs).toHaveLength(1)
    expect(recs[0].action).toBe('add-allow')
    expect(recs[0].pattern).toBe('Bash(npm install)')
  })

  it('recommends deny for frequently rejected tools', () => {
    const stats = new Map([
      ['Bash(sudo rm)', {
        tool: 'Bash',
        pattern: 'Bash(sudo rm)',
        allowed: 0,
        denied: 3,
        prompted: 0,
      }],
    ])

    const recs = generateRecommendations(stats, [], [])
    expect(recs).toHaveLength(1)
    expect(recs[0].action).toBe('add-deny')
  })

  it('skips already configured patterns', () => {
    const stats = new Map([
      ['Bash(npm install)', {
        tool: 'Bash',
        pattern: 'Bash(npm install)',
        allowed: 10,
        denied: 0,
        prompted: 5,
      }],
    ])

    const recs = generateRecommendations(stats, ['Bash(npm install)'], [])
    expect(recs).toHaveLength(0)
  })

  it('skips mixed approval/denial patterns', () => {
    const stats = new Map([
      ['Bash(curl)', {
        tool: 'Bash',
        pattern: 'Bash(curl)',
        allowed: 3,
        denied: 2,
        prompted: 1,
      }],
    ])

    const recs = generateRecommendations(stats, [], [])
    expect(recs).toHaveLength(0)
  })

  it('returns empty for no qualifying patterns', () => {
    const stats = new Map([
      ['Bash(test)', {
        tool: 'Bash',
        pattern: 'Bash(test)',
        allowed: 1,
        denied: 0,
        prompted: 0,
      }],
    ])

    const recs = generateRecommendations(stats, [], [])
    expect(recs).toHaveLength(0) // below threshold
  })
})

describe('isTelemetryEvent', () => {
  it('returns true for a valid TelemetryEvent object', () => {
    const valid = {
      event_type: 'ClaudeCodeInternalEvent',
      event_data: {
        event_name: 'tool_use_allowed',
        client_timestamp: '2026-03-01T10:00:00.000Z',
      },
    }
    expect(isTelemetryEvent(valid)).toBe(true)
  })

  it('returns false for null', () => {
    expect(isTelemetryEvent(null)).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(isTelemetryEvent(undefined)).toBe(false)
  })

  it('returns false for a string', () => {
    expect(isTelemetryEvent('not an event')).toBe(false)
  })

  it('returns false when event_type is missing', () => {
    const missing = {
      event_data: {
        event_name: 'test',
        client_timestamp: '2026-03-01T10:00:00.000Z',
      },
    }
    expect(isTelemetryEvent(missing)).toBe(false)
  })

  it('returns false when event_data is missing', () => {
    const missing = { event_type: 'ClaudeCodeInternalEvent' }
    expect(isTelemetryEvent(missing)).toBe(false)
  })

  it('returns false when event_name is not a string', () => {
    const invalid = {
      event_type: 'ClaudeCodeInternalEvent',
      event_data: {
        event_name: 123,
        client_timestamp: '2026-03-01T10:00:00.000Z',
      },
    }
    expect(isTelemetryEvent(invalid)).toBe(false)
  })

  it('returns false when client_timestamp is not a string', () => {
    const invalid = {
      event_type: 'ClaudeCodeInternalEvent',
      event_data: {
        event_name: 'test',
        client_timestamp: 12345,
      },
    }
    expect(isTelemetryEvent(invalid)).toBe(false)
  })

  it('returns false when event_data is not an object', () => {
    const invalid = {
      event_type: 'ClaudeCodeInternalEvent',
      event_data: 'not an object',
    }
    expect(isTelemetryEvent(invalid)).toBe(false)
  })
})

describe('getAnalysisPeriod', () => {
  it('returns null for empty events', () => {
    expect(getAnalysisPeriod([])).toBeNull()
  })

  it('returns earliest and latest timestamps', () => {
    const events: TelemetryEvent[] = [
      {
        event_type: 'ClaudeCodeInternalEvent',
        event_data: {
          event_name: 'tool_use_allowed',
          client_timestamp: '2026-03-01T10:00:00.000Z',
          additional_metadata: JSON.stringify({ tool_name: 'Bash', command: 'echo a' }),
        },
      },
      {
        event_type: 'ClaudeCodeInternalEvent',
        event_data: {
          event_name: 'tool_use_allowed',
          client_timestamp: '2026-03-03T10:00:00.000Z',
          additional_metadata: JSON.stringify({ tool_name: 'Bash', command: 'echo b' }),
        },
      },
      {
        event_type: 'ClaudeCodeInternalEvent',
        event_data: {
          event_name: 'tool_use_allowed',
          client_timestamp: '2026-03-02T10:00:00.000Z',
          additional_metadata: JSON.stringify({ tool_name: 'Bash', command: 'echo c' }),
        },
      },
    ]

    expect(getAnalysisPeriod(events)).toEqual({
      earliest: '2026-03-01T10:00:00.000Z',
      latest: '2026-03-03T10:00:00.000Z',
    })
  })
})
