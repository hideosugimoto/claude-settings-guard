import { describe, it, expect, afterEach } from 'vitest'

describe('NO_COLOR support', () => {
  const originalNoColor = process.env.NO_COLOR

  afterEach(() => {
    if (originalNoColor === undefined) {
      delete process.env.NO_COLOR
    } else {
      process.env.NO_COLOR = originalNoColor
    }
  })

  it('chalk produces no ANSI codes when level is 0', async () => {
    // chalk v5 auto-respects NO_COLOR env var
    // We verify by importing chalk and checking level=0 produces plain text
    const { default: chalk } = await import('chalk')
    const saved = chalk.level
    try {
      chalk.level = 0 as typeof chalk.level
      const result = chalk.red('hello')
      // Should have no ANSI escape codes
      expect(result).toBe('hello')
    } finally {
      chalk.level = saved
    }
  })

  it('chalk v5 is used (auto-respects NO_COLOR)', async () => {
    const { readFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const pkg = JSON.parse(
      await readFile(join(import.meta.dirname, '..', 'package.json'), 'utf-8')
    )
    const chalkVersion = pkg.dependencies.chalk
    // Verify chalk v5+ is specified (^5.x.x)
    expect(chalkVersion).toMatch(/^\^5/)
  })
})
