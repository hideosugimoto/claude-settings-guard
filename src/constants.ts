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
  'mkfs', 'fdisk', 'mount', 'umount',
  'iptables', 'systemctl', 'kill -9',
] as const

export const SENSITIVE_FILE_PATTERNS = [
  '**/.env', '**/.env.*', '**/secrets/**',
  '**/*.secret', '**/*.secrets',
  '**/*credential*',
  '**/*.pem', '**/*.key',
] as const

export const SAFE_ENV_SUFFIXES = [
  'example', 'sample', 'template', 'dist',
] as const

export const DEFAULT_DENY_RULES: readonly string[] = [
  'Bash(sudo *)', 'Bash(su *)', 'Bash(rm -rf /*)', 'Bash(rm -rf ~*)',
  'Bash(eval *)', 'Bash(base64 *)',
  'Read(**/.env)', 'Read(**/.env.*)', 'Read(**/secrets/**)',
  'Read(**/*.secret)', 'Read(**/*credential*)',
  'Write(**/.env)', 'Write(**/.env.*)', 'Write(**/secrets/**)',
  'Edit(**/.env)', 'Edit(**/.env.*)', 'Edit(**/secrets/**)',
  'Grep(**/.env)', 'Grep(**/.env.*)', 'Grep(**/secrets/**)',
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

// Commands that can read file contents (bypass Read deny via Bash)
export const FILE_READ_COMMANDS: ReadonlySet<string> = new Set([
  'cat', 'head', 'tail', 'less', 'more', 'grep', 'sed', 'awk', 'strings',
])

// Commands that can write/copy files (bypass Write/Edit deny via Bash)
export const FILE_WRITE_COMMANDS: ReadonlySet<string> = new Set([
  'sed', 'tee', 'cp', 'mv',
])

// Commands that act as prefix wrappers (can wrap denied commands)
export const PREFIX_COMMANDS: ReadonlySet<string> = new Set([
  'env', 'command', 'nice', 'nohup', 'builtin', 'time',
  'strace', 'ltrace', 'ionice', 'taskset', 'chrt',
])

// Commands that are hard to reverse — should require confirmation (ask), not auto-allow
// Included in all profiles (minimal, balanced, strict)
export const HARD_TO_REVERSE_ASK_RULES: readonly string[] = [
  'Bash(git push *)',
  'Bash(git push)',
  'Bash(git push --force *)',
  'Bash(git reset --hard *)',
  'Bash(git branch -D *)',
  'Bash(git clean -f *)',
  'Bash(git rebase *)',
  'Bash(git tag *)',
  'Bash(git stash drop *)',
  'Bash(npm publish *)',
  'Bash(npm publish)',
]

// Additional ask rules for strict profile only (infra/remote operations)
export const STRICT_ONLY_ASK_RULES: readonly string[] = [
  'Bash(ssh *)',
  'Bash(scp *)',
  'Bash(docker push *)',
  'Bash(kubectl delete *)',
  'Bash(kubectl apply *)',
  'Bash(terraform apply *)',
  'Bash(terraform destroy *)',
]

export const RECOMMEND_ALLOW_THRESHOLD = 3
export const RECOMMEND_DENY_THRESHOLD = 2
