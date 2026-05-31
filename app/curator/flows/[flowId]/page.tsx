import Link from 'next/link'
import { notFound } from 'next/navigation'
import { and, eq, desc } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { flows, flowVersions } from '@/lib/db/schema'
import { platformDisplayName, symptomDisplayName } from '@/lib/curator/slug-catalog'
import { MainHeader } from '@/components/vt/desktop'
import { FlowStatusPill, type FlowStatus } from '@/components/curator/flow-status-pill'
import { FlowBodySummary } from '@/components/curator/flow-body-summary'
import { cloneFromPublished } from '../actions'
import type { Flow } from '@/lib/flows/types'

export const metadata = { title: 'Curator — Flow detail' }

function fmtDate(d: Date | null): string {
  return d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
}

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

  const [latestDraft] = await db
    .select()
    .from(flowVersions)
    .where(and(eq(flowVersions.flowId, flowId), eq(flowVersions.state, 'draft')))
    .orderBy(desc(flowVersions.versionNumber))
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

  // Real lifecycle state (mirrors the list).
  let status: FlowStatus = 'empty'
  if (published && latestDraft && latestDraft.versionNumber > published.versionNumber) status = 'changed'
  else if (published) status = 'published'
  else if (latestDraft) status = 'draft'

  const cloneAction = async () => {
    'use server'
    const { flowVersionId } = await cloneFromPublished({ flowId })
    const { redirect } = await import('next/navigation')
    redirect(`/curator/flows/${flowId}/edit?versionId=${flowVersionId}`)
  }

  const vehicleLine = `${platformDisplayName(flow.platformSlug)} · ${symptomDisplayName(flow.symptomSlug)}`

  // What the curator sees + can act on, per state.
  const liveVersion = published ?? latestDraft

  return (
    <>
      <MainHeader
        eyebrowSlot={
          <Link href="/curator/flows" className="vt-curator-backlink">← Flows</Link>
        }
        title={flow.displayTitle}
        sub={vehicleLine}
        actions={<FlowStatusPill status={status} />}
      />
      <div className="vt-main__body vt-flow-detail">
        {/* State + primary action */}
        <section className="vt-flow-detail__state">
          {published ? (
            <>
              <div className="vt-flow-detail__state-head">
                <span className="vt-eyebrow">Live for techs · v{published.versionNumber}</span>
                <span className="vt-flow-detail__state-date">Published {fmtDate(published.publishedAt)}</span>
              </div>
              {status === 'changed' && (
                <p className="vt-flow-detail__note-line">
                  A newer draft (v{latestDraft!.versionNumber}) is in progress — techs still see v{published.versionNumber} until you publish it.
                </p>
              )}
            </>
          ) : latestDraft ? (
            <div className="vt-flow-detail__state-head">
              <span className="vt-eyebrow">Draft · not yet live</span>
              <span className="vt-flow-detail__state-date">Last edited {fmtDate(latestDraft.authoredAt)}</span>
            </div>
          ) : (
            <p className="vt-flow-detail__note-line">This flow has no content yet.</p>
          )}

          <div className="vt-flow-detail__actions">
            {status === 'changed' ? (
              <Link href={`/curator/flows/${flowId}/edit`} className="vt-btn vt-btn--accent">Continue editing draft</Link>
            ) : published ? (
              <form action={cloneAction}>
                <button type="submit" className="vt-btn vt-btn--accent">Make changes</button>
                <span className="vt-flow-detail__action-hint">
                  The live version stays frozen — your changes start a fresh draft.
                </span>
              </form>
            ) : latestDraft ? (
              <Link href={`/curator/flows/${flowId}/edit`} className="vt-btn vt-btn--accent">Continue editing draft</Link>
            ) : (
              <Link href={`/curator/flows/${flowId}/edit`} className="vt-btn vt-btn--accent">Start building</Link>
            )}
          </div>
        </section>

        {/* The change note for whichever version we're showing */}
        {liveVersion?.changeNote && (
          <div className="vt-writer-note vt-flow-detail__changenote">
            <div className="vt-writer-note__label">Why this version exists</div>
            <p className="vt-flow-detail__changenote-text">{liveVersion.changeNote}</p>
          </div>
        )}

        {/* The actual steps — a clean read of the real stored body */}
        {liveVersion && (
          <section className="vt-flow-detail__steps">
            <div className="vt-eyebrow vt-flow-detail__steps-label">The steps a tech walks through</div>
            <FlowBodySummary body={liveVersion.body as Flow} />
          </section>
        )}

        {/* Past published versions */}
        {archives.length > 0 && (
          <section className="vt-flow-detail__history">
            <div className="vt-eyebrow vt-flow-detail__steps-label">Earlier published versions</div>
            <ul className="vt-flow-history">
              {archives.map((a) => (
                <li key={a.id} className="vt-flow-history__row">
                  <span className="vt-flow-history__ver">v{a.versionNumber}</span>
                  <span className="vt-flow-history__note">{a.changeNote || '—'}</span>
                  <span className="vt-flow-history__date">{fmtDate(a.archivedAt)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  )
}
