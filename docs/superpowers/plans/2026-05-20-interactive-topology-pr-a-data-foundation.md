# Interactive Topology Diagnostic — PR-A: Data Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the database a way to express "these parts are the fuel system," and build the read-only loader that returns a platform+symptom's full system topology graph (components, connections, probe points, diagnostic payload) for the diagram UI to consume.

**Architecture:** Two additive schema columns (`components.systems` text-array, `symptoms.system` text). One pure data-loader function, `loadSystemTopology`, that resolves a platform + symptom to a `SystemTopology` object via structured Drizzle queries — no AI, no external calls. The diagram UI (PR-B) is out of scope here.

**Tech Stack:** TypeScript, Drizzle ORM, Postgres (Supabase live; PGlite for tests), Vitest. Migrations are hand-written (`drizzle-kit generate` has been broken since 0011b) and registered in `drizzle/migrations/meta/_journal.json`.

**Spec:** `docs/superpowers/specs/2026-05-20-interactive-topology-diagnostic-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `lib/db/schema.ts` | Modify | Add `systems` to `components`, `system` to `symptoms` |
| `drizzle/migrations/0019_component_systems.sql` | Create | Hand-written migration for the two columns |
| `drizzle/migrations/meta/_journal.json` | Modify | Register migration `0019` so the migrator runs it |
| `lib/diagnostics/load-system-topology.ts` | Create | `SystemTopology` types + the `loadSystemTopology` loader |
| `tests/unit/load-system-topology.test.ts` | Create | Vitest coverage for the loader (PGlite) |
| `drizzle/data/2026-05-20-fuel-system-tags.sql` | Create | Auditable record of the live fuel-tagging data step |

**Task order:** Tasks 1–2 are pure code (schema + loader + tests) and run autonomously. Tasks 3–4 write to the live Supabase database and **require Brandon's explicit approval** — they are clustered last on purpose.

---

### Task 1: Schema columns + migration

**Files:**
- Modify: `lib/db/schema.ts`
- Create: `drizzle/migrations/0019_component_systems.sql`
- Modify: `drizzle/migrations/meta/_journal.json`

- [ ] **Step 1: Add `systems` to the `components` table**

In `lib/db/schema.ts`, inside `export const components = pgTable('components', {...})`, add the `systems` column immediately after the `function` line:

```ts
    function: text('function'),
    systems: text('systems').array().notNull().default([]),
    sourceProvenance: text('source_provenance', {
```

- [ ] **Step 2: Add `system` to the `symptoms` table**

In `lib/db/schema.ts`, inside `export const symptoms = pgTable('symptoms', {...})`, add the `system` column immediately after the `category` block (after its `.notNull(),`):

```ts
    }).notNull(),
    system: text('system'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
```

- [ ] **Step 3: Write the migration SQL**

Create `drizzle/migrations/0019_component_systems.sql`:

```sql
-- Add system-grouping columns for the interactive wiring-topology diagnostic.
--
-- components.systems: which system diagram(s) a component appears in. A text
--   array because hub components (PCM, ground nodes, CAN bus) belong to every
--   system's diagram, not just one. Empty default — components are tagged in a
--   separate, reviewed data step (see drizzle/data/2026-05-20-fuel-system-tags.sql).
-- symptoms.system: which system's topology diagram a cached symptom opens.
--   Nullable — backfilled for the existing fuel symptoms in the tagging step.
--
-- Both additive. No existing column is changed or dropped.

ALTER TABLE "components" ADD COLUMN "systems" text[] NOT NULL DEFAULT '{}';
--> statement-breakpoint
ALTER TABLE "symptoms" ADD COLUMN "system" text;
```

- [ ] **Step 4: Register the migration in the journal**

In `drizzle/migrations/meta/_journal.json`, append a new object to the `entries` array, after the `0018_session_cache_hit_fks` entry (which has `"idx": 20`). Mind the comma after the previous entry's closing brace:

```json
    {
      "idx": 21,
      "version": "7",
      "when": 1779328801033,
      "tag": "0019_component_systems",
      "breakpoints": true
    }
```

- [ ] **Step 5: Verify the migration applies cleanly**

`tests/helpers/db.ts` builds every test database by running the full migration folder via `migrate()`. So running any existing DB test re-applies all migrations including `0019` — a malformed SQL file or a journal mistake fails here immediately.

Run: `pnpm test cached-lookup`
Expected: PASS (all `cached-lookup` tests green — proves migration `0019` applies on a fresh PGlite DB without error).

If it fails with "PGlite is closed" style noise on a cold run, re-run once before treating it as real (known fork-pool flake).

- [ ] **Step 6: Commit**

```bash
git add lib/db/schema.ts drizzle/migrations/0019_component_systems.sql drizzle/migrations/meta/_journal.json
git commit -m "feat(topology): add components.systems + symptoms.system columns"
```

---

### Task 2: `loadSystemTopology` loader + tests

**Files:**
- Create: `lib/diagnostics/load-system-topology.ts`
- Create: `tests/unit/load-system-topology.test.ts`

- [ ] **Step 1: Create the loader file with types + implementation**

Create `lib/diagnostics/load-system-topology.ts`:

```ts
import { and, arrayContains, eq, inArray } from 'drizzle-orm'
import type { AppDb } from '@/lib/db/queries'
import {
  platforms,
  symptoms,
  components,
  componentConnections,
  observableProperties,
  testActions,
  branchLogic,
  symptomTestImplications,
} from '@/lib/db/schema'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type TopologyObservableProperty = {
  slug: string
  description: string
  observationMethod: string
}

export type TopologyBranch = {
  condition: string
  verdict: string
  nextAction: string
}

export type TopologyTestAction = {
  slug: string
  description: string
  scenarioRequired: string
  observationMethod: string
  expectedObservation: string | null
  invasiveness: number
  /** True when the cache-hit symptom's test plan implicates this action. */
  implicatedByCurrentSymptom: boolean
  branches: TopologyBranch[]
}

export type TopologyComponent = {
  id: string
  slug: string
  name: string
  kind: string
  location: string | null
  function: string | null
  electricalContract: string | null
  sourceProvenance: string
  observableProperties: TopologyObservableProperty[]
  testActions: TopologyTestAction[]
}

export type TopologyConnection = {
  id: string
  fromComponentId: string
  toComponentId: string
  connectionKind: string
  direction: string
  description: string | null
  sourceProvenance: string
}

export type SystemTopology = {
  platform: { slug: string; name: string }
  symptom: { slug: string; description: string }
  system: string
  components: TopologyComponent[]
  connections: TopologyConnection[]
}

/** Human-readable platform name from the stored columns. */
function buildPlatformName(row: {
  parentMake: string
  parentModelFamily: string
  generation: string | null
  yearRange: string
}): string {
  const parts = [row.parentMake, row.parentModelFamily]
  if (row.generation) parts.push(row.generation)
  parts.push(`(${row.yearRange})`)
  return parts.join(' ')
}

// ---------------------------------------------------------------------------
// loadSystemTopology
// ---------------------------------------------------------------------------

/**
 * Loads the full system-topology graph for a platform + cached symptom:
 * every component tagged for the symptom's system, the connections among
 * them, and each component's probe points + diagnostic payload.
 *
 * Pure structured reads — no AI, no external calls. Returns null (never
 * throws) when the platform or symptom is missing, the symptom has no
 * system, or no components are tagged for that system.
 */
export async function loadSystemTopology({
  db,
  platformSlug,
  symptomSlug,
}: {
  db: AppDb
  platformSlug: string
  symptomSlug: string
}): Promise<SystemTopology | null> {
  // 1. Resolve platform
  const platform = await db.query.platforms.findFirst({
    where: eq(platforms.slug, platformSlug),
    columns: {
      id: true,
      slug: true,
      parentMake: true,
      parentModelFamily: true,
      generation: true,
      yearRange: true,
    },
  })
  if (!platform) return null

  // 2. Resolve symptom + the system its diagram opens
  const symptom = await db.query.symptoms.findFirst({
    where: eq(symptoms.slug, symptomSlug),
    columns: { id: true, slug: true, description: true, system: true },
  })
  if (!symptom || !symptom.system) return null
  const system = symptom.system

  // 3. Components tagged for this system on this platform
  const componentRows = await db
    .select({
      id: components.id,
      slug: components.slug,
      name: components.name,
      kind: components.kind,
      location: components.location,
      function: components.function,
      electricalContract: components.electricalContract,
      sourceProvenance: components.sourceProvenance,
    })
    .from(components)
    .where(
      and(
        eq(components.platformId, platform.id),
        eq(components.isRetired, false),
        arrayContains(components.systems, [system]),
      ),
    )
  if (componentRows.length === 0) return null
  const componentIds = componentRows.map((c) => c.id)

  // 4. Connections — only those with BOTH endpoints inside the system set
  const connectionRows = await db
    .select({
      id: componentConnections.id,
      fromComponentId: componentConnections.fromComponentId,
      toComponentId: componentConnections.toComponentId,
      connectionKind: componentConnections.connectionKind,
      direction: componentConnections.direction,
      description: componentConnections.description,
      sourceProvenance: componentConnections.sourceProvenance,
    })
    .from(componentConnections)
    .where(
      and(
        eq(componentConnections.isRetired, false),
        inArray(componentConnections.fromComponentId, componentIds),
        inArray(componentConnections.toComponentId, componentIds),
      ),
    )

  // 5. Observable properties (probe points) for those components
  const opRows = await db
    .select({
      componentId: observableProperties.componentId,
      slug: observableProperties.slug,
      description: observableProperties.description,
      observationMethod: observableProperties.observationMethod,
    })
    .from(observableProperties)
    .where(
      and(
        inArray(observableProperties.componentId, componentIds),
        eq(observableProperties.isRetired, false),
      ),
    )

  // 6. Test actions for those components + their branch logic
  const testActionRows = await db
    .select({
      id: testActions.id,
      componentId: testActions.componentId,
      slug: testActions.slug,
      description: testActions.description,
      scenarioRequired: testActions.scenarioRequired,
      observationMethod: testActions.observationMethod,
      expectedObservation: testActions.expectedObservation,
      invasiveness: testActions.invasiveness,
    })
    .from(testActions)
    .where(
      and(
        inArray(testActions.componentId, componentIds),
        eq(testActions.isRetired, false),
      ),
    )
  const testActionIds = testActionRows.map((t) => t.id)

  const branchRows = testActionIds.length
    ? await db
        .select({
          testActionId: branchLogic.testActionId,
          condition: branchLogic.condition,
          verdict: branchLogic.verdict,
          nextAction: branchLogic.nextAction,
        })
        .from(branchLogic)
        .where(
          and(
            inArray(branchLogic.testActionId, testActionIds),
            eq(branchLogic.isRetired, false),
          ),
        )
    : []

  // Which of those test actions does the CURRENT symptom implicate?
  const implRows = testActionIds.length
    ? await db
        .select({ testActionId: symptomTestImplications.testActionId })
        .from(symptomTestImplications)
        .where(
          and(
            eq(symptomTestImplications.symptomId, symptom.id),
            eq(symptomTestImplications.isRetired, false),
            inArray(symptomTestImplications.testActionId, testActionIds),
          ),
        )
    : []
  const implicatedIds = new Set(implRows.map((r) => r.testActionId))

  // 7. Assemble the graph
  const assembledComponents: TopologyComponent[] = componentRows.map((c) => ({
    id: c.id,
    slug: c.slug,
    name: c.name,
    kind: c.kind,
    location: c.location,
    function: c.function,
    electricalContract: c.electricalContract,
    sourceProvenance: c.sourceProvenance,
    observableProperties: opRows
      .filter((op) => op.componentId === c.id)
      .map((op) => ({
        slug: op.slug,
        description: op.description,
        observationMethod: op.observationMethod,
      })),
    testActions: testActionRows
      .filter((t) => t.componentId === c.id)
      .map((t) => ({
        slug: t.slug,
        description: t.description,
        scenarioRequired: t.scenarioRequired,
        observationMethod: t.observationMethod,
        expectedObservation: t.expectedObservation,
        invasiveness: t.invasiveness,
        implicatedByCurrentSymptom: implicatedIds.has(t.id),
        branches: branchRows
          .filter((b) => b.testActionId === t.id)
          .map((b) => ({
            condition: b.condition,
            verdict: b.verdict,
            nextAction: b.nextAction,
          })),
      })),
  }))

  return {
    platform: { slug: platform.slug, name: buildPlatformName(platform) },
    symptom: { slug: symptom.slug, description: symptom.description },
    system,
    components: assembledComponents,
    connections: connectionRows,
  }
}
```

Note: `arrayContains` is from `drizzle-orm` — it generates the Postgres `@>` containment operator (`systems @> ARRAY['fuel']`). If the installed `drizzle-orm` version does not export it, the build fails instantly on import; the fallback is `sql\`${system} = ANY(${components.systems})\`` inside the `and(...)`.

- [ ] **Step 2: Write the test file with fixtures + the happy-path test**

Create `tests/unit/load-system-topology.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb, type TestDb } from '../helpers/db'
import {
  platforms,
  symptoms,
  components,
  componentConnections,
  observableProperties,
  testActions,
  branchLogic,
  symptomTestImplications,
} from '@/lib/db/schema'
import { loadSystemTopology } from '@/lib/diagnostics/load-system-topology'

const PLATFORM_SLUG = 'ford-super-duty-4th-gen-67-psd'

async function seedFixtures(db: TestDb) {
  const [platform] = await db
    .insert(platforms)
    .values({
      slug: PLATFORM_SLUG,
      yearRange: '2017-2022',
      parentMake: 'Ford',
      parentModelFamily: 'Super Duty',
      generation: '4th gen',
    })
    .returning({ id: platforms.id })

  // Symptoms: a fuel symptom, a null-system symptom, an empty-system symptom
  const [sympFuel] = await db
    .insert(symptoms)
    .values([
      { slug: 'p0087', description: 'Fuel rail pressure too low', category: 'dtc', system: 'fuel' },
      { slug: 'p-no-system', description: 'Symptom with no system set', category: 'dtc', system: null },
      { slug: 'p-aftertreatment', description: 'A system with no tagged parts', category: 'dtc', system: 'aftertreatment' },
    ])
    .returning({ id: symptoms.id, slug: symptoms.slug })

  // Components: 3 fuel, 1 cooling (must be excluded), 1 retired fuel (excluded)
  const [cPcm, cFrp, cLiftPump, cRadiator] = await db
    .insert(components)
    .values([
      { slug: 'c-pcm', platformId: platform.id, name: 'PCM', kind: 'module', systems: ['fuel'], sourceProvenance: 'TRAINING-CONFIRMED' },
      { slug: 'c-frp', platformId: platform.id, name: 'FRP Sensor', kind: 'sensor', location: 'Front of DS rail', function: 'Reports rail pressure', electricalContract: '3-wire analog', systems: ['fuel'], sourceProvenance: 'TRAINING-CONFIRMED' },
      { slug: 'c-lift-pump', platformId: platform.id, name: 'Lift Pump', kind: 'pump', systems: ['fuel'], sourceProvenance: 'TRAINING-CONFIRMED' },
      { slug: 'c-radiator', platformId: platform.id, name: 'Radiator', kind: 'mechanical', systems: ['cooling'], sourceProvenance: 'TRAINING-CONFIRMED' },
      { slug: 'c-retired-fuel', platformId: platform.id, name: 'Retired Fuel Part', kind: 'sensor', systems: ['fuel'], isRetired: true, sourceProvenance: 'TRAINING-CONFIRMED' },
    ])
    .returning({ id: components.id, slug: components.slug })

  // Connections: 2 valid fuel-fuel, 1 fuel-cooling (excluded), 1 retired (excluded)
  await db.insert(componentConnections).values([
    { fromComponentId: cPcm.id, toComponentId: cFrp.id, connectionKind: 'electrical-wire', direction: 'bidirectional', description: 'PCM reads FRP signal', sourceProvenance: 'TRAINING-CONFIRMED' },
    { fromComponentId: cPcm.id, toComponentId: cLiftPump.id, connectionKind: 'electrical-wire', direction: 'unidirectional', description: 'PCM commands lift pump', sourceProvenance: 'TRAINING-CONFIRMED' },
    { fromComponentId: cPcm.id, toComponentId: cRadiator.id, connectionKind: 'electrical-wire', direction: 'unidirectional', description: 'Crosses into cooling — must be excluded', sourceProvenance: 'TRAINING-CONFIRMED' },
    { fromComponentId: cPcm.id, toComponentId: cLiftPump.id, connectionKind: 'electrical-wire', direction: 'unidirectional', description: 'Retired connection', isRetired: true, sourceProvenance: 'TRAINING-CONFIRMED' },
  ])

  // Observable properties on c-frp: 2 active, 1 retired
  await db.insert(observableProperties).values([
    { slug: 'op-frp-signal', componentId: cFrp.id, description: 'Back-probe the signal pin', observationMethod: 'electrical_measurement_at_pin', sourceProvenance: 'TRAINING-CONFIRMED' },
    { slug: 'op-frp-5v', componentId: cFrp.id, description: 'Back-probe the 5V reference pin', observationMethod: 'electrical_measurement_at_pin', sourceProvenance: 'TRAINING-CONFIRMED' },
    { slug: 'op-frp-retired', componentId: cFrp.id, description: 'Retired probe point', observationMethod: 'electrical_measurement_at_pin', isRetired: true, sourceProvenance: 'TRAINING-CONFIRMED' },
  ])

  // Test actions on c-frp: 1 implicated by p0087, 1 not, 1 retired
  const [taImplicated] = await db
    .insert(testActions)
    .values([
      { slug: 'ta-frp-keyon', componentId: cFrp.id, description: 'Check FRP at key-on', scenarioRequired: 'key-on', observationMethod: 'scan_tool_pid', expectedObservation: '26,000-28,000 PSI', invasiveness: 1, confidenceBoost: 30, sourceProvenance: 'TRAINING-CONFIRMED' },
      { slug: 'ta-frp-idle', componentId: cFrp.id, description: 'Check FRP at idle', scenarioRequired: 'idle', observationMethod: 'scan_tool_pid', expectedObservation: 'Idle rail pressure', invasiveness: 1, confidenceBoost: 20, sourceProvenance: 'TRAINING-CONFIRMED' },
      { slug: 'ta-frp-retired', componentId: cFrp.id, description: 'Retired test action', scenarioRequired: 'key-on', observationMethod: 'scan_tool_pid', invasiveness: 1, confidenceBoost: 10, isRetired: true, sourceProvenance: 'TRAINING-CONFIRMED' },
    ])
    .returning({ id: testActions.id })

  // Branch logic on the implicated test action
  await db.insert(branchLogic).values([
    { slug: 'bl-frp-low', testActionId: taImplicated.id, condition: 'Reading below range', verdict: 'fail', nextAction: 'Suspect supply pressure', sourceProvenance: 'TRAINING-CONFIRMED' },
  ])

  // p0087 implicates only ta-frp-keyon
  await db.insert(symptomTestImplications).values([
    { symptomId: sympFuel.id, testActionId: taImplicated.id, priority: 1, sourceProvenance: 'TRAINING-CONFIRMED' },
  ])
}

describe('loadSystemTopology', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
    await seedFixtures(db)
  })

  afterEach(async () => {
    await close()
  })

  it('returns the full fuel-system graph for a known platform + fuel symptom', async () => {
    const result = await loadSystemTopology({ db, platformSlug: PLATFORM_SLUG, symptomSlug: 'p0087' })

    expect(result).not.toBeNull()
    expect(result!.system).toBe('fuel')
    expect(result!.platform.slug).toBe(PLATFORM_SLUG)
    expect(result!.platform.name.length).toBeGreaterThan(0)
    expect(result!.symptom.slug).toBe('p0087')

    // 3 fuel components — radiator (cooling) and the retired fuel part excluded
    const slugs = result!.components.map((c) => c.slug).sort()
    expect(slugs).toEqual(['c-frp', 'c-lift-pump', 'c-pcm'])
  })

  it('includes only connections with both endpoints inside the system', async () => {
    const result = await loadSystemTopology({ db, platformSlug: PLATFORM_SLUG, symptomSlug: 'p0087' })
    // 2 valid fuel-fuel connections; the fuel-cooling and retired ones excluded
    expect(result!.connections).toHaveLength(2)
  })

  it('attaches active observable properties to a component', async () => {
    const result = await loadSystemTopology({ db, platformSlug: PLATFORM_SLUG, symptomSlug: 'p0087' })
    const frp = result!.components.find((c) => c.slug === 'c-frp')!
    expect(frp.observableProperties.map((o) => o.slug).sort()).toEqual(['op-frp-5v', 'op-frp-signal'])
  })

  it('flags test actions implicated by the current symptom and attaches branches', async () => {
    const result = await loadSystemTopology({ db, platformSlug: PLATFORM_SLUG, symptomSlug: 'p0087' })
    const frp = result!.components.find((c) => c.slug === 'c-frp')!
    // 2 active test actions (retired one excluded)
    expect(frp.testActions).toHaveLength(2)
    const implicated = frp.testActions.find((t) => t.slug === 'ta-frp-keyon')!
    const other = frp.testActions.find((t) => t.slug === 'ta-frp-idle')!
    expect(implicated.implicatedByCurrentSymptom).toBe(true)
    expect(other.implicatedByCurrentSymptom).toBe(false)
    expect(implicated.branches).toHaveLength(1)
    expect(implicated.branches[0].verdict).toBe('fail')
  })

  it('returns null for an unknown platform', async () => {
    const result = await loadSystemTopology({ db, platformSlug: 'nope', symptomSlug: 'p0087' })
    expect(result).toBeNull()
  })

  it('returns null for an unknown symptom', async () => {
    const result = await loadSystemTopology({ db, platformSlug: PLATFORM_SLUG, symptomSlug: 'nope' })
    expect(result).toBeNull()
  })

  it('returns null when the symptom has no system set', async () => {
    const result = await loadSystemTopology({ db, platformSlug: PLATFORM_SLUG, symptomSlug: 'p-no-system' })
    expect(result).toBeNull()
  })

  it('returns null when no components are tagged for the symptom system', async () => {
    const result = await loadSystemTopology({ db, platformSlug: PLATFORM_SLUG, symptomSlug: 'p-aftertreatment' })
    expect(result).toBeNull()
  })
})
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `pnpm test load-system-topology`
Expected: PASS — all 8 tests green. (Cold-run "PGlite is closed" flake: re-run once before treating as real.)

- [ ] **Step 4: Commit**

```bash
git add lib/diagnostics/load-system-topology.ts tests/unit/load-system-topology.test.ts
git commit -m "feat(topology): add loadSystemTopology data loader"
```

---

### Task 3: Apply migration 0019 to the live database

> ⚠️ **CHECKPOINT — requires Brandon's explicit approval before touching live Supabase.** No live-database write happens without a per-operation go-ahead.

**Files:** none (database operation)

- [ ] **Step 1: Rehearse on the local rehearsal database**

The `vyntechs_rehearsal` local Postgres mirrors the prod schema. Apply the migration there first:

Run: `psql vyntechs_rehearsal -f drizzle/migrations/0019_component_systems.sql`
Expected: `ALTER TABLE` printed twice, no error.

Verify the columns landed:

Run: `psql vyntechs_rehearsal -c "SELECT column_name FROM information_schema.columns WHERE (table_name='components' AND column_name='systems') OR (table_name='symptoms' AND column_name='system');"`
Expected: two rows — `systems` and `system`.

- [ ] **Step 2: Get Brandon's approval**

Confirm with Brandon that the migration may be applied to the live Supabase project (`ynmtszuybeenjbigxdyl`). Do not proceed without it.

- [ ] **Step 3: Apply to live Supabase**

Apply via the Supabase MCP `apply_migration` tool — name `0019_component_systems`, body = the SQL from `drizzle/migrations/0019_component_systems.sql`.

- [ ] **Step 4: Verify on live**

Via Supabase MCP `execute_sql`:

```sql
SELECT table_name, column_name FROM information_schema.columns
WHERE (table_name='components' AND column_name='systems')
   OR (table_name='symptoms' AND column_name='system');
```

Expected: two rows. No commit (this task changes the database, not the repo).

---

### Task 4: Fuel-system tagging

> ⚠️ **CHECKPOINT — Brandon reviews the component list, then approves the live write.** He is the automotive domain expert; the list below is a draft starting point.

**Files:**
- Create: `drizzle/data/2026-05-20-fuel-system-tags.sql`

- [ ] **Step 1: Brandon confirms the component list**

Present this draft fuel-component set (22 parts) to Brandon and let him add/remove. Open question for him: whether to also include ground nodes and the lift-pump power chain (`sd4-67psd-ground-point-block`, `sd4-67psd-ground-point-frame`, `sd4-67psd-bjb`) so the diagram shows the pump's ground and power context, as the prototype does.

- [ ] **Step 2: Write the tagging SQL**

Create `drizzle/data/2026-05-20-fuel-system-tags.sql` (final slug list reflects Brandon's Step 1 decision):

```sql
-- Fuel-system tagging for the interactive topology diagnostic (PR-A, Task 4).
-- Data step, not a schema migration. Applied to live Supabase via the
-- Supabase MCP after Brandon confirmed the component list. Recorded here for
-- auditability and so the diesel-seeding effort can follow the same pattern.

UPDATE components SET systems = ARRAY['fuel']
WHERE platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
  AND slug IN (
    'sd4-67psd-pcm',
    'sd4-67psd-lift-pump',
    'sd4-67psd-lift-pump-relay',
    'sd4-67psd-fuel-tank',
    'sd4-67psd-fuel-filter-ws',
    'sd4-67psd-fuel-level-sender',
    'sd4-67psd-wif-sensor',
    'sd4-67psd-cp4-pump',
    'sd4-67psd-imv',
    'sd4-67psd-frp-sensor',
    'sd4-67psd-hp-rail-bank-a',
    'sd4-67psd-hp-rail-bank-b',
    'sd4-67psd-injector-1', 'sd4-67psd-injector-2', 'sd4-67psd-injector-3', 'sd4-67psd-injector-4',
    'sd4-67psd-injector-5', 'sd4-67psd-injector-6', 'sd4-67psd-injector-7', 'sd4-67psd-injector-8',
    'sd4-67psd-pressure-relief-valve',
    'sd4-67psd-return-circuit'
  );
--> statement-breakpoint
UPDATE symptoms SET system = 'fuel'
WHERE slug IN (
  'p0087-fuel-rail-pressure-too-low',
  'p0088-fuel-rail-pressure-too-high',
  'no-start-cranks-normally-fuel-system-suspect'
);
```

- [ ] **Step 3: Rehearse on the local rehearsal database**

Run: `psql vyntechs_rehearsal -f drizzle/data/2026-05-20-fuel-system-tags.sql`
Expected: two `UPDATE` lines, the first reporting the component count (22 unless Brandon changed the list).

- [ ] **Step 4: Get Brandon's approval, then apply to live**

With Brandon's go-ahead, apply each `UPDATE` to the live Supabase project via the Supabase MCP `execute_sql` tool.

- [ ] **Step 5: Verify on live**

Via Supabase MCP `execute_sql`:

```sql
SELECT count(*) AS fuel_components FROM components WHERE 'fuel' = ANY(systems);
SELECT slug, system FROM symptoms ORDER BY slug;
```

Expected: `fuel_components` matches the confirmed list count; all three symptoms show `system = fuel`.

- [ ] **Step 6: Commit the data record**

```bash
git add drizzle/data/2026-05-20-fuel-system-tags.sql
git commit -m "chore(topology): record fuel-system tagging data step"
```

---

## Self-Review

**Spec coverage:** §4 (schema columns) → Task 1. §4 (migration mechanics, hand-written + rehearsal + live apply) → Tasks 1, 3. §4 (data population) → Task 4. §5.1 (`loadSystemTopology`, all 7 steps) → Task 2. §10 (returns null, never throws) → Task 2 null-case tests. §11 (TDD, PGlite, retired-row exclusion) → Task 2. PR-B (UI, layout, diagram, panel, route integration) is deliberately out of scope — it gets its own plan. ✅

**Placeholder scan:** No "TBD"/"handle edge cases"/"similar to" — every step carries exact code or exact commands. The one judgment call (Task 4 component list) is explicitly Brandon's decision with a concrete 22-item draft, not a placeholder. ✅

**Type consistency:** `SystemTopology`, `TopologyComponent`, `TopologyConnection`, `TopologyTestAction`, `TopologyBranch`, `TopologyObservableProperty` are defined once in Task 2 Step 1 and consumed only there. The loader's `select({...})` field names match the assembly object keys. `loadSystemTopology` arg shape (`{ db, platformSlug, symptomSlug }`) matches every test call. ✅

## Verification (whole PR-A)

- `pnpm test` — full suite green (loader + all pre-existing tests; migration `0019` applies on every fresh PGlite DB).
- Live Supabase has the `components.systems` + `symptoms.system` columns, ~22 fuel components tagged, 3 symptoms tagged `fuel`.
- PR opened against `staging-interactive-diagnostics` for Brandon to merge.

## Out of scope (→ PR-B, its own plan)

The diagram canvas, auto-layout, the detail panel, the route-page swap, mobile, and live UI validation. PR-B is planned once PR-A has landed and the data layer is real.
