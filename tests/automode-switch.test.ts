import { describe, it, expect } from 'vitest'
import { writeFile, readFile, mkdtemp, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { existsSync } from 'node:fs'
import {
  extractManagedRules,
  generateSessionSwitchScript,
  mergeSessionSwitchHookIntoSettings,
} from '../src/core/automode-switch.js'
import type { ClaudeSettings } from '../src/types.js'

describe('automode-switch', () => {
  describe('extractManagedRules', () => {
    it('extracts csg-managed deny rules', () => {
      const settings: ClaudeSettings = {
        permissions: {
          deny: ['Bash(sudo *)', 'Bash(custom-cmd *)'],
        },
      }
      const rules = extractManagedRules(settings)

      expect(rules.deny).toContain('Bash(sudo *)')
      expect(rules.deny).not.toContain('Bash(custom-cmd *)')
    })

    it('extracts csg-managed ask rules', () => {
      const settings: ClaudeSettings = {
        permissions: {
          ask: ['Bash(git push *)', 'Bash(my-deploy *)'],
        },
      }
      const rules = extractManagedRules(settings)

      expect(rules.ask).toContain('Bash(git push *)')
      expect(rules.ask).not.toContain('Bash(my-deploy *)')
    })

    it('extracts csg-managed allow rules', () => {
      const settings: ClaudeSettings = {
        permissions: {
          allow: ['Bash(git status *)', 'Bash(custom-tool *)'],
        },
      }
      const rules = extractManagedRules(settings)

      expect(rules.allow).toContain('Bash(git status *)')
      expect(rules.allow).not.toContain('Bash(custom-tool *)')
    })

    it('returns empty arrays for empty settings', () => {
      const settings: ClaudeSettings = {}
      const rules = extractManagedRules(settings)

      expect(rules.deny).toEqual([])
      expect(rules.allow).toEqual([])
      expect(rules.ask).toEqual([])
    })
  })

  describe('generateSessionSwitchScript', () => {
    it('generates a valid bash script', () => {
      const script = generateSessionSwitchScript()

      expect(script).toContain('#!/bin/bash')
      expect(script).toContain('permission_mode')
      expect(script).toContain('"auto"')
    })

    it('includes auto mode detection logic', () => {
      const script = generateSessionSwitchScript()

      expect(script).toContain('PERMISSION_MODE')
      expect(script).toContain('auto')
      expect(script).toContain('csg-rules.json')
    })

    it('includes rule removal for auto mode', () => {
      const script = generateSessionSwitchScript()

      expect(script).toContain('CSG_DENY')
      expect(script).toContain('CSG_ALLOW')
      expect(script).toContain('CSG_ASK')
    })

    it('includes rule restoration for non-auto mode', () => {
      const script = generateSessionSwitchScript()

      // Should have both branches
      expect(script).toContain('unique')  // merge with dedup
      expect(script).toContain('select')  // filter out
    })

    it('outputs a message to stderr when switching', () => {
      const script = generateSessionSwitchScript()

      expect(script).toContain('>&2')
      expect(script).toContain('AutoMode')
    })
  })

  describe('mergeSessionSwitchHookIntoSettings', () => {
    it('adds SessionStart hook to empty settings', () => {
      const settings: ClaudeSettings = {}
      const result = mergeSessionSwitchHookIntoSettings(settings, '/path/to/csg-session.sh')

      expect(result.SessionStart).toHaveLength(1)
      expect(result.SessionStart?.[0].hooks[0].command).toContain('csg-session')
    })

    it('preserves existing SessionStart hooks', () => {
      const settings: ClaudeSettings = {
        SessionStart: [{
          matcher: '',
          hooks: [{ type: 'command', command: 'other-hook.sh' }],
        }],
      }
      const result = mergeSessionSwitchHookIntoSettings(settings, '/path/to/csg-session.sh')

      expect(result.SessionStart).toHaveLength(2)
    })

    it('does not duplicate if already registered', () => {
      const settings: ClaudeSettings = {
        SessionStart: [{
          matcher: '',
          hooks: [{ type: 'command', command: '/path/to/csg-session.sh' }],
        }],
      }
      const result = mergeSessionSwitchHookIntoSettings(settings, '/path/to/csg-session.sh')

      expect(result.SessionStart).toHaveLength(1)
    })

    it('preserves other settings fields', () => {
      const settings: ClaudeSettings = {
        permissions: { allow: ['Read'] },
        env: { KEY: 'val' },
      }
      const result = mergeSessionSwitchHookIntoSettings(settings, '/path/to/csg-session.sh')

      expect(result.permissions?.allow).toEqual(['Read'])
      expect(result.env).toEqual({ KEY: 'val' })
    })
  })
})
