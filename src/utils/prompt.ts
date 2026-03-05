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

export async function select(
  message: string,
  choices: readonly string[],
  defaultChoice: string,
): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout })
  try {
    const answer = await rl.question(`${message} [${defaultChoice}]: `)
    const trimmed = answer.trim().toLowerCase()
    if (trimmed === '') return defaultChoice
    const match = choices.find(c => c.toLowerCase() === trimmed)
    if (!match) {
      process.stdout.write(`"${trimmed}" は無効な選択肢です。デフォルト "${defaultChoice}" を使用します。\n`)
    }
    return match ?? defaultChoice
  } finally {
    rl.close()
  }
}
