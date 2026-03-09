export type BypassTechnique =
  | 'pipe_chain'
  | 'semicolon_chain'
  | 'and_chain'
  | 'or_chain'
  | 'command_substitution'
  | 'process_substitution'
  | 'subshell'
  | 'brace_group'
  | 'env_variable_expansion'
  | 'eval_exec'
  | 'encoding_tricks'
  | 'background_exec'

export interface BypassRisk {
  readonly technique: BypassTechnique
  readonly description: string
  readonly example: string
  readonly severity: 'low' | 'medium' | 'high' | 'critical'
  readonly mitigatedByHook: boolean
}

export interface RuleAnalysis {
  readonly rule: string
  readonly bypasses: readonly BypassRisk[]
  readonly hasEnforceHook: boolean
}

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'

export interface RiskAssessment {
  readonly overallRiskLevel: RiskLevel
  readonly denyRulesAnalyzed: number
  readonly ruleAnalysis: readonly RuleAnalysis[]
  readonly mitigations: {
    readonly layer2HookInstalled: boolean
    readonly splitSubcommandsEnabled: boolean
    readonly hookedTechniques: readonly string[]
    readonly unhookedTechniques: readonly string[]
  }
  readonly suggestions: readonly {
    readonly priority: RiskLevel
    readonly action: string
    readonly description: string
    readonly command?: string
  }[]
}

interface TechniqueMeta {
  readonly technique: BypassTechnique
  readonly description: string
  readonly severity: 'low' | 'medium' | 'high' | 'critical'
}

const HOOKED_TECHNIQUES: ReadonlySet<BypassTechnique> = new Set<BypassTechnique>([
  'pipe_chain',
  'semicolon_chain',
  'and_chain',
  'or_chain',
  'command_substitution',
  'process_substitution',
  'subshell',
  'brace_group',
])

const UNHOOKED_TECHNIQUES: readonly BypassTechnique[] = [
  'env_variable_expansion',
  'eval_exec',
  'encoding_tricks',
  'background_exec',
]

const ALL_TECHNIQUES: readonly TechniqueMeta[] = [
  { technique: 'pipe_chain', description: 'Use a pipe to hide a denied command in a chain.', severity: 'high' },
  { technique: 'semicolon_chain', description: 'Use semicolon command chaining to bypass a direct match.', severity: 'high' },
  { technique: 'and_chain', description: 'Use && to execute denied command after a benign command.', severity: 'high' },
  { technique: 'or_chain', description: 'Use || fallback execution to trigger denied command.', severity: 'medium' },
  { technique: 'command_substitution', description: 'Execute denied command inside $() substitution.', severity: 'high' },
  { technique: 'process_substitution', description: 'Execute denied command inside <() process substitution.', severity: 'high' },
  { technique: 'subshell', description: 'Run denied command inside a subshell group.', severity: 'medium' },
  { technique: 'brace_group', description: 'Run denied command inside a brace command group.', severity: 'medium' },
  { technique: 'env_variable_expansion', description: 'Resolve denied command via shell variable expansion.', severity: 'critical' },
  { technique: 'eval_exec', description: 'Build denied command as a string and execute through eval.', severity: 'critical' },
  { technique: 'encoding_tricks', description: 'Use encoded payloads that decode at runtime before execution.', severity: 'critical' },
  { technique: 'background_exec', description: 'Run denied command in background to avoid visible chain context.', severity: 'medium' },
]

function isBashRule(rule: string): boolean {
  return /^Bash\(.*\)$/.test(rule)
}

function extractCommandFromRule(rule: string): string {
  const match = /^Bash\((.*)\)$/.exec(rule)
  const command = match?.[1]?.trim() ?? ''
  if (!command) return 'sh -c "echo blocked"'

  return command.includes('*') ? command.replace(/\*/g, 'dangerous-cmd').replace(/\s+/g, ' ').trim() : command
}

function toEnvExpansionExample(command: string): string {
  const [root, ...rest] = command.split(/\s+/).filter(Boolean)
  if (!root) return 'CMD=sh; $CMD -c "echo blocked"'
  const restPart = rest.length > 0 ? ` ${rest.join(' ')}` : ''
  return `CMD=${root}; $CMD${restPart}`
}

function toEncodingExample(command: string): string {
  return `echo '${command}' | base64 | base64 -d | bash`
}

