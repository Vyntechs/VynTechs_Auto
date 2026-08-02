import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { CustomerCopy } from '@/components/screens/customer-copy'
import type { CustomerCopyProjection, CustomerCopyResult } from '@/lib/shop-os/customer-copy'
import { customerCopyFixture } from '@/tests/helpers/customer-copy'
import '@/app/globals.css'
import './style.css'

const blockedCopy: CustomerCopyProjection = {
  ...customerCopyFixture,
  readyToPrint: false,
  blockers: ['shop_phone'],
  shop: { ...customerCopyFixture.shop, phone: null },
}

function Harness(): React.JSX.Element {
  const blocked = new URLSearchParams(window.location.search).get('state') === 'blocked'
  const [open, setOpen] = useState(false)
  const initialCopy = blocked ? blockedCopy : customerCopyFixture

  useEffect(() => {
    document.body.dataset.refreshCount = '0'
    document.body.dataset.printCalls = '0'
    document.body.dataset.printReadyAtCall = 'unset'
    window.print = () => {
      document.body.dataset.printReadyAtCall = document
        .querySelector('[data-customer-copy-document]')
        ?.getAttribute('data-print-ready') ?? 'missing'
      document.body.dataset.printCalls = String(Number(document.body.dataset.printCalls ?? '0') + 1)
    }
  }, [])

  async function refreshCopy(_ticketId: string): Promise<CustomerCopyResult> {
    document.body.dataset.refreshCount = String(Number(document.body.dataset.refreshCount ?? '0') + 1)
    return { ok: true, copy: initialCopy }
  }

  return (
    <div data-customer-copy-workspace>
      <header className="fixtureChrome" data-fixture-app-chrome>
        <strong>Shop OS</strong>
        <span>Repair order 001042</span>
      </header>
      <main className="fixtureShell" data-customer-copy-shell>
        <div className="fixtureContent" data-customer-copy-container>
          <header className="fixtureHeading">
            <p>Repair order</p>
            <h1>Front brake service</h1>
          </header>
          <button
            className="fixtureAction"
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((current) => !current)}
          >
            Customer copy
          </button>
          <aside className="fixtureStaff" data-staff-only>
            STAFF-ONLY-SENTINEL · Internal cost $61.00 · Margin 39%
          </aside>
          {open && (
            <CustomerCopy
              copy={initialCopy}
              canManageShopIdentity={false}
              ticketId="00000000-0000-4000-8000-000000000020"
              refreshCopy={refreshCopy}
            />
          )}
          <div className="fixtureLong" data-long-surrounding aria-hidden="true">
            Long repair-order history that must not create trailing print pages.
          </div>
        </div>
      </main>
    </div>
  )
}

const root = document.getElementById('root')
if (!root) throw new Error('customer copy harness root missing')
createRoot(root).render(<Harness />)
