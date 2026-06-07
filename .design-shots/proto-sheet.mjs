// Screenshot harness for the 3 canvas-direction prototypes (static HTML).
// No auth needed — they're served by `python3 -m http.server 3300` from
// .design-shots/mockups. Captures desktop + mobile for each, composes ONE
// contact sheet so all read in a single glance.
//
// Usage:  node .design-shots/proto-sheet.mjs            (initial state only)
//         node .design-shots/proto-sheet.mjs --interact (best-effort: also
//           clicks a "next test" control + a pin to capture the mechanic)
//
// BASE=http://localhost:3300 (default)

import { chromium } from '@playwright/test'
import * as fs from 'node:fs'
import * as path from 'node:path'

const BASE = process.env.BASE || 'http://localhost:3300'
const OUT_DIR = path.resolve(process.cwd(), '.design-shots/out')
const INTERACT = process.argv.includes('--interact')

const PROTOS = [
  { key: 'drive', label: 'The Drive', file: 'proto-drive.html' },
  { key: 'dimmer', label: 'The Dimmer', file: 'proto-dimmer.html' },
  { key: 'meter', label: 'The Meter', file: 'proto-meter.html' },
]
const DESKTOP = { name: 'desktop', width: 1440, height: 900 }
const MOBILE = { name: 'mobile', width: 390, height: 844 }

async function shoot(browser, vp, file, url, interactions = []) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  const cells = []
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })
    await page.waitForTimeout(900) // fonts + entrance motion settle
    await page.screenshot({ path: file })
    cells.push(file)
  } catch (e) {
    console.error(`! ${url} ${vp.name}: ${e.message}`)
    await page.screenshot({ path: file }).catch(() => {})
  }
  // Best-effort interaction captures (desktop only).
  for (const step of interactions) {
    try {
      const loc = page.locator(step.selector).first()
      if (await loc.count()) {
        await loc.click({ timeout: 2500 })
        await page.waitForTimeout(900)
        const f = file.replace(/\.png$/, `_${step.tag}.png`)
        await page.screenshot({ path: f })
        cells.push(f)
      }
    } catch (e) {
      console.error(`  (interaction ${step.tag} skipped: ${e.message.split('\n')[0]})`)
    }
  }
  await ctx.close()
  return cells
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const browser = await chromium.launch()
  const sheet = [] // {label, file}

  for (const p of PROTOS) {
    const url = `${BASE}/${p.file}`
    // Desktop (+ optional interaction sequence)
    const dFile = path.join(OUT_DIR, `proto_${p.key}_desktop.png`)
    const interactions = INTERACT
      ? [
          { selector: 'text=/next test/i', tag: 'next' },
          { selector: '[data-pin], .pin, [class*="pin"]', tag: 'tapped' },
          { selector: 'text=/whole system/i', tag: 'whole' },
        ]
      : []
    const dCells = await shoot(browser, DESKTOP, dFile, url, interactions)
    for (const f of dCells) sheet.push({ label: `${p.label} — desktop${f.includes('_') ? ' · ' + f.split('_').pop().replace('.png', '') : ''}`, file: f })
    // Mobile
    const mFile = path.join(OUT_DIR, `proto_${p.key}_mobile.png`)
    const mCells = await shoot(browser, MOBILE, mFile, url, [])
    for (const f of mCells) sheet.push({ label: `${p.label} — mobile`, file: f })
    console.log(`captured ${p.label}`)
  }

  // Compose contact sheet: 2-up grid, dark backing so the bone canvas pops.
  const sheetPage = await (await browser.newContext({ viewport: { width: 1760, height: 1200 }, deviceScaleFactor: 1 })).newPage()
  const html = `<html><body style="margin:0;background:#0b0b0c;font-family:ui-sans-serif,system-ui;padding:18px">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px">
      ${sheet.map((c) => {
        const b64 = fs.readFileSync(c.file).toString('base64')
        return `<div style="background:#161618;border:1px solid #2a2a2e;border-radius:10px;overflow:hidden">
          <div style="color:#e6e6e6;font:600 13px ui-monospace,monospace;padding:9px 12px;border-bottom:1px solid #2a2a2e;letter-spacing:.04em">${c.label}</div>
          <img src="data:image/png;base64,${b64}" style="width:100%;display:block"/>
        </div>`
      }).join('')}
    </div></body></html>`
  await sheetPage.setContent(html, { waitUntil: 'networkidle' })
  await sheetPage.waitForTimeout(400)
  const sheetPath = path.join(OUT_DIR, 'proto-sheet.png')
  await sheetPage.screenshot({ path: sheetPath, fullPage: true })
  await browser.close()
  console.log(`\nCONTACT SHEET: ${sheetPath}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
