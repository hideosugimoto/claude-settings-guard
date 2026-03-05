# /csg

Claude Settings Guard の設定状態サマリーと改善提案を表示します。

以下のコマンドを実行して、結果を分析・報告してください:

```bash
npx claude-settings-guard diagnose
```

結果を確認した上で:
1. CRITICAL / WARNING がある場合は具体的な修正案を提示
2. レガシー構文がある場合は `npx claude-settings-guard migrate --dry-run` で移行内容を確認
3. 問題がなければ「設定は健全です」と報告

追加の最適化が必要な場合は以下も実行してください:
```bash
npx claude-settings-guard recommend
```
