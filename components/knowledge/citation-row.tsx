'use client'

import type { KnowledgeListRow } from '@/lib/knowledge/list'
import { TYPE_LABELS } from '@/lib/knowledge/constants'
import { getCitationPeek } from '@/lib/knowledge/citation-peek'
import { TypeGlyph } from './glyph'

type Props = {
  item: KnowledgeListRow
  onOpen?: (item: KnowledgeListRow) => void
}

export function CitationRow({ item, onOpen }: Props) {
  const peek = getCitationPeek(item)
  return (
    <button
      type="button"
      className={`vk-cite-row${item.retired ? ' vk-cite-row--retired' : ''}`}
      onClick={() => onOpen?.(item)}
      aria-label={`Open citation: ${item.title}`}
    >
      <span className="vk-cite-row__glyph">
        <TypeGlyph type={item.type} />
      </span>
      <span className="vk-cite-row__body">
        <span className="vk-cite-row__meta">
          <span className="vk-cite-row__type">{TYPE_LABELS[item.type]}</span>
          {item.retired && (
            <>
              <span className="vk-cite-row__sep" />
              <span className="vk-cite-row__retired-tag">Retired</span>
            </>
          )}
        </span>
        <span className="vk-cite-row__title">{item.title}</span>
        {peek.kind === 'prose' ? (
          <span className="vk-cite-row__peek vk-cite-row__peek--prose">{peek.text}</span>
        ) : (
          <span className="vk-cite-row__peek vk-cite-row__peek--data">
            {peek.segments.map((s, i) =>
              s.dim ? (
                <span key={i} className="vk-cite-row__peek-dim">
                  {s.text}
                </span>
              ) : (
                <span key={i}>{s.text}</span>
              ),
            )}
          </span>
        )}
      </span>
      <span className="vk-cite-row__chevron" aria-hidden="true">
        ›
      </span>
    </button>
  )
}
