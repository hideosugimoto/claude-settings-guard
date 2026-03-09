import { LEGACY_COLON_PATTERN, MODERN_SPACE_PATTERN, SAFE_ENV_SUFFIXES } from '../constants.js'

export interface DenyRule {
  readonly toolName: string
  readonly pattern: string
  readonly regex: string
}

const UNSAFE_CHAR_DESCRIPTIONS: ReadonlyMap<string, string> = new Map([
  ['`', 'backtick (command substitution)'],
  ['$', 'dollar sign (variable/command expansion)'],
  [';', 'semicolon (command chaining)'],
  ['|', 'pipe (command piping)'],
  ['&', 'ampersand (background/chaining)'],
  ['\n', 'newline'],
  ['\r', 'carriage return'],
  ["'", 'single quote (shell escape)'],
  ['"', 'double quote (shell escape)'],
  ['\\', 'backslash (escape character)'],
  ['!', 'exclamation mark (history expansion)'],
  ['{', 'open brace (brace expansion)'],
  ['}', 'close brace (brace expansion)'],
])

function assertSafePattern(pattern: string): void {
  const match = pattern.match(/[`$;|&\n\r'"\\!{}]/)
  if (match) {
    const char = match[0]
    const desc = UNSAFE_CHAR_DESCRIPTIONS.get(char) ?? `character '${char}'`
    throw new Error(
      `Deny pattern contains unsafe shell characters: pattern "${pattern}" has ${desc}`
    )
  }
}

function patternToRegex(pattern: string): string {
  assertSafePattern(pattern)
  const regex = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '<<GLOBSTAR>>')
    .replace(/\*/g, '.*')
    .replace(/<<GLOBSTAR>>/g, '.*')
    .replace(/\?/g, '.')
  return regex + '$'
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
    const isDuplicate = existing.some(r => r.regex === parsed.regex)
    if (!isDuplicate) {
      result.set(parsed.toolName, [...existing, parsed])
    }
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

function generateSafeEnvExclusionLines(): string[] {
  const suffixes = SAFE_ENV_SUFFIXES.map(s => `"${s}"`).join(' ')
  return [
    `  # Exclude safe .env suffixes (e.g. .env.example, .env.sample)`,
    `  safe_env_suffixes=(${suffixes})`,
    `  is_safe_env=false`,
    `  for suffix in "\${safe_env_suffixes[@]}"; do`,
    `    if [[ "$file_path" == *".env.$suffix" ]]; then`,
    `      is_safe_env=true`,
    `      break`,
    `    fi`,
    `  done`,
    `  if [ "$is_safe_env" = true ]; then`,
    `    # Allow safe .env files to pass through`,
    `    :`,
    `  elif`,
  ]
}

export function generateBashToolCheck(rules: readonly DenyRule[]): string {
  const regexVars = rules.map((r, i) => `  re_bash_${i}='^${r.regex}'`)
  const conditions = rules.map((_r, i) =>
    `      [[ "$subcmd" =~ $re_bash_${i} ]]`
  )

  return `if [[ "$TOOL_NAME_LOWER" == "bash" ]]; then
  command=$(printf '%s' "$input" | jq -r '.tool_input.command // ""')
${regexVars.join('\n')}
  while IFS= read -r subcmd; do
    subcmd=$(printf '%s' "$subcmd" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    [ -z "$subcmd" ] && continue
    # Normalize: collapse whitespace, strip path prefix, strip prefix commands
    subcmd=$(printf '%s' "$subcmd" | sed -E 's/[[:space:]]+/ /g')
    subcmd=$(printf '%s' "$subcmd" | sed -E 's|^/[^ ]*/||')
    subcmd=$(strip_prefix_commands "$subcmd")
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

  const filePathExtraction = [
    `  file_path=$(printf '%s' "$input" | jq -r '.tool_input.file_path // ""')`,
    `  file_path=$(printf '%s' "$file_path" | tr '[:upper:]' '[:lower:]')`,
  ].join('\n')

  const inputExtraction = usesFilePath
    ? filePathExtraction
    : `  tool_input=$(printf '%s' "$input")`

  const lines: string[] = [
    `if [[ "$TOOL_NAME_LOWER" == "${toolPrefix}" ]]; then`,
    inputExtraction,
    ...regexVars,
  ]

  if (usesFilePath) {
    lines.push(...generateSafeEnvExclusionLines())
  } else {
    lines.push('  if')
  }

  lines.push(conditions.join(' ||\n'))
  lines.push('  then')
  lines.push(generateDenyResponse(toolName))
  lines.push('  fi')
  lines.push('fi')

  return lines.join('\n')
}
