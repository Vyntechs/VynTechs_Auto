import Link from 'next/link'
import { MainHeader } from '@/components/vt/desktop'
import { ResearchProgress } from '@/components/curator/research-progress'

// Gating is inherited from app/curator/layout.tsx (canCurate). No extra auth needed here.
export default async function ResearchingPage({
  params,
  searchParams,
}: {
  params: Promise<{ flowId: string }>
  searchParams: Promise<{ runId?: string }>
}) {
  const { flowId } = await params
  const { runId } = await searchParams
  if (!runId) {
    return (
      <>
        <MainHeader
          eyebrowSlot={<Link href={`/curator/flows/${flowId}`} className="vt-curator-backlink">← Back to flow</Link>}
          title="No research run in progress"
          sub="There’s nothing to watch here right now."
        />
        <div className="vt-main__body vt-research">
          <div className="vt-callout vt-callout--info">
            <p className="vt-callout__body">Open the flow to start research or edit the draft.</p>
            <Link href={`/curator/flows/${flowId}`} className="vt-btn vt-btn--accent">Go to the flow</Link>
          </div>
        </div>
      </>
    )
  }
  return <ResearchProgress runId={runId} flowId={flowId} />
}
