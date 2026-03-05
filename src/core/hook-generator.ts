import { LEGACY_COLON_PATTERN, MODERN_SPACE_PATTERN } from '../constants.js'
import type { ClaudeSettings } from '../types.js'

interface DenyRule {
  readonly toolName: string
  readonly pattern: string
  readonly regex: string
}

function assertSafePattern(pattern: string): void {
  if (/[`$;|&\n\r]/.test(pattern)) {
    throw new Error(`Deny pattern contains unsafe shell characters: ${pattern}`)
  }
}

function patternToRegex(pattern: string): string {
  assertSafePattern(pattern)
  return pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '<<GLOBSTAR>>')
    .replace(/\*/g, '.*')
    .replace(/<<GLOBSTAR>>/g, '.*')
    .replace(/\?/g, '.')
}

function parseDenyPattern(pattern: string): DenyRule | null {
  // Legacy colon syntax
  const legacyMatch = pattern.match(LEGACY_COLON_PATTERN)
  if (legacyMatch) {
    const [, toolName, arg] = legacyMatch
    return {
      toolName,
      pattern,
      regex: patternToRegex(`${arg} *`),
    }
  }

  // Modern space syntax
  const modernMatch = pattern.match(MODERN_SPACE_PATTERN)
  if (modernMatch) {
    const [, toolName, arg] = modernMatch
    return {
      toolName,
      pattern,
      regex: patternToRegex(arg),
    }
  }

  return null
}

function generateSplitSubcommands(): string {
  // Generate bash function using string array to avoid template literal escaping issues
  // Note: backtick command substitution is not supported (Claude Code uses $() exclusively)
  const lines = [
    '# Split shell command into subcommands (pipes, chains, substitutions)',
    'split_subcommands() {',
    '  local cmd="$1"',
    '',
    '  # Extract $() contents and output them separately',
    "  local extracted=$(printf '%s' \"$cmd\" | grep -oE '\\$\\([^)]+\\)' | sed 's/^\\$(//' | sed 's/)$//')",
    '',
    '  # Remove $() and <() blocks from main command',
    "  local cleaned=$(printf '%s' \"$cmd\" | sed -E 's/\\$\\([^)]*\\)//g; s/<\\([^)]*\\)//g')",
    '',
    '  # Remove subshell parens and brace groups',
    "  cleaned=$(printf '%s' \"$cleaned\" | sed -E 's/^[[:space:]]*\\(//; s/\\)[[:space:]]*$//; s/^[[:space:]]*\\{//; s/\\}[[:space:]]*$//')",
    '',
    '  # Replace operators with newlines (multi-char first)',
    "  cleaned=$(printf '%s' \"$cleaned\" | sed 's/&&/\\n/g' | sed 's/||/\\n/g' | sed 's/|/\\n/g' | sed 's/;/\\n/g')",
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

export function generateEnforceScript(denyRules: readonly string[]): string {
  const parsedRules = denyRules
    .map(parseDenyPattern)
    .filter((r): r is DenyRule => r !== null)

  // Group by tool name
  const byTool = new Map<string, DenyRule[]>()
  for (const rule of parsedRules) {
    const existing = byTool.get(rule.toolName) ?? []
    byTool.set(rule.toolName, [...existing, rule])
  }

  const hasBashRules = byTool.has('Bash')
  const toolChecks: string[] = []

  for (const [toolName, rules] of byTool) {
    if (toolName === 'Bash') {
      // Bash rules: split subcommands and check each one
      // Use regex variables for macOS bash 3.2 compatibility
      const regexVars = rules.map((r, i) => `  re_bash_${i}='^${r.regex}'`)
      const conditions = rules.map((_r, i) =>
        `      [[ "$subcmd" =~ $re_bash_${i} ]]`
      )

      toolChecks.push(`if [ "$TOOL_NAME" = "Bash" ]; then
  command=$(printf '%s' "$input" | jq -r '.tool_input.command // ""')
${regexVars.join('\n')}
  while IFS= read -r subcmd; do
    subcmd=$(printf '%s' "$subcmd" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    [ -z "$subcmd" ] && continue
    if
${conditions.join(' ||\n')}
    then
      reason="BLOCKED by enforce-permissions: deny rule matched for Bash (subcmd: $subcmd)"
      jq -n --arg reason "$reason" '{
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: $reason
        }
      }'
      echo "$reason" >&2
      exit 2
    fi
  done < <(split_subcommands "$command")
fi`)
    } else {
      // Non-Bash rules: direct check (no subcommand splitting)
      // Use regex variables for macOS bash 3.2 compatibility
      const toolPrefix = toolName.toLowerCase()
      const regexVars: string[] = []
      const conditions = rules.map((r, i) => {
        if (toolName === 'Read' || toolName === 'Write' || toolName === 'Edit') {
          regexVars.push(`  re_${toolPrefix}_${i}='${r.regex}'`)
          return `    [[ "$file_path" =~ $re_${toolPrefix}_${i} ]]`
        }
        regexVars.push(`  re_${toolPrefix}_${i}='${r.regex}'`)
        return `    [[ "$tool_input" =~ $re_${toolPrefix}_${i} ]]`
      })

      const inputExtraction = toolName === 'Read' || toolName === 'Write' || toolName === 'Edit'
        ? '  file_path=$(printf \'%s\' "$input" | jq -r \'.tool_input.file_path // ""\')'
        : '  tool_input=$(printf \'%s\' "$input")'

      toolChecks.push(`if [ "$TOOL_NAME" = "${toolName}" ]; then
${inputExtraction}
${regexVars.join('\n')}
  if
${conditions.join(' ||\n')}
  then
    reason="BLOCKED by enforce-permissions: deny rule matched for ${toolName}"
    jq -n --arg reason "$reason" '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: $reason
      }
    }'
    echo "$reason" >&2
    exit 2
  fi
fi`)
    }
  }

  const splitFn = hasBashRules ? `\n${generateSplitSubcommands()}\n` : ''

  return `#!/bin/bash
# Auto-generated by claude-settings-guard
# Layer 2: PreToolUse enforcement hook
# Reads deny rules and independently blocks matching tool calls
# This is a backup for settings.json deny rules that may not work due to bugs

input=$(cat)
${splitFn}
${toolChecks.join('\n\n')}

exit 0
`
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
