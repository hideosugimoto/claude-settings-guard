# claude-settings-guard (csg)

[![npm version](https://img.shields.io/npm/v/claude-settings-guard)](https://www.npmjs.com/package/claude-settings-guard)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-792%20passed-brightgreen)]()

[日本語](#日本語) | [English](#english)

---

## 日本語

Claude Code の `settings.json` 権限設定を診断・修正・補強する CLI ツールです。

### Quick Start

```bash
npx claude-settings-guard
```

これだけで対話型ガイドが起動し、以下を自動実行します:

1. 設定の診断 (レガシー構文、構造問題、競合を検出)
2. マイグレーション (レガシー→モダン構文の一括変換)
3. テレメトリ分析 (使用パターンに基づく推薦)
4. プロファイル選択 (minimal / balanced / strict)
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

3つのプリセットから選択できます。各プロファイルは基本 deny ルール（sudo, su, rm -rf, eval, base64, .env, secrets）を含みます。

全プロファイル共通で、取り消しが困難なコマンド（git push, git reset --hard, npm publish 等）は `ask` に設定され、実行前に確認を求めます。

#### minimal（速度重視）

ほぼ全ツールを自動許可。確認プロンプトを最小化したい人向け。

| 設定 | 内容 |
|------|------|
| deny | `Bash(sudo *)`, `Bash(rm -rf /*)` |
| allow | `Read`, `Edit`, `Write`, `Glob`, `Grep` (ベア `Bash` は ask 競合により自動除去) |
| ask | `Bash(git push *)`, `Bash(git reset --hard *)`, `Bash(npm publish *)` 等 11 ルール |
| フック | enforce-permissions のみ |

#### balanced（推奨デフォルト）

読み取りは自動許可、書き込み・実行は確認。多くのユーザーに適したバランス。

| 設定 | 内容 |
|------|------|
| deny | `Bash(sudo *)`, `Bash(rm -rf /*)`, `Read(**/.env)`, `Read(**/secrets/**)` |
| allow | `Read`, `Glob`, `Grep` |
| ask | `Bash`, `Edit`, `Write` + 取消困難コマンド 11 ルール |
| フック | enforce-permissions のみ |

#### strict（セキュリティ重視）

ネットワークコマンドもブロック。セキュリティ最優先の環境向け。

| 設定 | 内容 |
|------|------|
| deny | 上記 + `Bash(curl *)`, `Bash(wget *)`, `Bash(eval *)`, `Bash(base64 *)`, `Write(**/.env)` |
| allow | `Read`, `Glob`, `Grep` |
| ask | `Bash`, `Edit`, `Write` + 取消困難コマンド 11 ルール + インフラ系 7 ルール (`ssh`, `kubectl`, `terraform` 等) |
| フック | enforce-permissions + 起動時自動診断 |

---

### コマンド一覧

| コマンド | 説明 |
|---------|------|
| `csg` / `csg setup` | 対話型ガイドセットアップ (デフォルト) |
| `csg diagnose [--json] [--quiet]` | settings.json を診断し、問題を検出する |
| `csg migrate [--dry-run]` | レガシー構文をモダン構文に一括変換する |
| `csg recommend [-y\|--yes]` | テレメトリデータを分析し、権限設定を推薦・自動適用する |
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
| ベア `Bash` + `Bash(...)` ask | **全 Bash ask ルールが無効化される** | ベアツール名を allow から自動除去 |
| allow + deny に同じルール | 冗長（deny が勝つが将来変更リスク） | allow から自動除去 |
| allow + ask に同じルール | **ask が無効化される**（allow が優先） | allow から自動除去 |

```
例1: ベア Bash が allow にあり、ask に Bash(git push *) がある
  → allow からベア Bash を自動除去
  → git push 時に Claude が確認を求めるようになる

例2: Bash(git push *) が allow と ask の両方にある
  → allow から自動除去し、ask のみに残す
```

`csg diagnose` でも `BARE_TOOL_OVERRIDE` / `ALLOW_ASK_CONFLICT` / `ALLOW_DENY_CONFLICT` として検出・警告します。

### テレメトリ推薦

`csg recommend` は `~/.claude/telemetry/` のイベントを分析し、以下の基準で推薦を行います:

| 推薦 | 条件 |
|------|------|
| allow に追加 | 同一ツールを 3 回以上手動許可している場合 |
| deny に追加 | 同一ツールを 2 回以上拒否している場合 |

#### パターングルーピング

同じプレフィックスを持つコマンドが 3 つ以上あると、ワイルドカードパターンにグルーピングして推薦します:

```
Bash(npm install lodash)  ─┐
Bash(npm install express) ─┼→ Bash(npm install *) を allow に追加
Bash(npm install chalk)   ─┘
```

`npm`, `git`, `cargo`, `pip` 等のパッケージマネージャ/VCS コマンドは 2 トークン（例: `npm install`）でグルーピングし、その他は 1 トークン（例: `ls`）でグルーピングします。

#### 自動適用

推薦の表示後、対話的に適用を確認できます。`--yes` フラグで確認をスキップできます:

```bash
csg recommend        # 推薦を表示 → 「適用しますか？ [Y/n]」
csg recommend --yes  # 確認なしで自動適用
```

適用時に deny ルールが追加された場合、Layer 2 強制フックが自動的に再生成されます。

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
npm test               # テスト実行 (33 files, 792 tests)
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
│   ├── session-hook.ts       # セッション起動時フック
│   ├── telemetry-analyzer.ts # テレメトリ分析
│   └── mcp-protocol.ts      # JSON-RPC 2.0 フレーミング
├── mcp-server.ts         # MCP サーバー
├── profiles/             # プロファイル定義
├── types.ts              # Zod スキーマ・型定義
└── constants.ts          # 定数・既知ツール一覧
```

---

## English

A CLI tool to diagnose, fix, and reinforce Claude Code's `settings.json` permission configuration.

### Quick Start

```bash
npx claude-settings-guard
```

This single command launches an interactive guide that automatically:

1. Diagnoses settings (detects legacy syntax, structural issues, conflicts)
2. Migrates patterns (batch conversion from legacy to modern syntax)
3. Analyzes telemetry (recommendations based on usage patterns)
4. Selects a profile (minimal / balanced / strict)
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

Choose from 3 presets. Each profile includes foundational deny rules (sudo, su, rm -rf, eval, base64, .env, secrets).

All profiles include `ask` rules for hard-to-reverse commands (git push, git reset --hard, npm publish, etc.) that require confirmation before execution.

#### minimal (Speed-Focused)

Auto-allows most tools. For users who want minimal confirmation prompts.

| Setting | Content |
|---------|---------|
| deny | `Bash(sudo *)`, `Bash(rm -rf /*)` |
| allow | `Read`, `Edit`, `Write`, `Glob`, `Grep` (bare `Bash` auto-removed due to ask conflict) |
| ask | `Bash(git push *)`, `Bash(git reset --hard *)`, `Bash(npm publish *)`, etc. (11 rules) |
| hooks | enforce-permissions only |

#### balanced (Recommended Default)

Auto-allows reads, requires confirmation for writes/execution.

| Setting | Content |
|---------|---------|
| deny | `Bash(sudo *)`, `Bash(rm -rf /*)`, `Read(**/.env)`, `Read(**/secrets/**)` |
| allow | `Read`, `Glob`, `Grep` |
| ask | `Bash`, `Edit`, `Write` + hard-to-reverse commands (11 rules) |
| hooks | enforce-permissions only |

#### strict (Security-Focused)

Blocks network commands. For security-critical environments.

| Setting | Content |
|---------|---------|
| deny | All above + `Bash(curl *)`, `Bash(wget *)`, `Bash(eval *)`, `Bash(base64 *)`, `Write(**/.env)` |
| allow | `Read`, `Glob`, `Grep` |
| ask | `Bash`, `Edit`, `Write` + hard-to-reverse (11 rules) + infra commands (7 rules: `ssh`, `kubectl`, `terraform`, etc.) |
| hooks | enforce-permissions + startup auto-diagnostics |

---

### Commands

| Command | Description |
|---------|-------------|
| `csg` / `csg setup` | Interactive guided setup (default) |
| `csg diagnose [--json] [--quiet]` | Audit settings.json for issues |
| `csg migrate [--dry-run]` | Batch-convert legacy syntax to modern format |
| `csg recommend [-y\|--yes]` | Analyze telemetry, suggest and auto-apply permission changes |
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
| Bare `Bash` + `Bash(...)` ask | **All Bash ask rules silently ignored** | Auto-remove bare tool from allow |
| allow + deny overlap | Redundant (deny wins, but risky if behavior changes) | Auto-remove from allow |
| allow + ask overlap | **ask is silently ignored** (allow takes priority) | Auto-remove from allow |

```
Example 1: Bare "Bash" in allow with Bash(git push *) in ask
  → Bare "Bash" auto-removed from allow
  → Claude now asks for confirmation before git push

Example 2: Bash(git push *) in both allow and ask
  → Auto-removed from allow, kept in ask
```

`csg diagnose` detects these as `BARE_TOOL_OVERRIDE` / `ALLOW_ASK_CONFLICT` / `ALLOW_DENY_CONFLICT`.

### Telemetry Recommendations

`csg recommend` analyzes events from `~/.claude/telemetry/` using these thresholds:

| Recommendation | Condition |
|----------------|-----------|
| Add to allow | Tool manually approved 3+ times |
| Add to deny | Tool rejected 2+ times |

#### Pattern Grouping

When 3+ commands share the same prefix, they are grouped into a wildcard pattern:

```
Bash(npm install lodash)  ─┐
Bash(npm install express) ─┼→ Recommend Bash(npm install *) for allow
Bash(npm install chalk)   ─┘
```

Package managers and VCS commands (`npm`, `git`, `cargo`, `pip`, etc.) use 2-token prefixes (e.g., `npm install`); others use 1-token prefixes (e.g., `ls`).

#### Auto-Apply

After displaying recommendations, you can interactively apply them. Use `--yes` to skip confirmation:

```bash
csg recommend        # Show recommendations → "Apply? [Y/n]"
csg recommend --yes  # Auto-apply without confirmation
```

When deny rules are added, the Layer 2 enforcement hook is automatically regenerated.

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
npm test               # Run tests (33 files, 792 tests)
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
│   ├── session-hook.ts       # Session startup hook
│   ├── telemetry-analyzer.ts # Telemetry analysis
│   └── mcp-protocol.ts      # JSON-RPC 2.0 framing
├── mcp-server.ts         # MCP server
├── profiles/             # Profile definitions
├── types.ts              # Zod schemas & type definitions
└── constants.ts          # Constants & known tools list
```

---

## License

MIT
