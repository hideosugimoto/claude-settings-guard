export const KNOWN_TOOLS = [
  'Bash', 'Read', 'Write', 'Edit', 'MultiEdit',
  'Glob', 'Grep', 'WebFetch', 'WebSearch',
  'TodoRead', 'TodoWrite', 'LS',
  'Agent', 'Skill', 'NotebookEdit',
] as const

export type KnownTool = typeof KNOWN_TOOLS[number]

/**
 * Expand git patterns with -C (directory) variants.
 * e.g. "Bash(git show *)" → ["Bash(git show *)", "Bash(git -C * show *)"]
 * This ensures patterns match both "git show ..." and "git -C /path show ..."
 */
function expandGitCVariants(patterns: readonly string[]): readonly string[] {
  return patterns.flatMap(p => {
    const match = p.match(/^Bash\(git (\S+)(.*)\)$/)
    if (!match) return [p]
    const subcmd = match[1]
    if (subcmd === '-C') return [p]
    const rest = match[2]
    return [p, `Bash(git -C * ${subcmd}${rest})`]
  })
}

export const DANGEROUS_COMMANDS = [
  'sudo', 'su', 'rm -rf /', 'rm -rf ~',
  'chmod 777', 'dd if=', ':(){:|:&};:',
  'mkfs', 'fdisk', 'mount', 'umount',
  'iptables', 'systemctl', 'kill -9',
] as const

export const SENSITIVE_FILE_PATTERNS = [
  '**/.env', '**/.env.*', '**/secrets/**',
  '**/*.secret', '**/*.secrets',
  '**/*credential*',
  '**/*.pem', '**/*.key',
] as const

export const SAFE_ENV_SUFFIXES = [
  'example', 'sample', 'template', 'dist',
] as const

export const DEFAULT_DENY_RULES: readonly string[] = [
  'Bash(sudo *)', 'Bash(su *)', 'Bash(rm -rf /*)', 'Bash(rm -rf ~*)',
  'Bash(eval *)', 'Bash(base64 *)',
  'Bash(chmod 777 *)', 'Bash(chmod +s *)', 'Bash(chmod u+s *)', 'Bash(chmod g+s *)',
  'Read(**/.env)', 'Read(**/.env.*)', 'Read(**/secrets/**)',
  'Read(**/*.secret)', 'Read(**/*credential*)',
  'Write(**/.env)', 'Write(**/.env.*)', 'Write(**/secrets/**)',
  'Edit(**/.env)', 'Edit(**/.env.*)', 'Edit(**/secrets/**)',
  'Grep(**/.env)', 'Grep(**/.env.*)', 'Grep(**/secrets/**)',
]

export const LEGACY_COLON_PATTERN = /^(\w+)\((.+):(\*)\)$/

export const MODERN_SPACE_PATTERN = /^(\w+)\((.+)\)$/

export const BARE_TOOL_PATTERN = /^(\w+)$/

export const MCP_TOOL_PATTERN = /^mcp__\w+__\w+/

export const GLOBAL_SETTINGS_PATH = '~/.claude/settings.json'
export const LOCAL_SETTINGS_PATH = '~/.claude/settings.local.json'
export const BACKUP_DIR = '~/.claude/backups'
export const HOOKS_DIR = '~/.claude/hooks'
export const SKILLS_DIR = '~/.claude/skills'
export const TELEMETRY_DIR = '~/.claude/telemetry'

// Commands that can read file contents (bypass Read deny via Bash)
export const FILE_READ_COMMANDS: ReadonlySet<string> = new Set([
  'cat', 'head', 'tail', 'less', 'more', 'grep', 'sed', 'awk', 'strings',
])

// Commands that can write/copy files (bypass Write/Edit deny via Bash)
export const FILE_WRITE_COMMANDS: ReadonlySet<string> = new Set([
  'sed', 'tee', 'cp', 'mv',
])

// Commands that act as prefix wrappers (can wrap denied commands)
export const PREFIX_COMMANDS: ReadonlySet<string> = new Set([
  'env', 'command', 'nice', 'nohup', 'builtin', 'time',
  'strace', 'ltrace', 'ionice', 'taskset', 'chrt',
])

