import Link from 'next/link'
import { db } from '@/lib/db/client'
import {
  listAllCases,
  listCaseFilterOptions,
  type CaseStatusFilter,
} from '@/lib/curator/queries'

const STATUS_OPTIONS: { value: CaseStatusFilter; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' },
  { value: 'deferred', label: 'Deferred' },
  { value: 'declined', label: 'Declined' },
]

function asStatus(raw: string | undefined): CaseStatusFilter | undefined {
  if (!raw) return undefined
  if (raw === 'open' || raw === 'closed' || raw === 'deferred' || raw === 'declined') {
    return raw
  }
  return undefined
}

function asNonEmpty(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

type SearchParams = {
  status?: string
  shop?: string
  tech?: string
  q?: string
}

export default async function AllCasesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const status = asStatus(params.status)
  const shopId = asNonEmpty(params.shop)
  const techId = asNonEmpty(params.tech)
  const search = asNonEmpty(params.q)

  const [rows, options] = await Promise.all([
    listAllCases(db, { status, shopId, techId, search }),
    listCaseFilterOptions(db),
  ])

  const techsForCurrentShop = shopId
    ? options.techs.filter((t) => t.shopId === shopId)
    : options.techs

  return (
    <div className="vt-cases-page">
      <header className="vt-cases-header">
        <h1>All cases</h1>
        <span className="vt-cases-count">
          {rows.length === 100 ? '100+ shown' : `${rows.length} shown`}
        </span>
      </header>

      <form method="get" className="vt-cases-filters">
        <div className="vt-cases-filter-row">
          <label>
            <span>Status</span>
            <select name="status" defaultValue={status ?? ''}>
              <option value="">Any</option>
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Shop</span>
            <select name="shop" defaultValue={shopId ?? ''}>
              <option value="">All shops</option>
              {options.shops.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Tech</span>
            <select name="tech" defaultValue={techId ?? ''}>
              <option value="">All techs</option>
              {techsForCurrentShop.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.fullName}
                </option>
              ))}
            </select>
          </label>

          <label className="vt-cases-search">
            <span>Search</span>
            <input
              type="search"
              name="q"
              defaultValue={search ?? ''}
              placeholder="Vehicle or symptom"
            />
          </label>

          <div className="vt-cases-filter-actions">
            <button type="submit" className="btn">
              Apply
            </button>
            <Link href="/curator/cases" className="vt-cases-clear">
              Clear
            </Link>
          </div>
        </div>
      </form>

      {rows.length === 0 ? (
        <p className="vt-cases-empty">No cases match these filters.</p>
      ) : (
        <table className="vt-cases-table">
          <thead>
            <tr>
              <th>Vehicle</th>
              <th>Complaint</th>
              <th>Status</th>
              <th>Tech</th>
              <th>Shop</th>
              <th>Opened</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const v = row.intake
              const vehicle = `${v.vehicleYear} ${v.vehicleMake} ${v.vehicleModel}`
              return (
                <tr key={row.id}>
                  <td>
                    <Link
                      href={`/curator/cases/${row.id}?from=all`}
                      className="vt-cases-link"
                    >
                      {vehicle}
                    </Link>
                  </td>
                  <td className="vt-cases-complaint">{v.customerComplaint}</td>
                  <td>
                    <span className={`vt-cases-status vt-cases-status-${row.status}`}>
                      {row.status}
                    </span>
                  </td>
                  <td>{row.techName ?? '—'}</td>
                  <td>{row.shopName ?? '—'}</td>
                  <td>
                    <time
                      dateTime={row.createdAt.toISOString()}
                      className="vt-cases-date"
                    >
                      {row.createdAt.toLocaleString()}
                    </time>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
