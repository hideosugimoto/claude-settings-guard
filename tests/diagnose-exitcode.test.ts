import { describe, it, expect } from 'vitest'
import { shouldExitWithError } from '../src/commands/diagnose.js'
import type { DiagnosticIssue } from '../src/types.js'

describe('shouldExitWithError', () => {
  const criticalIssue: DiagnosticIssue = {
    severity: 'critical',
    code: 'LEGACY_SYNTAX',
    message: 'test',
  }

  const warningIssue: DiagnosticIssue = {
    severity: 'warning',
    code: 'CONFLICT',
    message: 'test',
  }

  const infoIssue: DiagnosticIssue = {
    severity: 'info',
    code: 'PIPE_VULNERABLE',
    message: 'test',
  }

  it('returns true when critical issues exist', () => {
    expect(shouldExitWithError([criticalIssue])).toBe(true)
  })

  it('returns true when warning issues exist', () => {
    expect(shouldExitWithError([warningIssue])).toBe(true)
  })

  it('returns false when only info issues exist', () => {
    expect(shouldExitWithError([infoIssue])).toBe(false)
  })

  it('returns false when no issues exist', () => {
    expect(shouldExitWithError([])).toBe(false)
  })

  it('returns true when mixed critical and info', () => {
    expect(shouldExitWithError([criticalIssue, infoIssue])).toBe(true)
  })

  it('returns true when mixed warning and info', () => {
    expect(shouldExitWithError([warningIssue, infoIssue])).toBe(true)
  })

  it('returns false for multiple info-only issues', () => {
    expect(shouldExitWithError([infoIssue, infoIssue, infoIssue])).toBe(false)
  })
})
