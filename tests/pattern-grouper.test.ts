import { describe, it, expect } from 'vitest'
import { extractPrefix, groupStatsByPrefix } from '../src/core/pattern-grouper.js'
import type { ToolStats } from '../src/core/telemetry-analyzer.js'

function createStat(pattern: string, allowed = 0, denied = 0, prompted = 0): ToolStats {
  const tool = pattern.split('(')[0]
  return { tool, pattern, allowed, denied, prompted }
}

describe('extractPrefix', () => {
  it('extracts two-token prefixes for package managers and git', () => {
    expect(extractPrefix('npm install lodash')).toBe('npm install')
    expect(extractPrefix('git status -s')).toBe('git status')
  })

  it('extracts one-token prefix for generic commands', () => {
    expect(extractPrefix('ls -la')).toBe('ls')
  })

  it('skips sudo and extracts next command prefix', () => {
    expect(extractPrefix('sudo apt install nginx')).toBe('apt install')
  })
})

describe('groupStatsByPrefix', () => {
  it('groups three or more subcommands into wildcard pattern', () => {
    const stats = new Map<string, ToolStats>([
      ['Bash(npm install lodash)', createStat('Bash(npm install lodash)', 2, 0, 1)],
      ['Bash(npm install chalk)', createStat('Bash(npm install chalk)', 1, 0, 0)],
      ['Bash(npm install zod)', createStat('Bash(npm install zod)', 1, 0, 2)],
    ])

    const grouped = groupStatsByPrefix(stats)
    expect(grouped).toHaveLength(1)
    expect(grouped[0].wildcardPattern).toBe('Bash(npm install *)')
    expect(grouped[0].exactPatterns).toHaveLength(3)
    expect(grouped[0].totalAllowed).toBe(4)
  })

  it('does not group when subcommands are two or fewer', () => {
    const stats = new Map<string, ToolStats>([
      ['Bash(npm test)', createStat('Bash(npm test)', 2)],
      ['Bash(npm run lint)', createStat('Bash(npm run lint)', 1)],
    ])

    const grouped = groupStatsByPrefix(stats)
    expect(grouped).toHaveLength(2)
    expect(grouped.map(g => g.wildcardPattern)).toEqual([
      'Bash(npm test)',
      'Bash(npm run lint)',
    ])
  })

  it('does not mix different tools', () => {
    const stats = new Map<string, ToolStats>([
      ['Bash(npm install lodash)', createStat('Bash(npm install lodash)', 1)],
      ['Bash(npm install chalk)', createStat('Bash(npm install chalk)', 1)],
      ['Bash(npm install zod)', createStat('Bash(npm install zod)', 1)],
      ['Read(npm install)', createStat('Read(npm install)', 1)],
    ])

    const grouped = groupStatsByPrefix(stats)
    expect(grouped.find(g => g.tool === 'Bash')?.wildcardPattern).toBe('Bash(npm install *)')
    expect(grouped.find(g => g.tool === 'Read')?.wildcardPattern).toBe('Read(npm install)')
  })

  it('does not group patterns without arguments', () => {
    const stats = new Map<string, ToolStats>([
      ['Bash', createStat('Bash', 5)],
      ['Read', createStat('Read', 2)],
    ])

    const grouped = groupStatsByPrefix(stats)
    expect(grouped).toHaveLength(0)
  })
})
