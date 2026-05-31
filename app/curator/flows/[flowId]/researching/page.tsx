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
  if (!runId) return <div className="vt-curator-page">Missing runId.</div>
  return (
    <div className="vt-curator-page">
      <ResearchProgress runId={runId} flowId={flowId} />
    </div>
  )
}
