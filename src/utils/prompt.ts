import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'

export async function confirm(message: string, defaultYes = true): Promise<boolean> {
  const hint = defaultYes ? 'Y/n' : 'y/N'
  const rl = createInterface({ input: stdin, output: stdout })
  try {
    const answer = await rl.question(`${message} [${hint}]: `)
    const trimmed = answer.trim().toLowerCase()
    if (trimmed === '') return defaultYes
    return trimmed === 'y' || trimmed === 'yes'
  } finally {
    rl.close()
  }
}
