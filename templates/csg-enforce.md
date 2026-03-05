# /csg-enforce

Claude Settings Guard の Layer 2 強制フックを生成・更新します。

まず dry-run で確認してください:

```bash
npx claude-settings-guard enforce --dry-run
```

生成されるスクリプトの内容を確認し、問題がなければ適用してください:

```bash
npx claude-settings-guard enforce
```

適用後、PreToolUse フックが正しく登録されたことを確認してください:
```bash
cat ~/.claude/settings.json | jq '.PreToolUse'
```
