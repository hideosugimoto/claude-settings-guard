import { describe, it, expect } from 'vitest'
import { validateTemplateName } from '../src/commands/deploy-slash.js'

describe('deploy-slash validation', () => {
  describe('validateTemplateName', () => {
    it('accepts valid template names', () => {
      expect(validateTemplateName('csg.md')).toBe(true)
      expect(validateTemplateName('csg-diagnose.md')).toBe(true)
      expect(validateTemplateName('csg-enforce.md')).toBe(true)
    })

    it('rejects path traversal attempts', () => {
      expect(validateTemplateName('../etc/passwd')).toBe(false)
      expect(validateTemplateName('../../secrets')).toBe(false)
    })

    it('rejects absolute paths', () => {
      expect(validateTemplateName('/etc/passwd')).toBe(false)
    })

    it('rejects paths with directory separators', () => {
      expect(validateTemplateName('sub/file.md')).toBe(false)
      expect(validateTemplateName('sub\\file.md')).toBe(false)
    })

    it('rejects empty string', () => {
      expect(validateTemplateName('')).toBe(false)
    })
  })
})
