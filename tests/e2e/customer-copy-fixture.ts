import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function stylesheet(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
    .replace(/@font-face\s*\{[\s\S]*?\}/g, '')
}

export function customerCopyFixtureHtml(): string {
  const globalCss = stylesheet('app/globals.css')
  const customerCopyCss = stylesheet('components/screens/customer-copy.module.css')

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Customer copy proof</title>
    <style>
      ${globalCss}
      ${customerCopyCss}
      [hidden] { display: none !important; }
      .fixtureChrome {
        display: flex;
        align-items: center;
        justify-content: space-between;
        min-height: 58px;
        border-bottom: 1px solid var(--vt-rule);
        padding: 0 clamp(16px, 4vw, 48px);
        background: var(--vt-surface);
        font: 600 12px/1.3 var(--vt-font-sans);
        letter-spacing: .08em;
        text-transform: uppercase;
      }
      .fixtureMain {
        display: grid;
        gap: 18px;
        width: min(100%, 1080px);
        margin: 0 auto;
        padding: clamp(20px, 4vw, 48px);
      }
      .fixtureTitle { margin: 0; font: 400 clamp(30px, 5vw, 48px)/1 var(--vt-font-serif); }
      .fixtureSummary { margin: 0; color: var(--vt-fg-2); }
      .fixtureAction {
        justify-self: start;
        min-height: 44px;
        border: 1px solid var(--vt-rule-strong);
        border-radius: var(--vt-radius-2);
        background: transparent;
        padding: 0 18px;
        color: var(--vt-fg-1);
        font-weight: 650;
        cursor: pointer;
      }
      .fixtureStaffOnly {
        border-left: 3px solid var(--vt-risk-high);
        padding: 10px 12px;
        color: var(--vt-fg-2);
        font: 12px/1.4 var(--vt-font-mono);
      }
      @media (max-width: 600px) {
        .fixtureMain { padding: 20px 14px 32px; }
        .fixtureAction { width: 100%; }
      }
    </style>
  </head>
  <body>
    <header class="fixtureChrome" data-fixture-app-chrome>
      <span>Shop OS</span>
      <span>Repair order 000042</span>
    </header>
    <main class="fixtureMain">
      <h1 class="fixtureTitle">Front brake service</h1>
      <p class="fixtureSummary">Customer-approved work · ready for checkout</p>
      <button
        class="fixtureAction"
        type="button"
        aria-expanded="false"
        aria-controls="customer-copy-preview"
      >Customer copy</button>
      <aside class="fixtureStaffOnly" data-staff-only>
        STAFF-ONLY-SENTINEL · Internal cost $61.00 · Margin 39%
      </aside>

      <section
        id="customer-copy-preview"
        class="preview"
        aria-label="Customer copy preview"
        hidden
      >
        <div class="controls" data-customer-copy-controls>
          <div>
            <p>Customer copy</p>
            <span>Invoice ready</span>
          </div>
          <button type="button">Print customer copy</button>
        </div>

        <article class="paper" data-customer-copy-document data-document-kind="invoice">
          <header class="documentHeader">
            <div class="shopIdentity">
              <p class="shopName">Honest Auto</p>
              <p>(312) 555-0144</p>
              <p>810 W Fulton Market</p>
              <p>Chicago, IL 60607</p>
            </div>
            <div class="documentIdentity">
              <p>RO 000042</p>
              <h2 tabindex="-1">Invoice</h2>
              <p class="balanceLabel">Balance</p>
              <p class="balance">$295.50</p>
            </div>
          </header>

          <div class="factGrid">
            <section aria-labelledby="fixture-customer">
              <h3 id="fixture-customer">Customer</h3>
              <p>Ada Driver</p>
            </section>
            <section aria-labelledby="fixture-vehicle">
              <h3 id="fixture-vehicle">Vehicle</h3>
              <p>2020 Ford F-150</p>
              <p><span>VIN</span> 1FTFW1E50LFA00001</p>
              <p><span>Odometer</span> 91,240 mi</p>
            </section>
          </div>

          <section class="work" aria-labelledby="fixture-work">
            <h3 id="fixture-work">Work and pricing</h3>
            <article class="job" data-customer-copy-job>
              <header>
                <p>Concern</p>
                <h4>Front brake service</h4>
              </header>
              <ul>
                <li>
                  <div><p>Brake pad set</p><span>1 · BRK-1042 · Akebono · Taxable</span></div>
                  <strong>$100.00</strong>
                </li>
                <li>
                  <div><p>Replace front brake pads</p><span>1.5 hr · $100.00/hr</span></div>
                  <strong>$150.00</strong>
                </li>
              </ul>
            </article>
          </section>

          <section class="decisions" aria-labelledby="fixture-decisions">
            <h3 id="fixture-decisions">Recorded customer decisions</h3>
            <ul>
              <li>
                <span>Front brake service</span>
                <strong>Customer said yes · Phone · Aug 2, 2026, 9:14 AM</strong>
              </li>
            </ul>
          </section>

          <div class="moneyGrid">
            <section class="payments" aria-labelledby="fixture-payments">
              <h3 id="fixture-payments">Payments</h3>
              <ul><li><span>Card · Aug 2, 2026, 10:02 AM</span><strong>$0.00</strong></li></ul>
            </section>
            <dl class="totals" data-customer-copy-totals>
              <div><dt>Subtotal</dt><dd>$250.00</dd></div>
              <div><dt>Tax</dt><dd>$45.50</dd></div>
              <div><dt>Total</dt><dd>$295.50</dd></div>
              <div><dt>Paid</dt><dd>$0.00</dd></div>
              <div class="totalBalance"><dt>Balance</dt><dd>$295.50</dd></div>
            </dl>
          </div>
        </article>
      </section>
    </main>
    <script>
      const action = document.querySelector('.fixtureAction')
      const preview = document.querySelector('#customer-copy-preview')
      action.addEventListener('click', () => {
        preview.hidden = false
        action.setAttribute('aria-expanded', 'true')
        preview.querySelector('h2').focus()
      })
    </script>
  </body>
</html>`
}
