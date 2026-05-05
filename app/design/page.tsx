/* Public design preview — fixture-driven showcase of the 5 phone screens.
   Use this at /design at 390x844 to verify the implementation without auth. */
import { ActiveSession } from '@/components/screens/active-session'
import { TodayHome } from '@/components/screens/today-home'
import { TreeGenerating } from '@/components/screens/tree-generating'
import { DeclineOrDefer } from '@/components/screens/decline-or-defer'
import { OutcomeCapture } from '@/components/screens/outcome-capture'
import type { Session } from '@/lib/db/schema'

const NOW = new Date()
const MIN_AGO = (m: number) => new Date(NOW.getTime() - m * 60_000)

const fixtureSession: Session = {
  id: 'fixt-f150-p0299-aaaa1111',
  shopId: 'shop-1',
  techId: 'tech-1',
  status: 'open',
  createdAt: MIN_AGO(14),
  closedAt: null,
  outcome: null,
  intake: {
    vehicleYear: 2018,
    vehicleMake: 'Ford',
    vehicleModel: 'F-150',
    customerComplaint: 'Loss of power up hills, intermittent wrench light.',
  },
  treeState: {
    nodes: [
      { id: 'n1', label: 'Pull DTCs + freeze frame', status: 'resolved' },
      { id: 'n2', label: 'Inspect cold-side CAC pipe', status: 'resolved' },
      { id: 'n3', label: 'Note: no obvious damage', status: 'resolved' },
      {
        id: 'n4',
        label: 'Smoke test cold-side intercooler',
        status: 'active',
        rationale:
          'Apply 5 psi shop air through the post-MAF port. Photograph any escape locations — wastegate vacuum line, CAC pipe joints, intercooler core.',
      },
      { id: 'n5', label: 'Locate escape source', status: 'pending' },
      { id: 'n6', label: 'Verify wastegate vacuum line integrity', status: 'pending' },
      { id: 'n7', label: 'Replace if cracked', status: 'pending' },
      { id: 'n8', label: 'Hard-pull verification drive', status: 'pending' },
    ],
    currentNodeId: 'n4',
    message: 'Smoke test the cold-side intercooler.',
  },
}

const closedSession: Session = {
  ...fixtureSession,
  id: 'fixt-tacoma-cccc3333',
  status: 'closed',
  createdAt: MIN_AGO(60),
  closedAt: MIN_AGO(14),
  intake: {
    vehicleYear: 2019,
    vehicleMake: 'Toyota',
    vehicleModel: 'Tacoma',
    customerComplaint: 'Rough idle — vacuum leak at PCV elbow.',
  },
}

const FRAME: React.CSSProperties = {
  width: 390,
  height: 844,
  border: '1px solid var(--vt-rule)',
  borderRadius: 24,
  overflow: 'hidden',
  background: 'var(--vt-bg)',
  flex: '0 0 auto',
}

const LABEL: React.CSSProperties = {
  fontFamily: 'var(--vt-font-mono)',
  fontSize: 11,
  color: 'var(--vt-fg-3)',
  marginBottom: 8,
  letterSpacing: 0,
}

export default function DesignPreviewPage() {
  return (
    <main
      style={{
        minHeight: '100vh',
        background:
          'radial-gradient(1200px 600px at 30% 0%, var(--vt-bone-100) 0%, transparent 70%), var(--vt-bone-200)',
        padding: '32px 16px 64px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 24,
      }}
    >
      <header style={{ textAlign: 'center', maxWidth: 720 }}>
        <h1 className="vt-h2" style={{ margin: 0, color: 'var(--vt-fg)' }}>
          Vyntechs — phone surface preview
        </h1>
        <p
          className="vt-small"
          style={{ marginTop: 8, color: 'var(--vt-fg-2)' }}
        >
          Five screens at 390 × 844 (iPhone 14). Fixture data only — no auth, no DB.
        </p>
      </header>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(390px, 1fr))',
          gap: 32,
          width: '100%',
          maxWidth: 1320,
        }}
      >
        {[
          { id: 'today', label: 'T-PH-2 · Today / Home', node: <ShowcaseToday /> },
          { id: 'active', label: 'T-PH-4 · Active session', node: <ActiveSession session={fixtureSession} /> },
          { id: 'generating', label: 'T-PH-5 · Tree generating', node: <ShowcaseGenerating /> },
          { id: 'decline', label: 'T-PH-6 · Decline-or-defer', node: <ShowcaseDecline /> },
          { id: 'outcome', label: 'T-PH-7 · Outcome capture', node: <ShowcaseOutcome /> },
        ].map((s) => (
          <div
            key={s.id}
            id={s.id}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}
          >
            <div style={LABEL}>{s.label}</div>
            <div style={FRAME}>{s.node}</div>
          </div>
        ))}
      </div>
    </main>
  )
}

function ShowcaseToday() {
  return (
    <TodayHome
      techName="Marcus"
      bay="Bay 3"
      inProgress={[fixtureSession]}
      closedToday={[closedSession]}
    />
  )
}

function ShowcaseGenerating() {
  return (
    <TreeGenerating
      vehicle="2018 Ford F-150 · 3.5L EcoBoost · P0299 + P0236"
      matches={47}
      elapsed="T+0:04"
    />
  )
}

function ShowcaseDecline() {
  return (
    <DeclineOrDefer
      vehicleName="2014 BMW 335i — N55"
      vehicleVin="VIN · WBA3A5C50EJF12345 · 110,400 mi"
      timer="42:18"
      gap="Build-date-specific K-CAN wire colors not found in 5 weighted queries. Forum sources conflict — splice on the wrong wire bricks the bus."
      options={[
        {
          number: 1,
          title: 'Gather more low-risk data',
          description: 'Pull build-date-specific wiring from ProDemand and photograph it.',
        },
        {
          number: 2,
          title: 'Decline this job',
          description: 'Customer-facing language: refer to BMW dealer or N55 specialist.',
        },
        {
          number: 3,
          title: 'Defer for curator review',
          description:
            '24–72 hr turnaround. Customer keeps the vehicle. Answer enters corpus for all future similar cases.',
          emphasized: true,
        },
      ]}
    />
  )
}

function ShowcaseOutcome() {
  return (
    <OutcomeCapture
      vehicleName="2018 Ford F-150 — 3.5L EcoBoost"
      vehicleMeta="closing case · session 0:58:12"
      timer="0:58"
      diagMin={24}
      repairMin={30}
    />
  )
}
