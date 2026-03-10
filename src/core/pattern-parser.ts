import {
  KNOWN_TOOLS,
  LEGACY_COLON_PATTERN,
  MODERN_SPACE_PATTERN,
  BARE_TOOL_PATTERN,
  MCP_TOOL_PATTERN,
} from '../constants.js'
import type { PermissionRule } from '../types.js'

export function parsePattern(
  pattern: string,
  source: PermissionRule['source']
): PermissionRule {
  // Bare tool name: "Read", "Write", etc.
  const bareMatch = pattern.match(BARE_TOOL_PATTERN)
  if (bareMatch && !pattern.includes('(')) {
    return {
      pattern,
      source,
      isLegacy: false,
      toolName: bareMatch[1],
    }
  }

  // MCP tool: "mcp__server__tool"
  if (MCP_TOOL_PATTERN.test(pattern)) {
    return {
      pattern,
      source,
      isLegacy: false,
      toolName: pattern,
    }
  }

  // Legacy colon syntax: "Bash(npm:*)"
  const legacyMatch = pattern.match(LEGACY_COLON_PATTERN)
  if (legacyMatch) {
    return {
      pattern,
      source,
      isLegacy: true,
      toolName: legacyMatch[1],
      argument: `${legacyMatch[2]}:${legacyMatch[3]}`,
    }
  }

  // Modern space syntax: "Bash(npm *)" or "Read(**/.env)"
  const modernMatch = pattern.match(MODERN_SPACE_PATTERN)
  if (modernMatch) {
    return {
      pattern,
      source,
      isLegacy: false,
      toolName: modernMatch[1],
      argument: modernMatch[2],
    }
  }

  // Fallback: treat as unknown
  return {
    pattern,
    source,
    isLegacy: false,
    toolName: pattern,
  }
}

export function isLegacySyntax(pattern: string): boolean {
  return LEGACY_COLON_PATTERN.test(pattern)
}

export function isValidToolName(name: string): boolean {
  if (MCP_TOOL_PATTERN.test(name)) return true
  return (KNOWN_TOOLS as readonly string[]).includes(name)
}
