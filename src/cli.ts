#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { renderBrief, renderJson, renderText, triage } from './triage.js'

const VERSION = '1.0.0'

function usage(): string {
  return [
    'ci-triage — turn a failed CI log into a root cause and a fix',
    '',
    'Usage:',
    '  ci-triage <logfile> [more.logs...] [options]',
    '  cat failed.log | ci-triage [options]',
    '',
    'Options:',
    '  --brief           Print only the root cause and its fix',
    '  --json            Emit structured JSON',
    '  --max <n>         Maximum findings to keep (default 50)',
    '  -h, --help        Show this help',
    '  -v, --version     Show version',
    '',
    'Exit codes: 0 report produced, 2 usage/IO error.',
  ].join('\n')
}

function main(): void {
  const args = process.argv.slice(2)
  if (args.includes('-h') || args.includes('--help')) {
    process.stdout.write(`${usage()}\n`)
    return
  }
  if (args.includes('-v') || args.includes('--version')) {
    process.stdout.write(`${VERSION}\n`)
    return
  }

  const asJson = args.includes('--json')
  const brief = args.includes('--brief')
  const maxIndex = args.indexOf('--max')
  let maxFindings = 50
  if (maxIndex >= 0) {
    const raw = args[maxIndex + 1]
    if (!raw || !/^\d+$/.test(raw)) throw new Error('--max needs a positive integer')
    maxFindings = Number.parseInt(raw, 10)
  }

  const files: string[] = []
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--max') {
      i += 1
      continue
    }
    if (args[i].startsWith('-')) continue
    files.push(args[i])
  }

  let log: string
  if (files.length === 0 || files[0] === '-') {
    log = readFileSync(0, 'utf8')
  } else {
    log = files.map((file) => readFileSync(file, 'utf8')).join('\n')
  }

  const result = triage(log, { maxFindings })
  const output = asJson ? renderJson(result) : brief ? renderBrief(result) : renderText(result, VERSION)
  process.stdout.write(`${output}\n`)
}

try {
  main()
} catch (error) {
  process.stderr.write(`ci-triage: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 2
}
