import { describe, it, expect, vi, beforeEach } from 'vitest'
import { exitWithError, handleCommandError } from '../src/utils/exit.js'

const mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {
  throw new Error('process.exit called')
}) as never)
const mockStderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

beforeEach(() => {
  mockExit.mockClear()
  mockStderr.mockClear()
})

describe('exitWithError', () => {
  it('writes formatted error message to stderr', () => {
    try {
      exitWithError('something went wrong')
    } catch {
      // expected
    }
    expect(mockStderr).toHaveBeenCalledWith('Error: something went wrong\n')
  })

  it('calls process.exit with code 1 by default', () => {
    try {
      exitWithError('fail')
    } catch {
      // expected
    }
    expect(mockExit).toHaveBeenCalledWith(1)
  })

  it('calls process.exit with custom code', () => {
    try {
      exitWithError('fail', 2)
    } catch {
      // expected
    }
    expect(mockExit).toHaveBeenCalledWith(2)
  })

  it('handles empty string message', () => {
    try {
      exitWithError('')
    } catch {
      // expected
    }
    expect(mockStderr).toHaveBeenCalledWith('Error: \n')
    expect(mockExit).toHaveBeenCalledWith(1)
  })

  it('handles message with special characters', () => {
    try {
      exitWithError('file "not found" at /path/to/file')
    } catch {
      // expected
    }
    expect(mockStderr).toHaveBeenCalledWith('Error: file "not found" at /path/to/file\n')
  })
})

describe('handleCommandError', () => {
  it('extracts message from Error instances', () => {
    try {
      handleCommandError(new Error('database connection failed'))
    } catch {
      // expected
    }
    expect(mockStderr).toHaveBeenCalledWith('Error: database connection failed\n')
    expect(mockExit).toHaveBeenCalledWith(1)
  })

  it('converts non-Error values to string', () => {
    try {
      handleCommandError('plain string error')
    } catch {
      // expected
    }
    expect(mockStderr).toHaveBeenCalledWith('Error: plain string error\n')
  })

  it('handles number errors', () => {
    try {
      handleCommandError(42)
    } catch {
      // expected
    }
    expect(mockStderr).toHaveBeenCalledWith('Error: 42\n')
  })

  it('handles null errors', () => {
    try {
      handleCommandError(null)
    } catch {
      // expected
    }
    expect(mockStderr).toHaveBeenCalledWith('Error: null\n')
  })

  it('handles undefined errors', () => {
    try {
      handleCommandError(undefined)
    } catch {
      // expected
    }
    expect(mockStderr).toHaveBeenCalledWith('Error: undefined\n')
  })
})
