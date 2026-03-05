import { LEGACY_COLON_PATTERN, MODERN_SPACE_PATTERN } from '../constants.js'

export interface DenyRule {
  readonly toolName: string
  readonly pattern: string
  readonly regex: string
}

function assertSafePattern(pattern: string): void {
  if (/[`$;|&\n\r'"\\]/.test(pattern)) {
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

export function parseDenyPattern(pattern: string): DenyRule | null {
  const legacyMatch = pattern.match(LEGACY_COLON_PATTERN)
  if (legacyMatch) {
    const [, toolName, arg] = legacyMatch
    return { toolName, pattern, regex: patternToRegex(`${arg} *`) }
  }

  const modernMatch = pattern.match(MODERN_SPACE_PATTERN)
  if (modernMatch) {
    const [, toolName, arg] = modernMatch
    return { toolName, pattern, regex: patternToRegex(arg) }
  }

  return null
}

export function groupRulesByTool(denyRules: readonly string[]): ReadonlyMap<string, readonly DenyRule[]> {
  const result = new Map<string, DenyRule[]>()

  for (const rule of denyRules) {
    const parsed = parseDenyPattern(rule)
    if (!parsed) continue
    const existing = result.get(parsed.toolName) ?? []
    result.set(parsed.toolName, [...existing, parsed])
  }

  return result
}

function generateDenyResponse(toolName: string): string {
  return `    reason="BLOCKED by enforce-permissions: deny rule matched for ${toolName}"
    jq -n --arg reason "$reason" '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: $reason
      }
    }'
    echo "$reason" >&2
    exit 2`
}

export function generateBashToolCheck(rules: readonly DenyRule[]): string {
  const regexVars = rules.map((r, i) => `  re_bash_${i}='^${r.regex}'`)
  const conditions = rules.map((_r, i) =>
    `      [[ "$subcmd" =~ $re_bash_${i} ]]`
  )

  return `if [ "$TOOL_NAME" = "Bash" ]; then
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
fi`
}

export function generateNonBashToolCheck(toolName: string, rules: readonly DenyRule[]): string {
  if (!/^\w+$/.test(toolName)) {
    throw new Error(`Invalid tool name: ${toolName}`)
  }
  const toolPrefix = toolName.toLowerCase()
  const usesFilePath = toolName === 'Read' || toolName === 'Write' || toolName === 'Edit'

  const regexVars = rules.map((r, i) =>
    `  re_${toolPrefix}_${i}='${r.regex}'`
  )

  const varName = usesFilePath ? 'file_path' : 'tool_input'
  const conditions = rules.map((_r, i) =>
    `    [[ "$${varName}" =~ $re_${toolPrefix}_${i} ]]`
  )

  const inputExtraction = usesFilePath
    ? `  file_path=$(printf '%s' "$input" | jq -r '.tool_input.file_path // ""')`
    : `  tool_input=$(printf '%s' "$input")`

  return `if [ "$TOOL_NAME" = "${toolName}" ]; then
${inputExtraction}
${regexVars.join('\n')}
  if
${conditions.join(' ||\n')}
  then
${generateDenyResponse(toolName)}
  fi
fi`
}
