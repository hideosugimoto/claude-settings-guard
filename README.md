# claude-settings-guard (csg)

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
        複合コマンド (&&, ||, |, $()) も分解して検査
        --> 一致すれば exit 2 で強制ブロック
```

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
├── hooks/
│   ├── enforce-permissions.sh ← Layer 2 強制フック
│   └── session-diagnose.sh    ← 起動時自動診断 (strict のみ)
└── commands/
    ├── csg.md                 ← /csg スラッシュコマンド
    ├── csg-diagnose.md        ← /csg-diagnose
    └── csg-enforce.md         ← /csg-enforce
```

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

3つのプリセットから選択できます。各プロファイルは基本 deny ルール（sudo, rm -rf, .env, secrets）を含みます。

#### minimal（速度重視）

ほぼ全ツールを自動許可。確認プロンプトを最小化したい人向け。

| 設定 | 内容 |
|------|------|
| deny | `Bash(sudo *)`, `Bash(rm -rf /*)` |
| allow | `Read`, `Edit`, `Write`, `Bash`, `Glob`, `Grep` |
| ask | なし |
| フック | enforce-permissions のみ |

#### balanced（推奨デフォルト）

読み取りは自動許可、書き込み・実行は確認。多くのユーザーに適したバランス。

| 設定 | 内容 |
|------|------|
| deny | `Bash(sudo *)`, `Bash(rm -rf /*)`, `Read(**/.env)`, `Read(**/secrets/**)` |
| allow | `Read`, `Glob`, `Grep` |
| ask | `Bash`, `Edit`, `Write` |
| フック | enforce-permissions のみ |

#### strict（セキュリティ重視）

ネットワークコマンドもブロック。セキュリティ最優先の環境向け。

| 設定 | 内容 |
|------|------|
| deny | 上記 + `Bash(curl *)`, `Bash(wget *)`, `Write(**/.env)` |
| allow | `Read`, `Glob`, `Grep` |
| ask | `Bash`, `Edit`, `Write` |
| フック | enforce-permissions + 起動時自動診断 |

---

### コマンド一覧

| コマンド | 説明 |
|---------|------|
| `csg` / `csg setup` | 対話型ガイドセットアップ (デフォルト) |
| `csg diagnose [--json] [--quiet]` | settings.json を診断し、問題を検出する |
| `csg migrate [--dry-run]` | レガシー構文をモダン構文に一括変換する |
| `csg recommend` | テレメトリデータを分析し、権限設定を推薦する |
| `csg enforce [--dry-run]` | deny ルールの強制フック (PreToolUse) を生成・登録する |
| `csg init [--profile NAME] [--force]` | 初回セットアップ: スラッシュコマンド・プロファイル・フックを配置 |
| `csg mcp` | MCP サーバーとして起動 (Claude Code 統合) |

### 診断で検出する問題

| コード | 重要度 | 内容 |
|--------|--------|------|
| `LEGACY_SYNTAX` | CRITICAL | コロン構文 `Tool(arg:*)` の使用 |
| `STRUCTURE_ISSUE` | WARNING | トップレベルの `deny`/`allowedTools` |
| `INVALID_TOOL` | WARNING | 未知のツール名 |
| `CONFLICT` | WARNING | allow と deny の競合 |
| `INVALID_PATTERN` | WARNING | パターン構文エラー |
| `PIPE_VULNERABLE` | INFO | パイプによるバイパスの可能性 → Layer 2 で対処 |

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

| ツール | 説明 |
|--------|------|
| `csg_diagnose` | 設定を診断して問題を返す |
| `csg_recommend` | プロファイルに基づく改善提案 |
| `csg_enforce` | Layer 2 フックを生成・更新 (dry-run 対応) |
| `csg_setup` | プロファイル適用ガイド |

### 開発

```bash
git clone https://github.com/hideosugimoto/claude-settings-guard.git
cd claude-settings-guard
npm install
npm run build          # ビルド
npm test               # テスト実行 (340 tests)
npx tsx src/index.ts   # ローカル実行
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
        Decomposes compound commands (&&, ||, |, $())
        --> exit 2 to force-block on match
```

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
├── hooks/
│   ├── enforce-permissions.sh ← Layer 2 enforcement hook
│   └── session-diagnose.sh    ← Startup auto-diagnostics (strict only)
└── commands/
    ├── csg.md                 ← /csg slash command
    ├── csg-diagnose.md        ← /csg-diagnose
    └── csg-enforce.md         ← /csg-enforce
```

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

Choose from 3 presets. Each profile includes foundational deny rules (sudo, rm -rf, .env, secrets).

#### minimal (Speed-Focused)

Auto-allows most tools. For users who want minimal confirmation prompts.

| Setting | Content |
|---------|---------|
| deny | `Bash(sudo *)`, `Bash(rm -rf /*)` |
| allow | `Read`, `Edit`, `Write`, `Bash`, `Glob`, `Grep` |
| ask | None |
| hooks | enforce-permissions only |

#### balanced (Recommended Default)

Auto-allows reads, requires confirmation for writes/execution.

| Setting | Content |
|---------|---------|
| deny | `Bash(sudo *)`, `Bash(rm -rf /*)`, `Read(**/.env)`, `Read(**/secrets/**)` |
| allow | `Read`, `Glob`, `Grep` |
| ask | `Bash`, `Edit`, `Write` |
| hooks | enforce-permissions only |

#### strict (Security-Focused)

Blocks network commands. For security-critical environments.

| Setting | Content |
|---------|---------|
| deny | All above + `Bash(curl *)`, `Bash(wget *)`, `Write(**/.env)` |
| allow | `Read`, `Glob`, `Grep` |
| ask | `Bash`, `Edit`, `Write` |
| hooks | enforce-permissions + startup auto-diagnostics |

---

### Commands

| Command | Description |
|---------|-------------|
| `csg` / `csg setup` | Interactive guided setup (default) |
| `csg diagnose [--json] [--quiet]` | Audit settings.json for issues |
| `csg migrate [--dry-run]` | Batch-convert legacy syntax to modern format |
| `csg recommend` | Analyze telemetry and suggest permission changes |
| `csg enforce [--dry-run]` | Generate enforcement hook from deny rules |
| `csg init [--profile NAME] [--force]` | First-time setup: deploy slash commands, profiles, and hooks |
| `csg mcp` | Start as MCP server for Claude Code integration |

### Diagnostic Issue Codes

| Code | Severity | Description |
|------|----------|-------------|
| `LEGACY_SYNTAX` | CRITICAL | Colon syntax `Tool(arg:*)` detected |
| `STRUCTURE_ISSUE` | WARNING | Top-level `deny`/`allowedTools` found |
| `INVALID_TOOL` | WARNING | Unknown tool name |
| `CONFLICT` | WARNING | Pattern in both allow and deny |
| `INVALID_PATTERN` | WARNING | Pattern syntax error |
| `PIPE_VULNERABLE` | INFO | Pipe bypass risk → addressed by Layer 2 |

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

| Tool | Description |
|------|-------------|
| `csg_diagnose` | Diagnose settings and return issues |
| `csg_recommend` | Suggest improvements based on profile |
| `csg_enforce` | Generate/update Layer 2 hook (dry-run supported) |
| `csg_setup` | Profile application guide |

### Development

```bash
git clone https://github.com/hideosugimoto/claude-settings-guard.git
cd claude-settings-guard
npm install
npm run build          # Build
npm test               # Run tests (340 tests)
npx tsx src/index.ts   # Run locally
```

---

## License

MIT
