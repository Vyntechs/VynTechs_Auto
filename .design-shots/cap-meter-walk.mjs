// Walks the updated Meter prototype through all 6 step shapes + key interactions,
// desktop + mobile, captures console errors, composes ONE contact sheet.
// file:// — no server. Usage: node .design-shots/cap-meter-walk.mjs
import { chromium } from '@playwright/test'
import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = process.cwd()
const OUT = path.resolve(ROOT, '.design-shots/out/walk')
const URL = `file://${ROOT}/.design-shots/mockups/proto-meter.html`
fs.mkdirSync(OUT, { recursive: true })

const STEP_LABELS = ['1 confirm-complaint', '2 electrical PROBE', '3 LOCATE', '4 single-value PID', '5 LOOK/inspect', '6 FORK/decision']

async function run() {
  const browser = await chromium.launch()
  const cells = []
  const allErrs = []

  // ---------- DESKTOP WALK ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
    const page = await ctx.newPage()
    const errs = []
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
    page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message))
    await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 })
    await page.waitForTimeout(1100)
    const snap = async (label) => {
      const f = path.join(OUT, `d_${label.replace(/[^a-z0-9]+/gi, '_')}.png`)
      await page.screenshot({ path: f }); cells.push({ label: `desktop · ${label}`, file: f })
    }
    // step 1 as loaded
    await snap(STEP_LABELS[0])
    // step 2 (probe) + its see-source + secondary expands
    await page.click('#ctlNext'); await page.waitForTimeout(1000); await snap(STEP_LABELS[1])
    await page.click('#mProv').catch(()=>{}); await page.waitForTimeout(700); await snap('2 PROBE · why? open')
    await page.click('#mProv').catch(()=>{}); // close why
    await page.click('#mSecToggle').catch(()=>{}); await page.waitForTimeout(700); await snap('2 PROBE · detail open')
    await page.click('#mSecToggle').catch(()=>{}); await page.waitForTimeout(300)
    // step 3 locate
    await page.click('#ctlNext'); await page.waitForTimeout(1000); await snap(STEP_LABELS[2])
    // step 4 single-value PID
    await page.click('#ctlNext'); await page.waitForTimeout(1000); await snap(STEP_LABELS[3])
    // step 5 look + tap fault swatch
    await page.click('#ctlNext'); await page.waitForTimeout(1000); await snap(STEP_LABELS[4])
    await page.click('#mSwFault').catch(()=>{}); await page.waitForTimeout(800); await snap('5 LOOK · fault tapped')
    // step 6 fork
    await page.click('#ctlNext'); await page.waitForTimeout(1100); await snap(STEP_LABELS[5])
    // whole system
    await page.click('#ctlWhole').catch(()=>{}); await page.waitForTimeout(1000); await snap('whole system')
    if (errs.length) allErrs.push('DESKTOP: ' + errs.slice(0, 8).join(' | '))
    console.log(`desktop walk done · consoleErrors=${errs.length}`)
    await ctx.close()
  }

  // ---------- MOBILE WALK (375 hard gate) ----------
  for (const W of [375, 390]) {
    const ctx = await browser.newContext({ viewport: { width: W, height: 812 }, deviceScaleFactor: 3 })
    const page = await ctx.newPage()
    const errs = []
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
    page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message))
    await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 })
    await page.waitForTimeout(1100)
    const snap = async (label) => {
      const f = path.join(OUT, `m${W}_${label.replace(/[^a-z0-9]+/gi, '_')}.png`)
      await page.screenshot({ path: f }); cells.push({ label: `mobile ${W} · ${label}`, file: f })
    }
    await snap('1 confirm')
    await page.click('#ctlNext'); await page.waitForTimeout(1000); await snap('2 PROBE (pump above sheet?)')
    await page.click('#ctlNext'); await page.click('#ctlNext'); await page.waitForTimeout(800); await snap('4 PID')
    await page.click('#ctlNext'); await page.waitForTimeout(900); await snap('5 LOOK')
    if (errs.length) allErrs.push(`MOBILE${W}: ` + errs.slice(0, 6).join(' | '))
    console.log(`mobile ${W} walk done · consoleErrors=${errs.length}`)
    await ctx.close()
  }

  // ---------- CONTACT SHEET ----------
  const sp = await (await browser.newContext({ viewport: { width: 2200, height: 1400 }, deviceScaleFactor: 1 })).newPage()
  const html = `<html><body style="margin:0;background:#0b0b0c;font-family:ui-monospace,monospace;padding:16px">
    <div style="color:#9aa;font:600 12px ui-monospace;padding:0 0 12px">METER walk — ${cells.length} frames · console errors: ${allErrs.length ? allErrs.join('  ||  ') : 'NONE'}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
    ${cells.map((c) => {
      const b64 = fs.readFileSync(c.file).toString('base64')
      return `<div style="background:#161618;border:1px solid #2a2a2e;border-radius:8px;overflow:hidden">
        <div style="color:#e6e6e6;font-size:12px;padding:7px 10px;border-bottom:1px solid #2a2a2e">${c.label}</div>
        <img src="data:image/png;base64,${b64}" style="width:100%;display:block"/></div>`
    }).join('')}
    </div></body></html>`
  await sp.setContent(html, { waitUntil: 'networkidle' })
  await sp.waitForTimeout(400)
  const out = path.join(path.resolve(ROOT, '.design-shots/out'), 'meter-walk-sheet.png')
  await sp.screenshot({ path: out, fullPage: true })
  await browser.close()
  console.log(`\nCONTACT SHEET: ${out}`)
  console.log(allErrs.length ? `CONSOLE ERRORS:\n${allErrs.join('\n')}` : 'NO CONSOLE ERRORS')
}
run().catch((e) => { console.error(e); process.exit(1) })
