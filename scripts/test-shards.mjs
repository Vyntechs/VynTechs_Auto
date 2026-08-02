#!/usr/bin/env node
// The full Vitest suite is database-heavy: run as one monolithic process it
// exits without an observable result under load, and its failure count has
// varied on identical source. Every release plan since Row 54 therefore
// documents the same policy in prose — eight serialized shards, at most two
// workers. This script is that policy, executable, so CI and a local branch
// gate prove the suite the same way instead of re-deriving the invocation.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SHARDS = 8
const failed = []
let totalPassed = 0

// Run the installed Vitest directly with this Node. Shelling out to `pnpm`
// meant a shell without pnpm on PATH produced ENOENT on every shard, which the
// old status check reported as "0 tests passed, all 8 shards FAILED" — a red
// gate that never ran a test.
const VITEST = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../node_modules/vitest/vitest.mjs',
)

if (!existsSync(VITEST)) {
  process.stderr.write(`Cannot find Vitest at ${VITEST}. Install dependencies first.\n`)
  process.exit(1)
}

for (let shard = 1; shard <= SHARDS; shard += 1) {
  process.stdout.write(`\n=== shard ${shard}/${SHARDS} ===\n`)
  const run = spawnSync(
    process.execPath,
    [
      VITEST,
      'run',
      `--shard=${shard}/${SHARDS}`,
      '--maxWorkers=2',
      '--reporter=dot',
    ],
    { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' },
  )

  // A shard that could not start is not a shard that failed its tests. Say so,
  // and stop, rather than reporting an unrun suite as a legible red result.
  if (run.error) {
    process.stderr.write(`\nShard ${shard} could not start: ${run.error.message}\n`)
    process.exit(1)
  }

  const stdout = run.stdout ?? ''
  process.stdout.write(stdout)

  // Sum the per-shard counts so the receipt is a real total, not a guess.
  const passed = stdout.match(/Tests\s+(?:\d+ failed \| )?(\d+) passed/)
  if (passed) totalPassed += Number(passed[1])
  if (run.status !== 0) failed.push(shard)
}

// Zero tests across eight shards means the runner, not the code, is broken.
if (totalPassed === 0) {
  process.stderr.write('\nNo shard reported any test. The runner did not execute the suite.\n')
  process.exit(1)
}

process.stdout.write(`\n=== ${totalPassed} tests passed across ${SHARDS} shards ===\n`)

if (failed.length > 0) {
  process.stdout.write(`FAILED shards: ${failed.join(', ')}\n`)
  process.exit(1)
}
