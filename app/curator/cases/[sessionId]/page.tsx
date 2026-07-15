import { notFound } from 'next/navigation'
import Link from 'next/link'
import { and, isNull, eq, desc } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { fetchCuratorCaseDetail } from '@/lib/curator/case-detail-query'
import { novelPatternQueue } from '@/lib/db/schema'
import { DeferredActions } from '@/components/curator/deferred-actions'
import { NovelActions } from '@/components/curator/novel-actions'

export default async function CuratorCasePage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>
  searchParams: Promise<{ from?: string }>
}) {
  const { sessionId } = await params
  const { from } = await searchParams
  const detail = await fetchCuratorCaseDetail(db, sessionId)
  if (!detail) notFound()

  const { session, events } = detail

  let novelQueueEntry: { id: string } | null = null
  if (from === 'novel') {
    const [entry] = await db
      .select({ id: novelPatternQueue.id })
      .from(novelPatternQueue)
      .where(and(eq(novelPatternQueue.sessionId, sessionId), isNull(novelPatternQueue.reviewedAt)))
      .orderBy(desc(novelPatternQueue.createdAt))
      .limit(1)
    novelQueueEntry = entry ?? null
  }

  // Back link depends on which queue linked here
  const backHref =
    from === 'deferred'
      ? '/curator/deferred'
      : from === 'novel'
        ? '/curator/novel'
        : from?.startsWith('drift/')
          ? `/curator/${from}`
          : '/curator/drift'

  // Vehicle info lives inside the intake JSON column (IntakePayload)
  const intake = session.intake
  // treeState is typed TreeState — proposedAction lives inside treeState JSON
  const treeState = session.treeState
  // Outcome info lives inside the outcome JSON column (OutcomePayload)
  const outcome = session.outcome

  return (
    <article className="vt-case-detail">
      {/* ── Header: vehicle + complaint ── */}
      <header className="vt-case-detail-header">
        <Link href={backHref}>← Back</Link>
        <h1>
          {intake.vehicleYear} {intake.vehicleMake} {intake.vehicleModel}
          {intake.vehicleEngine ? ` (${intake.vehicleEngine})` : ''}
          {intake.mileage ? ` · ${intake.mileage.toLocaleString()} mi` : ''}
        </h1>
        <p className="vt-case-detail-complaint">{intake.customerComplaint}</p>
      </header>

      {/* ── Section 1: Conversation log ── */}
      <section>
        <h2>Conversation</h2>
        {events.length === 0 ? (
          <p style={{ color: 'var(--vt-fg-3)' }}>No conversation events recorded.</p>
        ) : (
          <div className="vt-event-list">
            {events.map((ev) => (
              <div key={ev.id} className="vt-event">
                <time dateTime={ev.createdAt.toISOString()}>
                  {ev.createdAt.toLocaleString()}
                </time>
                <div>
                  {/* eventType = 'advance' | 'observation' | 'tree_update' | 'close'
                      observationText holds the tech's input; aiResponse holds the AI reply */}
                  <span className="vt-event-type">[{ev.eventType}]</span>
                  {ev.observationText ? (
                    <span className="vt-event-tech"> Tech: {ev.observationText}</span>
                  ) : null}
                  {ev.aiResponse ? (
                    <span className="vt-event-ai">
                      {' '}
                      AI:{' '}
                      {ev.eventType === 'close' && ev.aiResponse.declineOrDefer
                        ? (ev.aiResponse.declineOrDefer.language?.internalNote ?? '(close)')
                        : ev.aiResponse.requestedFollowUp
                          ? `Follow-up: ${ev.aiResponse.requestedFollowUp}`
                          : ev.aiResponse.nextNodeId
                            ? `→ node ${ev.aiResponse.nextNodeId}`
                            : '(tree update)'}
                    </span>
                  ) : null}
                  {/* Per-turn AI message text — populated on observation events
                      from 2026-05-09 onward. Older rows render the routing
                      summary above only; not backfilled. */}
                  {ev.aiResponse?.messageText ? (
                    <p className="vt-event-ai-message" style={{ fontStyle: 'italic', margin: '4px 0 0', fontSize: 13 }}>
                      {ev.aiResponse.messageText}
                    </p>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Section 2: Diagnostic-path tree ── */}
      <section>
        <h2>Diagnostic Path</h2>
        {/* TODO P+1: render treeState as an interactive tree component;
            for now raw JSON is acceptable as a curator read-only placeholder */}
        <pre style={{ overflowX: 'auto', fontSize: 12 }}>
          {JSON.stringify(treeState, null, 2)}
        </pre>
        {treeState?.proposedAction ? (
          <dl>
            <dt>Proposed action</dt>
            <dd>{treeState.proposedAction.description}</dd>
            <dt>Confidence</dt>
            <dd>{(treeState.proposedAction.confidence * 100).toFixed(0)}%</dd>
            {treeState.proposedAction.confidenceGap ? (
              <>
                <dt>Confidence gap</dt>
                <dd>{treeState.proposedAction.confidenceGap}</dd>
              </>
            ) : null}
          </dl>
        ) : null}
      </section>

      {/* ── Section 3: Outcome ── */}
      <section>
        <h2>Outcome</h2>
        <dl>
          <dt>Session status</dt>
          <dd>{session.status}</dd>
          {/* outcomeStatus is session.status at the top level; the detailed outcome
              record lives in session.outcome (OutcomePayload) when present */}
          <dt>Root cause</dt>
          <dd>{outcome?.rootCause ?? '—'}</dd>
          <dt>Action type</dt>
          <dd>{outcome?.actionType ?? '—'}</dd>
          <dt>Symptoms resolved</dt>
          <dd>{outcome?.verification.symptomsResolved ?? '—'}</dd>
          <dt>Diag time</dt>
          <dd>{outcome ? `${outcome.diagMinutes} min` : '—'}</dd>
          <dt>Repair time</dt>
          <dd>{outcome ? `${outcome.repairMinutes} min` : '—'}</dd>
          {outcome?.notes ? (
            <>
              <dt>Tech notes</dt>
              <dd>{outcome.notes}</dd>
            </>
          ) : null}
          {outcome?.partInfo ? (
            <>
              <dt>Part</dt>
              <dd>
                {outcome.partInfo.name}
                {outcome.partInfo.oemNumber ? ` (OEM: ${outcome.partInfo.oemNumber})` : ''}
                {outcome.partInfo.cost != null
                  ? ` — $${outcome.partInfo.cost.toFixed(2)}`
                  : ''}
              </dd>
            </>
          ) : null}
        </dl>
      </section>

      {from === 'deferred' && (
        <DeferredActions sessionId={session.id} />
      )}
      {from === 'novel' && novelQueueEntry && (
        <>
          <div className="vt-novel-add-corpus">
            <Link
              href={`/curator/corpus/new?fromCase=${session.id}&fromQueueEntry=${novelQueueEntry.id}`}
              className="vt-novel-add-corpus-link"
            >
              Add to corpus →
            </Link>
          </div>
          <NovelActions queueEntryId={novelQueueEntry.id} />
        </>
      )}
    </article>
  )
}
