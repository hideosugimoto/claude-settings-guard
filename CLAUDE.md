# claude-settings-guard

## 開発メモ

### Auto mode 対応 検討メモ（2026-03-25）
- 試みたこと：auto mode 時に deny/ask をクリアした設定ファイルを切り替えて起動するシェルスクリプトの実装
- 課題：プラン判定・設定退避の実装が複雑、仕様変更リスクが高い
- 判断：research preview 段階のため実装を見送り。正式リリース後に再検討
- 設計メモ：起動オプションで設定ファイルを出し分ける方式（alias or 専用シェル）が有望
- 参考：`--settings` オプション、`autoMode.soft_deny`、しきい値（3回連続/合計20回）

#### 調査で判明した事実
- AutoMode は Team/Enterprise プラン限定（個人 Pro/Max では使えない）
- `--permission-mode auto` は非対応プランでは無視される（エラーにならない）
- settings.json はセッション起動後もリアルタイムで再読み込みされる
- AutoMode 時も settings.json の deny/allow は分類器より先に評価される
- enforce-permissions.sh の deny ルールはスクリプト生成時にハードコードされる
- PreToolUse hook input に `permission_mode` フィールドが含まれる

### 対応済み（2026-03-26）
1. ✅ AI分類レスポンスで `subcommands` がオブジェクトで返された場合の zod スキーマ修正（`flexibleArrayOf` で配列に正規化）
2. ✅ minimal プロファイルでも `dd`, `osascript`, `dscl`, `ldapmodify` 等の高リスクコマンドを ask に（プロンプト調整 + `HIGH_RISK_SYSTEM_ASK_RULES` 静的ルール追加）
