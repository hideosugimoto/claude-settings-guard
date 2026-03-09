import { describe, it, expect } from 'vitest'
import { analyzeBypassRisks } from '../src/core/bypass-analyzer.js'

describe('analyzeBypassRisks', () => {
  it('returns all bypass techniques for Bash(sudo *)', () => {
    const result = analyzeBypassRisks(['Bash(sudo *)'], false)

    expect(result.ruleAnalysis).toHaveLength(1)
    expect(result.ruleAnalysis[0].bypasses).toHaveLength(12)
    expect(result.ruleAnalysis[0].bypasses.some(b => b.technique === 'pipe_chain')).toBe(true)
    expect(result.ruleAnalysis[0].bypasses.some(b => b.technique === 'command_substitution')).toBe(true)
    expect(result.ruleAnalysis[0].bypasses.some(b => b.technique === 'eval_exec')).toBe(true)
  })

  it('skips non-Bash rules from bypass analysis', () => {
    const result = analyzeBypassRisks(['Read(**/.env)'], false)

    expect(result.denyRulesAnalyzed).toBe(0)
    expect(result.ruleAnalysis).toEqual([])
  })

  it('marks hooked techniques as mitigated when enforce hook is installed', () => {
    const result = analyzeBypassRisks(['Bash(sudo *)'], true)

    const pipeChain = result.ruleAnalysis[0].bypasses.find(b => b.technique === 'pipe_chain')
    const evalExec = result.ruleAnalysis[0].bypasses.find(b => b.technique === 'eval_exec')

    expect(pipeChain?.mitigatedByHook).toBe(true)
    expect(evalExec?.mitigatedByHook).toBe(false)
  })

  it('returns critical overall risk when hook is not installed', () => {
    const result = analyzeBypassRisks(['Bash(sudo *)'], false)
    expect(result.overallRiskLevel).toBe('critical')
  })

  it('includes actionable suggestions', () => {
    const result = analyzeBypassRisks(['Bash(sudo *)'], false)

    expect(result.suggestions.some(s => s.action.includes('Install Layer 2 enforce hook'))).toBe(true)
    expect(result.suggestions.some(s => s.command === 'npx claude-settings-guard enforce')).toBe(true)
  })
})
