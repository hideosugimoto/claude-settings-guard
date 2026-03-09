import { Command } from 'commander'
import { diagnoseCommand } from './commands/diagnose.js'
import { migrateCommand } from './commands/migrate.js'
import { recommendCommand } from './commands/recommend.js'
import { enforceCommand } from './commands/enforce.js'
import { initCommand } from './commands/init.js'
import { setupCommand } from './commands/setup.js'
import { startMcpServer } from './mcp-server.js'
import { VERSION } from './version.js'

const program = new Command()

program
  .name('csg')
  .description('Claude Settings Guard - settings.json 権限設定の診断・修正・補強ツール')
  .version(VERSION)
  .option('-y, --yes', '非対話モード (全ステップを自動実行)')
  .action(async (opts) => {
    try {
      await setupCommand({ yes: opts.yes })
    } catch (err) {
      process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`)
      process.exit(1)
    }
  })

program
  .command('setup')
  .description('対話型ガイドセットアップ (デフォルト)')
  .option('-y, --yes', '非対話モード (全ステップを自動実行)')
  .action(async (opts) => {
    try {
      await setupCommand({ yes: opts.yes })
    } catch (err) {
      process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`)
      process.exit(1)
    }
  })

program
  .command('diagnose')
  .description('settings.json を診断し、問題を検出する')
  .option('--json', 'JSON 形式で出力する')
  .option('--quiet', 'CRITICAL/WARNING のみ表示 (--json と併用)')
  .action(async (opts) => {
    try {
      await diagnoseCommand({ json: opts.json, quiet: opts.quiet })
    } catch (err) {
      process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`)
      process.exit(1)
    }
  })

program
  .command('migrate')
  .description('レガシー構文をモダン構文に一括変換する')
  .option('--dry-run', '変更を適用せず、差分のみ表示する')
  .action(async (opts) => {
    try {
      await migrateCommand({ dryRun: opts.dryRun })
    } catch (err) {
      process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`)
      process.exit(1)
    }
  })

program
  .command('recommend')
  .description('テレメトリデータを分析し、権限設定の推薦を行う')
  .option('-y, --yes', '推薦を確認なしで適用する')
  .action(async (opts) => {
    try {
      await recommendCommand({ yes: opts.yes })
    } catch (err) {
      process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`)
      process.exit(1)
    }
  })

program
  .command('enforce')
  .description('deny ルールの強制フック (PreToolUse) を生成・登録する')
  .option('--dry-run', '変更を適用せず、生成内容のみ表示する')
  .action(async (opts) => {
    try {
      await enforceCommand({ dryRun: opts.dryRun })
    } catch (err) {
      process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`)
      process.exit(1)
    }
  })

program
  .command('init')
  .description('初回セットアップ: スラッシュコマンドとフックを自動配置する')
  .option('--profile <name>', 'プロファイル (minimal, balanced, strict)', 'balanced')
  .option('--force', '既存のスラッシュコマンドを上書きする')
  .action(async (opts) => {
    try {
      await initCommand({ profile: opts.profile, force: opts.force })
    } catch (err) {
      process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`)
      process.exit(1)
    }
  })

program
  .command('mcp')
  .description('MCP サーバーとして起動 (Claude Code から利用)')
  .action(async () => {
    try {
      await startMcpServer()
    } catch (err) {
      process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`)
      process.exit(1)
    }
  })

program.parse()