// Commands that are hard to reverse — should require confirmation (ask), not auto-allow
// Included in all profiles (minimal, balanced, strict)
export const HARD_TO_REVERSE_ASK_RULES: readonly string[] = expandGitCVariants([
  'Bash(git push *)',
  'Bash(git push)',
  'Bash(git push --force *)',
  'Bash(git reset --hard *)',
  'Bash(git branch -D *)',
  'Bash(git clean -f *)',
  'Bash(git rebase *)',
  'Bash(git tag *)',
  'Bash(git stash drop *)',
  'Bash(npm publish *)',
  'Bash(npm publish)',
  'Bash(pnpm publish *)',
  'Bash(pnpm publish)',
  'Bash(yarn publish *)',
  'Bash(yarn publish)',
  'Bash(yarn npm publish *)',
  'Bash(yarn npm publish)',
  'Bash(bun publish *)',
  'Bash(bun publish)',
  'Bash(cargo publish *)',
  'Bash(cargo publish)',
])

// High-risk system commands that should require confirmation even in minimal profile.
// These can cause irreversible damage to disks, OS settings, or directory services.
export const HIGH_RISK_SYSTEM_ASK_RULES: readonly string[] = [
  'Bash(dd *)',
  'Bash(osascript *)',
  'Bash(dscl *)',
  'Bash(ldapmodify *)',
  'Bash(diskutil *)',
  'Bash(csrutil *)',
  'Bash(spctl *)',
  'Bash(dseditgroup *)',
]

// Additional ask rules for strict profile only (infra/remote operations)
export const STRICT_ONLY_ASK_RULES: readonly string[] = [
  'Bash(ssh *)',
  'Bash(scp *)',
  'Bash(docker push *)',
  'Bash(kubectl delete *)',
  'Bash(kubectl apply *)',
  'Bash(terraform apply *)',
  'Bash(terraform destroy *)',
]