function exampleForTechnique(technique: BypassTechnique, command: string): string {
  switch (technique) {
    case 'pipe_chain':
      return `echo x | ${command}`
    case 'semicolon_chain':
      return `echo ok; ${command}`
    case 'and_chain':
      return `echo ok && ${command}`
    case 'or_chain':
      return `false || ${command}`
    case 'command_substitution':
      return `echo $(${command})`
    case 'process_substitution':
      return `cat <(${command})`
    case 'subshell':
      return `(${command})`
    case 'brace_group':
      return `{ ${command}; }`
    case 'env_variable_expansion':
      return toEnvExpansionExample(command)
    case 'eval_exec':
      return `eval "${command}"`
    case 'encoding_tricks':
      return toEncodingExample(command)
    case 'background_exec':
      return `${command} &`
  }
}

function hasUnhookedRisks(ruleAnalysis: readonly RuleAnalysis[]): boolean {
  return ruleAnalysis.some(entry =>
    entry.bypasses.some(risk => !risk.mitigatedByHook)
  )
}

function createSuggestions(
  hasBashDenyRules: boolean,
  enforceHookInstalled: boolean,
  hasUnhooked: boolean
): RiskAssessment['suggestions'] {
  if (!hasBashDenyRules) {
    return [
      {
        priority: 'low',
        action: 'No immediate bypass risk',
        description: 'No Bash deny rules were found, so shell bypass analysis is not applicable.',
      },
    ]
  }

  if (!enforceHookInstalled) {
    return [
      {
        priority: 'critical',
        action: 'Install Layer 2 enforce hook',
        description: 'Install the PreToolUse enforcement hook to split and evaluate chained shell subcommands.',
        command: 'npx claude-settings-guard enforce',
      },
      {
        priority: 'high',
        action: 'Re-run risk assessment',
        description: 'Re-check bypass exposure after installing the hook.',
        command: 'csg_assess_risk',
      },
    ]
  }

  if (hasUnhooked) {
    return [
      {
        priority: 'medium',
        action: 'Harden shell execution policy',
        description: 'Layer 2 hook covers command chaining but does not fully prevent eval/encoding/variable indirection patterns.',
      },
      {
        priority: 'medium',
        action: 'Restrict high-risk primitives',
        description: 'Add deny rules for risky shells or interpreters (for example: Bash(eval *), Bash(base64 *)).',
      },
    ]
  }

  return [
    {
      priority: 'low',
      action: 'Maintain current mitigations',
      description: 'Current hook coverage mitigates known chaining and substitution bypass techniques.',
    },
  ]
}

export function analyzeBypassRisks(
  denyRules: readonly string[],
  enforceHookInstalled: boolean
): RiskAssessment {
  const bashRules = denyRules.filter(isBashRule)

  const ruleAnalysis: RuleAnalysis[] = bashRules.map(rule => {
    const command = extractCommandFromRule(rule)
    const bypasses: BypassRisk[] = ALL_TECHNIQUES.map(meta => {
      const mitigatedByHook = enforceHookInstalled && HOOKED_TECHNIQUES.has(meta.technique)
      return {
        technique: meta.technique,
        description: meta.description,
        example: exampleForTechnique(meta.technique, command),
        severity: meta.severity,
        mitigatedByHook,
      }
    })

    return {
      rule,
      bypasses,
      hasEnforceHook: enforceHookInstalled,
    }
  })

  const hasBashDenyRules = bashRules.length > 0
  const unhooked = hasUnhookedRisks(ruleAnalysis)

  const overallRiskLevel: RiskLevel =
    !enforceHookInstalled && hasBashDenyRules ? 'critical'
    : enforceHookInstalled && unhooked ? 'medium'
    : 'low'

  return {
    overallRiskLevel,
    denyRulesAnalyzed: bashRules.length,
    ruleAnalysis,
    mitigations: {
      layer2HookInstalled: enforceHookInstalled,
      splitSubcommandsEnabled: enforceHookInstalled,
      hookedTechniques: [...HOOKED_TECHNIQUES],
      unhookedTechniques: UNHOOKED_TECHNIQUES,
    },
    suggestions: createSuggestions(hasBashDenyRules, enforceHookInstalled, unhooked),
  }
}
