#!/usr/bin/env node
// The full Vitest suite is database-heavy: run as one monolithic process it
// exits without an observable result under load, and its failure count has
// varied on identical source. Every release plan since Row 54 therefore
// documents the same policy in prose — eight serialized shards, at most two
// workers. This script is that policy, executable, so CI and a local branch
// gate prove the suite the same way instead of re-deriving the invocation.
import { spawnSync } from 'node:child_process'

const SHARDS = 8
const failed = []
let totalPassed = 0

for (let shard = 1; shard <= SHARDS; shard += 1) {
  process.stdout.write(`\n=== shard ${shard}/${SHARDS} ===\n`)
  const run = spawnSync(
    'pnpm',
    [
      'exec',
      'vitest',
      'run',
      `--shard=${shard}/${SHARDS}`,
      '--maxWorkers=2',
      '--reporter=dot',
    ],
    { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' },
  )

  const stdout = run.stdout ?? ''
  process.stdout.write(stdout)

  // Sum the per-shard counts so the receipt is a real total, not a guess.
  const passed = stdout.match(/Tests\s+(?:\d+ failed \| )?(\d+) passed/)
  if (passed) totalPassed += Number(passed[1])
  if (run.status !== 0) failed.push(shard)
}

process.stdout.write(`\n=== ${totalPassed} tests passed across ${SHARDS} shards ===\n`)

if (failed.length > 0) {
  process.stdout.write(`FAILED shards: ${failed.join(', ')}\n`)
  process.exit(1)
}
