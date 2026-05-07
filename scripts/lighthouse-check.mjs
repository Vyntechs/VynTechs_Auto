#!/usr/bin/env node
// Lighthouse perf-budget check. Runs against http://localhost:3000/ and
// asserts Core Web Vitals + perf score against fixed budgets.
//
// Usage:
//   pnpm dev &                 # in another terminal
//   pnpm test:perf             # against the dev server
//   pnpm test:perf https://<preview>.vercel.app   # against any URL
//
// Optional dependency: `lighthouse` is heavy (~80MB) and not installed by
// default. If missing, this script prints install instructions and exits 0
// so it doesn't block the broader pipeline. Install with:
//   pnpm add -D lighthouse chrome-launcher
//
// Vercel Speed Insights is the primary perf gate in production — this script
// is for local deep-dives and CI on preview deploys.

const url = (process.argv[2] || process.env.PERF_URL || 'http://localhost:3000').replace(/\/$/, '')

const BUDGETS = {
  // Core Web Vitals — Google's "Good" thresholds.
  largestContentfulPaint: 2500, // ms
  cumulativeLayoutShift: 0.1,
  interactionToNextPaint: 200, // ms
  // Aggregated score, 0-100.
  performance: 0.9, // 90/100
}

let lighthouse, chromeLauncher
try {
  lighthouse = (await import('lighthouse')).default
  chromeLauncher = await import('chrome-launcher')
} catch {
  console.log('\nLighthouse is not installed. Skipping perf check.')
  console.log('To enable: pnpm add -D lighthouse chrome-launcher\n')
  process.exit(0)
}

console.log(`\nLighthouse: ${url}`)
console.log('  budgets: LCP < 2500ms, CLS < 0.1, INP < 200ms, perf >= 0.9\n')

const chrome = await chromeLauncher.launch({ chromeFlags: ['--headless=new', '--no-sandbox'] })

try {
  const result = await lighthouse(
    url,
    {
      port: chrome.port,
      onlyCategories: ['performance'],
      output: 'json',
      logLevel: 'error',
    },
    undefined,
  )

  if (!result) throw new Error('Lighthouse returned no result')
  const lhr = result.lhr

  const score = lhr.categories.performance.score ?? 0
  const audits = lhr.audits
  const lcp = audits['largest-contentful-paint']?.numericValue ?? Infinity
  const cls = audits['cumulative-layout-shift']?.numericValue ?? Infinity
  const inp = audits['interaction-to-next-paint']?.numericValue ?? null

  let pass = 0
  let fail = 0
  function check(label, ok, detail = '') {
    const mark = ok ? '✓' : '✗'
    const color = ok ? '\x1b[32m' : '\x1b[31m'
    const reset = '\x1b[0m'
    console.log(`  ${color}${mark}${reset} ${label}${detail ? ` — ${detail}` : ''}`)
    if (ok) pass++
    else fail++
  }

  check(`Performance score >= ${BUDGETS.performance}`, score >= BUDGETS.performance, `${score.toFixed(2)}`)
  check(`LCP < ${BUDGETS.largestContentfulPaint}ms`, lcp <= BUDGETS.largestContentfulPaint, `${lcp.toFixed(0)}ms`)
  check(`CLS < ${BUDGETS.cumulativeLayoutShift}`, cls <= BUDGETS.cumulativeLayoutShift, cls.toFixed(3))
  if (inp != null) {
    check(`INP < ${BUDGETS.interactionToNextPaint}ms`, inp <= BUDGETS.interactionToNextPaint, `${inp.toFixed(0)}ms`)
  } else {
    console.log('  - INP not measured (page may need user interaction)')
  }

  console.log(`\n  ${pass} passed, ${fail} failed\n`)
  process.exit(fail === 0 ? 0 : 1)
} finally {
  await chrome.kill()
}
