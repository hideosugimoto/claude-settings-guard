export const KNOWN_TOOLS = [
  'Bash', 'Read', 'Write', 'Edit', 'MultiEdit',
  'Glob', 'Grep', 'WebFetch', 'WebSearch',
  'TodoRead', 'TodoWrite', 'LS',
  'Agent', 'Skill', 'NotebookEdit',
] as const

export type KnownTool = typeof KNOWN_TOOLS[number]

export const DANGEROUS_COMMANDS = [
  'sudo', 'su', 'rm -rf /', 'rm -rf ~',
  'chmod 777', 'dd if=', ':(){:|:&};:',
] as const

export const SENSITIVE_FILE_PATTERNS = [
  '**/.env', '**/.env.*', '**/secrets/**',
  '**/*secret*', '**/*credential*',
  '**/*.pem', '**/*.key',
] as const

export const DEFAULT_DENY_RULES: readonly string[] = [
  'Bash(sudo *)', 'Bash(su *)', 'Bash(rm -rf /*)', 'Bash(rm -rf ~*)',
  'Read(**/.env)', 'Read(**/.env.*)', 'Read(**/secrets/**)',
  'Read(**/*secret*)', 'Read(**/*credential*)',
]

export const LEGACY_COLON_PATTERN = /^(\w+)\((.+):(\*)\)$/

export const MODERN_SPACE_PATTERN = /^(\w+)\((.+)\)$/

export const BARE_TOOL_PATTERN = /^(\w+)$/

export const MCP_TOOL_PATTERN = /^mcp__\w+__\w+/

export const GLOBAL_SETTINGS_PATH = '~/.claude/settings.json'
export const LOCAL_SETTINGS_PATH = '~/.claude/settings.local.json'
export const BACKUP_DIR = '~/.claude/backups'
export const HOOKS_DIR = '~/.claude/hooks'
export const COMMANDS_DIR = '~/.claude/commands'
export const TELEMETRY_DIR = '~/.claude/telemetry'

export const RECOMMEND_ALLOW_THRESHOLD = 3
export const RECOMMEND_DENY_THRESHOLD = 2