// Safe Bash commands to auto-allow when bare "Bash" is removed from allow.
// These compensate for the loss of blanket Bash access.
// MUST NOT overlap with HARD_TO_REVERSE_ASK_RULES or DEFAULT_DENY_RULES.
export const SAFE_BASH_ALLOW_RULES: readonly string[] = expandGitCVariants([
  // Git (safe operations — push/rebase/tag/reset --hard/clean -f/stash drop are in ask)
  'Bash(git add *)',
  'Bash(git commit *)',
  'Bash(git status *)',
  'Bash(git diff *)',
  'Bash(git log *)',
  'Bash(git show *)',
  'Bash(git blame *)',
  'Bash(git fetch *)',
  'Bash(git pull *)',
  'Bash(git checkout *)',
  'Bash(git switch *)',
  'Bash(git merge *)',
  'Bash(git branch -a *)',
  'Bash(git branch -r *)',
  'Bash(git branch -d *)',    // lowercase -d is safe (refuses unmerged)
  'Bash(git branch -m *)',
  'Bash(git branch -v *)',
  'Bash(git branch --list *)',
  'Bash(git stash save *)',
  'Bash(git stash push *)',
  'Bash(git stash pop *)',
  'Bash(git stash apply *)',
  'Bash(git stash list *)',
  'Bash(git stash show *)',
  'Bash(git cherry-pick *)',
  'Bash(git reflog *)',
  'Bash(git rev-parse *)',
  'Bash(git ls-files *)',
  'Bash(git config *)',
  'Bash(git remote *)',
  'Bash(git clone *)',
  'Bash(git init *)',
  'Bash(git worktree *)',
  'Bash(git bisect *)',
  'Bash(git submodule *)',
  'Bash(git describe *)',
  'Bash(git shortlog *)',
  'Bash(git apply *)',
  // Package managers & runtimes (npm publish is in ask — use specific subcommands)
  'Bash(npm install *)',
  'Bash(npm ci *)',
  'Bash(npm run *)',
  'Bash(npm test *)',
  'Bash(npm start *)',
  'Bash(npm init *)',
  'Bash(npm ls *)',
  'Bash(npm list *)',
  'Bash(npm outdated *)',
  'Bash(npm info *)',
  'Bash(npm view *)',
  'Bash(npm search *)',
  'Bash(npm pack *)',
  'Bash(npm audit *)',
  'Bash(npm fund *)',
  'Bash(npm exec *)',
  'Bash(npm cache *)',
  'Bash(npm config *)',
  'Bash(npm prefix *)',
  'Bash(npm root *)',
  'Bash(npm bin *)',
  'Bash(npm link *)',
  'Bash(npm unlink *)',
  'Bash(npm uninstall *)',
  'Bash(npm update *)',
  'Bash(npm version *)',
  'Bash(npm why *)',
  'Bash(npm dedupe *)',
  'Bash(npm explain *)',
  'Bash(npm prune *)',
  'Bash(npm rebuild *)',
  'Bash(npm explore *)',
  'Bash(npm pkg *)',
  'Bash(npm set-script *)',
  'Bash(npx *)',
  'Bash(node *)',
  // pnpm (pnpm publish is in ask)
  'Bash(pnpm install *)',
  'Bash(pnpm add *)',
  'Bash(pnpm remove *)',
  'Bash(pnpm run *)',
  'Bash(pnpm test *)',
  'Bash(pnpm exec *)',
  'Bash(pnpm dlx *)',
  'Bash(pnpm ls *)',
  'Bash(pnpm list *)',
  'Bash(pnpm outdated *)',
  'Bash(pnpm update *)',
  'Bash(pnpm audit *)',
  'Bash(pnpm init *)',
  'Bash(pnpm config *)',
  'Bash(pnpm store *)',
  'Bash(pnpm why *)',
  'Bash(pnpm rebuild *)',
  'Bash(pnpm prune *)',
  // yarn (yarn publish is in ask)
  'Bash(yarn install *)',
  'Bash(yarn add *)',
  'Bash(yarn remove *)',
  'Bash(yarn run *)',
  'Bash(yarn test *)',
  'Bash(yarn dlx *)',
  'Bash(yarn list *)',
  'Bash(yarn outdated *)',
  'Bash(yarn upgrade *)',
  'Bash(yarn audit *)',
  'Bash(yarn init *)',
  'Bash(yarn config *)',
  'Bash(yarn cache *)',
  'Bash(yarn why *)',
  'Bash(yarn workspaces *)',
  'Bash(yarn info *)',
  // bun (bun publish is in ask)
  'Bash(bun install *)',
  'Bash(bun add *)',
  'Bash(bun remove *)',
  'Bash(bun run *)',
  'Bash(bun test *)',
  'Bash(bun x *)',
  'Bash(bun init *)',
  'Bash(bun build *)',
  'Bash(bun update *)',
  'Bash(bun pm *)',
  'Bash(bun link *)',
  'Bash(bun unlink *)',
  // cargo (cargo publish is in ask)
  'Bash(cargo build *)',
  'Bash(cargo run *)',
  'Bash(cargo test *)',
  'Bash(cargo check *)',
  'Bash(cargo clippy *)',
  'Bash(cargo fmt *)',
  'Bash(cargo doc *)',
  'Bash(cargo add *)',
  'Bash(cargo remove *)',
  'Bash(cargo update *)',
  'Bash(cargo init *)',
  'Bash(cargo new *)',
  'Bash(cargo bench *)',
  'Bash(cargo clean *)',
  'Bash(cargo tree *)',
  'Bash(cargo fix *)',
  'Bash(cargo install *)',
  'Bash(cargo uninstall *)',
  'Bash(pip *)',
  'Bash(pip3 *)',
  'Bash(python *)',
  'Bash(python3 *)',
  // Common CLI tools
  'Bash(ls *)',
  'Bash(cat *)',
  'Bash(head *)',
  'Bash(tail *)',
  'Bash(echo *)',
  'Bash(printf *)',
  'Bash(mkdir *)',
  'Bash(touch *)',
  'Bash(cp *)',
  'Bash(mv *)',
  'Bash(find *)',
  'Bash(grep *)',
  'Bash(sed *)',
  'Bash(awk *)',
  'Bash(sort *)',
  'Bash(uniq *)',
  'Bash(wc *)',
  'Bash(diff *)',
  'Bash(which *)',
  'Bash(type *)',
  'Bash(pwd *)',
  'Bash(cd *)',
  'Bash(env *)',
  'Bash(export *)',
  'Bash(source *)',
  'Bash(chmod 644 *)',
  'Bash(chmod 755 *)',
  'Bash(chmod 600 *)',
  'Bash(chmod 700 *)',
  'Bash(chmod +x *)',
  'Bash(chmod -x *)',
  'Bash(chmod u+x *)',
  'Bash(chmod g+x *)',
  'Bash(tar *)',
  'Bash(zip *)',
  'Bash(unzip *)',
  'Bash(jq *)',
  'Bash(xargs *)',
  // Dev tools
  'Bash(make *)',
  'Bash(tsc *)',
  'Bash(eslint *)',
  'Bash(prettier *)',
  'Bash(vitest *)',
  'Bash(jest *)',
  'Bash(pytest *)',
  'Bash(playwright *)',
  // Docker (docker push is in strict ask — use specific subcommands)
  'Bash(docker build *)',
  'Bash(docker run *)',
  'Bash(docker exec *)',
  'Bash(docker ps *)',
  'Bash(docker images *)',
  'Bash(docker logs *)',
  'Bash(docker stop *)',
  'Bash(docker start *)',
  'Bash(docker restart *)',
  'Bash(docker rm *)',
  'Bash(docker rmi *)',
  'Bash(docker pull *)',
  'Bash(docker inspect *)',
  'Bash(docker network *)',
  'Bash(docker volume *)',
  'Bash(docker tag *)',
  'Bash(docker login *)',
  'Bash(docker logout *)',
  'Bash(docker system *)',
  'Bash(docker container *)',
  'Bash(docker image *)',
  'Bash(docker compose *)',
  'Bash(docker-compose *)',
  'Bash(gh *)',
  'Bash(tmux *)',
])

