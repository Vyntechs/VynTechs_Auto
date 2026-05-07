import Link from 'next/link'
import { db } from '@/lib/db/client'
import { listCorpusEntries } from '@/lib/curator/queries'

export default async function CorpusListPage({
  searchParams,
}: { searchParams: Promise<{ curator?: string }> }) {
  const sp = await searchParams
  const curatorOnly = sp.curator === '1'
  const rows = await listCorpusEntries(db, { curatorOnly })

  return (
    <div className="vt-corpus-list-page">
      <header className="vt-corpus-list-header">
        <h1>Solved cases</h1>
        <span className="vt-corpus-list-count">{rows.length}{curatorOnly ? ' curator-authored' : ' total'}</span>
        <div className="vt-corpus-list-actions">
          <Link href="/curator/corpus/new" className="vt-corpus-list-new">+ New entry</Link>
          <Link
            href={curatorOnly ? '/curator/corpus' : '/curator/corpus?curator=1'}
            className="vt-corpus-list-filter"
          >
            {curatorOnly ? 'Show all' : 'Show curator-authored only'}
          </Link>
        </div>
      </header>

      {rows.length === 0 ? (
        <div className="vt-corpus-list-empty">
          {curatorOnly
            ? 'No curator-authored corpus entries yet.'
            : 'No corpus entries yet.'}
        </div>
      ) : (
        <table className="vt-corpus-list-table">
          <thead>
            <tr>
              <th>Vehicle</th>
              <th>Symptom tags</th>
              <th>Root cause</th>
              <th>Source</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  {r.vehicleYear} {r.vehicleMake} {r.vehicleModel}
                  {r.vehicleEngine ? ` (${r.vehicleEngine})` : ''}
                </td>
                <td className="vt-corpus-list-tags">{r.symptomTags.join(', ')}</td>
                <td>{r.rootCause}</td>
                <td>{r.isCuratorEntry ? 'curator' : 'system'}</td>
                <td>
                  <time dateTime={r.createdAt.toISOString()}>
                    {r.createdAt.toLocaleDateString()}
                  </time>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
