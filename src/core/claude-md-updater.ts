import { readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { getClaudeMdPath, ensureDir } from '../utils/paths.js'

const BEGIN_MARKER = '<!-- CSG:BASH_RULES:BEGIN -->'
const END_MARKER = '<!-- CSG:BASH_RULES:END -->'

export type UpdateAction = 'added' | 'updated' | 'skipped'

export interface ClaudeMdUpdateResult {
  readonly action: UpdateAction
  readonly filePath: string
}

export function generateBashRulesSection(): string {
  return `${BEGIN_MARKER}
## Bash コマンドルール (managed by claude-settings-guard)

Claude Code のパーミッションパターン（例: \`Bash(git add *)\`）はコマンド文字列全体にマッチします。
複合コマンドはパターンをバイパスするため、以下のルールを厳守してください。

### 禁止: 複合コマンド
- \`&&\`, \`||\`, \`;\`, \`&\` でコマンドを連結しない
- 各コマンドは個別の Bash ツール呼び出しにする

**悪い例:**
\`\`\`bash
cd /path/to/project && git add .
docker build -t app . && docker run app
npm install && npm test
\`\`\`

**良い例:**
\`\`\`bash
# 別々の Bash 呼び出しとして実行
git -C /path/to/project add .

docker build -t app .
# (別の Bash 呼び出し)
docker run app
\`\`\`

### 代替手段
- \`cd /path && git ...\` → \`git -C /path ...\`
- \`cd /path && command\` → 絶対パスを引数に渡す
- 複数コマンドが必要 → 個別の Bash ツール呼び出しに分割

### 例外: パイプ
- 読み取り専用のデータ処理パイプ（\`|\`）は許可
  - OK: \`grep pattern file | wc -l\`
  - OK: \`cat file | sort | uniq\`
- パイプと \`&&\` 等の組み合わせは禁止
  - NG: \`grep pattern file | wc -l && echo done\`
${END_MARKER}`
}

async function readClaudeMd(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, 'utf-8')
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return ''
    }
    throw error
  }
}

export async function updateClaudeMd(filePath?: string): Promise<ClaudeMdUpdateResult> {
  const targetPath = filePath ?? getClaudeMdPath()
  const currentContent = await readClaudeMd(targetPath)
  const newSection = generateBashRulesSection()

  const beginIdx = currentContent.indexOf(BEGIN_MARKER)
  const endIdx = currentContent.indexOf(END_MARKER)

  // Both markers present: check if update needed
  if (beginIdx !== -1 && endIdx !== -1 && beginIdx < endIdx) {
    const existingSection = currentContent.slice(beginIdx, endIdx + END_MARKER.length)

    if (existingSection === newSection) {
      return { action: 'skipped', filePath: targetPath }
    }

    const before = currentContent.slice(0, beginIdx)
    const after = currentContent.slice(endIdx + END_MARKER.length)
    const updatedContent = before + newSection + after

    await ensureDir(dirname(targetPath))
    await writeFile(targetPath, updatedContent, 'utf-8')
    return { action: 'updated', filePath: targetPath }
  }

  // No valid marker pair: append section
  const separator = currentContent.length > 0 && !currentContent.endsWith('\n\n')
    ? (currentContent.endsWith('\n') ? '\n' : '\n\n')
    : ''
  const newContent = currentContent + separator + newSection + '\n'

  await ensureDir(dirname(targetPath))
  await writeFile(targetPath, newContent, 'utf-8')
  return { action: 'added', filePath: targetPath }
}
