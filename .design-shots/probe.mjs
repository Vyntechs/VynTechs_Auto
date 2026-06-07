import { chromium } from '@playwright/test'
const ROOT = process.cwd()
const BASE = `file://${ROOT}/.design-shots/mockups`
const b = await chromium.launch()
for (const key of ['drive','dimmer','meter']) {
  const ctx = await b.newContext({ viewport:{width:1440,height:900} })
  const page = await ctx.newPage()
  const errs=[]; page.on('pageerror',e=>errs.push(e.message))
  await page.goto(`${BASE}/proto-${key}.html`,{waitUntil:'networkidle'})
  await page.waitForTimeout(700)
  const probe = async () => page.evaluate(()=>{
    const cand=[...document.querySelectorAll('*')].map(e=>[e,getComputedStyle(e).transform]).filter(([e,t])=>t&&t!=='none')
    cand.sort((a,b)=>b[0].getBoundingClientRect().width - a[0].getBoundingClientRect().width)
    const t = cand.length? cand[0][1] : 'NO-TRANSFORMED-EL'
    const texts=[...document.querySelectorAll('*')].map(e=>(e.childElementCount===0?(e.textContent||'').trim():'')).filter(Boolean)
    const banner = texts.find(x=>/back-probe|continuity|locate|find the|key on|ground/i.test(x))||'NO-BANNER'
    return {t, banner:banner.slice(0,64)}
  })
  const clickByText = (re) => page.evaluate((s)=>{const rx=new RegExp(s,'i');const el=[...document.querySelectorAll('button,span,div,[onclick],a,li')].filter(e=>rx.test((e.textContent||'').trim())&&(e.textContent||'').trim().length<40).sort((a,b)=>a.textContent.length-b.textContent.length)[0];if(el){el.click();return true}return false}, re)
  const a = await probe()
  const n1 = await clickByText('next test'); await page.waitForTimeout(800)
  const c = await probe()
  const n2 = await clickByText('next test'); await page.waitForTimeout(800)
  const d = await probe()
  console.log(`\n=== ${key} ===`)
  console.log('init :', a.t.slice(0,50), '|', a.banner)
  console.log('nxt1 :', c.t.slice(0,50), '|', c.banner)
  console.log('nxt2 :', d.t.slice(0,50), '|', d.banner)
  console.log(`  clicked next? ${n1}/${n2} | transform moved? ${a.t!==c.t||c.t!==d.t} | banner changed? ${a.banner!==c.banner||c.banner!==d.banner} | errs ${errs.length}`)
  await ctx.close()
}
await b.close()
