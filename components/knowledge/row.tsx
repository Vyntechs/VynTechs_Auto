import Link from 'next/link'
import { TypeGlyph } from './glyph'
import { TYPE_SHORT } from '@/lib/knowledge/constants'
import type { KnowledgeListRow } from '@/lib/knowledge/list'

function formatScope(s: KnowledgeListRow['vehicleScopes'][number]): string {
  const year = s.yearStart === s.yearEnd
    ? String(s.yearStart)
    : `${s.yearStart}–${String(s.yearEnd).slice(2)}`
  const tail = [s.make, s.model, s.engine && `· ${s.engine}`, s.trim && `· ${s.trim}`]
    .filter(Boolean)
    .join(' ')
  return `${year} ${tail}`
}

function formatEdited(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const mi = String(date.getMinutes()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} · ${hh}:${mi}`
}

export function KnowledgeRow({ item, currentQuery }: { item: KnowledgeListRow; currentQuery: string }) {
  const params = new URLSearchParams(currentQuery)
  params.set('detail', item.id)
  const href = `/knowledge?${params.toString()}`

  return (
    <Link href={href} className="vk-row" role="link" scroll={false}>
      <div className="vk-row__type">
        <span className="vk-row__type-label">{TYPE_SHORT[item.type]}</span>
        <span className="vk-row__type-mark"><TypeGlyph type={item.type} /></span>
      </div>
      <div className="vk-row__main">
        <h3 className="vk-row__title">{item.title}</h3>
        {item.vehicleScopes.length > 0 && (
          <div className="vk-row__scope">
            {item.vehicleScopes.map((s, i) => (
              <span className="vk-scope" key={i}>
                <span className="vk-scope__year">
                  {s.yearStart === s.yearEnd
                    ? s.yearStart
                    : `${s.yearStart}–${String(s.yearEnd).slice(2)}`}
                </span>
                {' '}
                {[s.make, s.model, s.engine && `· ${s.engine}`, s.trim && `· ${s.trim}`]
                  .filter(Boolean)
                  .join(' ')}
              </span>
            ))}
          </div>
        )}
        {(item.dtcList.length > 0 || item.systemCodes.length > 0 || item.symptoms.length > 0) && (
          <div className="vk-row__tags">
            {item.dtcList.map(d => {
              const sub = item.dtcSubCodes?.[d]
              return (
                <span className="vk-tag vk-tag--dtc" key={d}>
                  {d}
                  {sub && <span className="vk-tag__sub"> ·{sub}</span>}
                </span>
              )
            })}
            {item.dtcList.length > 0 && item.systemCodes.length > 0 && (
              <span className="vk-row__tags-dot" />
            )}
            {item.systemCodes.map(s => (
              <span key={s}>{s.replace(/_/g, ' ')}</span>
            ))}
            {item.symptoms.length > 0 && (
              <>
                {(item.dtcList.length > 0 || item.systemCodes.length > 0) && (
                  <span className="vk-row__tags-dot" />
                )}
                {item.symptoms.map(s => (
                  <span className="vk-tag vk-tag--sym" key={s}>{s.replace(/_/g, ' ')}</span>
                ))}
              </>
            )}
          </div>
        )}
      </div>
      <div className="vk-row__meta">
        {item.retired && <span className="vk-row__retired-tag">Retired</span>}
        {item.fireCount > 0 && (
          <span className="vk-row__fires">
            fired <span className="vk-row__fires-num">{item.fireCount}×</span>
          </span>
        )}
        <span className="vk-row__edited">{formatEdited(item.updatedAt)}</span>
      </div>
    </Link>
  )
}

KnowledgeRow.formatScope = formatScope
KnowledgeRow.formatEdited = formatEdited
