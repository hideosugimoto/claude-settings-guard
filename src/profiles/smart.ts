import type { Profile } from '../types.js'
import { HARD_TO_REVERSE_ASK_RULES, STRICT_ONLY_ASK_RULES, SMART_ASK_RULES } from '../constants.js'

export const smartProfile: Profile = {
  name: 'smart',
  description: 'AutoMode 相当の静的ルール。ローカル開発は許可し、外部通信・破壊操作・インフラ変更のみ確認を要求。',
  deny: [
    // Privilege escalation
    'Bash(sudo *)',
    'Bash(su *)',
    // Catastrophic destruction
    'Bash(rm -rf /*)',
    'Bash(rm -rf ~*)',
    // Code execution obfuscation
    'Bash(eval *)',
    // Dangerous permissions
    'Bash(chmod 777 *)',
    'Bash(chmod +s *)',
    'Bash(chmod u+s *)',
    'Bash(chmod g+s *)',
    // Secrets / credentials
    'Read(**/.env)',
    'Read(**/.env.*)',
    'Read(**/secrets/**)',
    'Read(**/*.secret)',
    'Read(**/*credential*)',
    'Write(**/.env)',
    'Write(**/.env.*)',
    'Write(**/secrets/**)',
    'Edit(**/.env)',
    'Edit(**/.env.*)',
    'Edit(**/secrets/**)',
    'Grep(**/.env)',
    'Grep(**/.env.*)',
    'Grep(**/secrets/**)',
  ],
  allow: [
    'Read', 'Write', 'Edit', 'Glob', 'Grep',
  ],
  ask: [
    ...HARD_TO_REVERSE_ASK_RULES,
    ...STRICT_ONLY_ASK_RULES,
    ...SMART_ASK_RULES,
  ],
  hooks: { enforce: true, sessionDiagnose: false },
  readOnlyBash: true,
}
