import { describe, it, expect } from 'vitest'
import { generateSessionDiagnoseScript, mergeSessionHookIntoSettings } from '../src/core/session-hook.js'
import type { ClaudeSettings } from '../src/types.js'

describe('session-hook', () => {
  describe('generateSessionDiagnoseScript', () => {
    it('generates a valid bash script', () => {
      const script = generateSessionDiagnoseScript()
      expect(script).toContain('#!/bin/bash')
      expect(script).toContain('claude-settings-guard diagnose')
    })

    it('uses --json and --quiet flags', () => {
      const script = generateSessionDiagnoseScript()
      expect(script).toContain('--json')
      expect(script).toContain('--quiet')
    })

    it('outputs to stderr for Claude visibility', () => {
      const script = generateSessionDiagnoseScript()
      expect(script).toContain('>&2')
    })

    it('exits with 0 to not block startup', () => {
      const script = generateSessionDiagnoseScript()
      expect(script).toContain('exit 0')
    })
  })

  describe('mergeSessionHookIntoSettings', () => {
    it('adds SessionStart hook to empty settings', () => {
      const settings: ClaudeSettings = {}
      const result = mergeSessionHookIntoSettings(settings, '/path/to/session-diagnose.sh')

      expect(result.SessionStart).toHaveLength(1)
      expect(result.SessionStart![0].hooks[0].command).toBe('/path/to/session-diagnose.sh')
    })

    it('does not duplicate if already registered', () => {
      const settings: ClaudeSettings = {
        SessionStart: [{
          matcher: '',
          hooks: [{ type: 'command', command: '/path/to/session-diagnose.sh' }],
        }],
      }

      const result = mergeSessionHookIntoSettings(settings, '/other/session-diagnose.sh')
      expect(result.SessionStart).toHaveLength(1)
    })

    it('preserves existing SessionStart hooks', () => {
      const settings: ClaudeSettings = {
        SessionStart: [{
          matcher: '',
          hooks: [{ type: 'command', command: '/path/to/other-hook.sh' }],
        }],
      }

      const result = mergeSessionHookIntoSettings(settings, '/path/to/session-diagnose.sh')
      expect(result.SessionStart).toHaveLength(2)
    })

    it('preserves other settings fields', () => {
      const settings: ClaudeSettings = {
        permissions: { allow: ['Read'] },
      }

      const result = mergeSessionHookIntoSettings(settings, '/path/to/session-diagnose.sh')
      expect(result.permissions?.allow).toEqual(['Read'])
      expect(result.SessionStart).toHaveLength(1)
    })
  })
})