// Read-only Bash commands: always safe, no file read/write side effects.
// DO NOT include `env` (prefix bypass risk).
export const READ_ONLY_BASH_SAFE: readonly string[] = expandGitCVariants([
  'Bash(ls *)',
  'Bash(find *)',
  'Bash(wc *)',
  'Bash(sort *)',
  'Bash(uniq *)',
  'Bash(diff *)',
  'Bash(file *)',
  'Bash(which *)',
  'Bash(type *)',
  'Bash(pwd)',
  'Bash(date *)',
  'Bash(whoami)',
  'Bash(hostname)',
  'Bash(uname *)',
  'Bash(git status *)',
  'Bash(git log *)',
  'Bash(git diff *)',
  'Bash(git branch *)',
  'Bash(git show *)',
  'Bash(git remote *)',
  'Bash(git describe *)',
  'Bash(git shortlog *)',
  'Bash(git rev-parse *)',
  'Bash(git ls-files *)',
  'Bash(git reflog *)',
  'Bash(git blame *)',
])

// File-reading Bash commands: can read file contents, may conflict with Read/Grep deny rules.
// sed is also in FILE_WRITE_COMMANDS (sed -i can write).
export const READ_ONLY_BASH_FILE_READERS: readonly string[] = [
  'Bash(cat *)',
  'Bash(head *)',
  'Bash(tail *)',
  'Bash(less *)',
  'Bash(more *)',
  'Bash(grep *)',
  'Bash(awk *)',
  'Bash(strings *)',
  'Bash(sed *)',
]

// Additional ask rules for the smart profile.
// Maps AutoMode's soft_deny categories to concrete Bash patterns.
// Categories that require semantic/AI judgment (e.g. data exfiltration intent,
// content integrity) cannot be expressed as static patterns and are not included.
export const SMART_ASK_RULES: readonly string[] = [
  // Cloud Storage Mass Delete
  'Bash(aws s3 rm *)',
  'Bash(aws s3api delete-objects *)',
  'Bash(gsutil rm *)',
  'Bash(gsutil -m rm *)',
  'Bash(az storage blob delete *)',
  'Bash(az storage container delete *)',
  // Production Deploy (beyond publish — infra tools)
  'Bash(helm install *)',
  'Bash(helm upgrade *)',
  // Remote Shell Writes
  'Bash(kubectl exec *)',
  'Bash(docker exec *)',
  // Interfere With Others
  'Bash(kill -9 *)',
  'Bash(killall *)',
  // Modify Shared Resources
  'Bash(terraform state *)',
  // Expose Local Services
  'Bash(ngrok *)',
  // Credential Exploration
  'Bash(kubectl get secrets *)',
  'Bash(kubectl get secret *)',
  // Exfil Scouting
  'Bash(nmap *)',
  'Bash(nc *)',
  'Bash(netcat *)',
  // Unauthorized Persistence
  'Bash(crontab *)',
  // Create Unsafe Agents
  'Bash(docker run --privileged *)',
  // Code Execution Obfuscation (ask, not deny — has legitimate uses)
  'Bash(base64 *)',
]

export const RECOMMEND_ALLOW_THRESHOLD = 3
export const RECOMMEND_DENY_THRESHOLD = 2
