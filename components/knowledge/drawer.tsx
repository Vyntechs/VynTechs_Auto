'use client'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { TypeGlyph } from './glyph'
import { TYPE_SHORT } from '@/lib/knowledge/constants'
import type { KnowledgeListRow } from '@/lib/knowledge/list'

type PinRow = { pin_number: string; signal_name: string; wire_color?: string; expected_voltage_or_waveform?: string; notes?: string }
type WiringConn = { from_component: string; from_pin?: string; to_component: string; to_pin?: string; wire_color?: string; splice_id?: string; notes?: string }
type TheorySection = { heading: string; body: string }

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000

export function KnowledgeDrawer({
  item,
  ownerMode = true,
}: {
  item: KnowledgeListRow | null
  ownerMode?: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const search = useSearchParams()
  const [pending, setPending] = useState<'retire' | 'restore' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const close = useCallback(() => {
    const next = new URLSearchParams(search.toString())
    next.delete('detail')
    const q = next.toString()
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false })
  }, [router, pathname, search])

  useEffect(() => {
    if (!item) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [item, close])

  if (!item) return null

  const isRetired = item.retired
  const withinRestoreWindow = isRetired && item.retiredAt
    ? Date.now() - new Date(item.retiredAt).getTime() < TWENTY_FOUR_HOURS_MS
    : false

  async function handleRetire() {
    if (!confirm('Retire this item? It will hide from the list within 24h.')) return
    setPending('retire'); setError(null)
    try {
      const res = await fetch(`/api/knowledge/${item!.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'retire failed')
    } finally { setPending(null) }
  }

  async function handleRestore() {
    setPending('restore'); setError(null)
    try {
      const res = await fetch(`/api/knowledge/${item!.id}/restore`, { method: 'POST' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'restore failed')
    } finally { setPending(null) }
  }

  const totalTags = item.dtcList.length + item.systemCodes.length + item.symptoms.length
  const lastEdited = new Date(item.updatedAt).toISOString().slice(0, 16).replace('T', ' · ')

  return (
    <>
      <div className="vk-drawer__scrim" onClick={close} aria-hidden />
      <aside className="vk-drawer" role="dialog" aria-modal="true" aria-labelledby="vk-dr-title">
        <header className="vk-drawer__head">
          <div className="vk-drawer__head-l">
            <div className="vk-drawer__type">
              <span className="vk-drawer__type-mark"><TypeGlyph type={item.type} /></span>
              <span>{TYPE_SHORT[item.type]}</span>
              {isRetired && (
                <span
                  style={{
                    fontFamily: 'var(--vt-font-mono)', fontSize: 9, fontWeight: 600,
                    letterSpacing: '0.16em', color: 'var(--vt-fg-3)',
                    border: '0.5px solid var(--vt-rule)', padding: '1px 6px', borderRadius: 1,
                  }}
                >
                  RETIRED
                </span>
              )}
            </div>
            <h2 id="vk-dr-title" className="vk-drawer__title">{item.title}</h2>
            {item.vehicleScopes.length > 0 && (
              <div className="vk-drawer__scope">
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
          </div>
          <button type="button" className="vk-drawer__close" onClick={close} aria-label="Close">×</button>
        </header>

        <div className="vk-drawer__body">
          <DrawerTypeBody item={item} />
        </div>

        <footer className="vk-drawer__foot">
          <div className="vk-drawer__foot-meta">
            <span>Tags</span>
            <span>
              {item.fireCount > 0 && <><strong>{item.fireCount}</strong> fires · </>}
              last edited {lastEdited}
            </span>
          </div>
          <div className="vk-drawer__foot-tags">
            {item.dtcList.map(d => <span className="vk-tag vk-tag--dtc" key={d}>{d}</span>)}
            {item.systemCodes.map(s => <span className="vk-tag" key={s}>{s.replace(/_/g, ' ')}</span>)}
            {item.symptoms.map(s => <span className="vk-tag vk-tag--sym" key={s}>{s.replace(/_/g, ' ')}</span>)}
            {totalTags === 0 && (
              <span
                style={{
                  fontFamily: 'var(--vt-font-mono)', fontSize: 10,
                  color: 'var(--vt-fg-3)', letterSpacing: '0.14em',
                }}
              >
                UNTAGGED
              </span>
            )}
          </div>
          {ownerMode && (
            <div className="vk-drawer__foot-actions">
              {!isRetired && (
                <button
                  type="button"
                  className="vk-btn vk-btn--danger"
                  disabled={pending !== null}
                  onClick={handleRetire}
                  style={{ marginLeft: 'auto' }}
                >
                  {pending === 'retire' ? 'Retiring…' : 'Retire'}
                </button>
              )}
              {isRetired && withinRestoreWindow && (
                <button
                  type="button"
                  className="vk-btn"
                  disabled={pending !== null}
                  onClick={handleRestore}
                  style={{ marginLeft: 'auto' }}
                >
                  {pending === 'restore' ? 'Restoring…' : 'Restore'}
                </button>
              )}
            </div>
          )}
          {error && (
            <div style={{ marginTop: 8, color: 'var(--vt-risk-destructive)', fontSize: 13 }}>
              {error}
            </div>
          )}
        </footer>
      </aside>
    </>
  )
}

function DrawerTypeBody({ item }: { item: KnowledgeListRow }) {
  const sd = (item.structuredData ?? {}) as Record<string, unknown>
  switch (item.type) {
    case 'pinout': return <PinoutBody sd={sd} />
    case 'connector': return <ConnectorBody sd={sd} body={item.body} />
    case 'wiring_diagram': return <WiringBody sd={sd} />
    case 'theory_of_operation': return <TheoryBody sd={sd} />
    case 'cause_fix': return <CauseFixBody sd={sd} />
    case 'bulletin': return <BulletinBody sd={sd} />
    case 'note':
    case 'reference_doc':
      return (
        <div className="vk-dsec">
          <p className="vk-dsec__body">{item.body ?? ''}</p>
        </div>
      )
  }
}

function PinoutBody({ sd }: { sd: Record<string, unknown> }) {
  const pins = (Array.isArray(sd.pins) ? sd.pins : []) as PinRow[]
  const connectorRef = typeof sd.connector_ref === 'string' ? sd.connector_ref : ''
  return (
    <div className="vk-dsec">
      <div className="vk-dsec__head">
        <span>Pin table · {pins.length} pin{pins.length === 1 ? '' : 's'}</span>
        {connectorRef && <span>Connector {connectorRef}</span>}
      </div>
      <div className="vk-pintbl">
        <div className="vk-pintbl__row vk-pintbl__row--head">
          <div>PIN</div><div>SIGNAL</div><div>WIRE</div><div>EXPECTED</div><div>NOTES</div>
        </div>
        {pins.map(p => (
          <div className="vk-pintbl__row" key={p.pin_number}>
            <div>{p.pin_number}</div>
            <div>{p.signal_name}</div>
            <div>{p.wire_color ?? '—'}</div>
            <div>{p.expected_voltage_or_waveform ?? '—'}</div>
            <div
              style={{
                fontFamily: 'var(--vt-font-serif)', fontStyle: 'italic', fontSize: 13,
                color: 'var(--vt-fg-2)',
              }}
            >
              {p.notes ?? ''}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ConnectorBody({ sd, body }: { sd: Record<string, unknown>; body: string | null }) {
  const connectorId = typeof sd.connector_id === 'string' ? sd.connector_id : ''
  const componentName = typeof sd.component_name === 'string' ? sd.component_name : ''
  const location = typeof sd.location_description === 'string' ? sd.location_description : ''
  const imageRef = typeof sd.image_ref === 'string' ? sd.image_ref : ''
  const matingImageRef = typeof sd.mating_end_image_ref === 'string' ? sd.mating_end_image_ref : ''
  return (
    <>
      {(imageRef || matingImageRef) && (
        <div className="vk-conn">
          {imageRef && (
            <div className="vk-upload__filled">
              <div className="vk-upload__filled-img" style={{ height: 200 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageRef} alt="In place" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>
              <div className="vk-upload__filled-meta"><span>In place</span></div>
            </div>
          )}
          {matingImageRef && (
            <div className="vk-upload__filled">
              <div className="vk-upload__filled-img" style={{ height: 200 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={matingImageRef} alt="Mating end" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>
              <div className="vk-upload__filled-meta"><span>Mating end</span></div>
            </div>
          )}
        </div>
      )}
      <div className="vk-dsec">
        <div className="vk-dsec__head"><span>Identity</span></div>
        <div className="vk-cf">
          {connectorId && (
            <>
              <span className="vk-cf__label">OEM ID</span>
              <span className="vk-cf__val" style={{ fontFamily: 'var(--vt-font-mono)', fontSize: 14 }}>{connectorId}</span>
            </>
          )}
          {componentName && (
            <>
              <span className="vk-cf__label">COMPONENT</span>
              <span className="vk-cf__val">{componentName}</span>
            </>
          )}
        </div>
      </div>
      {location && (
        <div className="vk-dsec">
          <div className="vk-dsec__head"><span>Location</span></div>
          <p className="vk-conn__location">{location}</p>
        </div>
      )}
      {body && (
        <div className="vk-dsec">
          <div className="vk-dsec__head"><span>Notes</span></div>
          <p className="vk-dsec__body">{body}</p>
        </div>
      )}
    </>
  )
}

function WiringBody({ sd }: { sd: Record<string, unknown> }) {
  const imageRef = typeof sd.image_ref === 'string' ? sd.image_ref : ''
  const name = typeof sd.name === 'string' ? sd.name : ''
  const connections = (Array.isArray(sd.connections) ? sd.connections : []) as WiringConn[]
  return (
    <>
      {imageRef && (
        <div className="vk-wd">
          <div className="vk-wd__img" style={{ aspectRatio: '16 / 9' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageRef} alt={name || 'Wiring diagram'} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          </div>
          {name && <div className="vk-wd__foot"><span>{name}</span></div>}
        </div>
      )}
      {connections.length > 0 && (
        <div className="vk-dsec">
          <div className="vk-dsec__head"><span>Connections · {connections.length}</span></div>
          <div className="vk-conntbl">
            <div className="vk-conntbl__row vk-conntbl__row--head">
              <div>FROM</div><div>FROM PIN</div><div>TO</div><div>TO PIN</div>
              <div>WIRE</div><div>SPLICE</div><div>NOTES</div>
            </div>
            {connections.map((c, i) => (
              <div className="vk-conntbl__row" key={i}>
                <div>{c.from_component}</div>
                <div>{c.from_pin ?? ''}</div>
                <div>{c.to_component}</div>
                <div>{c.to_pin ?? ''}</div>
                <div>{c.wire_color ?? ''}</div>
                <div>{c.splice_id ?? ''}</div>
                <div
                  style={{
                    fontFamily: 'var(--vt-font-serif)', fontStyle: 'italic',
                    color: 'var(--vt-fg-2)',
                  }}
                >
                  {c.notes ?? ''}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

function TheoryBody({ sd }: { sd: Record<string, unknown> }) {
  const sections = (Array.isArray(sd.sections) ? sd.sections : []) as TheorySection[]
  const [open, setOpen] = useState<Record<number, boolean>>(() =>
    Object.fromEntries(sections.map((_, i) => [i, i === 0])),
  )
  return (
    <div className="vk-theory">
      {sections.map((s, i) => (
        <div className="vk-theory__sec" key={i}>
          <button
            type="button"
            className="vk-theory__head"
            onClick={() => setOpen(o => ({ ...o, [i]: !o[i] }))}
          >
            <span className="vk-theory__head-num">{String(i + 1).padStart(2, '0')}</span>
            <span>{s.heading}</span>
            <span className="vk-theory__head-caret">{open[i] ? '▾' : '▸'}</span>
          </button>
          {open[i] && <div className="vk-theory__body">{s.body}</div>}
        </div>
      ))}
    </div>
  )
}

function CauseFixBody({ sd }: { sd: Record<string, unknown> }) {
  const fields: Array<[string, string | undefined]> = [
    ['COMPLAINT', toStr(sd.complaint)],
    ['CAUSE', toStr(sd.cause)],
    ['CORRECTION', toStr(sd.correction)],
    ['FIRST CHECK', toStr(sd.first_check)],
  ]
  return (
    <div className="vk-dsec">
      <div className="vk-cf">
        {fields.map(([label, val]) =>
          val ? (
            <span key={label} style={{ display: 'contents' }}>
              <span className="vk-cf__label">{label}</span>
              <p className="vk-cf__val">{val}</p>
            </span>
          ) : null,
        )}
      </div>
    </div>
  )
}

function BulletinBody({ sd }: { sd: Record<string, unknown> }) {
  const source = toStr(sd.source)
  const bulletinId = toStr(sd.bulletin_id)
  const link = toStr(sd.link)
  const summary = toStr(sd.summary)
  const body = toStr(sd.body)
  return (
    <>
      <div className="vk-dsec">
        <div className="vk-cf">
          {source && (<><span className="vk-cf__label">SOURCE</span>
            <span className="vk-cf__val" style={{ fontFamily: 'var(--vt-font-mono)', fontSize: 14 }}>{source}</span></>)}
          {bulletinId && (<><span className="vk-cf__label">BULLETIN ID</span>
            <span className="vk-cf__val" style={{ fontFamily: 'var(--vt-font-mono)', fontSize: 14 }}>{bulletinId}</span></>)}
          {link && (<><span className="vk-cf__label">LINK</span>
            <a href={link} className="vk-cf__val" style={{
              color: 'var(--vt-amber-500)', fontFamily: 'var(--vt-font-mono)',
              fontSize: 13, textDecoration: 'underline',
            }}>{link}</a></>)}
        </div>
      </div>
      {summary && (
        <div className="vk-dsec">
          <div className="vk-dsec__head"><span>Summary</span></div>
          <p className="vk-dsec__body">{summary}</p>
        </div>
      )}
      {body && (
        <div className="vk-dsec">
          <div className="vk-dsec__head"><span>Body</span></div>
          <p className="vk-dsec__body">{body}</p>
        </div>
      )}
    </>
  )
}

function toStr(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  return v.trim() || undefined
}
