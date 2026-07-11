import Link from 'next/link'
import type { QuoteBuilderResult } from '@/lib/shop-os/quotes'
import type { TicketDetail } from '@/lib/tickets'
import styles from './manual-quote-builder.module.css'

type QuoteBuilder = Extract<QuoteBuilderResult, { ok: true }>['builder']

export function ManualQuoteBuilder({
  ticket,
  builder,
}: {
  ticket: TicketDetail
  builder: QuoteBuilder
}): React.JSX.Element {
  return (
    <main className={`app ${styles.screen}`}>
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Repair order {ticket.ticketNumber}</p>
          <h1>Build quote</h1>
        </div>
        <Link href={`/tickets/${ticket.id}`}>Back to ticket</Link>
      </div>
      {!builder.ticket.reconciled && (
        <p className={styles.notice}>
          Draft quote lines now. Prepare stays blocked until customer and vehicle are added.
        </p>
      )}
    </main>
  )
}
