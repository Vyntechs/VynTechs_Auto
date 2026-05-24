import type { ReactNode } from 'react'
import Link from 'next/link'
import { CreateRow, GroupHead, Row } from './rows'
import type { RecentCustomer } from '@/lib/intake/recent-customers'
import type { CustomerHit, CustomerVehicle, VehicleHit } from '@/lib/intake/search'
import type { InputShape } from '@/lib/intake/input-shape'

export function DropdownEmpty({
  recents,
  focusedIdx,
  onPickCustomer,
  onCreateNew,
}: {
  recents: RecentCustomer[]
  focusedIdx: number | null
  onPickCustomer: (customer: RecentCustomer) => void
  onCreateNew: () => void
}) {
  if (recents.length === 0) {
    return (
      <div className="pis__dropdown" role="listbox" id="pis-dropdown">
        <div className="pis__dropdown-inner">
          <div className="pis__empty-zero">
            No one&apos;s been through the counter yet today.
            <br />
            Start typing — or create a new customer.
          </div>
        </div>
        <CreateRow
          id="pis-row-create"
          hint="Name and phone is all we need."
          focused={focusedIdx === 0}
          onClick={onCreateNew}
        />
      </div>
    )
  }

  const visible = recents.slice(0, 5)
  const showSeeMore = recents.length > 5

  return (
    <div className="pis__dropdown" role="listbox" id="pis-dropdown">
      <div className="pis__dropdown-inner">
        <GroupHead
          label="Recent · today"
          count={`${recents.length} customer${recents.length === 1 ? '' : 's'}`}
        />
        <div className="pis__empty-pad">
          {visible.map((c, i) => (
            <Row
              key={c.id}
              id={`pis-row-${i}`}
              kind="C"
              primary={c.name}
              secondary={
                <>
                  {c.phone ?? '—'}
                  {' · '}
                  {c.vehicleCount} vehicle{c.vehicleCount === 1 ? '' : 's'}
                </>
              }
              meta="↩"
              focused={focusedIdx === i}
              onClick={() => onPickCustomer(c)}
            />
          ))}
        </div>
        {showSeeMore && (
          <button type="button" className="pis__seemore">
            See all {recents.length} ↓
          </button>
        )}
      </div>
      <CreateRow
        id="pis-row-create"
        hint="Or — start a new ticket from scratch."
        focused={focusedIdx === visible.length}
        onClick={onCreateNew}
      />
    </div>
  )
}

export function DropdownSearching({
  elapsedMs,
  onCreateNew,
  focusedIdx,
}: {
  elapsedMs: number
  onCreateNew: () => void
  focusedIdx: number | null
}) {
  return (
    <div className="pis__dropdown" role="listbox" id="pis-dropdown">
      <div className="pis__dropdown-inner">
        <div className="pis__status">
          <span className="pis__status__left">
            <span className="pis__spinner" /> Searching · {elapsedMs} ms
          </span>
          <span>—</span>
        </div>
        <div
          style={{
            padding: '22px 18px 26px',
            fontFamily: 'var(--vt-font-serif)',
            fontStyle: 'italic',
            color: 'var(--vt-fg-3)',
            fontSize: 15,
          }}
        >
          Holding previous results while we re-fetch…
        </div>
      </div>
      <CreateRow
        id="pis-row-create"
        hint="No need to wait — you can always create new."
        focused={focusedIdx === 0}
        onClick={onCreateNew}
      />
    </div>
  )
}

