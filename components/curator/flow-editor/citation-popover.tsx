'use client'

import * as Popover from '@radix-ui/react-popover'
import type { Citation } from '@/lib/flows/types'

/**
 * Inline citation superscript opening a popover with source title, URL, fetchedAt,
 * and excerpt. Per agent-06 / #98: the excerpt is shown prominently so Brandon can
 * verify the citation supports the claim without leaving the screen. The popover
 * renders ONLY real stored citation fields — no fabricated "where I looked" ledger.
 */
export function CitationPopover({ index, citation }: { index: number; citation: Citation }) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <sup>
          <button className="vt-citation-anchor" aria-label={`Citation ${index + 1}`}>{index + 1}</button>
        </sup>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="vt-citation-popover" sideOffset={5}>
          <h4>{citation.title || 'Untitled source'}</h4>
          <a href={citation.sourceUrl} target="_blank" rel="noreferrer noopener">{citation.sourceUrl}</a>
          <p className="vt-citation-fetched">Fetched: {citation.fetchedAt}</p>
          {citation.excerpt.trim() ? (
            <blockquote className="vt-citation-excerpt">{citation.excerpt}</blockquote>
          ) : (
            <p className="vt-unverified">(no excerpt — grade: {citation.evidenceGrade})</p>
          )}
          <Popover.Arrow />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
