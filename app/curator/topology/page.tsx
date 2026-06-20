import { db } from '@/lib/db/client'
import { loadSystemTopology } from '@/lib/diagnostics/load-system-topology'
import { layoutTopology } from '@/lib/diagnostics/topology-layout'
import { TopologyDiagnostic } from '@/components/screens/topology-diagnostic'

export const metadata = { title: 'Curator — Topology (preview)' }

// The only platform with system-topology data today. Hard-coded because this
// is a read-only proof that the diagram draws itself from the database.
const PLATFORM_SLUG = 'ford-super-duty-4th-gen-67-psd'

// The three fuel-system symptoms seeded for this platform. The first is the
// default the page opens with.
const SYMPTOMS: { slug: string; label: string }[] = [
  { slug: 'p0087-fuel-rail-pressure-too-low', label: 'P0087 — rail pressure too low' },
  { slug: 'p0088-fuel-rail-pressure-too-high', label: 'P0088 — rail pressure too high' },
  { slug: 'no-start-cranks-normally-fuel-system-suspect', label: 'No-start, cranks normally' },
]
const DEFAULT_SYMPTOM = SYMPTOMS[0].slug

type SearchParams = {
  symptom?: string
}

function resolveSymptom(raw: string | undefined): string {
  return SYMPTOMS.some((s) => s.slug === raw) ? (raw as string) : DEFAULT_SYMPTOM
}

export default async function CuratorTopologyPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const symptomSlug = resolveSymptom(params.symptom)

  const topology = await loadSystemTopology({
    db,
    platformSlug: PLATFORM_SLUG,
    symptomSlug,
  })

  return (
    // Full-window escape: .topo-route renders OVER the curator shell (topbar +
    // sidebar + main padding) as a fixed full-viewport layer. The layout's
    // canCurate auth gate still runs server-side — only the chrome is covered.
    <div className="topo-route">
      {topology ? (
        <TopologyDiagnostic
          topology={topology}
          layout={layoutTopology(topology)}
          vehicleName={topology.platform.name}
          sessionId="preview"
          symptoms={SYMPTOMS}
          activeSymptomSlug={symptomSlug}
        />
      ) : (
        // Loader-null = not-found (no platform/symptom/components). Distinct from
        // the CLIENT's zero-step honest degrade (a topology loaded, but no step
        // is implicated) — that lives in TopologyDiagnostic.
        <p className="topo__not-found">No diagram data for this case yet.</p>
      )}
    </div>
  )
}
