'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { parseCannedJobListResponse, type SafeCannedJobTemplate } from '@/lib/shop-os/canned-jobs-ui'
import { parseEnabledVendorAccountsResponse, type SafeManualVendorAccount } from '@/lib/shop-os/parts-sourcing-ui'
import { parseQuoteBuilderProjection } from '@/lib/shop-os/quote-builder-ui'
import type { QuoteBuilderResult } from '@/lib/shop-os/quotes'
import { ManualQuoteBuilder, type QuoteTicketIdentity } from './manual-quote-builder'
import styles from './inline-quote-workspace.module.css'

type QuoteBuilder = Extract<QuoteBuilderResult, { ok: true }>['builder']

export type QuoteWorkspaceProjection = Array<{
  id: string
  workStatus: 'open' | 'in_progress' | 'blocked'
  approvalState: 'pending_quote' | 'quote_ready' | 'sent' | 'approved' | 'declined'
}>

export function inlineQuoteWorkspaceId(ticketId: string): string {
  return `inline-quote-workspace-${ticketId}`
}

type Loaded = {
  builder: QuoteBuilder
  cannedJobs: SafeCannedJobTemplate[]
  cannedCatalogAvailable: boolean
  vendorAccounts: SafeManualVendorAccount[]
  vendorCatalogAvailable: boolean
}

export function InlineQuoteWorkspace({
  actorId,
  workspaceId,
  ticket,
  canCreateVendorAccount = false,
  onClose,
  onProjection,
}: {
  actorId: string
  workspaceId?: string
  ticket: QuoteTicketIdentity
  canCreateVendorAccount?: boolean
  onClose: () => void
  onProjection: (jobs: QuoteWorkspaceProjection) => void
}): React.JSX.Element {
  const boundaryRef = useRef<HTMLElement>(null)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    queueMicrotask(() => boundaryRef.current?.focus())
  }, [])

  useEffect(() => {
    let canceled = false

    async function load(): Promise<void> {
      setError(false)
      setLoaded(null)
      try {
        const [quoteResponse, cannedResponse, vendorResponse] = await Promise.all([
          fetch(`/api/tickets/${ticket.id}/quote`, { cache: 'no-store' }),
          fetch('/api/shop/canned-jobs', { cache: 'no-store' }),
          fetch('/api/shop/vendor-accounts', { cache: 'no-store' }),
        ])
        const [quoteBody, cannedBody, vendorBody] = await Promise.all([
          quoteResponse.json().catch(() => null),
          cannedResponse.json().catch(() => null),
          vendorResponse.json().catch(() => null),
        ])
        const builder = quoteResponse.ok
          && typeof quoteBody === 'object' && quoteBody !== null && 'builder' in quoteBody
          ? parseQuoteBuilderProjection((quoteBody as { builder: unknown }).builder)
          : null
        if (!builder || builder.ticket.id.toLowerCase() !== ticket.id.toLowerCase()) {
          throw new Error('invalid_quote')
        }

        const canned = cannedResponse.ok ? parseCannedJobListResponse(cannedBody) : null
        const cannedCatalogAvailable = canned !== null
          && canned.taxRateBps === builder.configuration.taxRateBps
        const vendorAccounts = vendorResponse.ok
          ? parseEnabledVendorAccountsResponse(vendorBody)
          : null
        if (canceled) return
        setLoaded({
          builder,
          cannedJobs: cannedCatalogAvailable ? canned.cannedJobs : [],
          cannedCatalogAvailable,
          vendorAccounts: vendorAccounts ?? [],
          vendorCatalogAvailable: vendorAccounts !== null,
        })
      } catch {
        if (!canceled) setError(true)
      }
    }

    void load()
    return () => { canceled = true }
  }, [attempt, ticket.id])

  async function reloadCatalog(): Promise<void> {
    if (!loaded) return
    try {
      const response = await fetch('/api/shop/canned-jobs', { cache: 'no-store' })
      const body = await response.json().catch(() => null)
      const canned = response.ok ? parseCannedJobListResponse(body) : null
      const available = canned !== null
        && canned.taxRateBps === loaded.builder.configuration.taxRateBps
      setLoaded((current) => current ? {
        ...current,
        cannedJobs: available ? canned.cannedJobs : [],
        cannedCatalogAvailable: available,
      } : current)
    } catch {
      setLoaded((current) => current ? {
        ...current,
        cannedJobs: [],
        cannedCatalogAvailable: false,
      } : current)
    }
  }

  const boundaryId = workspaceId ?? inlineQuoteWorkspaceId(ticket.id)

  return (
    <section
      ref={boundaryRef}
      id={boundaryId}
      className={styles.boundary}
      role="region"
      aria-label="Inline quote workspace"
      aria-busy={!error && !loaded ? true : undefined}
      tabIndex={-1}
    >
      {error ? (
        <div className={styles.state}>
          <div role="alert">
            <strong>Quote could not be opened here.</strong>
            <p>The repair order is safe. Retry this tool or use the full quote page.</p>
          </div>
          <div className={styles.actions}>
            <button type="button" onClick={() => setAttempt((current) => current + 1)}>Retry quote</button>
            <Link href={`/tickets/${ticket.id}/quote`}>Open the full quote page</Link>
            <button type="button" onClick={onClose}>Close</button>
          </div>
        </div>
      ) : !loaded ? (
        <div className={styles.state}>
          <p role="status">Opening the current quote…</p>
        </div>
      ) : (
        <ManualQuoteBuilder
          actorId={actorId}
          ticket={ticket}
          builder={loaded.builder}
          cannedJobs={loaded.cannedJobs}
          cannedCatalogAvailable={loaded.cannedCatalogAvailable}
          vendorAccounts={loaded.vendorAccounts}
          vendorCatalogAvailable={loaded.vendorCatalogAvailable}
          canCreateVendorAccount={canCreateVendorAccount}
          embedded
          onClose={onClose}
          onProjection={onProjection}
          onReloadCatalog={() => void reloadCatalog()}
        />
      )}
    </section>
  )
}
