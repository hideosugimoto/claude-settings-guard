import { describe, it, expect } from 'vitest'
import { getProjectSettingsPath } from './paths.js'

describe('getProjectSettingsPath', () => {
  it('returns correct path for valid absolute directory', () => {
    const result = getProjectSettingsPath('/home/user/project')
    expect(result).toBe('/home/user/project/.claude/settings.json')
  })

  it('throws for relative path', () => {
    expect(() => getProjectSettingsPath('relative/path')).toThrow(
      'Project directory must be an absolute path'
    )
  })

  it('throws for dot-relative path', () => {
    expect(() => getProjectSettingsPath('./relative/path')).toThrow(
      'Project directory must be an absolute path'
    )
  })

  it('throws for path containing .. traversal', () => {
    expect(() => getProjectSettingsPath('/home/user/../etc')).toThrow(
      'Project directory must not contain path traversal'
    )
  })

  it('throws for path with .. at the end', () => {
    expect(() => getProjectSettingsPath('/home/user/..')).toThrow(
      'Project directory must not contain path traversal'
    )
  })

  it('allows paths with dots that are not traversal', () => {
    const result = getProjectSettingsPath('/home/user/.config')
    expect(result).toBe('/home/user/.config/.claude/settings.json')
  })

  it('allows paths with double-dot in directory name', () => {
    const result = getProjectSettingsPath('/home/user/my..project')
    expect(result).toBe('/home/user/my..project/.claude/settings.json')
  })
})
