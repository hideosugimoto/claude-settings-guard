import type { Profile } from '../types.js'

export const strictProfile: Profile = {
  name: 'strict',
  description: 'セキュリティ重視。ネットワークコマンドも deny、全書き込み確認、SessionStart 診断を有効化。',
  deny: [
    'Bash(sudo *)',
    'Bash(rm -rf /*)',
    'Bash(curl *)',
    'Bash(wget *)',
    'Read(**/.env)',
    'Read(**/secrets/**)',
    'Write(**/.env)',
  ],
  allow: [
    'Read', 'Glob', 'Grep',
  ],
  ask: [
    'Bash', 'Edit', 'Write',
  ],
  hooks: { enforce: true, sessionDiagnose: true },
}
