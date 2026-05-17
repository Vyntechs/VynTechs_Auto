'use client'

import { useCallback, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { KnowledgeListRow } from '@/lib/knowledge/list'
import { CitationRow } from '@/components/knowledge/citation-row'

type Props = {
  /**
   * Cited knowledge items, hydrated server-side from
   * `currentNode.citationItemIds`. Rendered in array order — the order
   * reflects first-citation order across turns (see
   * `attributeCitationsToCurrentNode`).
   *
   * Empty array renders nothing — no border, no eyebrow. Implicit
   * absence = "no shop-vetted source for this step."
   */
  items: KnowledgeListRow[]
  /** Default visible before tapping "see more". */
  defaultVisible?: number
}

export function ActiveStepCitations({ items, defaultVisible = 3 }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const search = useSearchParams()
  const [expanded, setExpanded] = useState(false)

  const openDrawer = useCallback(
    (item: KnowledgeListRow) => {
      const next = new URLSearchParams(search.toString())
      next.set('detail', item.id)
      router.replace(`${pathname}?${next.toString()}`, { scroll: false })
    },
    [router, pathname, search],
  )

  if (items.length === 0) return null

  // Only collapse when there are ≥ defaultVisible + 2 items — saves a
  // pointless "show 1 more" row when there are exactly 4 with default 3.
  const overflow = items.length > defaultVisible + 1
  const visible = !overflow || expanded ? items : items.slice(0, defaultVisible)
  const hiddenCount = items.length - visible.length

  return (
    <section className="vk-cite" aria-label="Cited shop knowledge">
      <div className="vk-cite__eyebrow">
        <span>Sources</span>
        <span className="vk-cite__count">{items.length} referenced</span>
      </div>
      <div className="vk-cite-docket">
        {visible.map((it) => (
          <CitationRow key={it.id} item={it} onOpen={openDrawer} />
        ))}
        {hiddenCount > 0 && (
          <button
            type="button"
            className="vk-cite-more"
            onClick={() => setExpanded(true)}
          >
            <span>Show {hiddenCount} more</span>
            <span className="vk-cite-more__sep" />
            <span style={{ color: 'var(--vt-fg-3)' }}>
              {[...new Set(items.slice(defaultVisible).map((i) => i.type))]
                .map((t) => t.replace(/_/g, ' '))
                .join(' · ')}
            </span>
          </button>
        )}
      </div>
    </section>
  )
}
