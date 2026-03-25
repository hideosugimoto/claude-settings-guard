import { execSync } from 'node:child_process'
import { detectProject } from './project-detector.js'

export interface EnvironmentSuggestion {
  readonly entries: readonly string[]
  readonly gitRemote: string | null
  readonly projectType: string | null
}

const PROJECT_TYPE_LABELS: Readonly<Record<string, string>> = {
  nodejs: 'TypeScript/Node.js',
  rust: 'Rust',
  go: 'Go',
  python: 'Python',
  ruby: 'Ruby',
  java: 'Java',
}

/**
 * Detect the git remote URL for the current project.
 */
function detectGitRemote(cwd: string): string | null {
  try {
    const output = execSync('git remote get-url origin 2>/dev/null', {
      encoding: 'utf-8',
      timeout: 5000,
      cwd,
    }).trim()
    if (!output) return null

    // Extract org/host from various URL formats
    // https://github.com/org/repo.git → github.com/org
    // git@github.com:org/repo.git → github.com/org
    const httpsMatch = output.match(/https?:\/\/([^/]+)\/([^/]+)/)
    if (httpsMatch) return `${httpsMatch[1]}/${httpsMatch[2]}`

    const sshMatch = output.match(/@([^:]+):([^/]+)/)
    if (sshMatch) return `${sshMatch[1]}/${sshMatch[2]}`

    return null
  } catch {
    return null
  }
}

/**
 * Generate autoMode.environment suggestion based on project context.
 */
export async function generateEnvironmentSuggestion(cwd: string): Promise<EnvironmentSuggestion> {
  const project = await detectProject(cwd)
  const gitRemote = detectGitRemote(cwd)

  const entries: string[] = []

  const typeLabel = project.detectedType
    ? PROJECT_TYPE_LABELS[project.detectedType] ?? project.detectedType
    : null

  if (typeLabel) {
    entries.push(`Organization: (your org). Primary use: ${typeLabel} development`)
  } else {
    entries.push('Organization: (your org). Primary use: software development')
  }

  if (gitRemote) {
    entries.push(`Source control: ${gitRemote}`)
  } else {
    entries.push('Source control: (your git hosting org, e.g. github.com/your-org)')
  }

  return {
    entries,
    gitRemote,
    projectType: project.detectedType,
  }
}
