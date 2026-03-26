import chalk from 'chalk'
import type { DiagnosticIssue, MigrationResult, Recommendation } from '../types.js'

export function printHeader(title: string): void {
  const line = '='.repeat(title.length + 4)
  process.stdout.write(`\n${chalk.bold.cyan(line)}\n`)
  process.stdout.write(`${chalk.bold.cyan(`  ${title}`)}\n`)
  process.stdout.write(`${chalk.bold.cyan(line)}\n\n`)
}

export function printIssue(issue: DiagnosticIssue): void {
  const badge = issue.severity === 'critical'
    ? chalk.bgRed.white.bold(' CRITICAL ')
    : issue.severity === 'warning'
      ? chalk.bgYellow.black.bold(' WARNING ')
      : chalk.bgBlue.white(' INFO ')

  process.stdout.write(`${badge} ${issue.message}\n`)

  if (issue.details && issue.details.length > 0) {
    for (const detail of issue.details.slice(0, 5)) {
      process.stdout.write(`  ${chalk.dim('>')} ${detail}\n`)
    }
    if (issue.details.length > 5) {
      process.stdout.write(`  ${chalk.dim(`... and ${issue.details.length - 5} more`)}\n`)
    }
  }

  if (issue.fix) {
    process.stdout.write(`  ${chalk.green('Fix:')} ${issue.fix}\n`)
  }
  process.stdout.write('\n')
}

export function printMigration(migration: MigrationResult): void {
  const typeLabel = migration.type === 'syntax'
    ? chalk.yellow('[syntax]')
    : chalk.blue('[structure]')
  process.stdout.write(
    `  ${typeLabel} ${chalk.red(migration.original)} ${chalk.dim('->')} ${chalk.green(migration.migrated)}\n`
  )
}

export function printRecommendation(rec: Recommendation): void {
  const actionLabel = rec.action === 'add-allow'
    ? chalk.green('[+allow]')
    : rec.action === 'add-deny'
      ? chalk.red('[+deny]')
      : rec.action === 'add-ask'
        ? chalk.yellow('[+ask]')
        : rec.action === 'remove'
          ? chalk.yellow('[remove]')
          : chalk.blue('[migrate]')

  process.stdout.write(`  ${actionLabel} ${chalk.bold(rec.pattern)}\n`)
  process.stdout.write(`    ${chalk.dim(rec.reason)}`)

  if (rec.stats) {
    process.stdout.write(
      ` ${chalk.dim(`(${rec.stats.allowed} allowed / ${rec.stats.denied} denied / ${rec.stats.prompted} prompted)`)}`
    )
  }
  process.stdout.write('\n')
}

export function printSuccess(msg: string): void {
  process.stdout.write(`${chalk.green('OK')} ${msg}\n`)
}

export function printWarning(msg: string): void {
  process.stdout.write(`${chalk.yellow('WARN')} ${msg}\n`)
}

export function printError(msg: string): void {
  process.stderr.write(`${chalk.red('ERROR')} ${msg}\n`)
}

