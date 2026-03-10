import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockStderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

beforeEach(() => {
  mockStderr.mockClear()
})

describe('debug utility', () => {
  let debugModule: typeof import('../src/utils/debug.js')

  beforeEach(async () => {
    vi.resetModules()
    delete process.env.CSG_DEBUG
    debugModule = await import('../src/utils/debug.js')
  })

  afterEach(() => {
    delete process.env.CSG_DEBUG
  })

  describe('debug()', () => {
    it('does nothing when debug is disabled', () => {
      debugModule.debug('should not appear')
      expect(mockStderr).not.toHaveBeenCalled()
    })

    it('writes to stderr when enabled via enableDebug()', () => {
      debugModule.enableDebug()
      debugModule.debug('test message')
      expect(mockStderr).toHaveBeenCalledWith('[CSG DEBUG] test message\n')
    })

    it('writes to stderr when CSG_DEBUG=1', async () => {
      process.env.CSG_DEBUG = '1'
      vi.resetModules()
      const mod = await import('../src/utils/debug.js')
      mod.debug('env message')
      expect(mockStderr).toHaveBeenCalledWith('[CSG DEBUG] env message\n')
    })

    it('does not write when CSG_DEBUG is set to other values', async () => {
      process.env.CSG_DEBUG = '0'
      vi.resetModules()
      const mod = await import('../src/utils/debug.js')
      mod.debug('should not appear')
      expect(mockStderr).not.toHaveBeenCalled()
    })

    it('handles empty string message', () => {
      debugModule.enableDebug()
      debugModule.debug('')
      expect(mockStderr).toHaveBeenCalledWith('[CSG DEBUG] \n')
    })

    it('handles message with special characters', () => {
      debugModule.enableDebug()
      debugModule.debug('Reading /path/to/"file".json')
      expect(mockStderr).toHaveBeenCalledWith('[CSG DEBUG] Reading /path/to/"file".json\n')
    })
  })

  describe('isDebugEnabled()', () => {
    it('returns false by default', () => {
      expect(debugModule.isDebugEnabled()).toBe(false)
    })

    it('returns true after enableDebug()', () => {
      debugModule.enableDebug()
      expect(debugModule.isDebugEnabled()).toBe(true)
    })

    it('returns true when CSG_DEBUG=1', async () => {
      process.env.CSG_DEBUG = '1'
      vi.resetModules()
      const mod = await import('../src/utils/debug.js')
      expect(mod.isDebugEnabled()).toBe(true)
    })

    it('returns false when CSG_DEBUG is not 1', async () => {
      process.env.CSG_DEBUG = 'true'
      vi.resetModules()
      const mod = await import('../src/utils/debug.js')
      expect(mod.isDebugEnabled()).toBe(false)
    })
  })

  describe('enableDebug()', () => {
    it('enables debug mode persistently for the module', () => {
      expect(debugModule.isDebugEnabled()).toBe(false)
      debugModule.enableDebug()
      expect(debugModule.isDebugEnabled()).toBe(true)
    })
  })
})
