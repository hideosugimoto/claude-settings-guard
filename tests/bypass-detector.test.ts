import { describe, it, expect } from 'vitest'
import {
  checkCrossToolBypasses,
  checkPrefixBypasses,
  checkMissingPairedDenyRules,
} from '../src/core/bypass-detector.js'

// ============================================================
// checkCrossToolBypasses
// ============================================================
describe('bypass-detector: checkCrossToolBypasses', () => {
  it('warns when Read deny exists and Bash(cat *) is allowed', () => {
    const allowRules = ['Bash(cat *)', 'Bash(npm *)']
    const denyRules = ['Read(**/.env)', 'Read(**/secrets/**)']
    const issues = checkCrossToolBypasses(allowRules, denyRules)

    expect(issues.length).toBeGreaterThan(0)
    expect(issues[0].severity).toBe('warning')
    expect(issues[0].code).toBe('CROSS_TOOL_BYPASS')
  })

  it('warns for head/tail/less/more/grep/sed/awk/strings against Read deny', () => {
    const readCommands = ['head', 'tail', 'less', 'more', 'grep', 'sed', 'awk', 'strings']

    for (const cmd of readCommands) {
      const allowRules = [`Bash(${cmd} *)`]
      const denyRules = ['Read(**/.env)']
      const issues = checkCrossToolBypasses(allowRules, denyRules)

      expect(issues.length).toBeGreaterThan(0, `Expected warning for ${cmd}`)
      expect(issues[0].code).toBe('CROSS_TOOL_BYPASS')
    }
  })

  it('warns for cp/mv/tee against Write deny', () => {
    const writeCommands = ['cp', 'mv', 'tee']

    for (const cmd of writeCommands) {
      const allowRules = [`Bash(${cmd} *)`]
      const denyRules = ['Write(**/.env)']
      const issues = checkCrossToolBypasses(allowRules, denyRules)

      expect(issues.length).toBeGreaterThan(0, `Expected warning for ${cmd}`)
      expect(issues[0].code).toBe('CROSS_TOOL_BYPASS')
    }
  })

  it('warns for sed against Edit deny', () => {
    const allowRules = ['Bash(sed *)']
    const denyRules = ['Edit(**/.env)']
    const issues = checkCrossToolBypasses(allowRules, denyRules)

    expect(issues.length).toBeGreaterThan(0)
    expect(issues[0].code).toBe('CROSS_TOOL_BYPASS')
  })

  it('does NOT warn when no file-based deny rules exist', () => {
    const allowRules = ['Bash(cat *)']
    const denyRules = ['Bash(sudo *)']
    const issues = checkCrossToolBypasses(allowRules, denyRules)

    expect(issues.length).toBe(0)
  })

  it('does NOT warn when no Bash allow rules exist', () => {
    const allowRules = ['Read(**/src/**)', 'Write(**/src/**)']
    const denyRules = ['Read(**/.env)']
    const issues = checkCrossToolBypasses(allowRules, denyRules)

    expect(issues.length).toBe(0)
  })
})

// ============================================================
// checkPrefixBypasses
// ============================================================
describe('bypass-detector: checkPrefixBypasses', () => {
  it('warns when Bash(env *) is allowed and Bash deny rules exist', () => {
    const allowRules = ['Bash(env *)']
    const denyRules = ['Bash(sudo *)']
    const issues = checkPrefixBypasses(allowRules, denyRules)

    expect(issues.length).toBeGreaterThan(0)
    expect(issues[0].severity).toBe('info')
    expect(issues[0].code).toBe('PREFIX_BYPASS_RISK')
  })

  it('warns for all known prefix commands', () => {
    const prefixCmds = ['env', 'command', 'nice', 'nohup', 'builtin', 'time']

    for (const prefix of prefixCmds) {
      const allowRules = [`Bash(${prefix} *)`]
      const denyRules = ['Bash(sudo *)']
      const issues = checkPrefixBypasses(allowRules, denyRules)

      expect(issues.length).toBeGreaterThan(0, `Expected warning for ${prefix}`)
      expect(issues[0].code).toBe('PREFIX_BYPASS_RISK')
    }
  })

  it('does NOT warn when no Bash deny rules exist', () => {
    const allowRules = ['Bash(env *)']
    const denyRules = ['Read(**/.env)']
    const issues = checkPrefixBypasses(allowRules, denyRules)

    expect(issues.length).toBe(0)
  })

  it('does NOT warn when no prefix command is in allow', () => {
    const allowRules = ['Bash(npm *)', 'Bash(cat *)']
    const denyRules = ['Bash(sudo *)']
    const issues = checkPrefixBypasses(allowRules, denyRules)

    expect(issues.length).toBe(0)
  })
})

// ============================================================
// checkMissingPairedDenyRules
// ============================================================
describe('bypass-detector: checkMissingPairedDenyRules', () => {
  it('suggests Edit deny when Read deny exists without Edit pair', () => {
    const denyRules = ['Read(**/.env)']
    const issues = checkMissingPairedDenyRules(denyRules)

    expect(issues.length).toBeGreaterThan(0)
    const editIssue = issues.find(i =>
      i.message.includes('Edit')
    )
    expect(editIssue).toBeDefined()
    expect(editIssue!.code).toBe('MISSING_PAIRED_DENY')
  })

  it('suggests Write deny when Read deny exists without Write pair', () => {
    const denyRules = ['Read(**/.env)']
    const issues = checkMissingPairedDenyRules(denyRules)

    const writeIssue = issues.find(i =>
      i.message.includes('Write')
    )
    expect(writeIssue).toBeDefined()
  })

  it('suggests Grep deny when Read deny exists without Grep pair', () => {
    const denyRules = ['Read(**/.env)']
    const issues = checkMissingPairedDenyRules(denyRules)

    const grepIssue = issues.find(i =>
      i.message.includes('Grep')
    )
    expect(grepIssue).toBeDefined()
  })

  it('returns empty when all pairs exist', () => {
    const denyRules = [
      'Read(**/.env)',
      'Edit(**/.env)',
      'Write(**/.env)',
      'Grep(**/.env)',
    ]
    const issues = checkMissingPairedDenyRules(denyRules)
    expect(issues).toHaveLength(0)
  })

  it('returns empty when no Read deny rules exist', () => {
    const denyRules = ['Bash(sudo *)']
    const issues = checkMissingPairedDenyRules(denyRules)
    expect(issues).toHaveLength(0)
  })
})