export function DropdownResults({
  customers,
  vehicles,
  latencyMs,
  focusedIdx,
  onPickCustomer,
  onPickVehicle,
  onCreateNew,
  highlightTokens,
}: {
  customers: CustomerHit[]
  vehicles: VehicleHit[]
  latencyMs: number
  focusedIdx: number | null
  onPickCustomer: (customer: CustomerHit) => void
  onPickVehicle: (vehicle: VehicleHit) => void
  onCreateNew: () => void
  highlightTokens: string[]
}) {
  const totalMatches = customers.length + vehicles.length
  let idx = 0
  return (
    <div className="pis__dropdown" role="listbox" id="pis-dropdown">
      <div className="pis__dropdown-inner">
        <div className="pis__status">
          <span className="pis__status__left">
            Matched · {latencyMs} ms · {totalMatches} match{totalMatches === 1 ? '' : 'es'}
          </span>
          <span>↑↓ navigate · ↩ pick</span>
        </div>
        {customers.length > 0 && <GroupHead label="Customers" count={customers.length} />}
        {customers.map((c) => {
          const myIdx = idx++
          return (
            <Row
              key={c.id}
              id={`pis-row-${myIdx}`}
              kind="C"
              primary={highlight(c.name, highlightTokens)}
              secondary={
                <>
                  {c.phone ?? '—'}
                  {c.email ? ` · ${c.email}` : ''} · {c.vehicleCount} vehicle
                  {c.vehicleCount === 1 ? '' : 's'}
                </>
              }
              meta={c.lastVisit ? formatRelative(c.lastVisit) : '—'}
              focused={focusedIdx === myIdx}
              onClick={() => onPickCustomer(c)}
            />
          )
        })}
        {customers.length > 0 && vehicles.length > 0 && <div className="pis__divider" />}
        {vehicles.length > 0 && <GroupHead label="Vehicles" count={vehicles.length} />}
        {vehicles.map((v) => {
          const myIdx = idx++
          const ymm = `${v.year ?? ''} ${v.make ?? ''} ${v.model ?? ''}`.trim()
          return (
            <Row
              key={v.id}
              id={`pis-row-${myIdx}`}
              kind="V"
              primary={
                <>
                  {highlight(ymm, highlightTokens)} · {v.ownerName}
                </>
              }
              secondary={
                <>
                  {v.vin && <>VIN {highlight(v.vin, highlightTokens)}</>}
                  {v.plate && <> · {highlight(v.plate, highlightTokens)}</>}
                  {v.mileage != null && <> · {v.mileage.toLocaleString()} mi</>}
                </>
              }
              meta={v.lastVisit ? formatRelative(v.lastVisit) : '—'}
              focused={focusedIdx === myIdx}
              onClick={() => onPickVehicle(v)}
            />
          )
        })}
      </div>
      <CreateRow
        id="pis-row-create"
        hint="Not in this list? Create new customer."
        focused={focusedIdx === totalMatches}
        onClick={onCreateNew}
      />
    </div>
  )
}

export function DropdownNoMatch({
  query,
  shape,
  onCreateNew,
  focusedIdx,
}: {
  query: string
  shape: InputShape
  onCreateNew: () => void
  focusedIdx: number | null
}) {
  const hint = routeHint(shape)
  return (
    <div className="pis__dropdown" role="listbox" id="pis-dropdown">
      <div className="pis__dropdown-inner">
        <div className="pis__status">
          <span className="pis__status__left">No match</span>
          <span>—</span>
        </div>
        <div className="pis__nomatch">
          <div className="pis__nomatch__head">
            Nothing matches{' '}
            <em style={{ fontStyle: 'italic', color: 'var(--vt-fg)' }}>&quot;{query}&quot;</em>{' '}
            in customers or vehicles.
          </div>
          <div className="pis__nomatch__detail">
            Searched: name · phone · email · VIN · plate · year · make · model
          </div>
          {hint && (
            <div className="pis__nomatch__route">
              Looks like a {hint.kind} — we&apos;ll prefill the {hint.field} field.{' '}
              <b>
                {hint.field}: {hint.value}
              </b>
            </div>
          )}
        </div>
      </div>
      <CreateRow
        id="pis-row-create"
        label="Create new customer with this info"
        hint="Required fields: name + phone."
        focused={focusedIdx === 0}
        onClick={onCreateNew}
      />
    </div>
  )
}

export function DropdownSlow({
  elapsedSec,
  prev,
  focusedIdx,
  onCreateNew,
  onPickCustomer,
  onPickVehicle,
}: {
  elapsedSec: number
  prev: { customers: CustomerHit[]; vehicles: VehicleHit[] } | null
  focusedIdx: number | null
  onCreateNew: () => void
  onPickCustomer: (customer: CustomerHit) => void
  onPickVehicle: (vehicle: VehicleHit) => void
}) {
  return (
    <div className="pis__dropdown" role="listbox" id="pis-dropdown">
      <div className="pis__dropdown-inner">
        <div className="pis__status">
          <span className="pis__status__left">
            <span className="pis__spinner" /> Still searching · {elapsedSec.toFixed(1)} s
          </span>
          <span>slow network</span>
        </div>
        <div
          style={{
            padding: '20px 18px',
            fontFamily: 'var(--vt-font-serif)',
            fontStyle: 'italic',
            fontSize: 14,
            color: 'var(--vt-fg-3)',
            lineHeight: 1.45,
          }}
        >
          Holding previous matches. You can still create a new customer — or pick one of the
          cached rows below — we&apos;ll reconcile when the search returns.
        </div>
        {prev && (prev.customers.length > 0 || prev.vehicles.length > 0) && (
          <>
            <GroupHead
              label="Previous matches · old"
              count={`${prev.customers.length} customer${prev.customers.length === 1 ? '' : 's'} · ${prev.vehicles.length} vehicle${prev.vehicles.length === 1 ? '' : 's'}`}
            />
            {prev.customers.map((c) => (
              <Row
                key={c.id}
                kind="C"
                primary={c.name}
                secondary={c.phone ?? '—'}
                meta="cached"
                onClick={() => onPickCustomer(c)}
              />
            ))}
            {prev.vehicles.map((v) => (
              <Row
                key={v.id}
                kind="V"
                primary={`${v.year ?? ''} ${v.make ?? ''} ${v.model ?? ''} · ${v.ownerName}`.trim()}
                secondary={v.vin ?? '—'}
                meta="cached"
                onClick={() => onPickVehicle(v)}
              />
            ))}
          </>
        )}
      </div>
      <CreateRow
        id="pis-row-create"
        hint="The create-new path is never blocked."
        focused={focusedIdx === 0}
        onClick={onCreateNew}
      />
    </div>
  )
}

