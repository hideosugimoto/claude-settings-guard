import { createHash } from 'node:crypto'
import type { ClaudeSettings } from '../types.js'
import {
  groupRulesByTool,
  generateBashToolCheck,
  generateNonBashToolCheck,
  generateBashFileArgCheck,
} from './hook-script-builder.js'
import type { DenyRule } from './hook-script-builder.js'

function generateStripPrefixCommands(): string {
  const lines = [
    '# Strip common prefix commands (env, command, nice, nohup, etc.)',
    'strip_prefix_commands() {',
    '  local cmd="$1"',
    '  local prefix_cmds="env command nice nohup builtin time strace ltrace ionice taskset chrt"',
    '  local changed=true',
    '  while [ "$changed" = true ]; do',
    '    changed=false',
    '    for prefix in $prefix_cmds; do',
    '      # Strip "prefix " from start, also handle "prefix VAR=val " for env',
    '      if [[ "$cmd" =~ ^"$prefix "[[:space:]]* ]]; then',
    '        cmd="${cmd#"$prefix "}"',
    '        # For env: also strip VAR=value pairs',
    '        while [[ "$cmd" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; do',
    '          cmd="${cmd#*=}"',
    '          cmd="${cmd#* }"',
    '        done',
    '        cmd=$(printf \'%s\' "$cmd" | sed \'s/^[[:space:]]*//\')',
    '        changed=true',
    '      fi',
    '    done',
    '  done',
    '  printf \'%s\' "$cmd"',
    '}',
  ]
  return lines.join('\n')
}

function generateExtractSubstitutions(): string {
  // Extract balanced $() with proper nesting support
  // Use string array to avoid template literal escaping issues with bash variables
  const lines = [
    '# Extract balanced $() substitutions (handles nesting)',
    'extract_substitutions() {',
    '  local cmd="$1"',
    '  local len=${#cmd}',
    '  local i=0',
    '  while [ $i -lt $len ]; do',
    '    if [ "${cmd:$i:2}" = "\\$(" ]; then',
    '      local start=$((i + 2))',
    '      local depth=1',
    '      local j=$start',
    '      while [ $j -lt $len ] && [ $depth -gt 0 ]; do',
    '        local ch="${cmd:$j:1}"',
    '        if [ "$ch" = "(" ]; then',
    '          depth=$((depth + 1))',
    '        elif [ "$ch" = ")" ]; then',
    '          depth=$((depth - 1))',
    '        fi',
    '        j=$((j + 1))',
    '      done',
    '      if [ $depth -eq 0 ]; then',
    '        local inner="${cmd:$start:$((j - start - 1))}"',
    "        printf '%s\\n' \"$inner\"",
    '      fi',
    '      i=$j',
    '    else',
    '      i=$((i + 1))',
    '    fi',
    '  done',
    '}',
  ]
  return lines.join('\n')
}

function generateSplitSubcommands(): string {
  const lines = [
    '# Split shell command into subcommands (pipes, chains, substitutions, background)',
    'split_subcommands() {',
    '  local cmd="$1"',
    '',
    '  # Extract balanced $() contents',
    '  local extracted',
    '  extracted=$(extract_substitutions "$cmd")',
    '',
    '  # Remove $() and <() blocks from main command',
    '  local cleaned="$cmd"',
    "  cleaned=$(printf '%s' \"$cleaned\" | sed -E 's/\\$\\([^)]*\\)//g; s/<\\([^)]*\\)//g')",
    '  # Second pass for nested remnants',
    "  cleaned=$(printf '%s' \"$cleaned\" | sed -E 's/\\$\\([^)]*\\)//g')",
    '',
    '  # Remove subshell parens and brace groups',
    "  cleaned=$(printf '%s' \"$cleaned\" | sed -E 's/^[[:space:]]*\\(//; s/\\)[[:space:]]*$//; s/^[[:space:]]*\\{//; s/\\}[[:space:]]*$//')",
    '',
    '  # Replace operators with newlines (multi-char first, then background &)',
    "  cleaned=$(printf '%s' \"$cleaned\" | sed 's/&&/\\n/g' | sed 's/||/\\n/g' | sed 's/|/\\n/g' | sed 's/;/\\n/g' | sed 's/&/\\n/g')",
    '',
    '  # Output main parts (trimmed)',
    "  printf '%s\\n' \"$cleaned\" | while IFS= read -r line; do",
    "    line=$(printf '%s' \"$line\" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')",
    '    [ -n "$line" ] && printf \'%s\\n\' "$line"',
    '  done',
    '',
    '  # Output extracted $() parts (recursively split)',
    '  if [ -n "$extracted" ]; then',
    '    printf \'%s\\n\' "$extracted" | while IFS= read -r sub; do',
    '      [ -z "$sub" ] && continue',
    '      split_subcommands "$sub"',
    '    done',
    '  fi',
    '}',
  ]
  return lines.join('\n')
}

