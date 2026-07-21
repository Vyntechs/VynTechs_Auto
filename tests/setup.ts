import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Client command surfaces keep short-lived timers while mounted. Explicit
// cleanup keeps each test isolated and prevents a rendered board from leaking
// its live-refresh timer into a later suite shard.
afterEach(cleanup)

if (process.env.DIAGNOSTICS_RELEASE === undefined) {
  process.env.DIAGNOSTICS_RELEASE = 'legacy'
}
