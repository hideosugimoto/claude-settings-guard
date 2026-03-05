# /csg-diagnose

Claude Settings Guard の詳細診断を実行します。

以下のコマンドを実行し、結果を分析してください:

```bash
npx claude-settings-guard diagnose
```

診断結果を以下の形式で報告してください:
- **CRITICAL**: 即座に対応が必要な問題（レガシー構文、構造問題等）
- **WARNING**: 注意が必要な問題（競合、不明なツール名等）
- **INFO**: 参考情報（パイプバイパス脆弱性等）

各問題に対して修正コマンドまたは手動修正手順を提示してください。
