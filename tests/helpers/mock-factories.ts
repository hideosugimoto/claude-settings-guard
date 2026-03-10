export function createMockExtractAllRules(overrides?: Partial<{
  allowRules: string[]
  denyRules: string[]
  askRules: string[]
  legacyAllowedTools: string[]
  legacyDeny: string[]
}>) {
  return {
    allowRules: [] as string[],
    denyRules: ['Bash(rm *)'] as string[],
    askRules: [] as string[],
    legacyAllowedTools: [] as string[],
    legacyDeny: [] as string[],
    ...overrides,
  }
}

export function createMockSettingsWithEnforceHook() {
  return {
    PreToolUse: [{
      matcher: 'Bash',
      hooks: [{ type: 'command', command: '/tmp/hooks/enforce-permissions.sh' }],
    }],
    permissions: { deny: ['Bash(rm *)'] },
  }
}
