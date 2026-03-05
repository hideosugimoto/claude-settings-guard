import { describe, it, expect } from 'vitest'
import {
  splitShellCommand,
  checkPipeVulnerability,
} from '../src/utils/command-parser.js'

describe('splitShellCommand', () => {
  it('returns single command as-is', () => {
    expect(splitShellCommand('npm install')).toEqual(['npm install'])
  })

  it('returns empty array for empty string', () => {
    expect(splitShellCommand('')).toEqual([])
  })

  it('splits pipe commands', () => {
    expect(splitShellCommand('npm install | grep warn')).toEqual([
      'npm install',
      'grep warn',
    ])
  })

  it('splits multi-pipe commands', () => {
    expect(splitShellCommand('cat file | grep pattern | head -10')).toEqual([
      'cat file',
      'grep pattern',
      'head -10',
    ])
  })

  it('splits AND chains', () => {
    expect(splitShellCommand('npm install && npm test')).toEqual([
      'npm install',
      'npm test',
    ])
  })

  it('splits OR chains', () => {
    expect(splitShellCommand('cmd1 || cmd2')).toEqual([
      'cmd1',
      'cmd2',
    ])
  })

  it('splits semicolons', () => {
    expect(splitShellCommand('npm install; npm audit')).toEqual([
      'npm install',
      'npm audit',
    ])
  })

  it('extracts commands from $() substitution', () => {
    const result = splitShellCommand('echo $(whoami)')
    expect(result).toContain('echo')
    expect(result).toContain('whoami')
  })

  it('extracts commands from backtick substitution', () => {
    const result = splitShellCommand('echo `whoami`')
    expect(result).toContain('echo')
    expect(result).toContain('whoami')
  })

  it('splits mixed operators', () => {
    const result = splitShellCommand('cd /tmp && cat file | grep secret')
    expect(result).toContain('cd /tmp')
    expect(result).toContain('cat file')
    expect(result).toContain('grep secret')
  })

  it('extracts from subshell', () => {
    const result = splitShellCommand('(cd /tmp && rm -rf *)')
    expect(result).toContain('cd /tmp')
    expect(result).toContain('rm -rf *')
  })

  it('extracts from brace group', () => {
    const result = splitShellCommand('{ cd /tmp; rm -rf *; }')
    expect(result).toContain('cd /tmp')
    expect(result).toContain('rm -rf *')
  })

  it('detects sudo after pipe', () => {
    const result = splitShellCommand('echo foo | sudo rm -rf /')
    expect(result).toContain('sudo rm -rf /')
  })

  it('detects sudo after AND chain', () => {
    const result = splitShellCommand('cd /tmp && sudo rm -rf /')
    expect(result).toContain('sudo rm -rf /')
  })

  it('detects sudo inside $() substitution', () => {
    const result = splitShellCommand('echo $(sudo cat /etc/shadow)')
    expect(result).toContain('sudo cat /etc/shadow')
  })

  it('trims whitespace from subcommands', () => {
    const result = splitShellCommand('  npm install  |  grep warn  ')
    expect(result).toEqual(['npm install', 'grep warn'])
  })

  it('removes empty entries', () => {
    const result = splitShellCommand('npm install ;; npm test')
    expect(result).not.toContain('')
    expect(result.length).toBeGreaterThan(0)
  })

  it('deduplicates identical subcommands', () => {
    const result = splitShellCommand('echo $(echo hello)')
    const echoCount = result.filter(c => c === 'echo hello').length
    expect(echoCount).toBeLessThanOrEqual(1)
  })
})

describe('splitShellCommand — real-world Claude Code patterns', () => {
  it('handles process substitution <()', () => {
    const result = splitShellCommand('diff <(curl -s url1) <(curl -s url2)')
    expect(result).toContain('curl -s url1')
    expect(result).toContain('curl -s url2')
  })

  it('handles multiple $() in one command', () => {
    const result = splitShellCommand('echo $(whoami) $(hostname)')
    expect(result).toContain('whoami')
    expect(result).toContain('hostname')
  })

  it('handles nested pipe inside $()', () => {
    const result = splitShellCommand('echo $(cat /etc/passwd | grep root)')
    expect(result).toContain('cat /etc/passwd')
    expect(result).toContain('grep root')
  })

  it('handles xargs with sudo', () => {
    const result = splitShellCommand('find . -name "*.log" | xargs sudo rm')
    expect(result).toContain('xargs sudo rm')
  })

  it('handles redirect with pipe', () => {
    const result = splitShellCommand('sudo cat /etc/shadow 2>&1 | tee output.txt')
    expect(result.some(c => c.includes('sudo'))).toBe(true)
  })

  it('handles newline-separated commands', () => {
    const result = splitShellCommand('npm install\nnpm test')
    expect(result).toContain('npm install')
    expect(result).toContain('npm test')
  })

  it('handles typical Claude Code npm chain', () => {
    const result = splitShellCommand('cd /tmp && npm init -y && npm install express && node app.js')
    expect(result).toContain('cd /tmp')
    expect(result).toContain('npm init -y')
    expect(result).toContain('npm install express')
    expect(result).toContain('node app.js')
  })

  it('handles Claude Code git chain', () => {
    const result = splitShellCommand('git add . && git commit -m "feat: add feature" && git push')
    expect(result).toContain('git add .')
    expect(result).toContain('git push')
  })

  it('handles dangerous pattern: pipe to sudo', () => {
    const result = splitShellCommand('echo "password" | sudo -S rm -rf /')
    expect(result.some(c => c.startsWith('sudo'))).toBe(true)
  })

  it('handles dangerous pattern: encoded bypass via eval', () => {
    const result = splitShellCommand('eval $(echo "sudo rm -rf /")')
    expect(result).toContain('echo "sudo rm -rf /"')
  })

  it('handles semicolon at end of command', () => {
    const result = splitShellCommand('npm install;')
    expect(result).toEqual(['npm install'])
  })

  it('handles complex real-world: test && deploy chain', () => {
    const result = splitShellCommand('npm test && npm run build && npm publish || echo "failed"')
    expect(result).toContain('npm test')
    expect(result).toContain('npm run build')
    expect(result).toContain('npm publish')
    expect(result).toContain('echo "failed"')
  })

  it('handles process substitution with sudo', () => {
    const result = splitShellCommand('sudo tee /etc/config < <(echo "data")')
    expect(result.some(c => c.includes('sudo'))).toBe(true)
  })
})

describe('checkPipeVulnerability', () => {
  it('returns info for Bash deny patterns with arguments', () => {
    const result = checkPipeVulnerability('Bash(sudo *)')
    expect(result).not.toBeNull()
    expect(result!.severity).toBe('info')
    expect(result!.code).toBe('PIPE_VULNERABLE')
  })

  it('returns null for non-Bash patterns', () => {
    expect(checkPipeVulnerability('Read(**/.env)')).toBeNull()
  })

  it('returns null for bare Bash pattern', () => {
    expect(checkPipeVulnerability('Bash')).toBeNull()
  })

  it('returns info for legacy Bash patterns', () => {
    const result = checkPipeVulnerability('Bash(sudo:*)')
    expect(result).not.toBeNull()
    expect(result!.code).toBe('PIPE_VULNERABLE')
  })
})
