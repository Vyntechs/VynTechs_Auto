// Reusable curator-screenshot + contact-sheet tool.
//
// Signs in once via Supabase (node) → builds the sb-<ref>-auth-token cookie
// (mirrors tests/e2e/global-setup.ts) → drives Playwright across a set of
// routes × viewports → composes ONE contact sheet so all shots read in a
// single glance.
//
// Usage:  node .design-shots/sheet.mjs
//   BASE=http://localhost:3210 (default)
//
// Edit SHOTS below to point at different routes/cases.

import { chromium } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import * as fs from 'node:fs'
import * as path from 'node:path'

const BASE = process.env.BASE || 'http://localhost:3210'
const OUT_DIR = path.resolve(process.cwd(), '.design-shots/out')

const SHOTS = [
  { label: 'P0087 fuel-rail-pressure-low', url: '/curator/topology?symptom=p0087-fuel-rail-pressure-too-low' },
  { label: 'No-start (cranks normally)', url: '/curator/topology?symptom=no-start-cranks-normally-fuel-system-suspect' },
]
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
]

function loadEnvLocal() {
  const envPath = path.resolve(process.cwd(), '.env.local')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
    }
  }
}

async function buildAuthCookie() {
  const email = process.env.TEST_USER_EMAIL
  const password = process.env.TEST_USER_PASSWORD
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!email || !password || !url || !anon) {
    throw new Error('Missing TEST_USER_EMAIL/PASSWORD or SUPABASE url/anon in .env.local')
  }
  const supabase = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`signInWithPassword failed: ${error.message}`)
  const ref = url.match(/^https?:\/\/([^.]+)\./)[1]
  return {
    name: `sb-${ref}-auth-token`,
    value: 'base64-' + Buffer.from(JSON.stringify(data.session)).toString('base64'),
    domain: 'localhost',
    path: '/',
    httpOnly: false,
    secure: false,
    sameSite: 'Lax',
  }
}

async function main() {
  loadEnvLocal()
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const cookie = await buildAuthCookie()

  const browser = await chromium.launch()
  const cells = []
  for (const shot of SHOTS) {
    for (const vp of VIEWPORTS) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } })
      await ctx.addCookies([cookie])
      const page = await ctx.newPage()
      const file = path.join(OUT_DIR, `${shot.url.replace(/[^a-z0-9]+/gi, '_')}_${vp.name}.png`)
      try {
        await page.goto(BASE + shot.url, { waitUntil: 'networkidle', timeout: 45000 })
        await page.waitForSelector('.react-flow__node, .topo-node', { timeout: 20000 }).catch(() => {})
        await page.waitForTimeout(1800)
      } catch (e) {
        console.error(`! ${shot.label} ${vp.name}: ${e.message}`)
      }
      await page.screenshot({ path: file })
      cells.push({ label: `${shot.label} — ${vp.name}`, file })
      await ctx.close()
      console.log(`captured ${shot.label} ${vp.name}`)
    }
  }

  // Compose a single contact sheet by rendering the shots into an HTML grid.
  const sheetPage = await (await browser.newContext({ viewport: { width: 1700, height: 1200 } })).newPage()
  const html = `<html><body style="margin:0;background:#0b0b0c;font-family:ui-sans-serif,system-ui;padding:16px">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      ${cells
        .map((c) => {
          const b64 = fs.readFileSync(c.file).toString('base64')
          return `<div style="background:#161618;border:1px solid #2a2a2e;border-radius:10px;overflow:hidden">
            <div style="color:#e6e6e6;font-size:13px;padding:8px 12px;border-bottom:1px solid #2a2a2e">${c.label}</div>
            <img src="data:image/png;base64,${b64}" style="width:100%;display:block"/>
          </div>`
        })
        .join('')}
    </div></body></html>`
  await sheetPage.setContent(html, { waitUntil: 'networkidle' })
  await sheetPage.waitForTimeout(500)
  const sheetPath = path.join(OUT_DIR, 'sheet.png')
  await sheetPage.screenshot({ path: sheetPath, fullPage: true })
  await browser.close()
  console.log(`\nCONTACT SHEET: ${sheetPath}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
