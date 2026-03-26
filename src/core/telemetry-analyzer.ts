import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { getTelemetryDir } from '../utils/paths.js'
import {
  RECOMMEND_ALLOW_THRESHOLD,
  RECOMMEND_DENY_THRESHOLD,
  FILE_READ_COMMANDS,
  FILE_WRITE_COMMANDS,
  PREFIX_COMMANDS,
} from '../constants.js'
import type { TelemetryEvent, Recommendation } from '../types.js'
import { groupStatsByPrefix } from './pattern-grouper.js'

export function isTelemetryEvent(value: unknown): value is TelemetryEvent {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  if (typeof obj.event_type !== 'string') return false
  if (typeof obj.event_data !== 'object' || obj.event_data === null) return false
  const eventData = obj.event_data as Record<string, unknown>
  return (
    typeof eventData.event_name === 'string' &&
    typeof eventData.client_timestamp === 'string'
  )
}

export interface ToolStats {
  readonly tool: string
  readonly pattern: string
  readonly allowed: number
  readonly denied: number
  readonly prompted: number
}

function parseToolFromEvent(event: TelemetryEvent): { tool: string; pattern: string } | null {
  const meta = event.event_data.additional_metadata
  if (!meta) return null

  try {
    const parsed = typeof meta === 'string' ? JSON.parse(meta) : meta
    const tool = parsed.tool_name ?? parsed.toolName
    if (!tool) return null

    // Claude Code telemetry does not include the specific Bash command
    // in permission events — only the tool name (e.g. "Bash", "Edit").
    // For Bash, we return the bare tool name.
    const command = parsed.tool_command ?? parsed.command ?? ''
    const pattern = command ? `${tool}(${command})` : tool
    return { tool, pattern }
  } catch {
    return null
  }
}

// Claude Code telemetry event names for permission decisions.
// Only match events that represent actual permission decisions,
// not progress/success/error events.
const PERMISSION_EVENT_NAMES = new Set([
  'tengu_tool_use_granted_in_prompt_temporary',
  'tengu_tool_use_granted_in_prompt_permanent',
  'tengu_tool_use_denied_in_config',
  'tengu_tool_use_rejected_in_prompt',
  'tengu_tool_use_can_use_tool_rejected',
  'tengu_tool_use_show_permission_request',
  'tengu_tool_use_granted_by_permission_hook',
])

function isPermissionEvent(event: TelemetryEvent): boolean {
  return PERMISSION_EVENT_NAMES.has(event.event_data.event_name)
}

function getEventDecision(event: TelemetryEvent): 'allowed' | 'denied' | 'prompted' | null {
  const name = event.event_data.event_name
  switch (name) {
    // User manually approved in prompt
    case 'tengu_tool_use_granted_in_prompt_temporary':
    case 'tengu_tool_use_granted_in_prompt_permanent':
    case 'tengu_tool_use_granted_by_permission_hook':
      return 'allowed'
    // Denied by config or rejected by user
    case 'tengu_tool_use_denied_in_config':
    case 'tengu_tool_use_rejected_in_prompt':
    case 'tengu_tool_use_can_use_tool_rejected':
      return 'denied'
    // Permission dialog was shown
    case 'tengu_tool_use_show_permission_request':
      return 'prompted'
    default:
      return null
  }
}

export interface TelemetryLoadResult {
  readonly events: readonly TelemetryEvent[]
  readonly skippedLines: number
}

export async function loadTelemetryEvents(): Promise<TelemetryLoadResult> {
  const telemetryDir = getTelemetryDir()
  let files: string[]

  try {
    files = await readdir(telemetryDir)
  } catch {
    return { events: [], skippedLines: 0 }
  }

  const eventFiles = files.filter(f => f.startsWith('1p_failed_events.') && f.endsWith('.json'))
  const events: TelemetryEvent[] = []
  let skippedLines = 0

  for (const file of eventFiles) {
    try {
      const content = await readFile(join(telemetryDir, file), 'utf-8')
      const lines = content.trim().split('\n')
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const parsed: unknown = JSON.parse(line)
          if (isTelemetryEvent(parsed)) {
            events.push(parsed)
          } else {
            skippedLines++
          }
        } catch {
          skippedLines++
        }
      }
    } catch {
      // skip unreadable files — not counted as skipped lines
    }
  }

  return { events, skippedLines }
}

