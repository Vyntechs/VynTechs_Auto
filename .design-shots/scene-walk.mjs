// INTEGRATION live-route walker for the REBUILT assembled diagram.
// Signs in via Supabase (proven sheet.mjs cookie), loads each seeded symptom on
// the LIVE /curator/topology route at desktop 1440 + mobile 375, waits for the
// new `.topo__assembled` view (or the honest `.topo__no-plan` degrade), captures
// console/page errors per frame, plus a "Whole system" escape toggle on one
// symptom, then composes ONE contact sheet. 375 is the hard gate.
// Usage: BASE=http://localhost:3210 node .design-shots/scene-walk.mjs
import { chromium } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import * as fs from 'node:fs'
import * as path from 'node:path'

const BASE = process.env.BASE || 'http://localhost:3210'
const OUT_DIR = path.resolve(process.cwd(), '.design-shots/out')

const SYMPTOMS = [
  { slug: 'p0087-fuel-rail-pressure-too-low', label: 'P0087 rail-pressure-low' },
  { slug: 'p0088-fuel-rail-pressure-too-high', label: 'P0088 rail-pressure-high' },
  { slug: 'no-start-cranks-normally-fuel-system-suspect', label: 'No-start cranks-normally' },
]
const VIEWPORTS = [
  { name: 'desktop-1440', width: 1440, height: 900, dsf: 2 },
  { name: 'mobile-375', width: 375, height: 812, dsf: 3 }, // HARD gate
]

function loadEnvLocal() {
  const envPath = path.resolve(process.cwd(), '.env.local')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
  }
}

async function buildAuthCookie() {
  const email = process.env.TEST_USER_EMAIL
  const password = process.env.TEST_USER_PASSWORD
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!email || !password || !url || !anon) throw new Error('Missing TEST_USER_* or SUPABASE url/anon in .env.local')
  const supabase = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`signInWithPassword failed: ${error.message}`)
  const ref = url.match(/^https?:\/\/([^.]+)\./)[1]
  return {
    name: `sb-${ref}-auth-token`,
    value: 'base64-' + Buffer.from(JSON.stringify(data.session)).toString('base64'),
    domain: 'localhost', path: '/', httpOnly: false, secure: false, sameSite: 'Lax',
  }
}

const cells = []
const allErrs = []

async function capture(browser, cookie, slug, label, vp, { wholeSystem = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.dsf })
  await ctx.addCookies([cookie])
  const page = await ctx.newPage()
  const errs = []
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
  page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message))
  const tag = `${label}${wholeSystem ? ' · whole-system' : ''} · ${vp.name}`
  try {
    await page.goto(`${BASE}/curator/topology?symptom=${slug}`, { waitUntil: 'networkidle', timeout: 60000 })
    // wait for the new assembled view OR the honest zero-step degrade.
    await page.waitForSelector('.topo__assembled, .topo__no-plan, .topo__not-found', { timeout: 25000 }).catch(() => {})
    if (wholeSystem) {
      await page.getByRole('button', { name: /whole system/i }).first().click().catch(() => {})
      await page.waitForTimeout(1200)
    }
    await page.waitForTimeout(1400)
  } catch (e) {
    errs.push(`GOTO ${e.message}`)
  }
  const file = path.join(OUT_DIR, `walk_${slug}_${wholeSystem ? 'whole_' : ''}${vp.name}.png`)
  await page.screenshot({ path: file, fullPage: true })
  cells.push({ label: tag, file })
  if (errs.length) allErrs.push(`${tag}: ${errs.slice(0, 6).join(' | ')}`)
  console.log(`captured ${tag} · consoleErrors=${errs.length}`)
  await ctx.close()
}

async function main() {
  loadEnvLocal()
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const cookie = await buildAuthCookie()
  // Use whatever chromium headless-shell is actually installed (sidesteps the
  // @playwright/test revision-vs-installed mismatch). Falls back to the default.
  const cacheRoot = path.join(process.env.HOME, 'Library/Caches/ms-playwright')
  let executablePath
  try {
    // Pick the dir whose binary ACTUALLY EXISTS (empty stub dirs sort first).
    for (const dir of fs.readdirSync(cacheRoot).filter((d) => d.startsWith('chromium_headless_shell-'))) {
      const cand = path.join(cacheRoot, dir, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell')
      if (fs.existsSync(cand)) { executablePath = cand; break }
    }
  } catch { /* fall back to default */ }
  if (!executablePath) throw new Error('no installed chrome-headless-shell binary found under ' + cacheRoot)
  console.log('using browser:', executablePath)
  const browser = await chromium.launch({ executablePath })

  for (const s of SYMPTOMS) {
    for (const vp of VIEWPORTS) await capture(browser, cookie, s.slug, s.label, vp)
  }
  // Bonus: prove the "Whole system" escape drops into the retained xyflow view.
  await capture(browser, cookie, SYMPTOMS[0].slug, SYMPTOMS[0].label, VIEWPORTS[0], { wholeSystem: true })

  // Compose ONE contact sheet.
  const sp = await (await browser.newContext({ viewport: { width: 2400, height: 1500 } })).newPage()
  const html = `<html><body style="margin:0;background:#0b0b0c;font-family:ui-monospace,monospace;padding:16px">
    <div style="color:#9aa;font:600 12px ui-monospace;padding:0 0 12px">SCENE walk — ${cells.length} frames · console errors: ${allErrs.length ? allErrs.length : 'NONE'}</div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">
    ${cells.map((c) => {
      const b64 = fs.readFileSync(c.file).toString('base64')
      return `<div style="background:#161618;border:1px solid #2a2a2e;border-radius:8px;overflow:hidden">
        <div style="color:#e6e6e6;font-size:12px;padding:7px 10px;border-bottom:1px solid #2a2a2e">${c.label}</div>
        <img src="data:image/png;base64,${b64}" style="width:100%;display:block"/></div>`
    }).join('')}
    </div></body></html>`
  await sp.setContent(html, { waitUntil: 'networkidle' })
  await sp.waitForTimeout(400)
  const out = path.join(OUT_DIR, 'scene-walk-sheet.png')
  await sp.screenshot({ path: out, fullPage: true })
  await browser.close()
  console.log(`\nCONTACT SHEET: ${out}`)
  console.log(allErrs.length ? `CONSOLE ERRORS:\n${allErrs.join('\n')}` : 'NO CONSOLE ERRORS')
  process.exitCode = allErrs.length ? 1 : 0
}
main().catch((e) => { console.error(e); process.exit(1) })
