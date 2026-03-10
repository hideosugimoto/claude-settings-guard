import { describe, it, expect, vi, afterEach } from 'vitest'
import { isJqAvailable } from './jq-check.js'

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}))

import { execSync } from 'node:child_process'

const mockedExecSync = vi.mocked(execSync)

describe('isJqAvailable', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns true when jq is installed', () => {
    mockedExecSync.mockReturnValue(Buffer.from('/usr/bin/jq'))
    expect(isJqAvailable()).toBe(true)
  })

  it('returns false when jq is not installed', () => {
    mockedExecSync.mockImplementation(() => {
      throw new Error('command not found')
    })
    expect(isJqAvailable()).toBe(false)
  })

  it('calls execSync with correct arguments', () => {
    mockedExecSync.mockReturnValue(Buffer.from('/usr/bin/jq'))
    isJqAvailable()
    expect(mockedExecSync).toHaveBeenCalledWith('command -v jq', { stdio: 'pipe' })
  })
})
