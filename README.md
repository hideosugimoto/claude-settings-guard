# claude-settings-guard (csg)

[![npm version](https://img.shields.io/npm/v/claude-settings-guard)](https://www.npmjs.com/package/claude-settings-guard)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-1045%20passed-brightgreen)]()

[日本語](#日本語) | [English](#english)

---

## 日本語

> **免責事項**: 本ツールはコミュニティによる非公式ツールです。Anthropic, PBC とは一切関係ありません。"Claude" は Anthropic, PBC の商標です。

Claude Code の `settings.json` 権限設定を診断・修正・補強する CLI ツールです。

### Quick Start

```bash
npx claude-settings-guard
```

これだけで対話型ガイドが起動し、以下を自動実行します:

1. 設定の診断 (レガシー構文、構造問題、競合を検出)
2. マイグレーション (レガシー→モダン構文の一括変換)
3. テレメトリ分析 (使用パターンに基づく推薦)
4. プロファイル選択 (minimal / balanced / strict / smart)
5. 二重防御セットアップ (deny ルール + 強制フック)

CI や自動化では `-y` フラグで非対話実行できます:

```bash
npx claude-settings-guard -y
```

### 解決する問題

| 症状 | 原因 | csg の解決策 |
|------|------|-------------|
| `allowedTools` に追加しても毎回許可を求められる | レガシー構文 `Bash(npm:*)` を使用中 | `csg migrate` で `Bash(npm *)` に自動変換 |
| `deny` に設定してもブロックされないことがある | Claude Code 内部のパターンマッチングバグ | Layer 2 フックで二重防御 |
| 毎回 Yes を押す手間が多い | 頻繁に使うツールが allow に未登録 | `csg recommend` でテレメトリベースの推薦 |
| 設定の構造が古い | トップレベル→`permissions.*` への移行が必要 | `csg migrate` で構造ごと自動変換 |
| `.env` や秘密ファイルが読まれるリスク | deny 設定が不十分 | プロファイルで推奨 deny ルールを一括適用 |
| `curl ... \| sh` で deny をバイパスされる | 複合コマンドの解析不足 | Layer 2 フックが `&&`, `\|\|`, `\|`, `$()` を分解して個別検査 |

### アーキテクチャ: 二重防御システム

```
ツール実行リクエスト
        |
 Layer 1: settings.json (Claude Code 内部)
        permissions.allow --> 確認なし許可
        permissions.deny  --> ブロック
        | (バグで通過した場合)
 Layer 2: PreToolUse Hook (独立した番犬)
        bash 正規表現で deny ルールを再チェック
        複合コマンド (&&, ||, |, $(), <()) も分解して個別検査
        --> 一致すれば exit 2 で強制ブロック
```

### 設定レイヤー

csg は 3 階層の設定ファイルをマージして診断します:

| レイヤー | パス | 用途 |
|---------|------|------|
| グローバル | `~/.claude/settings.json` | ユーザー全体の基本設定 |
| ローカル | `~/.claude/settings.local.json` | マシン固有の上書き（git 管理外） |
| プロジェクト | `.claude/settings.json` | プロジェクト固有の設定 |

---

### 導入手順

#### 方法 1: 対話型ガイド（推奨）

最もかんたんな方法です。5つのステップを順番にガイドします。

```bash
npx claude-settings-guard
```

ウィザードが以下を順に実行します:

```
Step 1/5: 診断     → 現在の設定の問題を検出
Step 2/5: 移行     → レガシー構文があれば自動変換
Step 3/5: 推薦     → テレメトリに基づく設定提案
Step 4/5: プロファイル → セキュリティレベルを選択
Step 5/5: セットアップ → deny ルール・フック・スラッシュコマンドを配置
```

#### 方法 2: ワンライナー（非対話）

すべてデフォルト設定 (balanced プロファイル) で一括適用:

```bash
npx claude-settings-guard -y
```

#### 方法 3: プロファイル指定で初期化

```bash
# balanced プロファイル（推奨デフォルト）
npx claude-settings-guard init --profile balanced

# AutoMode 相当の保護
npx claude-settings-guard init --profile smart

# セキュリティ重視
npx claude-settings-guard init --profile strict

# 速度重視・最小制限
npx claude-settings-guard init --profile minimal
```

#### 方法 4: グローバルインストール

頻繁に使う場合:

```bash
npm install -g claude-settings-guard
csg                          # 対話型ガイド
csg init --profile strict    # プロファイル指定
```

#### 導入後に配置されるファイル

```
~/.claude/
├── settings.json              ← deny/allow/ask ルールが追加される
├── CLAUDE.md                  ← Bash 複合コマンドルールが追加される
├── backups/                   ← 設定変更前の自動バックアップ
├── hooks/
│   ├── enforce-permissions.sh ← Layer 2 強制フック
│   └── session-diagnose.sh    ← 起動時自動診断 (strict のみ)
└── commands/
    ├── csg.md                 ← /csg スラッシュコマンド
    ├── csg-diagnose.md        ← /csg-diagnose
    └── csg-enforce.md         ← /csg-enforce
```

> 設定の変更時には `~/.claude/backups/` にタイムスタンプ付きバックアップが自動作成されます。

#### 導入後の確認

```bash
# 設定に問題がないか確認
csg diagnose

# フックスクリプトをプレビュー
csg enforce --dry-run

# Claude Code 内でスラッシュコマンドを使用
# /csg          → 設定サマリー
# /csg-diagnose → 詳細診断
# /csg-enforce  → フック更新
```

---

### プロファイル

4つのプリセットから選択できます。各プロファイルは基本 deny ルール（sudo, su, rm -rf, .env, secrets）を含みます。

全プロファイル共通で、取り消しが困難なコマンド（git push, git reset --hard, npm/pnpm/yarn/bun/cargo publish 等）は `ask` に設定され、実行前に確認を求めます。危険な chmod（777, +s）は deny に設定されます。

#### minimal（速度重視）

ほぼ全ツールを自動許可。確認プロンプトを最小化したい人向け。

| 設定 | 内容 |
|------|------|
| deny | `Bash(sudo *)`, `Bash(rm -rf /*)`, `Bash(chmod 777 *)`, `Bash(chmod +s *)` |
| allow | `Read`, `Edit`, `Write`, `Glob`, `Grep` (ベア `Bash` は ask 競合により自動除去、安全なサブコマンドで補償) |
| ask | `Bash(git push *)`, `Bash(git reset --hard *)`, `Bash(npm publish *)` 等 21 ルール + 高リスクシステムコマンド (`dd`, `osascript`, `dscl`, `diskutil` 等) 8 ルール |
| フック | enforce-permissions のみ |

#### balanced（推奨デフォルト）

読み取りは自動許可、書き込み・実行は確認。多くのユーザーに適したバランス。

| 設定 | 内容 |
|------|------|
| deny | `Bash(sudo *)`, `Bash(rm -rf /*)`, `Read(**/.env)`, `Read(**/secrets/**)` |
| allow | `Read`, `Glob`, `Grep` |
| ask | `Bash`, `Edit`, `Write` + 取消困難コマンド 21 ルール |
| フック | enforce-permissions のみ |

#### smart（AutoMode 相当）

Claude Code の AutoMode（AI 分類器）の判定基準に準拠した静的ルール。ローカル開発は許可し、外部通信・破壊操作・インフラ変更のみ確認を要求。AutoMode は v2.1.111（2026-04-16）以降 Max プランでも利用可能になりましたが、**Pro プランでは引き続き利用不可**です。smart プロファイルは Pro ユーザーや LLM 呼び出しコストを避けたいユーザーに、AutoMode 相当の保護を静的ルールで提供します。

| 設定 | 内容 |
|------|------|
| deny | `Bash(sudo *)`, `Bash(eval *)`, `Bash(chmod 777 *)`, `Read(**/.env)`, `Write(**/secrets/**)` 等 |
| allow | `Read`, `Write`, `Edit`, `Glob`, `Grep` (curl/wget もローカル開発用に許可) |
| ask | 取消困難コマンド 21 ルール + インフラ系 7 ルール + AutoMode 相当 22 ルール (クラウド操作、プロセス管理、永続化、ポートスキャン等) |
| フック | enforce-permissions のみ |

#### strict（セキュリティ重視）

ネットワークコマンドもブロック。セキュリティ最優先の環境向け。

| 設定 | 内容 |
|------|------|
| deny | 上記 + `Bash(curl *)`, `Bash(wget *)`, `Bash(eval *)`, `Bash(base64 *)`, `Write(**/.env)` |
| allow | `Read`, `Glob`, `Grep` |
| ask | `Bash`, `Edit`, `Write` + 取消困難コマンド 21 ルール + インフラ系 7 ルール (`ssh`, `kubectl`, `terraform` 等) |
| フック | enforce-permissions + 起動時自動診断 |

---

### コマンド一覧

| コマンド | 説明 |
|---------|------|
| `csg` / `csg setup` | 対話型ガイドセットアップ (デフォルト) |
| `csg diagnose [--json] [--quiet]` | settings.json を診断し、問題を検出する |
| `csg migrate [--dry-run]` | レガシー構文をモダン構文に一括変換する |
| `csg recommend [--profile NAME] [--dry-run] [-y\|--yes]` | インストール済みツールをAI分析し、権限設定を推薦・適用する |
| `csg enforce [--dry-run]` | deny ルールの強制フック (PreToolUse) を生成・登録する |
| `csg init [--profile NAME] [--force]` | 初回セットアップ: スラッシュコマンド・プロファイル・フックを配置 |
| `csg mcp` | MCP サーバーとして起動 (Claude Code 統合) |

#### 終了コード

| コード | 条件 |
|--------|------|
| `0` | 問題なし、または INFO レベルのみ |
| `1` | CRITICAL または WARNING レベルの問題が検出された（`--json` 使用時） |

CI/CD で設定品質をゲートに利用できます:

```bash
# CI パイプラインで設定の健全性をチェック
npx claude-settings-guard diagnose --json --quiet || echo "Settings issues detected"
```

### 診断で検出する問題

| コード | 重要度 | 内容 |
|--------|--------|------|
| `LEGACY_SYNTAX` | CRITICAL | コロン構文 `Tool(arg:*)` の使用 |
| `BARE_TOOL_OVERRIDE` | CRITICAL | ベアツール名（例: `Bash`）が ask パターンを無効化 |
| `STRUCTURE_ISSUE` | WARNING | トップレベルの `deny`/`allowedTools` |
| `INVALID_TOOL` | WARNING | 未知のツール名 |
| `CONFLICT` | WARNING | allow と deny の競合 |
| `ALLOW_ASK_CONFLICT` | WARNING | allow と ask の競合（allow が優先され ask が無効化） |
| `ALLOW_DENY_CONFLICT` | WARNING | allow と deny の重複（冗長、deny が優先） |
| `CROSS_TOOL_BYPASS` | WARNING/INFO | Bash 経由のファイル deny バイパス（Layer 2 導入時は INFO に降格） |
| `PREFIX_BYPASS_RISK` | WARNING/INFO | プレフィックスコマンドによる deny 回避リスク |
| `MISSING_PAIRED_DENY` | WARNING | Read deny はあるが Write/Edit deny が未設定 |
| `INVALID_PATTERN` | WARNING | パターン構文エラー |
| `PIPE_VULNERABLE` | INFO | パイプによるバイパスの可能性 → Layer 2 で対処 |

### 競合自動除去

`csg setup` / `csg init` でプロファイル適用時、allow ルールが deny や ask と競合している場合、自動的に allow から除去します。

| 競合パターン | 問題 | csg の対処 |
|---|---|---|
| ベア `Bash` + `Bash(...)` ask | **全 Bash ask ルールが無効化される** | ベアツール名を allow から自動除去、安全なサブコマンドで補償 |
| allow + deny に同じルール | 冗長（deny が勝つが将来変更リスク） | allow から自動除去 |
| allow + ask に同じルール | **ask が無効化される**（allow が優先） | allow から自動除去 |
| 広い allow が特定の ask/deny をオーバーライド | **`Bash(npm *)` が `Bash(npm publish *)` を無効化** | プレフィックスマッチで検出し allow から自動除去 |

```
例1: ベア Bash が allow にあり、ask に Bash(git push *) がある
  → allow からベア Bash を自動除去
  → 安全なコマンド (git commit, npm install 等) は個別パターンで補償
  → git push 時に Claude が確認を求めるようになる

例2: Bash(git push *) が allow と ask の両方にある
  → allow から自動除去し、ask のみに残す

例3: Bash(npm *) が allow にあり、ask に Bash(npm publish *) がある
  → 広い Bash(npm *) を allow から自動除去
  → npm install, npm run 等の安全なサブコマンドは個別に allow に追加
```

`csg diagnose` でも `BARE_TOOL_OVERRIDE` / `ALLOW_ASK_CONFLICT` / `ALLOW_DENY_CONFLICT` として検出・警告します。

### AI ツールスキャン推薦

`csg recommend` はインストール済みの CLI ツールを自動検出し、Claude AI で安全性を分類して allow/ask/deny を推薦します。

```bash
# プレビュー（変更なし）
csg recommend --profile smart --dry-run

# 自動適用
csg recommend --profile minimal --yes

# プロファイル省略時は現在の設定から自動検出
csg recommend --dry-run
```

#### 動作フロー

```
1. PATH 上のユーザーインストール済みバイナリをスキャン
2. CSG 既存ルールでカバー済みのツールを除外
3. 未カバーツールを Claude AI に送信し分類:
   - skip: 開発無関係（メディアコーデック、暗号テスト等）→ 無視
   - safe: ローカル開発ツール → allow
   - needs-confirmation: 外部通信・DB操作等 → ask
   - dangerous: 特権昇格・破壊操作 → deny
4. プロファイルに応じて allow/ask/deny にマッピング
5. サブコマンドレベルの粒度で推薦
```

#### プロファイル別マッピング

| AI 判定 | minimal | balanced | smart | strict |
|---------|---------|----------|-------|--------|
| safe | allow | allow | allow | allow |
| needs-confirmation | allow | ask | ask | ask |
| dangerous | ask | ask | deny | deny |

#### サブコマンドレベルの粒度

同一ツールでもサブコマンドごとにリスクが異なる場合、AI が自動で分けます:

```
brew list *     → [+allow]  パッケージ一覧（読み取りのみ）
brew install *  → [+ask]    ネットワークからインストール
brew services * → [+ask]    バックグラウンドサービス管理
```

#### オプション

| オプション | 説明 |
|-----------|------|
| `--profile <name>` | 分類基準を指定 (minimal, balanced, strict, smart) |
| `--dry-run` | 推薦を表示するが適用しない |
| `-y, --yes` | 確認なしで自動適用 |

適用時に deny ルールが追加された場合、Layer 2 強制フックが自動的に再生成されます。

> **注意**: AI 分類には Claude Code CLI が必要です。ネットワーク接続が必要で、API 利用料が発生します。

#### 標準 skill `/less-permission-prompts` との使い分け

Claude Code v2.1.111（2026-04-16）で、セッション transcript から頻出の read-only Bash/MCP 呼び出しを検出して allowlist を提案する標準 skill `/less-permission-prompts` が追加されました。csg の `recommend` とは **入力信号と出力が異なる補完関係** です。

| 観点 | `csg recommend` | `/less-permission-prompts` |
|------|-----------------|----------------------------|
| 入力 | PATH バイナリスキャン ＋ OTel telemetry | セッション transcript |
| タイミング | 事前（未使用ツールも対象） | 事後（実際に使った履歴ベース） |
| 出力 | allow / ask / **deny** 3種類 | allow のみ |
| 分類基準 | 4 プロファイル × AI リスク分類（safe / needs-confirmation / dangerous / skip） | read-only 限定 |
| 副作用 | settings.json 書き換え ＋ **Layer 2 フック再生成** | settings.json のみ |

**推奨併用フロー**: `csg recommend` で初期設定＋ deny を固め、運用中に残る許可プロンプトは `/less-permission-prompts` で削る。transcript にしか現れないローカル固有コマンドを拾える一方、csg の核心（deny 強制、複合コマンド再検査、プロファイル保護）は引き続き csg が担います。

### MCP サーバー統合

Claude Code から直接設定を確認・改善できます。

```json
// ~/.claude.json に追加
{
  "mcpServers": {
    "csg": {
      "command": "npx",
      "args": ["claude-settings-guard", "mcp"]
    }
  }
}
```

利用可能な MCP ツール:

| ツール | 引数 | 説明 |
|--------|------|------|
| `csg_diagnose` | なし | 設定を診断して問題を返す |
| `csg_recommend` | `profile?` | プロファイルに基づく改善提案 |
| `csg_enforce` | `dryRun?` | Layer 2 フックを生成・更新 (dry-run 対応) |
| `csg_setup` | `profile?` | プロファイル適用ガイド |

### 開発

```bash
git clone https://github.com/hideosugimoto/claude-settings-guard.git
cd claude-settings-guard
npm install
npm run build          # ビルド
npm test               # テスト実行 (54 files, 1045 tests)
npx tsx src/index.ts   # ローカル実行
```

#### プロジェクト構成

```
src/
├── index.ts              # CLI エントリポイント
├── commands/             # 各サブコマンドの実装
│   ├── setup.ts          # 5ステップ対話型ウィザード
│   ├── diagnose.ts       # 診断
│   ├── migrate.ts        # マイグレーション
│   ├── recommend.ts      # テレメトリ推薦
│   ├── enforce.ts        # フック生成
│   ├── init.ts           # 初期化
│   └── deploy-slash.ts   # スラッシュコマンド配置
├── core/                 # コアロジック
│   ├── settings-reader.ts    # 3層設定読み込み・マージ
│   ├── settings-writer.ts    # 設定書き込み（自動バックアップ付き）
│   ├── pattern-validator.ts  # パターン検証
│   ├── pattern-migrator.ts   # 構文・構造マイグレーション
│   ├── hook-generator.ts     # 強制フック生成
│   ├── hook-regenerator.ts   # フック再生成の共通ロジック
│   ├── hook-script-builder.ts # シェルスクリプト構築
│   ├── pattern-grouper.ts    # コマンドプレフィックスのグルーピング
│   ├── recommendation-applier.ts # 推薦の自動適用
│   ├── claude-md-updater.ts  # CLAUDE.md Bash ルール管理
│   ├── session-hook.ts       # セッション起動時フック
│   ├── telemetry-analyzer.ts # テレメトリ分析
│   ├── ai-classifier.ts     # AI ツール分類 (Claude CLI 連携)
│   └── mcp-protocol.ts      # JSON-RPC 2.0 フレーミング
├── mcp-server.ts         # MCP サーバー
├── profiles/             # プロファイル定義
├── types.ts              # Zod スキーマ・型定義
└── constants.ts          # 定数・既知ツール一覧
```

---

## English

> **Disclaimer**: This is an unofficial community tool. It is not affiliated with, endorsed by, or sponsored by Anthropic, PBC. "Claude" is a trademark of Anthropic, PBC.

A CLI tool to diagnose, fix, and reinforce Claude Code's `settings.json` permission configuration.

### Quick Start

```bash
npx claude-settings-guard
```

This single command launches an interactive guide that automatically:

1. Diagnoses settings (detects legacy syntax, structural issues, conflicts)
2. Migrates patterns (batch conversion from legacy to modern syntax)
3. Analyzes telemetry (recommendations based on usage patterns)
4. Selects a profile (minimal / balanced / strict / smart)
5. Sets up dual-layer defense (deny rules + enforcement hooks)

For CI or automation, use the `-y` flag for non-interactive mode:

```bash
npx claude-settings-guard -y
```

### Problems Solved

| Symptom | Root Cause | csg Solution |
|---------|-----------|--------------|
| Tools in `allowedTools` still prompt for permission | Legacy colon syntax `Bash(npm:*)` | `csg migrate` auto-converts to `Bash(npm *)` |
| `deny` rules don't block as expected | Pattern matching bugs in Claude Code | Layer 2 hook provides dual-layer defense |
| Too many manual "Yes" confirmations | Frequently used tools not in allow list | `csg recommend` provides telemetry-based suggestions |
| Outdated settings structure | Need migration to `permissions.*` | `csg migrate` handles structure + syntax |
| Risk of `.env` or secret files being read | Insufficient deny rules | Profiles apply recommended deny rules in bulk |
| `curl ... \| sh` bypasses deny rules | Compound commands not analyzed | Layer 2 hook decomposes `&&`, `\|\|`, `\|`, `$()` and checks each part |

### Architecture: Dual-Layer Defense

```
Tool execution request
        |
 Layer 1: settings.json (Claude Code internals)
        permissions.allow --> auto-approve
        permissions.deny  --> block
        | (if bug lets it through)
 Layer 2: PreToolUse Hook (independent watchdog)
        Re-evaluates deny rules with bash regex
        Decomposes compound commands (&&, ||, |, $(), <())
        Checks each part independently against deny rules
        --> exit 2 to force-block on match
```

### Settings Layers

csg reads and merges settings from 3 layers:

| Layer | Path | Purpose |
|-------|------|---------|
| Global | `~/.claude/settings.json` | User-wide base settings |
| Local | `~/.claude/settings.local.json` | Machine-specific overrides (not in git) |
| Project | `.claude/settings.json` | Project-specific settings |

---

### Installation

#### Method 1: Interactive Guide (Recommended)

The simplest approach. Walks you through 5 steps.

```bash
npx claude-settings-guard
```

The wizard runs these steps in order:

```
Step 1/5: Diagnose  → Detect issues in current settings
Step 2/5: Migrate   → Auto-convert legacy syntax if found
Step 3/5: Recommend → Suggest settings based on telemetry
Step 4/5: Profile   → Choose security level
Step 5/5: Setup     → Deploy deny rules, hooks, and slash commands
```

#### Method 2: One-Liner (Non-Interactive)

Apply all defaults (balanced profile) in one shot:

```bash
npx claude-settings-guard -y
```

#### Method 3: Initialize with a Specific Profile

```bash
# Balanced profile (recommended default)
npx claude-settings-guard init --profile balanced

# AutoMode-equivalent protection
npx claude-settings-guard init --profile smart

# Security-focused
npx claude-settings-guard init --profile strict

# Speed-focused, minimal restrictions
npx claude-settings-guard init --profile minimal
```

#### Method 4: Global Install

For frequent use:

```bash
npm install -g claude-settings-guard
csg                          # Interactive guide
csg init --profile strict    # Profile-based init
```

#### Files Deployed After Setup

```
~/.claude/
├── settings.json              ← deny/allow/ask rules added
├── CLAUDE.md                  ← Bash compound command rules added
├── backups/                   ← Auto-backups before changes
├── hooks/
│   ├── enforce-permissions.sh ← Layer 2 enforcement hook
│   └── session-diagnose.sh    ← Startup auto-diagnostics (strict only)
└── commands/
    ├── csg.md                 ← /csg slash command
    ├── csg-diagnose.md        ← /csg-diagnose
    └── csg-enforce.md         ← /csg-enforce
```

> Settings changes automatically create timestamped backups in `~/.claude/backups/`.

#### Post-Installation Verification

```bash
# Check for configuration issues
csg diagnose

# Preview hook script
csg enforce --dry-run

# Use slash commands in Claude Code
# /csg          → Settings summary
# /csg-diagnose → Detailed diagnostics
# /csg-enforce  → Update enforcement hook
```

---

### Profiles

Choose from 4 presets. Each profile includes foundational deny rules (sudo, su, rm -rf, .env, secrets).

All profiles include `ask` rules for hard-to-reverse commands (git push, git reset --hard, npm/pnpm/yarn/bun/cargo publish, etc.) that require confirmation before execution. Dangerous chmod operations (777, +s) are denied.

#### minimal (Speed-Focused)

Auto-allows most tools. For users who want minimal confirmation prompts.

| Setting | Content |
|---------|---------|
| deny | `Bash(sudo *)`, `Bash(rm -rf /*)`, `Bash(chmod 777 *)`, `Bash(chmod +s *)` |
| allow | `Read`, `Edit`, `Write`, `Glob`, `Grep` (bare `Bash` auto-removed due to ask conflict, compensated with safe subcommands) |
| ask | `Bash(git push *)`, `Bash(git reset --hard *)`, `Bash(npm publish *)`, etc. (21 rules) + high-risk system commands (`dd`, `osascript`, `dscl`, `diskutil`, etc.) (8 rules) |
| hooks | enforce-permissions only |

#### balanced (Recommended Default)

Auto-allows reads, requires confirmation for writes/execution.

| Setting | Content |
|---------|---------|
| deny | `Bash(sudo *)`, `Bash(rm -rf /*)`, `Read(**/.env)`, `Read(**/secrets/**)` |
| allow | `Read`, `Glob`, `Grep` |
| ask | `Bash`, `Edit`, `Write` + hard-to-reverse commands (21 rules) |
| hooks | enforce-permissions only |

#### smart (AutoMode-Equivalent)

Static rules based on Claude Code's AutoMode (AI classifier) criteria. Allows local development freely while requiring confirmation for external communication, destructive operations, and infrastructure changes. As of v2.1.111 (2026-04-16), AutoMode is now available on the Max plan, but **still unavailable on the Pro plan**. The `smart` profile provides AutoMode-equivalent protection via static rules — useful for Pro users and anyone who wants to avoid the per-call LLM classifier cost.

| Setting | Content |
|---------|---------|
| deny | `Bash(sudo *)`, `Bash(eval *)`, `Bash(chmod 777 *)`, `Read(**/.env)`, `Write(**/secrets/**)`, etc. |
| allow | `Read`, `Write`, `Edit`, `Glob`, `Grep` (curl/wget allowed for local dev) |
| ask | Hard-to-reverse (21 rules) + infra (7 rules) + AutoMode-equivalent (22 rules: cloud ops, process mgmt, persistence, port scanning, etc.) |
| hooks | enforce-permissions only |

#### strict (Security-Focused)

Blocks network commands. For security-critical environments.

| Setting | Content |
|---------|---------|
| deny | All above + `Bash(curl *)`, `Bash(wget *)`, `Bash(eval *)`, `Bash(base64 *)`, `Write(**/.env)` |
| allow | `Read`, `Glob`, `Grep` |
| ask | `Bash`, `Edit`, `Write` + hard-to-reverse (21 rules) + infra commands (7 rules: `ssh`, `kubectl`, `terraform`, etc.) |
| hooks | enforce-permissions + startup auto-diagnostics |

---

### Commands

| Command | Description |
|---------|-------------|
| `csg` / `csg setup` | Interactive guided setup (default) |
| `csg diagnose [--json] [--quiet]` | Audit settings.json for issues |
| `csg migrate [--dry-run]` | Batch-convert legacy syntax to modern format |
| `csg recommend [--profile NAME] [--dry-run] [-y\|--yes]` | AI-scan installed tools and recommend allow/ask/deny rules |
| `csg enforce [--dry-run]` | Generate enforcement hook from deny rules |
| `csg init [--profile NAME] [--force]` | First-time setup: deploy slash commands, profiles, and hooks |
| `csg mcp` | Start as MCP server for Claude Code integration |

#### Exit Codes

| Code | Condition |
|------|-----------|
| `0` | No issues, or INFO-level issues only |
| `1` | CRITICAL or WARNING issues detected (with `--json`) |

Use in CI/CD to gate settings quality:

```bash
# Check settings health in CI pipeline
npx claude-settings-guard diagnose --json --quiet || echo "Settings issues detected"
```

### Diagnostic Issue Codes

| Code | Severity | Description |
|------|----------|-------------|
| `LEGACY_SYNTAX` | CRITICAL | Colon syntax `Tool(arg:*)` detected |
| `BARE_TOOL_OVERRIDE` | CRITICAL | Bare tool name (e.g. `Bash`) overrides ask patterns |
| `STRUCTURE_ISSUE` | WARNING | Top-level `deny`/`allowedTools` found |
| `INVALID_TOOL` | WARNING | Unknown tool name |
| `CONFLICT` | WARNING | Pattern in both allow and deny |
| `ALLOW_ASK_CONFLICT` | WARNING | Pattern in both allow and ask (allow overrides, ask ignored) |
| `ALLOW_DENY_CONFLICT` | WARNING | Pattern in both allow and deny (redundant, deny wins) |
| `CROSS_TOOL_BYPASS` | WARNING/INFO | File deny bypass via Bash (downgraded to INFO when Layer 2 installed) |
| `PREFIX_BYPASS_RISK` | WARNING/INFO | Deny evasion via prefix commands |
| `MISSING_PAIRED_DENY` | WARNING | Read deny exists but Write/Edit deny missing |
| `INVALID_PATTERN` | WARNING | Pattern syntax error |
| `PIPE_VULNERABLE` | INFO | Pipe bypass risk → addressed by Layer 2 |

### Conflict Auto-Resolution

When applying a profile via `csg setup` / `csg init`, allow rules that conflict with deny or ask rules are automatically removed.

| Conflict | Problem | csg Action |
|----------|---------|------------|
| Bare `Bash` + `Bash(...)` ask | **All Bash ask rules silently ignored** | Auto-remove bare tool from allow, compensate with safe subcommands |
| allow + deny overlap | Redundant (deny wins, but risky if behavior changes) | Auto-remove from allow |
| allow + ask overlap | **ask is silently ignored** (allow takes priority) | Auto-remove from allow |
| Broad allow overrides specific ask/deny | **`Bash(npm *)` overrides `Bash(npm publish *)`** | Prefix-match detection, auto-remove from allow |

```
Example 1: Bare "Bash" in allow with Bash(git push *) in ask
  → Bare "Bash" auto-removed from allow
  → Safe commands (git commit, npm install, etc.) compensated with individual patterns
  → Claude now asks for confirmation before git push

Example 2: Bash(git push *) in both allow and ask
  → Auto-removed from allow, kept in ask

Example 3: Bash(npm *) in allow with Bash(npm publish *) in ask
  → Broad Bash(npm *) auto-removed from allow
  → Safe subcommands (npm install, npm run, etc.) individually added to allow
```

`csg diagnose` detects these as `BARE_TOOL_OVERRIDE` / `ALLOW_ASK_CONFLICT` / `ALLOW_DENY_CONFLICT`.

### AI Tool Scan Recommendations

`csg recommend` auto-detects installed CLI tools and uses Claude AI to classify their safety, then recommends allow/ask/deny rules.

```bash
# Preview only (no changes)
csg recommend --profile smart --dry-run

# Auto-apply
csg recommend --profile minimal --yes

# Auto-detect profile from current settings
csg recommend --dry-run
```

#### How It Works

```
1. Scan PATH for user-installed binaries
2. Filter out tools already covered by CSG rules
3. Send uncovered tools to Claude AI for classification:
   - skip: Not dev-related (media codecs, crypto tests, etc.) → ignored
   - safe: Local dev tools → allow
   - needs-confirmation: Network ops, DB clients, etc. → ask
   - dangerous: Privilege escalation, destruction → deny
4. Map to allow/ask/deny based on active profile
5. Recommend at subcommand-level granularity
```

#### Profile Mapping

| AI Classification | minimal | balanced | smart | strict |
|-------------------|---------|----------|-------|--------|
| safe | allow | allow | allow | allow |
| needs-confirmation | allow | ask | ask | ask |
| dangerous | ask | ask | deny | deny |

#### Subcommand Granularity

When a tool has mixed-risk subcommands, AI classifies each separately:

```
brew list *     → [+allow]  List packages (read-only)
brew install *  → [+ask]    Install from network
brew services * → [+ask]    Manage background services
```

#### Options

| Option | Description |
|--------|-------------|
| `--profile <name>` | Classification profile (minimal, balanced, strict, smart) |
| `--dry-run` | Show recommendations without applying |
| `-y, --yes` | Auto-apply without confirmation |

When deny rules are added, the Layer 2 enforcement hook is automatically regenerated.

> **Note**: AI classification requires Claude Code CLI. Requires network access and incurs API usage costs.

#### Relationship with the built-in `/less-permission-prompts` skill

Claude Code v2.1.111 (2026-04-16) introduced a built-in `/less-permission-prompts` skill that scans session transcripts for common read-only Bash/MCP tool calls and proposes a prioritized allowlist. It is **complementary to `csg recommend`**, not a replacement — the two use different input signals and produce different outputs.

| Dimension | `csg recommend` | `/less-permission-prompts` |
|-----------|-----------------|----------------------------|
| Input | PATH binary scan + OTel telemetry | Session transcripts |
| Timing | Proactive (covers unused tools) | Reactive (based on actual usage) |
| Output | allow / ask / **deny** | allow only |
| Classification | 4 profiles × AI risk (safe / needs-confirmation / dangerous / skip) | read-only focus |
| Side effects | Writes settings.json + **regenerates Layer 2 hook** | Writes settings.json only |

**Recommended combined flow**: Use `csg recommend` for initial setup and deny enforcement, then run `/less-permission-prompts` periodically to trim remaining prompts from your actual session history. The skill captures project-local commands that don't show up in a PATH scan, while csg's core value (deny enforcement, compound-command re-checking, profile-based safety) stays with csg.

### MCP Server Integration

Let Claude directly check and improve settings.

```json
// Add to ~/.claude.json
{
  "mcpServers": {
    "csg": {
      "command": "npx",
      "args": ["claude-settings-guard", "mcp"]
    }
  }
}
```

Available MCP tools:

| Tool | Arguments | Description |
|------|-----------|-------------|
| `csg_diagnose` | None | Diagnose settings and return issues |
| `csg_recommend` | `profile?` | Suggest improvements based on profile |
| `csg_enforce` | `dryRun?` | Generate/update Layer 2 hook (dry-run supported) |
| `csg_setup` | `profile?` | Profile application guide |

### Development

```bash
git clone https://github.com/hideosugimoto/claude-settings-guard.git
cd claude-settings-guard
npm install
npm run build          # Build
npm test               # Run tests (54 files, 1045 tests)
npx tsx src/index.ts   # Run locally
```

#### Project Structure

```
src/
├── index.ts              # CLI entry point
├── commands/             # Subcommand implementations
│   ├── setup.ts          # 5-step interactive wizard
│   ├── diagnose.ts       # Diagnostics
│   ├── migrate.ts        # Migration
│   ├── recommend.ts      # Telemetry recommendations
│   ├── enforce.ts        # Hook generation
│   ├── init.ts           # Initialization
│   └── deploy-slash.ts   # Slash command deployment
├── core/                 # Core logic
│   ├── settings-reader.ts    # 3-layer settings loading & merging
│   ├── settings-writer.ts    # Settings write (with auto-backup)
│   ├── pattern-validator.ts  # Pattern validation
│   ├── pattern-migrator.ts   # Syntax & structure migration
│   ├── hook-generator.ts     # Enforcement hook generation
│   ├── hook-regenerator.ts   # Shared hook regeneration logic
│   ├── hook-script-builder.ts # Shell script building
│   ├── pattern-grouper.ts    # Command prefix grouping
│   ├── recommendation-applier.ts # Auto-apply recommendations
│   ├── claude-md-updater.ts  # CLAUDE.md Bash rules management
│   ├── session-hook.ts       # Session startup hook
│   ├── telemetry-analyzer.ts # Telemetry analysis
│   ├── ai-classifier.ts     # AI tool classification (Claude CLI integration)
│   └── mcp-protocol.ts      # JSON-RPC 2.0 framing
├── mcp-server.ts         # MCP server
├── profiles/             # Profile definitions
├── types.ts              # Zod schemas & type definitions
└── constants.ts          # Constants & known tools list
```

---

## Disclaimer

This is an unofficial community tool. It is not affiliated with, endorsed by, or sponsored by Anthropic, PBC. "Claude" is a trademark of Anthropic, PBC. Use of the name "Claude" in this project is solely for descriptive purposes to indicate compatibility with Claude Code.

本ツールはコミュニティによる非公式ツールです。Anthropic, PBC とは一切関係がなく、公認・推奨・後援を受けたものではありません。"Claude" は Anthropic, PBC の商標です。本プロジェクトにおける "Claude" の使用は、Claude Code との互換性を示す説明目的に限ります。

## License

MIT