export function analyzePermissionEvents(
  events: readonly TelemetryEvent[]
): ReadonlyMap<string, ToolStats> {
  const statsMap = new Map<string, ToolStats>()

  for (const event of events) {
    if (!isPermissionEvent(event)) continue

    const toolInfo = parseToolFromEvent(event)
    if (!toolInfo) continue

    const decision = getEventDecision(event)
    if (!decision) continue

    const existing = statsMap.get(toolInfo.pattern)
    if (existing) {
      const updated: ToolStats = {
        ...existing,
        [decision]: existing[decision] + 1,
      }
      statsMap.set(toolInfo.pattern, updated)
    } else {
      const newStats: ToolStats = {
        tool: toolInfo.tool,
        pattern: toolInfo.pattern,
        allowed: decision === 'allowed' ? 1 : 0,
        denied: decision === 'denied' ? 1 : 0,
        prompted: decision === 'prompted' ? 1 : 0,
      }
      statsMap.set(toolInfo.pattern, newStats)
    }
  }

  return statsMap
}

export function getAnalysisPeriod(
  events: readonly TelemetryEvent[]
): { earliest: string; latest: string } | null {
  if (events.length === 0) return null

  const timestamps = events
    .map(event => event.event_data.client_timestamp)
    .filter((timestamp): timestamp is string => Boolean(timestamp))
    .sort()

  if (timestamps.length === 0) return null
  return { earliest: timestamps[0], latest: timestamps[timestamps.length - 1] }
}


/**
 * Check if a Bash allow pattern would create a cross-tool bypass
 * against existing deny rules.
 */
function wouldBypassDenyRules(
  bashPattern: string,
  existingDeny: readonly string[],
): boolean {
  const match = bashPattern.match(/^Bash\((\S+)/)
  if (!match) return false
  const cmd = match[1].toLowerCase()

  const hasReadDeny = existingDeny.some(d => d.startsWith('Read(') || d.startsWith('Grep('))
  const hasWriteDeny = existingDeny.some(d => d.startsWith('Write('))
  const hasEditDeny = existingDeny.some(d => d.startsWith('Edit('))
  const hasBashDeny = existingDeny.some(d => d.startsWith('Bash('))

  // Cross-tool file bypass: read commands vs Read deny
  if (FILE_READ_COMMANDS.has(cmd) && hasReadDeny) return true
  // Cross-tool file bypass: write commands vs Write/Edit deny
  if (FILE_WRITE_COMMANDS.has(cmd) && (hasWriteDeny || hasEditDeny)) return true
  // Prefix bypass: prefix commands vs Bash deny
  if (PREFIX_COMMANDS.has(cmd) && hasBashDeny) return true

  return false
}

export function generateRecommendations(
  stats: ReadonlyMap<string, ToolStats>,
  existingAllow: readonly string[],
  existingDeny: readonly string[]
): readonly Recommendation[] {
  const recommendations: Recommendation[] = []
  const allowSet = new Set(existingAllow)
  const denySet = new Set(existingDeny)
  const grouped = groupStatsByPrefix(stats)

  for (const stat of grouped) {
    if (allowSet.has(stat.wildcardPattern) || denySet.has(stat.wildcardPattern)) continue

    const groupedSuffix = stat.exactPatterns.length >= 3
      ? ` (${stat.exactPatterns.length} subcommands grouped)`
      : ''

    if (stat.totalAllowed >= RECOMMEND_ALLOW_THRESHOLD && stat.totalDenied === 0) {
      // C1: Skip allow recommendations that would bypass deny rules
      if (wouldBypassDenyRules(stat.wildcardPattern, existingDeny)) continue

      recommendations.push({
        action: 'add-allow',
        pattern: stat.wildcardPattern,
        reason: `${stat.totalAllowed} times allowed, never denied${groupedSuffix}`,
        stats: {
          allowed: stat.totalAllowed,
          denied: stat.totalDenied,
          prompted: stat.totalPrompted,
        },
      })
    } else if (stat.totalDenied >= RECOMMEND_DENY_THRESHOLD && stat.totalAllowed === 0) {
      recommendations.push({
        action: 'add-deny',
        pattern: stat.wildcardPattern,
        reason: `${stat.totalDenied} times denied, never allowed${groupedSuffix}`,
        stats: {
          allowed: stat.totalAllowed,
          denied: stat.totalDenied,
          prompted: stat.totalPrompted,
        },
      })
    }
  }

  // Sort by total events descending
  return recommendations.sort((a, b) => {
    const aTotal = (a.stats?.allowed ?? 0) + (a.stats?.denied ?? 0)
    const bTotal = (b.stats?.allowed ?? 0) + (b.stats?.denied ?? 0)
    return bTotal - aTotal
  })
}
