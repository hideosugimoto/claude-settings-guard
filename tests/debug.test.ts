import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { debug, enableDebug, isDebugEnabled, resetDebug } from '../src/utils/debug.js'

const mockStderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

beforeEach(() => {
  mockStderr.mockClear()
})

describe('debug utility', () => {
  beforeEach(() => {
    resetDebug()
    delete process.env.CSG_DEBUG
  })

  afterEach(() => {
    resetDebug()
    delete process.env.CSG_DEBUG
  })

  describe('debug()', () => {
    it('does nothing when debug is disabled', () => {
      debug('should not appear')
      expect(mockStderr).not.toHaveBeenCalled()
    })

    it('writes to stderr when enabled via enableDebug()', () => {
      enableDebug()
      debug('test message')
      expect(mockStderr).toHaveBeenCalledWith('[CSG DEBUG] test message\n')
    })

    it('writes to stderr when CSG_DEBUG=1', () => {
      process.env.CSG_DEBUG = '1'
      debug('env message')
      expect(mockStderr).toHaveBeenCalledWith('[CSG DEBUG] env message\n')
    })

    it('does not write when CSG_DEBUG is set to other values', () => {
      process.env.CSG_DEBUG = '0'
      debug('should not appear')
      expect(mockStderr).not.toHaveBeenCalled()
    })

    it('handles empty string message', () => {
      enableDebug()
      debug('')
      expect(mockStderr).toHaveBeenCalledWith('[CSG DEBUG] \n')
    })

    it('handles message with special characters', () => {
      enableDebug()
      debug('Reading /path/to/"file".json')
      expect(mockStderr).toHaveBeenCalledWith('[CSG DEBUG] Reading /path/to/"file".json\n')
    })
  })

  describe('isDebugEnabled()', () => {
    it('returns false by default', () => {
      expect(isDebugEnabled()).toBe(false)
    })

    it('returns true after enableDebug()', () => {
      enableDebug()
      expect(isDebugEnabled()).toBe(true)
    })

    it('returns true when CSG_DEBUG=1', () => {
      process.env.CSG_DEBUG = '1'
      expect(isDebugEnabled()).toBe(true)
    })

    it('returns false when CSG_DEBUG is not 1', () => {
      process.env.CSG_DEBUG = 'true'
      expect(isDebugEnabled()).toBe(false)
    })
  })

  describe('enableDebug()', () => {
    it('enables debug mode persistently for the module', () => {
      expect(isDebugEnabled()).toBe(false)
      enableDebug()
      expect(isDebugEnabled()).toBe(true)
    })
  })

  describe('resetDebug()', () => {
    it('resets debug state to disabled', () => {
      enableDebug()
      expect(isDebugEnabled()).toBe(true)
      resetDebug()
      expect(isDebugEnabled()).toBe(false)
    })

    it('does not affect CSG_DEBUG env var detection', () => {
      enableDebug()
      resetDebug()
      process.env.CSG_DEBUG = '1'
      expect(isDebugEnabled()).toBe(true)
    })
  })
})
