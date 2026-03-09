import { access } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { join } from 'node:path'

export interface ProjectContext {
  readonly detectedType: string | null
  readonly indicators: readonly string[]
  readonly suggestedToolPatterns: readonly string[]
}

interface MarkerRule {
  readonly marker: string
  readonly type: ProjectContext['detectedType']
  readonly indicator: string
  readonly suggestedToolPatterns: readonly string[]
}

const MARKER_RULES: readonly MarkerRule[] = [
  {
    marker: 'package.json',
    type: 'nodejs',
    indicator: 'package.json found',
    suggestedToolPatterns: ['Bash(npm *)', 'Bash(npx *)', 'Bash(node *)'],
  },
  {
    marker: 'tsconfig.json',
    type: null,
    indicator: 'tsconfig.json found',
    suggestedToolPatterns: [],
  },
  {
    marker: 'Cargo.toml',
    type: 'rust',
    indicator: 'Cargo.toml found',
    suggestedToolPatterns: ['Bash(cargo *)'],
  },
  {
    marker: 'go.mod',
    type: 'go',
    indicator: 'go.mod found',
    suggestedToolPatterns: ['Bash(go *)'],
  },
  {
    marker: 'pyproject.toml',
    type: 'python',
    indicator: 'pyproject.toml found',
    suggestedToolPatterns: ['Bash(pip *)', 'Bash(python *)'],
  },
  {
    marker: 'requirements.txt',
    type: 'python',
    indicator: 'requirements.txt found',
    suggestedToolPatterns: ['Bash(pip *)', 'Bash(python *)'],
  },
  {
    marker: 'setup.py',
    type: 'python',
    indicator: 'setup.py found',
    suggestedToolPatterns: ['Bash(pip *)', 'Bash(python *)'],
  },
  {
    marker: 'Gemfile',
    type: 'ruby',
    indicator: 'Gemfile found',
    suggestedToolPatterns: ['Bash(gem *)', 'Bash(bundle *)'],
  },
  {
    marker: 'pom.xml',
    type: 'java',
    indicator: 'pom.xml found',
    suggestedToolPatterns: ['Bash(mvn *)', 'Bash(gradle *)'],
  },
  {
    marker: 'build.gradle',
    type: 'java',
    indicator: 'build.gradle found',
    suggestedToolPatterns: ['Bash(mvn *)', 'Bash(gradle *)'],
  },
]

async function markerExists(cwd: string, marker: string): Promise<boolean> {
  try {
    await access(join(cwd, marker), fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

export async function detectProject(cwd: string): Promise<ProjectContext> {
  const existence = await Promise.all(
    MARKER_RULES.map(async rule => ({ rule, exists: await markerExists(cwd, rule.marker) }))
  )

  const found = existence.filter(entry => entry.exists).map(entry => entry.rule)
  const indicators = found.map(rule => rule.indicator)

  const detected = found.find(rule => rule.type !== null) ?? null

  return {
    detectedType: detected?.type ?? null,
    indicators,
    suggestedToolPatterns: detected?.suggestedToolPatterns ?? [],
  }
}
