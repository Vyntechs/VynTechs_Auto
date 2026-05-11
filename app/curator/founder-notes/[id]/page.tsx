import { notFound } from 'next/navigation'
import { db } from '@/lib/db/client'
import { getFounderNote } from '@/lib/founder/queries'
import { FounderNoteReviewForm } from '@/components/curator/founder-note-review-form'
import type { CuratorCorpusInput } from '@/lib/curator/corpus-actions'

export default async function FounderNoteReviewPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const row = await getFounderNote(db, id)
  if (!row) notFound()

  const draft = (row.structuredDraft ?? {}) as Partial<CuratorCorpusInput>

  return (
    <div className="vt-founder-note-review-page">
      <header className="vt-founder-note-review-header">
        <h1>Review founder note</h1>
        <span className={`vt-founder-notes-status vt-founder-notes-status-${row.parseStatus}`}>
          {row.parseStatus}
        </span>
      </header>

      <section className="vt-founder-note-raw">
        <h2>Original note</h2>
        <pre>{row.rawText}</pre>
      </section>

      {row.llmNotes && (
        <section className="vt-founder-note-llm-notes">
          <h2>Structurer notes</h2>
          <p>{row.llmNotes}</p>
        </section>
      )}

      {row.missingFields.length > 0 && (
        <section className="vt-founder-note-missing">
          <h2>Missing fields</h2>
          <p>Fill these in below before promoting: {row.missingFields.join(', ')}</p>
        </section>
      )}

      {row.reviewedAt ? (
        <p className="vt-founder-note-reviewed">
          Already reviewed at {row.reviewedAt.toLocaleString()} — decision: {row.reviewedDecision}.
        </p>
      ) : (
        <FounderNoteReviewForm noteId={row.id} draft={draft} />
      )}
    </div>
  )
}
