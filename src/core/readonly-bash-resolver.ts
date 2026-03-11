import { READ_ONLY_BASH_SAFE, READ_ONLY_BASH_FILE_READERS } from '../constants.js'

export interface ReadOnlyBashResult {
  readonly allowed: readonly string[]
  readonly excluded: readonly string[]
  readonly warnings: readonly string[]
}

export function resolveReadOnlyBashRules(denyRules: readonly string[]): ReadOnlyBashResult {
  const allowed: string[] = [...READ_ONLY_BASH_SAFE]
  const excluded: string[] = []
  const warnings: string[] = []

  const hasReadDeny = denyRules.some(r => r.startsWith('Read(') || r.startsWith('Grep('))
  const hasWriteDeny = denyRules.some(r => r.startsWith('Write(') || r.startsWith('Edit('))

  for (const rule of READ_ONLY_BASH_FILE_READERS) {
    const isSed = rule === 'Bash(sed *)'

    // Exclude file readers if Read/Grep deny exists
    if (hasReadDeny) {
      excluded.push(rule)
      warnings.push(`${rule} を除外: Read/Grep deny ルールが存在するため`)
      continue
    }

    // Even without Read deny, exclude sed if Write/Edit deny exists
    if (isSed && hasWriteDeny) {
      excluded.push(rule)
      warnings.push(`${rule} を除外: Write/Edit deny ルールが存在するため (sed -i でバイパス可能)`)
      continue
    }

    allowed.push(rule)
  }

  return { allowed, excluded, warnings }
}
