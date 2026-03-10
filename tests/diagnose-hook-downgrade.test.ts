import { describe, it, expect } from 'vitest'
import { checkCrossToolBypasses, checkPrefixBypasses } from '../src/core/pattern-validator.js'
import { downgradeIfHookInstalled } from '../src/commands/diagnose.js'
import type { DiagnosticIssue } from '../src/types.js'

// ============================================================
// Test: CROSS_TOOL_BYPASS と PREFIX_BYPASS_RISK は
// Layer 2 フックが存在する場合 info に downgrade される
// ============================================================

describe('downgradeIfHookInstalled', () => {
  const crossToolIssue: DiagnosticIssue = {
    severity: 'warning',
    code: 'CROSS_TOOL_BYPASS',
    message: 'Bash(cat *) in allow can bypass Read deny rules',
    details: ['"cat" can access files'],
    fix: 'Remove the broad Bash allow rule or install the Layer 2 enforcement hook',
  }

  const prefixIssue: DiagnosticIssue = {
    severity: 'info',
    code: 'PREFIX_BYPASS_RISK',
    message: 'Bash allow rules for prefix commands (env) may bypass Bash deny rules at Layer 1',
    details: ['Prefix commands like "env" can wrap denied commands'],
    fix: 'Install the Layer 2 enforce hook with `csg enforce` to mitigate prefix bypass',
  }

  const otherWarning: DiagnosticIssue = {
    severity: 'warning',
    code: 'CONFLICT',
    message: '1 patterns found in both allow and deny',
    details: ['Bash(sudo *)'],
    fix: 'Remove from either allow or deny',
  }

  describe('when enforce hook IS installed', () => {
    it('downgrades CROSS_TOOL_BYPASS from warning to info', () => {
      const result = downgradeIfHookInstalled([crossToolIssue], true)
      expect(result[0].severity).toBe('info')
    })

    it('updates fix message to indicate hook is active', () => {
      const result = downgradeIfHookInstalled([crossToolIssue], true)
      expect(result[0].fix).toContain('Layer 2')
      expect(result[0].fix).toContain('保護')
    })

    it('updates PREFIX_BYPASS_RISK fix message', () => {
      const result = downgradeIfHookInstalled([prefixIssue], true)
      expect(result[0].fix).toContain('Layer 2')
      expect(result[0].fix).toContain('保護')
    })

    it('does NOT downgrade other warnings (e.g. CONFLICT)', () => {
      const result = downgradeIfHookInstalled([otherWarning], true)
      expect(result[0].severity).toBe('warning')
      expect(result[0].fix).toBe(otherWarning.fix)
    })

    it('handles mixed issue list correctly', () => {
      const issues = [crossToolIssue, otherWarning, prefixIssue]
      const result = downgradeIfHookInstalled(issues, true)
      expect(result[0].severity).toBe('info')     // cross-tool downgraded
      expect(result[1].severity).toBe('warning')   // conflict unchanged
      expect(result[2].severity).toBe('info')      // prefix unchanged (already info)
    })

    it('returns new array (immutable)', () => {
      const issues = [crossToolIssue]
      const result = downgradeIfHookInstalled(issues, true)
      expect(result).not.toBe(issues)
      expect(result[0]).not.toBe(crossToolIssue)
    })
  })

  describe('when enforce hook is NOT installed', () => {
    it('does NOT downgrade CROSS_TOOL_BYPASS', () => {
      const result = downgradeIfHookInstalled([crossToolIssue], false)
      expect(result[0].severity).toBe('warning')
    })

    it('does NOT change fix message', () => {
      const result = downgradeIfHookInstalled([crossToolIssue], false)
      expect(result[0].fix).toBe(crossToolIssue.fix)
    })

    it('returns issues unchanged', () => {
      const issues = [crossToolIssue, otherWarning]
      const result = downgradeIfHookInstalled(issues, false)
      expect(result[0].severity).toBe('warning')
      expect(result[1].severity).toBe('warning')
    })
  })
})

// ============================================================
// Integration: checkCrossToolBypasses + downgrade
// ============================================================
describe('Integration: cross-tool bypass detection + hook downgrade', () => {
  it('all CROSS_TOOL_BYPASS warnings become info when hook installed', () => {
    const allow = ['Bash(cat *)', 'Bash(sed *)', 'Bash(cp *)']
    const deny = ['Read(**/.env)', 'Write(**/.env)', 'Edit(**/.env)']
    const issues = checkCrossToolBypasses(allow, deny)

    expect(issues.length).toBeGreaterThan(0)
    expect(issues.every(i => i.severity === 'warning')).toBe(true)

    const downgraded = downgradeIfHookInstalled(issues, true)
    expect(downgraded.every(i => i.severity === 'info')).toBe(true)
  })

  it('all PREFIX_BYPASS_RISK issues get updated fix when hook installed', () => {
    const allow = ['Bash(env *)']
    const deny = ['Bash(sudo *)']
    const issues = checkPrefixBypasses(allow, deny)

    expect(issues.length).toBeGreaterThan(0)

    const downgraded = downgradeIfHookInstalled(issues, true)
    expect(downgraded.every(i => i.fix?.includes('保護'))).toBe(true)
  })
})
