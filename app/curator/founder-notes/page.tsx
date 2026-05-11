import Link from 'next/link'
import { getServerSupabase } from '@/lib/supabase-server'
import { isFounder } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { listPendingFounderNotes } from '@/lib/founder/queries'

export default async function FounderNotesQueuePage() {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const userIsFounder = isFounder(user?.id)

  const rows = await listPendingFounderNotes(db)

  return (
    <div className="vt-founder-notes-page">
      <header className="vt-founder-notes-header">
        <h1>Founder knowledge</h1>
        {userIsFounder && (
          <Link href="/curator/founder-notes/new" className="vt-founder-notes-new">
            New note
          </Link>
        )}
      </header>

      {rows.length === 0 ? (
        <p className="vt-founder-notes-empty">
          No pending notes. {userIsFounder ? 'Drop one in any time.' : ''}
        </p>
      ) : (
        <table className="vt-founder-notes-table">
          <thead>
            <tr>
              <th>Submitted</th>
              <th>Status</th>
              <th>Preview</th>
              <th>Missing</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const draft = row.structuredDraft as
                | { vehicleYear?: number; vehicleMake?: string; vehicleModel?: string; rootCause?: string }
                | null
              const vehicle = draft
                ? [draft.vehicleYear, draft.vehicleMake, draft.vehicleModel].filter(Boolean).join(' ')
                : ''
              const preview = vehicle || row.rawText.slice(0, 80)
              return (
                <tr key={row.id}>
                  <td>
                    <Link href={`/curator/founder-notes/${row.id}`} className="vt-founder-notes-link">
                      <time dateTime={row.createdAt.toISOString()}>
                        {row.createdAt.toLocaleString()}
                      </time>
                    </Link>
                  </td>
                  <td>
                    <span className={`vt-founder-notes-status vt-founder-notes-status-${row.parseStatus}`}>
                      {row.parseStatus}
                    </span>
                  </td>
                  <td className="vt-founder-notes-preview">{preview}</td>
                  <td className="vt-founder-notes-missing">
                    {row.missingFields.length === 0 ? '—' : row.missingFields.join(', ')}
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
