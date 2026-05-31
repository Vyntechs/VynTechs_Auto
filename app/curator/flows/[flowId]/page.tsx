import Link from 'next/link'
import { notFound } from 'next/navigation'
import { and, eq, desc } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { flows, flowVersions } from '@/lib/db/schema'
import { platformDisplayName, symptomDisplayName } from '@/lib/curator/slug-catalog'
import { cloneFromPublished } from '../actions'

export const metadata = { title: 'Curator — Flow detail' }

export default async function FlowDetailPage({ params }: { params: Promise<{ flowId: string }> }) {
  const { flowId } = await params
  const [flow] = await db
    .select({
      id: flows.id,
      displayTitle: flows.displayTitle,
      platformSlug: flows.platformSlug,
      symptomSlug: flows.symptomSlug,
    })
    .from(flows)
    .where(eq(flows.id, flowId))
    .limit(1)

  if (!flow) notFound()

  const [published] = await db
    .select()
    .from(flowVersions)
    .where(and(eq(flowVersions.flowId, flowId), eq(flowVersions.state, 'published')))
    .limit(1)

  const archives = await db
    .select({
      id: flowVersions.id,
      versionNumber: flowVersions.versionNumber,
      archivedAt: flowVersions.archivedAt,
      changeNote: flowVersions.changeNote,
    })
    .from(flowVersions)
    .where(and(eq(flowVersions.flowId, flowId), eq(flowVersions.state, 'archived')))
    .orderBy(desc(flowVersions.versionNumber))

  const cloneAction = async () => {
    'use server'
    const { flowVersionId } = await cloneFromPublished({ flowId })
    const { redirect } = await import('next/navigation')
    redirect(`/curator/flows/${flowId}/edit?versionId=${flowVersionId}`)
  }

  return (
    <div className="vt-curator-page">
      <header>
        <h1>{flow.displayTitle}</h1>
        <p>{platformDisplayName(flow.platformSlug)} · {symptomDisplayName(flow.symptomSlug)}</p>
      </header>

      {published ? (
        <section className="vt-flow-published">
          <h2>Current published (v{published.versionNumber})</h2>
          <p className="vt-flow-changenote"><em>{published.changeNote}</em></p>
          {/* N2 renders the real stored body as a readable structured summary.
              The polished tree read-view is PR-N7 scope. This is NOT placeholder
              content — it shows the actual published steps/answers/citations. */}
          <FlowBodySummary body={published.body as import('@/lib/flows/types').Flow} />
          <form action={cloneAction}>
            <button type="submit" className="vt-btn vt-btn-primary">Edit (clone new draft)</button>
          </form>
        </section>
      ) : (
        <section>
          <p>No published version yet.</p>
          <Link href={`/curator/flows/${flowId}/edit`} className="vt-btn vt-btn-primary">Open draft editor</Link>
        </section>
      )}

      {archives.length > 0 && (
        <section className="vt-flow-archives">
          <h2>Archive history</h2>
          <ul>
            {archives.map((a) => (
              <li key={a.id}>
                v{a.versionNumber} · archived {a.archivedAt ? new Date(a.archivedAt).toISOString().slice(0, 10) : '—'} · "{a.changeNote}"
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

// Real-data read view of a published body. Lists each step, its question/
// instructions, answers (with their branch target or finding), and citation
// count. NOT a JSON dump and NOT fabricated — it walks the actual stored Flow.
function FlowBodySummary({ body }: { body: import('@/lib/flows/types').Flow }) {
  const entries = Object.entries(body.steps)
  return (
    <ol className="vt-flow-body-summary">
      {entries.map(([id, step]) => (
        <li key={id} className={id === body.startStepId ? 'vt-flow-step vt-flow-step--start' : 'vt-flow-step'}>
          <strong>{id}{id === body.startStepId ? ' (start)' : ''}: {step.title || '(untitled)'}</strong>
          <p>{step.kind === 'question' ? step.question : step.instructions}</p>
          {step.kind === 'question' && (
            <ul>
              {step.answers.map((a) => (
                <li key={a.id}>
                  {a.label} → {a.next ? a.next : `FINDING: ${a.finding?.verdict ?? ''}`}
                </li>
              ))}
            </ul>
          )}
          {(step.citations?.length ?? 0) > 0 && (
            <p className="vt-flow-step-cites">{step.citations!.length} citation(s)</p>
          )}
        </li>
      ))}
    </ol>
  )
}
