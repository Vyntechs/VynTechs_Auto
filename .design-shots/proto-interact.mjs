// Drives each prototype to verify the SIGNATURE MECHANIC actually fires:
// advance a step, tap a pin, hit "whole system". Captures each state +
// records console errors. file:// so no server needed.

import { chromium } from '@playwright/test'
import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = process.cwd()
const OUT = path.resolve(ROOT, '.design-shots/out/interact')
const BASE = `file://${ROOT}/.design-shots/mockups`
const PROTOS = [
  { key: 'drive', file: 'proto-drive.html' },
  { key: 'dimmer', file: 'proto-dimmer.html' },
  { key: 'meter', file: 'proto-meter.html' },
]

async function clickText(page, re) {
  // click the smallest element whose trimmed text matches re (avoids hitting a big wrapper)
  const h = await page.evaluateHandle((reSrc) => {
    const rx = new RegExp(reSrc, 'i')
    const els = [...document.querySelectorAll('button,[role=button],a,[onclick],span,div,li')]
      .filter((e) => rx.test((e.textContent || '').trim()) && (e.textContent || '').trim().length < 40)
    els.sort((a, b) => (a.textContent.length - b.textContent.length))
    return els[0] || null
  }, re.source)
  const el = h.asElement()
  if (!el) return false
  await el.scrollIntoViewIfNeeded().catch(() => {})
  await el.click({ timeout: 2500 }).catch(() => {})
  return true
}

async function clickPin(page) {
  // a pin chip: small element whose text is exactly a pin role abbrev
  const h = await page.evaluateHandle(() => {
    const rx = /^(12V|GND|5V|SIG|LREF|PWM)$/i
    const els = [...document.querySelectorAll('button,span,div,[onclick],[data-pin],[class*=pin]')]
      .filter((e) => rx.test((e.textContent || '').trim()))
    return els[0] || null
  })
  const el = h.asElement()
  if (!el) return false
  await el.click({ timeout: 2500 }).catch(() => {})
  return true
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch()
  const cells = []
  for (const p of PROTOS) {
    const errs = []
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
    const page = await ctx.newPage()
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
    page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message))
    const url = `${BASE}/${p.file}`
    const snap = async (tag) => {
      await page.waitForTimeout(850)
      const f = path.join(OUT, `${p.key}_${tag}.png`)
      await page.screenshot({ path: f })
      cells.push({ label: `${p.key} · ${tag}`, file: f })
    }
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })
    await snap('1-init')
    const tappedPin = await clickPin(page); await snap('2-pin' + (tappedPin ? '' : '-MISS'))
    const next1 = await clickText(page, /next test/); await snap('3-next' + (next1 ? '' : '-MISS'))
    const next2 = await clickText(page, /next test/); await snap('4-next2' + (next2 ? '' : '-MISS'))
    const whole = await clickText(page, /whole system/); await snap('5-whole' + (whole ? '' : '-MISS'))
    console.log(`${p.key}: pin=${tappedPin} next1=${next1} next2=${next2} whole=${whole} consoleErrors=${errs.length}`)
    if (errs.length) console.log(`  ERRORS: ${errs.slice(0, 5).join(' | ')}`)
    await ctx.close()
  }
  // contact sheet, 3-up
  const sp = await (await browser.newContext({ viewport: { width: 2000, height: 1300 } })).newPage()
  const html = `<html><body style="margin:0;background:#0b0b0c;font-family:ui-monospace,monospace;padding:14px">
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
    ${cells.map((c) => {
      const b64 = fs.readFileSync(c.file).toString('base64')
      return `<div style="background:#161618;border:1px solid #2a2a2e;border-radius:8px;overflow:hidden">
        <div style="color:#e6e6e6;font-size:12px;padding:7px 10px;border-bottom:1px solid #2a2a2e">${c.label}</div>
        <img src="data:image/png;base64,${b64}" style="width:100%;display:block"/></div>`
    }).join('')}
    </div></body></html>`
  await sp.setContent(html, { waitUntil: 'networkidle' })
  await sp.waitForTimeout(300)
  const out = path.join(path.resolve(ROOT, '.design-shots/out'), 'proto-interact-sheet.png')
  await sp.screenshot({ path: out, fullPage: true })
  await browser.close()
  console.log(`\nINTERACTION SHEET: ${out}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
