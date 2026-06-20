import { chromium } from '@playwright/test'
import * as path from 'node:path'
const ROOT = process.cwd()
const OUT = path.resolve(ROOT, '.design-shots/out')
const url = `file://${ROOT}/.design-shots/mockups/proto-meter.html`
const b = await chromium.launch()
const errs = []
const ctx = await b.newContext({ viewport:{width:1440,height:900}, deviceScaleFactor:2 })
const page = await ctx.newPage()
page.on('pageerror',e=>errs.push(e.message)); page.on('console',m=>{if(m.type()==='error')errs.push(m.text())})
await page.goto(url,{waitUntil:'networkidle'}); await page.waitForTimeout(1000)
await page.screenshot({path:path.join(OUT,'meter2_1-default.png')})
// click a pin
await page.evaluate(()=>{const p=document.querySelector('[data-pin]');p&&p.click()}); await page.waitForTimeout(900)
await page.screenshot({path:path.join(OUT,'meter2_2-tapped.png')})
// whole system
await page.evaluate(()=>{const el=[...document.querySelectorAll('button,span,div')].find(e=>/whole system/i.test((e.textContent||'').trim())&&(e.textContent||'').trim().length<30);el&&el.click()}); await page.waitForTimeout(900)
await page.screenshot({path:path.join(OUT,'meter2_3-whole.png')})
await ctx.close()
// mobile
const m = await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:2}); const mp=await m.newPage()
await mp.goto(url,{waitUntil:'networkidle'}); await mp.waitForTimeout(1000)
await mp.screenshot({path:path.join(OUT,'meter2_4-mobile.png')}); await m.close()
await b.close()
console.log('console/page errors:', errs.length, errs.slice(0,4).join(' | '))
console.log('captured meter2_1-default, _2-tapped, _3-whole, _4-mobile')
