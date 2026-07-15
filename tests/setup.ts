import '@testing-library/jest-dom/vitest'

if (process.env.DIAGNOSTICS_RELEASE === undefined) {
  process.env.DIAGNOSTICS_RELEASE = 'legacy'
}
