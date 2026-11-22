export type Severity = 'error' | 'warning'

export interface Finding {
  rule: string
  severity: Severity
  file?: string
  line?: number
  column?: number
  message: string
  fix: string
  evidence: string
  index: number
}

export interface TriageOptions {
  maxFindings?: number
}

export interface TriageResult {
  ok: boolean
  rootCause: Finding | null
  findings: Finding[]
  scannedLines: number
  elapsedMs: number
  truncated: boolean
}

type Groups = Record<string, string | undefined>

const TS_FULL = /^\s*(?<file>[^\s(]+)\((?<line>\d+),(?<col>\d+)\):\s*error\s+(?<rule>TS\d+):\s*(?<msg>.+)$/
const TS_COLON = /^\s*(?<file>[^\s:]+):(?<line>\d+):(?<col>\d+)\s*-\s*error\s+(?<rule>TS\d+):\s*(?<msg>.+)$/
const TS_BARE = /^\s*error\s+(?<rule>TS\d+):\s*(?<msg>.+)$/
const ESLINT = /^\s*(?<file>[^\s:]+):(?<line>\d+):(?<col>\d+):\s*(?<severity>error|warning)\s+(?<msg>.+?)\s+(?<rule>@?[\w-]+(?:\/[\w-]+)*)\s*$/
const MODULE = /\bCannot find module ['"](?<mod>[^'"]+)['"]/i
const RESOLVE = /\bCould not resolve ["'](?<mod>[^"']+)["'](?: from ["'](?<file>[^"']+)["'])?/i
const NPM_404 = /\bnpm (?:ERR!|error)\s*404\s+(?<msg>.+)$/i
const NPM_CODE = /\bnpm (?:ERR!|error)\s*code\s+(?<code>E[A-Z0-9_]+)/i
const PY_ERROR = /^\s*E\s+(?<rule>ModuleNotFoundError|ImportError|AssertionError|TypeError|KeyError|AttributeError):\s*(?<msg>.+)$/
const PY_FAILED = /^\s*FAILED\s+(?<file>\S+)/i
const SQLSTATE = /\bSQLSTATE\[(?<code>[^\]]+)\]\s*(?<msg>[^\n]+)/i
const PHP_EXCEPTION = /\b(?:ErrorException|Fatal error|Illuminate\\[\w\\]+Exception):\s*(?<msg>.+)$/
const GH_ANNOTATION = /::error\s+(?:file=(?<file>[^,]+),)?(?:line=(?<line>\d+),)?(?:col=(?<col>\d+),)?(?<msg>.+)/
const GENERIC = /^\s*(?:fatal:|error:|Error:|FAIL|Failed|BUILD FAILED|\u2716)\s*(?<msg>.*)$/i

function groups(match: RegExpMatchArray): Groups {
  return match.groups ?? {}
}

