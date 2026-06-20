import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { researchRuns, flowVersions } from '@/lib/db/schema'
import type { ResearchAgentOutput, ResearchRunStatusView } from '@/lib/research/types'
import { requireCurator } from '@/lib/curator/route-helpers'
import { getPersona } from '@/lib/research/personas'

export async function GET(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const auth = await requireCurator()
  if (auth.kind === 'forbidden') return auth.response
  const { runId } = await params

  const [row] = await db
    .select()
    .from(researchRuns)
    .leftJoin(flowVersions, eq(flowVersions.researchRunId, researchRuns.id))
    .where(eq(researchRuns.id, runId))
    .limit(1)

  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const agents = (row.research_runs.agentOutputs as ResearchAgentOutput[]) ?? []

  const view: ResearchRunStatusView = {
    id: row.research_runs.id,
    status: row.research_runs.status,
    errorMessage: row.research_runs.errorMessage,
    startedAt: row.research_runs.startedAt.toISOString(),
    completedAt: row.research_runs.completedAt?.toISOString() ?? null,
    agents: agents.map((a) => ({
      persona: a.persona,
      displayName: getPersona(a.persona).displayName, // REAL persona name, no "AI" word
      status: a.status,
      progressNote:
        a.status === 'completed'
          ? `${a.findings.length} findings, ${a.visitedUrls.length} sources`
          : a.status === 'failed'
            ? (a.errorMessage ?? 'failed')
            : 'searching…',
    })),
    flowVersionId: row.flow_versions?.id ?? undefined,
  }

  return NextResponse.json(view)
}
