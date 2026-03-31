#!/bin/bash
# Install the /improve-settings slash command for Claude Code
set -euo pipefail

SKILLS_DIR="$HOME/.claude/skills"
COMMAND_FILE="$SKILLS_DIR/improve-settings.md"

mkdir -p "$SKILLS_DIR"

if [ -f "$COMMAND_FILE" ]; then
  echo "Already installed: $COMMAND_FILE"
  exit 0
fi

cat > "$COMMAND_FILE" << 'HEREDOC'
# /improve-settings

Claude Code の settings.json 権限設定を診断・最適化するコマンドです。

以下の手順で実行してください:

1. まず診断を実行:
```bash
npx claude-settings-guard diagnose
```

2. レガシー構文があれば移行:
```bash
npx claude-settings-guard migrate --dry-run
npx claude-settings-guard migrate
```

3. テレメトリから推薦を取得:
```bash
npx claude-settings-guard recommend
```

4. 強制フックを生成:
```bash
npx claude-settings-guard enforce
```

各コマンドの結果を確認し、必要に応じて設定を調整してください。
HEREDOC

echo "Installed: $COMMAND_FILE"
