import { describe, it, expect } from 'vitest'
import { detectAutoMode, findAutoModeStrippedRules } from '../src/core/automode-detector.js'
import type { ClaudeSettings } from '../src/types.js'

describe('automode-detector', () => {
  describe('detectAutoMode', () => {
    it('returns disabled when no autoMode config and no defaultMode', () => {
      const settings: ClaudeSettings = {
        permissions: { allow: ['Read'], deny: ['Bash(sudo *)'] },
      }
      const result = detectAutoMode(settings)
      expect(result.enabled).toBe(false)
      expect(result.hasConfig).toBe(false)
    })

    it('detects enabled when defaultMode is "auto"', () => {
      const settings: ClaudeSettings = {
        permissions: { defaultMode: 'auto' },
      }
      const result = detectAutoMode(settings)
      expect(result.enabled).toBe(true)
      expect(result.defaultMode).toBe('auto')
    })

    it('detects enabled when autoMode config has environment', () => {
      const settings: ClaudeSettings = {
        autoMode: { environment: ['Dev machine'] },
      }
      const result = detectAutoMode(settings)
      expect(result.enabled).toBe(true)
      expect(result.hasConfig).toBe(true)
    })

    it('detects enabled when autoMode config has soft_deny', () => {
      const settings: ClaudeSettings = {
        autoMode: { soft_deny: ['Never run sudo'] },
      }
      const result = detectAutoMode(settings)
      expect(result.enabled).toBe(true)
      expect(result.hasConfig).toBe(true)
    })

    it('detects enabled when autoMode config has allow', () => {
      const settings: ClaudeSettings = {
        autoMode: { allow: ['Local file operations'] },
      }
      const result = detectAutoMode(settings)
      expect(result.enabled).toBe(true)
      expect(result.hasConfig).toBe(true)
    })

    it('returns disabled when autoMode exists but all arrays are empty', () => {
      const settings: ClaudeSettings = {
        autoMode: { environment: [], allow: [], soft_deny: [] },
      }
      const result = detectAutoMode(settings)
      expect(result.enabled).toBe(false)
      expect(result.hasConfig).toBe(false)
    })

    it('detects enforce hook in PreToolUse', () => {
      const settings: ClaudeSettings = {
        permissions: { defaultMode: 'auto' },
        PreToolUse: [{
          matcher: 'Bash',
          hooks: [{ type: 'shell', command: '~/.claude/hooks/enforce-permissions.sh' }],
        }],
      }
      const result = detectAutoMode(settings)
      expect(result.enabled).toBe(true)
      expect(result.hasEnforceHook).toBe(true)
    })

    it('returns hasEnforceHook false when no hook', () => {
      const settings: ClaudeSettings = {
        permissions: { defaultMode: 'auto' },
      }
      const result = detectAutoMode(settings)
      expect(result.hasEnforceHook).toBe(false)
    })

    it('returns disabled for non-auto defaultMode', () => {
      const settings: ClaudeSettings = {
        permissions: { defaultMode: 'default' },
      }
      const result = detectAutoMode(settings)
      expect(result.enabled).toBe(false)
      expect(result.defaultMode).toBe('default')
    })
  })

  describe('findAutoModeStrippedRules', () => {
    it('finds bare Bash in allow', () => {
      const settings: ClaudeSettings = {
        permissions: { allow: ['Bash', 'Read', 'Glob'] },
      }
      const stripped = findAutoModeStrippedRules(settings)
      expect(stripped).toEqual(['Bash'])
    })

    it('finds Bash(*) in allow', () => {
      const settings: ClaudeSettings = {
        permissions: { allow: ['Bash(*)', 'Read'] },
      }
      const stripped = findAutoModeStrippedRules(settings)
      expect(stripped).toEqual(['Bash(*)'])
    })

    it('finds bare Agent in allow', () => {
      const settings: ClaudeSettings = {
        permissions: { allow: ['Agent', 'Read'] },
      }
      const stripped = findAutoModeStrippedRules(settings)
      expect(stripped).toEqual(['Agent'])
    })

    it('does not flag specific Bash patterns', () => {
      const settings: ClaudeSettings = {
        permissions: { allow: ['Bash(git status *)', 'Bash(npm install *)', 'Read'] },
      }
      const stripped = findAutoModeStrippedRules(settings)
      expect(stripped).toEqual([])
    })

    it('returns empty when no allow rules', () => {
      const settings: ClaudeSettings = {}
      const stripped = findAutoModeStrippedRules(settings)
      expect(stripped).toEqual([])
    })

    it('finds multiple broad patterns', () => {
      const settings: ClaudeSettings = {
        permissions: { allow: ['Bash', 'Agent', 'Bash(git status *)', 'Read'] },
      }
      const stripped = findAutoModeStrippedRules(settings)
      expect(stripped).toEqual(['Bash', 'Agent'])
    })
  })
})
