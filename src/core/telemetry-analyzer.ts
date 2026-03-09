import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { getTelemetryDir } from '../utils/paths.js'
import { RECOMMEND_ALLOW_THRESHOLD, RECOMMEND_DENY_THRESHOLD } from '../constants.js'
import type { TelemetryEvent, Recommendation } from '../types.js'
import { groupStatsByPrefix } from './pattern-grouper.js'

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
    const command = parsed.tool_command ?? parsed.command ?? ''

    if (!tool) return null

    const pattern = command ? `${tool}(${command})` : tool
    return { tool, pattern }
  } catch {
    return null
  }
}

function isPermissionEvent(event: TelemetryEvent): boolean {
  const name = event.event_data.event_name
  return name.includes('permission') ||
    name.includes('tool_use') ||
    name.includes('allow') ||
    name.includes('deny')
}

function getEventDecision(event: TelemetryEvent): 'allowed' | 'denied' | 'prompted' | null {
  const name = event.event_data.event_name
  if (name.includes('allowed') || name.includes('approved')) return 'allowed'
  if (name.includes('denied') || name.includes('rejected') || name.includes('blocked')) return 'denied'
  if (name.includes('prompted') || name.includes('asked')) return 'prompted'
  return null
}

export async function loadTelemetryEvents(): Promise<readonly TelemetryEvent[]> {
  const telemetryDir = getTelemetryDir()
  let files: string[]

  try {
    files = await readdir(telemetryDir)
  } catch {
    return []
  }

  const eventFiles = files.filter(f => f.startsWith('1p_failed_events.') && f.endsWith('.json'))
  const events: TelemetryEvent[] = []

  for (const file of eventFiles) {
    try {
      const content = await readFile(join(telemetryDir, file), 'utf-8')
      const lines = content.trim().split('\n')
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const parsed = JSON.parse(line)
          if (
            parsed.event_type &&
            parsed.event_data &&
            typeof parsed.event_data.event_name === 'string' &&
            typeof parsed.event_data.client_timestamp === 'string'
          ) {
            events.push(parsed as TelemetryEvent)
          }
        } catch {
          // skip malformed lines
        }
      }
    } catch {
      // skip unreadable files
    }
  }

  return events
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
