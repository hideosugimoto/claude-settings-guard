import { describe, it, expect } from 'vitest'
import { groupRulesByTool, generateBashToolCheck, generateNonBashToolCheck, parseDenyPattern } from '../src/core/hook-script-builder.js'

describe('hook-script-builder', () => {
  describe('assertSafePattern (via parseDenyPattern)', () => {
    it('throws on dollar sign (command substitution)', () => {
      expect(() => parseDenyPattern('Bash(echo $HOME)')).toThrow('unsafe')
    })

    it('throws on single quote (shell escape)', () => {
      expect(() => parseDenyPattern("Bash(echo 'hello')")).toThrow('unsafe')
    })

    it('throws on semicolon (command chaining)', () => {
      expect(() => parseDenyPattern('Bash(cmd; rm -rf /)')).toThrow('unsafe')
    })

    it('throws on backtick (command substitution)', () => {
      expect(() => parseDenyPattern('Bash(echo `whoami`)')).toThrow('unsafe')
    })

    it('throws on pipe (command piping)', () => {
      expect(() => parseDenyPattern('Bash(cat /etc/passwd | grep root)')).toThrow('unsafe')
    })

    it('throws on ampersand (background/chaining)', () => {
      expect(() => parseDenyPattern('Bash(cmd && rm -rf /)')).toThrow('unsafe')
    })

    it('throws on backslash (quote escape)', () => {
      expect(() => parseDenyPattern('Bash(test\\)')).toThrow('unsafe')
    })

    it('throws on double quote', () => {
      expect(() => parseDenyPattern('Bash(echo "hello")')).toThrow('unsafe')
    })

    it('allows safe patterns', () => {
      expect(parseDenyPattern('Bash(sudo *)')).not.toBeNull()
      expect(parseDenyPattern('Read(**/.env)')).not.toBeNull()
      expect(parseDenyPattern('Bash(rm -rf /*)')).not.toBeNull()
    })
  })

  describe('generateNonBashToolCheck validation', () => {
    it('throws on invalid tool names', () => {
      const rule = { toolName: 'Bad Tool', pattern: 'test', regex: 'test' }
      expect(() => generateNonBashToolCheck('Bad Tool', [rule])).toThrow('Invalid tool name')
    })

    it('accepts valid alphanumeric tool names', () => {
      const rule = { toolName: 'Read', pattern: 'Read(**/.env)', regex: '.*/.env' }
      expect(() => generateNonBashToolCheck('Read', [rule])).not.toThrow()
    })
  })

  describe('groupRulesByTool', () => {
    it('groups deny patterns by tool name', () => {
      const rules = ['Bash(sudo *)', 'Bash(rm -rf /*)', 'Read(**/.env)']
      const grouped = groupRulesByTool(rules)

      expect(grouped.get('Bash')).toHaveLength(2)
      expect(grouped.get('Read')).toHaveLength(1)
    })

    it('skips unparseable patterns', () => {
      const rules = ['InvalidPattern', 'Bash(sudo *)']
      const grouped = groupRulesByTool(rules)

      expect(grouped.has('InvalidPattern')).toBe(false)
      expect(grouped.get('Bash')).toHaveLength(1)
    })

    it('returns immutable-style Map (no mutation of input)', () => {
      const rules = ['Bash(sudo *)']
      const original = [...rules]
      groupRulesByTool(rules)
      expect(rules).toEqual(original)
    })

    it('deduplicates rules with identical regex', () => {
      // Simulates deny rules appearing in both permissions.deny and top-level deny
      const rules = ['Bash(sudo *)', 'Bash(sudo *)', 'Bash(rm -rf /*)', 'Read(**/.env)', 'Read(**/.env)']
      const grouped = groupRulesByTool(rules)

      // Each unique regex should appear only once
      const bashRules = grouped.get('Bash')!
      const bashRegexes = bashRules.map(r => r.regex)
      expect(new Set(bashRegexes).size).toBe(bashRegexes.length)

      const readRules = grouped.get('Read')!
      const readRegexes = readRules.map(r => r.regex)
      expect(new Set(readRegexes).size).toBe(readRegexes.length)
    })
  })

  describe('generateBashToolCheck', () => {
    it('generates bash check with regex variables', () => {
      const script = generateBashToolCheck([
        { toolName: 'Bash', pattern: 'Bash(sudo *)', regex: 'sudo .*' },
      ])

      expect(script).toContain('TOOL_NAME')
      expect(script).toContain('Bash')
      expect(script).toContain('re_bash_0')
      expect(script).toContain('sudo .*')
    })

    it('generates multiple conditions with OR', () => {
      const script = generateBashToolCheck([
        { toolName: 'Bash', pattern: 'Bash(sudo *)', regex: 'sudo .*' },
        { toolName: 'Bash', pattern: 'Bash(rm -rf /*)', regex: 'rm -rf /.*' },
      ])

      expect(script).toContain('re_bash_0')
      expect(script).toContain('re_bash_1')
      expect(script).toContain('||')
    })

    it('includes deny response JSON', () => {
      const script = generateBashToolCheck([
        { toolName: 'Bash', pattern: 'Bash(sudo *)', regex: 'sudo .*' },
      ])

      expect(script).toContain('permissionDecision')
      expect(script).toContain('deny')
    })
  })

  describe('generateNonBashToolCheck', () => {
    it('generates Read check with file_path extraction', () => {
      const script = generateNonBashToolCheck('Read', [
        { toolName: 'Read', pattern: 'Read(**/.env)', regex: '.*/.env' },
      ])

      expect(script).toContain('file_path')
      expect(script).toContain('Read')
    })

    it('generates Write check with file_path extraction', () => {
      const script = generateNonBashToolCheck('Write', [
        { toolName: 'Write', pattern: 'Write(**/.env)', regex: '.*/.env' },
      ])

      expect(script).toContain('file_path')
    })

    it('generates generic check with tool_input for other tools', () => {
      const script = generateNonBashToolCheck('WebFetch', [
        { toolName: 'WebFetch', pattern: 'WebFetch(*)', regex: '.*' },
      ])

      expect(script).toContain('tool_input')
      expect(script).not.toContain('file_path')
    })
  })
})
