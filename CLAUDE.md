# claude-settings-guard

## 開発メモ

### Auto mode 対応 検討メモ（2026-03-25 起票 / 2026-04-20 更新）
- 試みたこと：auto mode 時に deny/ask をクリアした設定ファイルを切り替えて起動するシェルスクリプトの実装
- 課題：プラン判定・設定退避の実装が複雑、仕様変更リスクが高い
- 判断：research preview 段階のため実装を見送り。Pro 解放もしくは一般リリース後に再検討
- 設計メモ：起動オプションで設定ファイルを出し分ける方式（alias or 専用シェル）が有望
- 参考：`--settings` オプション、`autoMode.soft_deny`、しきい値（3回連続/合計20回）

#### 調査で判明した事実
- AutoMode は Team/Enterprise に加え、**Max プランにも解放済み**（v2.1.111 / 2026-04-16、Opus 4.7 使用時）。Pro は引き続き利用不可
- `--enable-auto-mode` フラグは v2.1.111 で不要になった
- `--permission-mode auto` は非対応プランでは無視される（エラーにならない）
- settings.json はセッション起動後もリアルタイムで再読み込みされる
- AutoMode 時も settings.json の deny/allow は分類器より先に評価される
- enforce-permissions.sh の deny ルールはスクリプト生成時にハードコードされる
- PreToolUse hook input に `permission_mode` フィールドが含まれる
- AutoMode 拒否は `/permissions` の Recently denied タブから `r` キーで再試行可能（v2.1.90〜）
- `PermissionDenied` フック（v2.1.89〜）で拒否後の挙動を自動化可能

### 標準の Allow 推薦機能との棲み分け（2026-04-20）
- Claude Code 本体に `/less-permission-prompts` skill が追加された（v2.1.111 / 2026-04-16）
  - 役割：セッション transcript をスキャンし、頻出する read-only な Bash/MCP 呼び出しを allowlist として提案
  - csg との違い：
    - 入力信号：transcript（事後・実績ベース） vs csg は PATH バイナリスキャン＋telemetry（事前・proactive）
    - 出力：allow のみ vs csg は deny/ask/allow ＋ Layer 2 フック再生成
    - 分類：read-only 限定 vs csg は 4 プロファイル × AI 分類
- **結論：置き換えではなく補完**。csg の核心価値（deny 強制、複合コマンド再検査、未使用ツールの事前分類）は標準 skill では提供されない
- README でも補完関係として紹介する

### TODO: transcript ベースの推薦追加検討
- 背景：`/less-permission-prompts` が示すように transcript は有用な信号源
- 現状 csg の信号源：PATH スキャン（proactive）＋ OTel telemetry（reactive）
- 検討候補：`~/.claude/projects/*/session_*.jsonl` を読み、頻出 Bash 呼び出しを第3信号源として recommend に統合
- 着手基準：feedback_data_driven_improvement 方針に従い、「telemetry では拾えないが transcript なら拾える」という実ユーザー報告が出てから。推測での追加はしない

### 対応済み（2026-03-26）
1. ✅ AI分類レスポンスで `subcommands` がオブジェクトで返された場合の zod スキーマ修正（`flexibleArrayOf` で配列に正規化）
2. ✅ minimal プロファイルでも `dd`, `osascript`, `dscl`, `ldapmodify` 等の高リスクコマンドを ask に（プロンプト調整 + `HIGH_RISK_SYSTEM_ASK_RULES` 静的ルール追加）
