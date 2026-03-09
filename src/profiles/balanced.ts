import type { Profile } from '../types.js'

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
  ],
  hooks: { enforce: true, sessionDiagnose: false },
}
