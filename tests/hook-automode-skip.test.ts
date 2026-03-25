import { describe, it, expect } from 'vitest'
import { generateEnforceScript } from '../src/core/hook-generator.js'

describe('enforce hook AutoMode skip', () => {
  it('generates script with AutoMode skip logic', () => {
    const script = generateEnforceScript(['Bash(sudo *)'])

    expect(script).toContain('permission_mode')
    expect(script).toContain('"auto"')
    expect(script).toContain('exit 0')
  })

  it('checks permission_mode before tool_name', () => {
    const script = generateEnforceScript(['Bash(sudo *)'])

    const permModeIndex = script.indexOf('permission_mode')
    const toolNameIndex = script.indexOf('tool_name')

    expect(permModeIndex).toBeLessThan(toolNameIndex)
  })

  it('skips with exit 0 when AutoMode is active', () => {
    const script = generateEnforceScript(['Bash(sudo *)'])

    // The pattern should be: check permission_mode, if auto then exit 0
    const autoCheck = script.match(/PERMISSION_MODE.*auto.*exit 0/s)
    expect(autoCheck).not.toBeNull()
  })

  it('still includes deny rule checks after AutoMode check', () => {
    const script = generateEnforceScript(['Bash(sudo *)'])

    // After the AutoMode skip, the script should still have deny rule logic
    expect(script).toContain('sudo')
    expect(script).toContain('TOOL_NAME')
  })
})
