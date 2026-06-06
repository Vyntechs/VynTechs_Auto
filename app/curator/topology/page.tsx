import Link from 'next/link'
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
    <div>
      <nav
        aria-label="Symptom"
        style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}
      >
        {SYMPTOMS.map((s) => {
          const active = s.slug === symptomSlug
          return (
            <Link
              key={s.slug}
              href={`/curator/topology?symptom=${s.slug}`}
              aria-current={active ? 'page' : undefined}
              style={{
                padding: '0.35rem 0.75rem',
                borderRadius: 6,
                border: '1px solid #ccc',
                fontWeight: active ? 600 : 400,
                background: active ? '#111' : 'transparent',
                color: active ? '#fff' : 'inherit',
                textDecoration: 'none',
              }}
            >
              {s.label}
            </Link>
          )
        })}
      </nav>

      {topology ? (
        <TopologyDiagnostic
          topology={topology}
          layout={layoutTopology(topology)}
          vehicleName={topology.platform.name}
          sessionId="preview"
        />
      ) : (
        <p>No diagram data for this case yet.</p>
      )}
    </div>
  )
}