export function DropdownWhichVehicle({
  customerName,
  vehicles,
  focusedIdx,
  onBack,
  onPickVehicle,
  onCreateNew,
}: {
  customerName: string
  vehicles: CustomerVehicle[]
  focusedIdx: number | null
  onBack: () => void
  onPickVehicle: (vehicle: CustomerVehicle) => void
  onCreateNew: () => void
}) {
  return (
    <div className="pis__dropdown" role="listbox" id="pis-dropdown">
      <div className="pis__dropdown-inner">
        <div className="pis__tier__head">
          <span className="pis__tier__title">
            <b>{customerName}</b> · which vehicle?
          </span>
          <button type="button" className="pis__tier__back" onClick={onBack}>
            ← Back to results
          </button>
        </div>
        {vehicles.map((v, i) => {
          const ymm = `${v.year ?? ''} ${v.make ?? ''} ${v.model ?? ''}`.trim()
          return (
            <div key={v.id} className="pis__row-with-history">
              <Row
                id={`pis-row-${i}`}
                kind="V"
                primary={ymm}
                secondary={
                  <>
                    {v.vin && <>VIN {v.vin}</>}
                    {v.plate && <> · {v.plate}</>}
                    {v.mileage != null && <> · {v.mileage.toLocaleString()} mi</>}
                  </>
                }
                meta={v.lastVisit ? formatRelative(v.lastVisit) : '—'}
                focused={focusedIdx === i}
                onClick={() => onPickVehicle(v)}
              />
              <Link
                href={`/vehicles/${v.id}`}
                className="pis__row-history"
                aria-label={`History for ${ymm || 'this vehicle'}`}
              >
                history →
              </Link>
            </div>
          )
        })}
      </div>
      <CreateRow
        id="pis-row-create"
        label="None of these — add another vehicle for this customer"
        focused={focusedIdx === vehicles.length}
        onClick={onCreateNew}
      />
    </div>
  )
}

/* ---------- helpers ---------- */

function highlight(text: string, tokens: string[]): ReactNode {
  if (tokens.length === 0 || text === '') return text
  const escaped = tokens.filter((t) => t !== '').map(escapeRegex)
  if (escaped.length === 0) return text
  const re = new RegExp(`(${escaped.join('|')})`, 'gi')
  const parts = text.split(re)
  return parts.map((p, i) =>
    re.test(p) ? (
      <em key={i} className="pis__mark">
        {p}
      </em>
    ) : (
      <span key={i}>{p}</span>
    ),
  )
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function routeHint(shape: InputShape): { kind: string; field: string; value: string } | null {
  switch (shape.kind) {
    case 'phone':
      return { kind: 'phone', field: 'Phone', value: shape.value }
    case 'vin':
      return { kind: 'VIN', field: 'VIN', value: shape.value }
    case 'plate':
      return { kind: 'plate', field: 'License plate', value: shape.value }
    case 'year':
      return { kind: 'year', field: 'Year', value: String(shape.value) }
    case 'make':
      return { kind: 'make', field: 'Make', value: shape.value }
    case 'email':
      return { kind: 'email', field: 'Email', value: shape.value }
    default:
      return null
  }
}

function formatRelative(d: Date | string): string {
  // The API hands back ISO strings (JSON serialization), but our types claim
  // Date for ergonomics. Hydrate at the boundary so this never crashes the
  // tree on a string that looked like a Date in the types.
  const date = d instanceof Date ? d : new Date(d)
  const time = date.getTime()
  if (!Number.isFinite(time)) return '—'
  const diffMs = Date.now() - time
  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000))
  if (days === 0) return 'today'
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}wk ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}
