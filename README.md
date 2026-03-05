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
4. 二重防御セットアップ (deny ルール + 強制フック)

CI や自動化では `-y` フラグで非対話実行できます:
```bash
npx claude-settings-guard -y
```

### 解決する問題

| 症状 | 原因 |
|------|------|
| `allowedTools` に追加しても毎回許可を求められる | レガシー構文 `Bash(npm:*)` を使用中（正しくは `Bash(npm *)`） |
| `deny` に設定してもブロックされないことがある | Claude Code 内部のパターンマッチングバグ |
| 毎回 Yes を押す手間が多い | 頻繁に使うツールが allow に未登録 |
| 設定の構造が古い | `allowedTools`/`deny`（トップレベル）→ `permissions.allow`/`permissions.deny` への移行が必要 |

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
        --> 一致すれば exit 2 で強制ブロック
```

### インストール

```bash
# npx で直接実行 (推奨)
npx claude-settings-guard

# グローバルインストール
npm install -g claude-settings-guard
csg
```

### コマンド一覧

| コマンド | 説明 |
|---------|------|
| `csg` / `csg setup` | 対話型ガイドセットアップ (デフォルト) |
| `csg diagnose` | settings.json を診断し、問題を検出する |
| `csg migrate [--dry-run]` | レガシー構文をモダン構文に一括変換する |
| `csg recommend` | テレメトリデータを分析し、権限設定の推薦を行う |
| `csg enforce [--dry-run]` | deny ルールの強制フック (PreToolUse) を生成・登録する |
| `csg init` | 初回セットアップ: deny ルールとフックを自動配置する |

### 開発

```bash
git clone https://github.com/your-username/claude-settings-guard.git
cd claude-settings-guard
npm install
npm run build          # ビルド
npm test               # テスト実行
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
4. Sets up dual-layer defense (deny rules + enforcement hooks)

For CI or automation, use the `-y` flag for non-interactive mode:
```bash
npx claude-settings-guard -y
```

### Problems Solved

| Symptom | Root Cause |
|---------|-----------|
| Tools in `allowedTools` still prompt for permission | Legacy colon syntax `Bash(npm:*)` (correct: `Bash(npm *)`) |
| `deny` rules don't block as expected | Pattern matching bugs in Claude Code internals |
| Too many manual "Yes" confirmations | Frequently used tools not in allow list |
| Outdated settings structure | Need to migrate from top-level `allowedTools`/`deny` to `permissions.allow`/`permissions.deny` |

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
        --> exit 2 to force-block on match
```

### Installation

```bash
# Run directly with npx (recommended)
npx claude-settings-guard

# Or install globally
npm install -g claude-settings-guard
csg
```

### Commands

| Command | Description |
|---------|-------------|
| `csg` / `csg setup` | Interactive guided setup (default) |
| `csg diagnose` | Audit settings.json for issues |
| `csg migrate [--dry-run]` | Batch-convert legacy syntax to modern format |
| `csg recommend` | Analyze telemetry and suggest permission changes |
| `csg enforce [--dry-run]` | Generate enforcement hook from deny rules |
| `csg init` | First-time setup: deploy deny rules and hooks |

### Development

```bash
git clone https://github.com/your-username/claude-settings-guard.git
cd claude-settings-guard
npm install
npm run build          # Build
npm test               # Run tests
npx tsx src/index.ts   # Run locally
```

---

## License

MIT
