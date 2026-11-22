import assert from 'node:assert/strict'
import test from 'node:test'
import { renderBrief, renderJson, renderText, triage } from '../src/triage.js'

const TS_LOG = [
  '> tsc --noEmit',
  '',
  'src/a.ts(42,11): error TS2304: Cannot find name \'foo\'.',
  'src/b.ts(7,3): error TS2307: Cannot find module \'./missing\' or its corresponding type declarations.',
  'Found 2 errors in 2 files.',
].join('\n')

test('finds TypeScript errors with file, line and fix', () => {
  const result = triage(TS_LOG)
  assert.equal(result.findings.length, 2)
  assert.equal(result.rootCause?.rule, 'TS2304')
  assert.equal(result.rootCause?.file, 'src/a.ts')
  assert.equal(result.rootCause?.line, 42)
  assert.match(result.rootCause?.fix ?? '', /Import or declare/)
  assert.equal(result.ok, false)
})

test('detects missing npm module', () => {
  const result = triage('npm ERR! 404 Not Found - GET https://registry.npmjs.org/nope\nCannot find module \'nope\'')
  assert.ok(result.findings.some((finding) => finding.rule === 'MODULE_NOT_FOUND'))
  assert.ok(result.findings.some((finding) => finding.rule === 'NPM_404'))
})

test('detects ESLint errors with rule names', () => {
  const log = '/app/src/x.ts:3:7:  error  \'x\' is defined but never used  no-unused-vars'
  const result = triage(log)
  assert.equal(result.findings[0]?.rule, 'no-unused-vars')
  assert.equal(result.findings[0]?.line, 3)
  assert.match(result.findings[0]?.fix ?? '', /unused binding/)
})

test('detects Python and SQL failures', () => {
  const python = triage('E   ModuleNotFoundError: No module named \'requests\'')
  assert.equal(python.rootCause?.rule, 'ModuleNotFoundError')
  assert.match(python.rootCause?.fix ?? '', /pip install/)
  const sql = triage('SQLSTATE[42S02]: Base table or view not found: 1146 Table \'db.users\' doesn\'t exist')
  assert.equal(sql.rootCause?.rule, 'SQLSTATE_42S02')
})

test('handles GitHub annotations and generic failures', () => {
  const result = triage('::error file=src/main.ts,line=9,col=2::boom\nBUILD FAILED')
  assert.equal(result.findings[0]?.rule, 'GH_ANNOTATION')
  assert.equal(result.findings[0]?.file, 'src/main.ts')
  assert.ok(result.findings.some((finding) => finding.rule === 'GENERIC_ERROR'))
})

test('deduplicates identical errors', () => {
  const line = 'src/a.ts(1,1): error TS2304: Cannot find name \'x\'.'
  const result = triage(`${line}\n${line}\n${line}`)
  assert.equal(result.findings.length, 1)
})

test('respects maxFindings and reports truncation', () => {
  const lines = Array.from({ length: 10 }, (_, i) => `src/a.ts(${i + 1},1): error TS2304: Cannot find name 'x${i}'.`)
  const result = triage(lines.join('\n'), { maxFindings: 3 })
  assert.equal(result.findings.length, 3)
  assert.equal(result.truncated, true)
})

test('reports clean logs without inventing findings', () => {
  const result = triage('$ npm test\nAll 26 tests passed.\nDone in 3s.')
  assert.equal(result.ok, true)
  assert.equal(result.rootCause, null)
  assert.match(renderText(result), /No recognizable failure signature/)
})

test('renders a brief root-cause view', () => {
  const result = triage(TS_LOG)
  const brief = renderBrief(result)
  assert.equal(brief.split('\n').length, 3)
  assert.match(brief, /^TS2304 src\/a\.ts:42/)
  assert.match(brief, /Fix: Import or declare/)
})

test('renders JSON with the root cause', () => {
  const result = triage(TS_LOG)
  const parsed = JSON.parse(renderJson(result))
  assert.equal(parsed.rootCause.rule, 'TS2304')
  assert.equal(parsed.findings.length, 2)
  assert.equal(typeof parsed.elapsedMs, 'number')
})
