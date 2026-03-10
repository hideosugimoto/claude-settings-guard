import type { Profile } from '../types.js'
import { HARD_TO_REVERSE_ASK_RULES } from '../constants.js'

export const minimalProfile: Profile = {
  name: 'minimal',
  description: '速度重視・ワンライナー志向。ほぼ全ツールを自動許可し、最低限の deny のみ設定。',
  deny: [
    'Bash(sudo *)',
    'Bash(rm -rf /*)',
  ],
  allow: [
    'Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep',
  ],
  ask: [...HARD_TO_REVERSE_ASK_RULES],
  hooks: { enforce: true, sessionDiagnose: false },
}
