#!/usr/bin/env node
// Production / preview smoke test. Hits a few well-known surfaces of any
// deployed Vyntechs app and prints ✓/✗ per check. Exits 0 on all-green,
// non-zero on any failure.
//
// Usage:
//   pnpm test:smoke                              # defaults to https://vyntechs.dev
//   pnpm test:smoke https://<branch>.vercel.app
//   SMOKE_URL=https://staging.example.com pnpm test:smoke
//
// Read-only — never mutates remote state.

const DEFAULT_URL = 'https://vyntechs.dev'
const url = (process.argv[2] || process.env.SMOKE_URL || DEFAULT_URL).replace(/\/$/, '')

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

async function fetchText(path, opts = {}) {
  const res = await fetch(`${url}${path}`, { redirect: 'manual', ...opts })
  const body = await res.text()
  return { status: res.status, body, headers: res.headers }
}

async function main() {
  console.log(`\nSmoke: ${url}\n`)

  // 1) Health endpoint
  try {
    const { status, body } = await fetchText('/api/health')
    const ok = status === 200
    let detail = `HTTP ${status}`
    if (ok) {
      try {
        const json = JSON.parse(body)
        const pingOk = json.pingOk === true
        check('GET /api/health returns 200', true)
        check('  health.pingOk === true (database reachable)', pingOk, json.pingError ? JSON.stringify(json.pingError) : '')
        check('  health.supabaseUrl present', Boolean(json.supabaseUrl))
        check('  health.anthropicKeyPresent === true', json.anthropicKeyPresent === true)
        check('  health.voyageKeyPresent === true', json.voyageKeyPresent === true)
      } catch (e) {
        check('  /api/health body is JSON', false, String(e))
      }
    } else {
      check('GET /api/health returns 200', false, detail)
    }
  } catch (e) {
    check('GET /api/health reachable', false, String(e))
  }

  // 2) Landing page
  try {
    const { status, body } = await fetchText('/')
    const ok = status === 200 && body.includes('AI master tech for the bay.')
    check('GET / returns 200 with the landing h1', ok, `HTTP ${status}`)
  } catch (e) {
    check('GET / reachable', false, String(e))
  }

  // 3) Sign-in page
  try {
    const { status, body } = await fetchText('/sign-in')
    const ok = status === 200 && body.includes('id="email"') && body.includes('id="password"')
    check('GET /sign-in returns 200 with email + password fields', ok, `HTTP ${status}`)
  } catch (e) {
    check('GET /sign-in reachable', false, String(e))
  }

  // 4) Curator gate (anon → /sign-in). Once Phase P merges to main, the
  //    only acceptable response is the 307/302 redirect — set
  //    CURATOR_DEPLOYED=1 to drop the 404-tolerant branch and treat 404 as
  //    a hard failure (catches misconfigured auth gates that return
  //    notFound() where they should redirect).
  try {
    const { status, headers } = await fetchText('/curator/drift')
    const loc = headers.get('location') || ''
    const redirected = (status === 307 || status === 302) && loc.includes('/sign-in')
    const allow404 = process.env.CURATOR_DEPLOYED !== '1' && status === 404
    if (redirected) {
      check('GET /curator/drift as anon redirects to /sign-in', true, `HTTP ${status} → ${loc}`)
    } else if (allow404) {
      check(
        'GET /curator/drift not deployed yet (404 — set CURATOR_DEPLOYED=1 once Phase P ships to main)',
        true,
      )
    } else {
      check(
        'GET /curator/drift as anon should redirect to /sign-in',
        false,
        `HTTP ${status} → ${loc || '(no location header)'}`,
      )
    }
  } catch (e) {
    check('GET /curator/drift reachable', false, String(e))
  }

  // 5) Static assets — favicon
  try {
    const { status } = await fetchText('/favicon.ico')
    const ok = status === 200
    check('GET /favicon.ico returns 200', ok, `HTTP ${status}`)
  } catch (e) {
    check('GET /favicon.ico reachable', false, String(e))
  }

  console.log(`\n  ${pass} passed, ${fail} failed\n`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('\nSmoke runner crashed:', e)
  process.exit(2)
})
