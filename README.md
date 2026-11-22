# ci-triage

A zero-dependency Node/TypeScript CLI that reads a failed CI log and returns **the root cause + the fix**, not the whole wall of text.

Paste a build log, a `tsc` failure, an npm error, pytest output, a Laravel/PHPUnit error, or a GitHub Actions annotation. The tool parses known failure signatures, ranks them (typed compiler errors and file/line hits win over generic lines), deduplicates repeats, and prints one actionable finding first.

No network calls, no API keys, no telemetry — it runs entirely on the log you give it.

## Usage

```bash
npm install
npm run build

# shortest form: one root cause + fix
node dist/src/cli.js --brief failed.log

# full report: root cause + every other finding
node dist/src/cli.js failed.log

# structured output for automation
node dist/src/cli.js --json failed.log > triage.json

# stdin, multiple logs, limit findings
cat failed.log | node dist/src/cli.js -
node dist/src/cli.js a.log b.log --max 10
```

Output of `--brief` on the included real log:

```text
TS2322 examples/broken.ts:3
Type 'string' is not assignable to type 'number'.
Fix: Make the value match the declared type, or widen the type explicitly in examples/broken.ts.
```

Full output format:

```text
ci-triage v1.0.0 — scanned 19 lines in 4.68ms

ROOT CAUSE
  TS2322  examples/broken.ts:3
  Type 'string' is not assignable to type 'number'.
  Fix: Make the value match the declared type, or widen the type explicitly in examples/broken.ts.

OTHER FINDINGS (12)
  ...
```

Exit codes: `0` report produced, `2` usage or file-read error.

## What it recognizes

| Source | Example signature | Rule emitted |
| --- | --- | --- |
| TypeScript | `src/a.ts(42,11): error TS2304: Cannot find name 'foo'.` | `TS2304` |
| TypeScript (colon format) | `src/a.ts:42:11 - error TS2304: ...` | `TS2304` |
| ESLint | `src/a.ts:3:7: error 'x' is never used no-unused-vars` | `no-unused-vars` |
| npm | `Cannot find module 'x'`, `npm error code E404` | `MODULE_NOT_FOUND`, `NPM_E404` |
| Vite / Rollup | `Could not resolve "x" from "src/a.ts"` | `UNRESOLVED_IMPORT` |
| pytest | `E   ModuleNotFoundError: No module named 'x'`, `FAILED tests/...` | `ModuleNotFoundError`, `PYTEST_FAILED` |
| Laravel / PHPUnit | `SQLSTATE[42S02]: Base table or view not found` | `SQLSTATE_42S02` |
| GitHub Actions | `::error file=src/a.ts,line=9,col=2::boom` | `GH_ANNOTATION` |
| Anything else | `BUILD FAILED`, `fatal: ...`, `error: ...` | `GENERIC_ERROR` |

Each rule maps to a concrete fix suggestion. Ranking favors typed compiler errors, then module/resolution errors, then lint/generic lines; findings with `file:line` get a bonus and earlier lines win ties.

## Real usage / before–after

`examples/real-ci-failure.log` is **captured output**, not invented: `tsc --noEmit --strict` against a deliberately broken TypeScript file plus `npm view` for a package that does not exist. Raw output is committed verbatim; the broken source file was removed after capture.

Measured on Node 24.17 / Windows, 20 runs:

| | Before | After |
| --- | --- | --- |
| Lines a human scans | 19 lines containing 13 distinct errors | 3 lines (`--brief`) |
| Root cause selected | manual judgment across mixed TS + npm failures | `TS2322 examples/broken.ts:3` |
| Time to produce that answer | manual, not measured | **4.68 ms average** (min 3.98, max 6.31) |

Reproduce it:

```bash
npm test
node dist/src/cli.js --brief examples/real-ci-failure.log
node dist/src/cli.js --json examples/real-ci-failure.log
```

Saved runs: `examples/real-ci-failure.log`, `examples/real-triage-output.txt`, `examples/real-brief-output.txt`.

## Design

- `src/triage.ts` — pure parser/ranker/renderers; no I/O, easy to test.
- `src/cli.ts` — argument parsing, stdin/file input, exit codes.
- `test/triage.test.ts` — 10 `node:test` cases covering every signature family, dedupe, limits, clean logs, and both renderers.
- `.github/workflows/ci.yml` — `npm ci && npm test` on push and PR.

MIT licensed.