function num(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

function location(finding: Pick<Finding, 'file' | 'line'>): string {
  if (!finding.file) return ''
  return ` in ${finding.file}${finding.line === undefined ? '' : `:${finding.line}`}`
}

function suggestFix(rule: string, message: string, file?: string): string {
  const where = location({ file })
  if (/^TS2304$/.test(rule)) return `Import or declare the missing symbol${where}; check spelling.`
  if (/^TS2307$/.test(rule)) return `Install typings (npm i -D @types/<pkg>) or fix the import path / tsconfig paths${where}.`
  if (/^TS2322$/.test(rule)) return `Make the value match the declared type, or widen the type explicitly${where}.`
  if (/^TS2339$/.test(rule)) return `Property does not exist on this type — add it to the interface or narrow the type${where}.`
  if (/^TS2345$/.test(rule)) return `Argument type mismatch — fix the argument or the function signature${where}.`
  if (/^TS1005$|^TS1109$/.test(rule)) return `Syntax error — inspect the characters around the reported line${where}.`
  if (/^TS/.test(rule)) return `Read the compiler message at the reported location and apply the type/import fix${where}.`
  if (rule === 'MODULE_NOT_FOUND') {
    const match = message.match(/['"]([^'"]+)['"]/)
    return `Install ${match ? match[1] : 'the missing package'} (npm i <pkg>) and verify case/path.`
  }
  if (rule === 'UNRESOLVED_IMPORT') {
    const match = message.match(/["']([^"']+)["']/)
    return `Verify ${match ? match[1] : 'the import'} is installed and the path/alias matches the bundler config${where}.`
  }
  if (rule === 'NPM_404') return 'Package or version does not exist — check the name and registry.'
  if (/^NPM_/.test(rule)) return `Run the npm command locally to see the full error; fix reported ${rule} cause.`
  if (/unused/.test(rule)) return 'Remove the unused binding, or prefix it with _ when it is intentional.'
  if (/no-explicit-any/.test(rule)) return 'Replace any with the concrete type or an explicit unknown + narrow.'
  if (/^(@|no-|prefer-|require-|vue\/)/.test(rule) || rule.includes('/')) {
    return `Fix lint rule ${rule}${location({ file })}.`
  }
  if (rule === 'ModuleNotFoundError' || rule === 'ImportError') {
    const match = message.match(/No module named ['"]([^'"]+)['"]/)
    return `Add ${match ? match[1] : 'the module'} to requirements.txt (pip install <pkg>).`
  }
  if (rule === 'AssertionError') return 'Compare expected vs actual in the test diff; fix the code or the expectation.'
  if (rule === 'PYTEST_FAILED') return 'Open the failing test node and reproduce it locally with pytest.'
  if (/^SQLSTATE/.test(rule)) return 'Run pending migrations and verify DB credentials/schema for the reported table.'
  if (rule === 'PHP_EXCEPTION') return 'Open the reported file/line and guard the failing call or fix configuration.'
  if (rule === 'GH_ANNOTATION') return `Address the CI annotation${where}.`
  return `Open ${file ?? 'the reported file'} and address the reported error${where}.`
}

function parseLine(line: string): Omit<Finding, 'fix' | 'index'> | null {
  let match: RegExpMatchArray | null
  let g: Groups
  let rule: string
  let message: string
  let file: string | undefined
  let lineNo: number | undefined
  let column: number | undefined
  let severity: Severity = 'error'

  if ((match = line.match(TS_FULL)) || (match = line.match(TS_COLON))) {
    g = groups(match)
    rule = g.rule ?? 'TS_UNKNOWN'
    message = g.msg ?? line.trim()
    file = g.file
    lineNo = num(g.line)
    column = num(g.col)
  } else if ((match = line.match(TS_BARE))) {
    g = groups(match)
    rule = g.rule ?? 'TS_UNKNOWN'
    message = g.msg ?? line.trim()
  } else if ((match = line.match(ESLINT))) {
    g = groups(match)
    rule = g.rule ?? 'LINT'
    message = g.msg ?? line.trim()
    file = g.file
    lineNo = num(g.line)
    column = num(g.col)
    severity = g.severity === 'warning' ? 'warning' : 'error'
  } else if ((match = line.match(MODULE))) {
    rule = 'MODULE_NOT_FOUND'
    message = line.trim()
  } else if ((match = line.match(RESOLVE))) {
    g = groups(match)
    rule = 'UNRESOLVED_IMPORT'
    message = line.trim()
    file = g.file
  } else if ((match = line.match(NPM_404))) {
    rule = 'NPM_404'
    message = groups(match).msg ?? line.trim()
  } else if ((match = line.match(NPM_CODE))) {
    rule = `NPM_${groups(match).code ?? 'ERROR'}`
    message = line.trim()
  } else if ((match = line.match(PY_ERROR))) {
    g = groups(match)
    rule = g.rule ?? 'PY_ERROR'
    message = g.msg ?? line.trim()
  } else if ((match = line.match(PY_FAILED))) {
    rule = 'PYTEST_FAILED'
    message = line.trim()
    file = groups(match).file
  } else if ((match = line.match(SQLSTATE))) {
    g = groups(match)
    rule = `SQLSTATE_${g.code ?? 'UNKNOWN'}`
    message = g.msg ?? line.trim()
  } else if ((match = line.match(PHP_EXCEPTION))) {
    rule = 'PHP_EXCEPTION'
    message = groups(match).msg ?? line.trim()
  } else if ((match = line.match(GH_ANNOTATION))) {
    g = groups(match)
    rule = 'GH_ANNOTATION'
    message = g.msg ?? line.trim()
    file = g.file
    lineNo = num(g.line)
    column = num(g.col)
  } else if ((match = line.match(GENERIC))) {
    rule = 'GENERIC_ERROR'
    message = groups(match).msg ?? line.trim()
  } else {
    return null
  }

  return { rule, severity, file, line: lineNo, column, message, evidence: line.trim() }
}

function score(finding: Finding): number {
  let value = 0
  if (/^TS\d+$/.test(finding.rule)) value += 10
  else if (finding.rule === 'GH_ANNOTATION') value += 9
  else if (/^SQLSTATE/.test(finding.rule)) value += 9
  else if (['MODULE_NOT_FOUND', 'UNRESOLVED_IMPORT', 'NPM_404'].includes(finding.rule)) value += 8
  else if (/^NPM_/.test(finding.rule)) value += 7
  else if (['ModuleNotFoundError', 'ImportError', 'PYTEST_FAILED', 'AssertionError'].includes(finding.rule)) value += 7
  else if (/^(ErrorException|PHP_EXCEPTION)$/.test(finding.rule)) value += 6
  else if (/\/.+/.test(finding.rule)) value += 5
  else value += 3
  if (finding.file && finding.line !== undefined) value += 2
  return value - finding.index * 0.01
}

export function triage(log: string, options: TriageOptions = {}): TriageResult {
  const started = performance.now()
  const maxFindings = Math.max(1, options.maxFindings ?? 50)
  const lines = log.split(/\r?\n/)
  const findings: Finding[] = []
  const seen = new Set<string>()
  let truncated = false

  for (let i = 0; i < lines.length; i += 1) {
    const parsed = parseLine(lines[i])
    if (!parsed) continue
    const key = `${parsed.rule}|${parsed.file ?? ''}|${parsed.line ?? ''}|${parsed.message}`
    if (seen.has(key)) continue
    seen.add(key)
    if (findings.length === maxFindings) {
      truncated = true
      continue
    }
    findings.push({ ...parsed, fix: suggestFix(parsed.rule, parsed.message, parsed.file), index: i })
  }

  const sorted = [...findings].sort((a, b) => score(b) - score(a))
  return {
    ok: findings.length === 0,
    rootCause: sorted[0] ?? null,
    findings,
    scannedLines: lines.length,
    elapsedMs: Number((performance.now() - started).toFixed(2)),
    truncated,
  }
}

export function renderText(result: TriageResult, version = '1.0.0'): string {
  const head = `ci-triage v${version} — scanned ${result.scannedLines} lines in ${result.elapsedMs}ms`
  if (!result.rootCause) {
    return `${head}\n\nNo recognizable failure signature. Re-run with the full failed job log.`
  }

  const format = (finding: Finding): string => {
    const where = [finding.file, finding.line === undefined ? undefined : String(finding.line)]
      .filter(Boolean)
      .join(':')
    return [
      `  ${finding.rule}${where ? `  ${where}` : ''}`,
      `  ${finding.message}`,
      `  Fix: ${finding.fix}`,
    ].join('\n')
  }

  const others = result.findings.filter((f) => f !== result.rootCause)
  const blocks = [`ROOT CAUSE\n${format(result.rootCause)}`]
  if (others.length > 0) {
    blocks.push(`OTHER FINDINGS (${others.length}${result.truncated ? '+ truncated' : ''})\n${others.map(format).join('\n\n')}`)
  }
  return `${head}\n\n${blocks.join('\n\n')}`
}

export function renderBrief(result: TriageResult): string {
  if (!result.rootCause) return 'No recognizable failure signature.'
  const finding = result.rootCause
  const where = [finding.file, finding.line === undefined ? undefined : String(finding.line)]
    .filter(Boolean)
    .join(':')
  return `${finding.rule}${where ? ` ${where}` : ''}\n${finding.message}\nFix: ${finding.fix}`
}

export function renderJson(result: TriageResult): string {
  return JSON.stringify(result, null, 2)
}
