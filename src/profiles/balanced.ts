import type { Profile } from '../types.js'
import { HARD_TO_REVERSE_ASK_RULES } from '../constants.js'

export const balancedProfile: Profile = {
  name: 'balanced',
  description: '推奨デフォルト。読み取り系は許可、書き込み系は確認を要求。',
  deny: [
    'Bash(sudo *)',
    'Bash(rm -rf /*)',
    'Read(**/.env)',
    'Read(**/secrets/**)',
    'Write(**/.env)',
    'Write(**/secrets/**)',
    'Edit(**/.env)',
    'Edit(**/secrets/**)',
  ],
  allow: [
    'Read', 'Glob', 'Grep',
  ],
  ask: [
    'Bash', 'Edit', 'Write',
    ...HARD_TO_REVERSE_ASK_RULES,
  ],
  hooks: { enforce: true, sessionDiagnose: false },
  readOnlyBash: true,
}