function computeChecksum(body: string): string {
  return createHash('sha256').update(body).digest('hex').slice(0, 16)
}

export function generateEnforceScript(denyRules: readonly string[]): string {
  const byTool = groupRulesByTool(denyRules)

  const hasBashRules = byTool.has('Bash')
  const toolChecks: string[] = []

  // Collect file-path deny rules from non-Bash tools for cross-tool protection
  const fileDenyTools = ['Read', 'Write', 'Edit', 'Grep'] as const
  const fileDenyRules: DenyRule[] = []

  for (const [toolName, rules] of byTool) {
    if (toolName === 'Bash') {
      toolChecks.push(generateBashToolCheck(rules))
    } else {
      toolChecks.push(generateNonBashToolCheck(toolName, rules))
      if ((fileDenyTools as readonly string[]).includes(toolName)) {
        fileDenyRules.push(...rules)
      }
    }
  }

  // Add cross-tool file argument check for Bash commands
  const fileArgCheck = generateBashFileArgCheck(fileDenyRules)
  if (fileArgCheck) {
    toolChecks.push(fileArgCheck)
  }

  const helperFns = hasBashRules
    ? `\n${generateStripPrefixCommands()}\n\n${generateExtractSubstitutions()}\n\n${generateSplitSubcommands()}\n`
    : ''

  const body = `${helperFns}
${toolChecks.join('\n\n')}

exit 0
`

  const checksum = computeChecksum(body)

  return `#!/bin/bash
# Auto-generated by claude-settings-guard
# Layer 2: PreToolUse enforcement hook
# Reads deny rules and independently blocks matching tool calls
# This is a backup for settings.json deny rules that may not work due to bugs
# checksum: ${checksum}

# Verify jq is available
if ! command -v jq &>/dev/null; then
  echo "ERROR: enforce-permissions.sh requires jq but it is not installed" >&2
  exit 1
fi

input=$(cat)
TOOL_NAME=$(printf '%s' "$input" | jq -r '.tool_name // ""' 2>/dev/null)

# Fail-closed: reject if tool name is empty (malformed input)
if [ -z "$TOOL_NAME" ]; then
  echo "ERROR: enforce-permissions.sh: could not parse tool_name from input" >&2
  exit 2
fi

TOOL_NAME_LOWER=$(printf '%s' "$TOOL_NAME" | tr '[:upper:]' '[:lower:]')

# Treat MultiEdit as Edit for deny rule matching
if [[ "$TOOL_NAME_LOWER" == "multiedit" ]]; then
  TOOL_NAME_LOWER="edit"
fi
${body}`
}

export function generateHookRegistration(): {
  readonly matcher: string
  readonly hooks: readonly { readonly type: string; readonly command: string }[]
} {
  return {
    matcher: '*',
    hooks: [{
      type: 'command',
      command: '~/.claude/hooks/enforce-permissions.sh',
    }],
  }
}

export function mergeHookIntoSettings(
  settings: ClaudeSettings,
  hookPath: string
): ClaudeSettings {
  const existingPreToolUse = settings.PreToolUse ?? []

  // Check if already registered
  const alreadyExists = existingPreToolUse.some(rule =>
    rule.hooks.some(h => h.command.includes('enforce-permissions'))
  )

  if (alreadyExists) return settings

  const newRule = {
    matcher: '*',
    hooks: [{
      type: 'command' as const,
      command: hookPath,
    }],
  }

  return {
    ...settings,
    PreToolUse: [...existingPreToolUse, newRule],
  }
}
