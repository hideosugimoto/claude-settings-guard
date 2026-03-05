import { z } from 'zod'

// --- Zod Schemas ---

const hookEntrySchema = z.object({
  type: z.string(),
  command: z.string(),
}).passthrough()

const hookRuleSchema = z.object({
  matcher: z.string(),
  hooks: z.array(hookEntrySchema),
}).passthrough()

const permissionsSchema = z.object({
  allow: z.array(z.string()).optional(),
  deny: z.array(z.string()).optional(),
  ask: z.array(z.string()).optional(),
}).passthrough()

export const claudeSettingsSchema = z.object({
  permissions: permissionsSchema.optional(),
  hooks: z.record(z.array(hookRuleSchema)).optional(),
  deny: z.array(z.string()).optional(),
  allowedTools: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  language: z.string().optional(),
  PreToolUse: z.array(hookRuleSchema).optional(),
  PostToolUse: z.array(hookRuleSchema).optional(),
  Stop: z.array(hookRuleSchema).optional(),
  PreCompact: z.array(hookRuleSchema).optional(),
  SessionStart: z.array(hookRuleSchema).optional(),
  statusLine: z.unknown().optional(),
}).passthrough()

export type ClaudeSettings = z.infer<typeof claudeSettingsSchema>

// --- Domain Types ---

export interface PermissionRule {
  readonly pattern: string
  readonly source: 'allow' | 'deny' | 'ask' | 'allowedTools'
  readonly isLegacy: boolean
  readonly toolName: string
  readonly argument?: string
}

export type Severity = 'critical' | 'warning' | 'info'
export type IssueCode = 'LEGACY_SYNTAX' | 'STRUCTURE_ISSUE' | 'CONFLICT' | 'INVALID_TOOL' | 'INVALID_PATTERN'

export interface DiagnosticIssue {
  readonly severity: Severity
  readonly code: IssueCode
  readonly message: string
  readonly details?: readonly string[]
  readonly fix?: string
}

export type RecommendAction = 'add-allow' | 'add-deny' | 'remove' | 'migrate'

export interface Recommendation {
  readonly action: RecommendAction
  readonly pattern: string
  readonly reason: string
  readonly stats?: {
    readonly allowed: number
    readonly denied: number
    readonly prompted: number
  }
}

export interface TelemetryEvent {
  readonly event_type: string
  readonly event_data: {
    readonly event_name: string
    readonly client_timestamp: string
    readonly model?: string
    readonly session_id?: string
    readonly additional_metadata?: string
    readonly [key: string]: unknown
  }
}

export type MigrationType = 'syntax' | 'structure'

export interface MigrationResult {
  readonly original: string
  readonly migrated: string
  readonly type: MigrationType
}

export interface SettingsLayer {
  readonly path: string
  readonly settings: ClaudeSettings
}
