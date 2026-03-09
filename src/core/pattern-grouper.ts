import type { ToolStats } from './telemetry-analyzer.js'

export interface GroupedStats {
  readonly tool: string
  readonly wildcardPattern: string
  readonly exactPatterns: readonly string[]
  readonly totalAllowed: number
  readonly totalDenied: number
  readonly totalPrompted: number
}

const MIN_GROUP_SIZE = 3

const TWO_TOKEN_COMMANDS = new Set([
  'npm', 'yarn', 'pnpm', 'cargo', 'pip', 'gem', 'go', 'git', 'apt',
])

function tokenize(command: string): readonly string[] {
  return command.trim().split(/\s+/).filter(Boolean)
}

function extractToolAndCommand(pattern: string): { tool: string; command: string } | null {
  const match = /^([^()]+)\((.+)\)$/.exec(pattern)
  if (!match) return null
  return { tool: match[1], command: match[2] }
}

function formatWildcardPattern(tool: string, prefix: string): string {
  return `${tool}(${prefix} *)`
}

export function extractPrefix(command: string): string {
  const tokens = tokenize(command)
  if (tokens.length === 0) return ''

  const offset = tokens[0] === 'sudo' && tokens.length > 1 ? 1 : 0
  const root = tokens[offset]
  if (!root) return ''

  const next = tokens[offset + 1]
  if (TWO_TOKEN_COMMANDS.has(root) && next) return `${root} ${next}`
  return root
}

export function groupStatsByPrefix(
  stats: ReadonlyMap<string, ToolStats>
): readonly GroupedStats[] {
  const prefixGroups = new Map<string, ToolStats[]>()

  for (const stat of stats.values()) {
    const parsed = extractToolAndCommand(stat.pattern)
    if (!parsed) continue
    const prefix = extractPrefix(parsed.command)
    if (!prefix) continue
    const key = `${parsed.tool}::${prefix}`
    const list = prefixGroups.get(key) ?? []
    prefixGroups.set(key, [...list, stat])
  }

  const grouped: GroupedStats[] = []
  for (const [key, entries] of prefixGroups) {
    const sepIndex = key.indexOf('::')
    const tool = key.slice(0, sepIndex)
    const prefix = key.slice(sepIndex + 2)
    if (entries.length >= MIN_GROUP_SIZE) {
      grouped.push({
        tool,
        wildcardPattern: formatWildcardPattern(tool, prefix),
        exactPatterns: entries.map(e => e.pattern),
        totalAllowed: entries.reduce((sum, e) => sum + e.allowed, 0),
        totalDenied: entries.reduce((sum, e) => sum + e.denied, 0),
        totalPrompted: entries.reduce((sum, e) => sum + e.prompted, 0),
      })
      continue
    }

    for (const entry of entries) {
      grouped.push({
        tool: entry.tool,
        wildcardPattern: entry.pattern,
        exactPatterns: [entry.pattern],
        totalAllowed: entry.allowed,
        totalDenied: entry.denied,
        totalPrompted: entry.prompted,
      })
    }
  }

  return grouped
}
