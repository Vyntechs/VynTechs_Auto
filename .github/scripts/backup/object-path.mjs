function fail(message) {
  throw new Error(`encrypted backup path failed: ${message}`)
}

export function deriveBackupPath(eventName, runId) {
  if (typeof runId !== 'string' || !/^\d+$/.test(runId)) {
    fail('GitHub run identifier is invalid')
  }

  if (eventName === 'schedule') {
    return `database-backups/daily/vyntechs-run-${runId}.dump.age`
  }
  if (eventName === 'workflow_dispatch') {
    return `database-backups/manual/vyntechs-run-${runId}.dump.age`
  }
  fail('event is not authorized for backups')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [eventName, runId] = process.argv.slice(2)
  try {
    if (process.argv.length !== 4) fail('event and run identifier are required')
    process.stdout.write(`${deriveBackupPath(eventName, runId)}\n`)
  } catch {
    console.error('encrypted backup path failed')
    process.exitCode = 1
  }
}
