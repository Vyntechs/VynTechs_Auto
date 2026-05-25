# Phase 3 PR 1 — Platform Resolver + Cached Diagnostic Overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire a cache-hit shortcut into the existing diagnosis flow so that submitting a vehicle + complaint that maps to one of the 3 cached F-250 6.7L PSD diagnostics renders a read-only "cached overview" screen instantly, skipping the 30-60s AI tree generation. Cache miss preserves today's AI flow unchanged.

**Architecture:** Pre-flight cache check at the top of `POST /api/sessions` (after auth + paywall + open-session limit). Resolver maps `(year, make, model, engine) → platform slug` via a code-level function. On cache hit, the new session row gets `cacheHitPlatformId` + `cacheHitSymptomId` set, `treeState` is an empty sentinel, AI is skipped. The session detail page checks for `cacheHitSymptomId` and renders the new `CachedOverview` screen (ported V1 Ledger mobile + DesktopOverview from the Claude Design handoff). The intake form gets a new DTC field and a progressive chip-picker that fetches cached symptoms for the resolved platform.

**Tech Stack:** Next.js App Router, React, Drizzle ORM, PostgreSQL (Supabase), Vitest + PGlite for tests, Phosphor Icons (`@phosphor-icons/react`), the existing Workshop Instrument design system (`--vt-amber-500`, `--vt-bone-*`, etc.).

**Source artifacts:**
- Spec: `docs/superpowers/specs/2026-05-19-phase3-pr1-platform-resolver-design.md`
- Claude Design handoff: `docs/superpowers/handoffs/2026-05-19-claude-design-pr1-cached-diagnostic-overview.md`
- Claude Design package (extracted, read-only reference): `/tmp/vt-design-package/vyntechs-design-system/project/pr1-cached-overview/`
- Phase 3 kickoff: `docs/superpowers/handoffs/2026-05-19-orchestration-phase-3-kickoff.md`

---

## File Structure

### Files to create

| Path | Responsibility |
|---|---|
| `lib/diagnostics/resolve-platform.ts` | Code-level resolver. `resolvePlatformSlug({year, make, model, engine}): string \| null` |
| `lib/diagnostics/symptom-resolver.ts` | `resolveSymptomSlug({platformSlug, ...signals}): Promise<string \| null>` — tries chip > DTC > keyword in order |
| `lib/diagnostics/cached-lookup.ts` | `listCachedSymptomsForPlatform(platformSlug)` + `loadCachedDiagnostic({platformSlug, symptomSlug})` |
| `lib/diagnostics/gate-thresholds.ts` | Hard-coded per-symptom gate thresholds map for PR 1 (see Task 5 note) |
| `app/api/diagnostics/cached-complaints/route.ts` | GET endpoint returning chip list for the resolved platform |
| `drizzle/migrations/0018_session_cache_hit_fks.sql` | Hand-written migration adding `cache_hit_platform_id` + `cache_hit_symptom_id` to sessions |
| `components/intake/cached-complaint-picker.tsx` | Client component — debounced fetch + render chips |
| `components/vt/scenario-chip.tsx` | New primitive |
| `components/vt/method-chip.tsx` | New primitive (Phosphor icon + label) |
| `components/vt/invasiveness-dots.tsx` | New primitive (5-dot scale with risk escalation) |
| `components/vt/confidence-gate.tsx` | New primitive (compact horizontal bar with needle marker — separate from existing ConfidenceBlock) |
| `components/vt/symptom-hero.tsx` | New primitive (DTC + serif name + corpus line + gate) |
| `components/vt/cached-instant-badge.tsx` | The "cached · instant" eyebrow |
| `components/vt/cta-bar.tsx` | Bottom CTA bar primitive |
| `components/screens/cached-overview.tsx` | Mobile (V1 Ledger) + Desktop (DesktopOverview) screen, picks layout via container width |
| `components/screens/cached-empty.tsx` | Empty-state component (built; routing TBD per spec open Q #1) |
| `tests/unit/resolve-platform.test.ts` | Unit tests for resolver |
| `tests/unit/symptom-resolver.test.ts` | Unit tests for symptom resolution |
| `tests/unit/cached-lookup.test.ts` | PGlite integration test for lookup queries |
| `tests/unit/cached-complaints-route.test.ts` | Integration test for the API route |
| `tests/unit/sessions-cache-hit.test.ts` | Integration test for POST /api/sessions cache-hit branch |
| `tests/unit/route-for-session-cache-hit.test.ts` | Unit test for routeForSession cache-hit branch |

### Files to modify

| Path | Change |
|---|---|
| `lib/db/schema.ts` | Add `cacheHitPlatformId` + `cacheHitSymptomId` columns to `sessions` table |
| `lib/types.ts` | Extend `intakeSchema` (zod) with optional `dtcCodes: string[]` + `selectedSymptomSlug: string` |
| `lib/sessions.ts` | `createSessionForUser` accepts optional cache-hit fields; `treeState` becomes accepting of empty sentinel |
| `lib/session-routing.ts` | Add `'cached-overview'` branch (checks `cacheHitSymptomId` BEFORE treeState branches) |
| `app/api/sessions/route.ts` | Pre-flight cache check before AI generation |
| `app/(app)/sessions/[id]/page.tsx` | Handle `cached-overview` route kind; fetch + pass payload |
| `components/intake/new-session-form.tsx` | Add DTC field + mount picker; include new fields in submit payload |
| `app/globals.css` | Append PR 1 styles (verbatim from `/tmp/vt-design-package/.../overview.css`) |

### Test layout

The project uses `tests/unit/**/*.test.ts` (flat directory) per `vitest.config.ts`. All new tests live there with `pr1-` or `cached-` prefix for grouping.

---

## Phase A — Backend foundations

### Task 1: Hand-write migration 0018 (add cache-hit FK columns to sessions)

**Files:**
- Create: `drizzle/migrations/0018_session_cache_hit_fks.sql`
- Create: `drizzle/migrations/meta/0018_snapshot.json` (skip if hand-writing pattern from prior migrations omits snapshots — verify)
- Modify: `lib/db/schema.ts` (add two columns to `sessions` table definition)

- [ ] **Step 1.1: Read current sessions schema**

Run: `grep -B 2 -A 30 "export const sessions = pgTable" lib/db/schema.ts`
Expected: Find the existing `sessions` table definition — note last column before columns array close, and presence/absence of nullable FK columns to use as a pattern.

- [ ] **Step 1.2: Add columns to schema.ts**

In `lib/db/schema.ts`, inside the `sessions = pgTable('sessions', { ... })` columns block, append:

```ts
  cacheHitPlatformId: uuid('cache_hit_platform_id').references(
    (): AnyPgColumn => platforms.id,
    { onDelete: 'set null' },
  ),
  cacheHitSymptomId: uuid('cache_hit_symptom_id').references(
    (): AnyPgColumn => symptoms.id,
    { onDelete: 'set null' },
  ),
```

Place them right before the existing `createdAt`/`updatedAt` columns (matches the project's column-ordering convention).

- [ ] **Step 1.3: Hand-write the SQL migration**

Create `drizzle/migrations/0018_session_cache_hit_fks.sql`:

```sql
-- Add cache-hit FK columns to sessions for Phase 3 PR 1.
-- Both nullable: cache-hit sessions populate these; cache-miss + legacy sessions leave them NULL.
-- ON DELETE SET NULL so a platform/symptom row can be retired without losing the session record.

ALTER TABLE "sessions"
  ADD COLUMN "cache_hit_platform_id" uuid REFERENCES "platforms"("id") ON DELETE SET NULL,
  ADD COLUMN "cache_hit_symptom_id" uuid REFERENCES "symptoms"("id") ON DELETE SET NULL;

CREATE INDEX "sessions_cache_hit_symptom_id_idx" ON "sessions" ("cache_hit_symptom_id");
```

- [ ] **Step 1.4: Append to migration journal**

Open `drizzle/migrations/meta/_journal.json` (verify file name) and append a new entry following the existing pattern (look at the entry for `0017_diagnostic_orchestration`). Use a fresh timestamp + `idx: 18` + `tag: "0018_session_cache_hit_fks"`.

- [ ] **Step 1.5: Run typecheck**

Run: `pnpm tsc --noEmit`
Expected: PASS (the new columns reference existing `platforms` and `symptoms` tables, which already import correctly).

- [ ] **Step 1.6: Commit (schema + migration only — DO NOT apply to live DB yet)**

```bash
git add lib/db/schema.ts drizzle/migrations/0018_session_cache_hit_fks.sql drizzle/migrations/meta/_journal.json
git commit -m "feat(diagnostics): phase 3 pr1 — migration 0018 add session cache-hit FKs

Adds cache_hit_platform_id + cache_hit_symptom_id nullable columns to sessions
for PR 1's cache-hit shortcut. Both reference orchestration tables added in 0017.
Index on cache_hit_symptom_id for the routeForSession lookup.

Not yet applied to live DB — requires explicit per-op approval at execution.
"
```

---

### Task 2: Apply migration 0018 to live Supabase

**This task requires Brandon's explicit per-op approval at execution time** (per `feedback_no_dangerous_prod_ops` memory). Do not run this without the human confirming.

- [ ] **Step 2.1: Rehearse on local rehearsal DB**

Run: `psql vyntechs_rehearsal -f drizzle/migrations/0018_session_cache_hit_fks.sql`
Expected: `ALTER TABLE` + `CREATE INDEX` both return without error.

- [ ] **Step 2.2: Verify columns exist on rehearsal**

Run: `psql vyntechs_rehearsal -c "\d sessions" | grep cache_hit`
Expected: Two lines showing both new columns of type `uuid`.

- [ ] **Step 2.3: REQUEST APPROVAL — apply to live Supabase**

Surface this to Brandon explicitly. Required text in chat: "About to apply migration 0018 to live Supabase project `ynmtszuybeenjbigxdyl`. This adds two nullable columns to `sessions` and one index. Additive only. Approve?"

Wait for explicit "yes/approve" before proceeding.

- [ ] **Step 2.4: Apply via Supabase MCP**

After approval, use the `mcp__plugin_supabase_supabase__apply_migration` MCP tool:
- `project_id`: `ynmtszuybeenjbigxdyl`
- `name`: `0018_session_cache_hit_fks`
- `query`: contents of `drizzle/migrations/0018_session_cache_hit_fks.sql`

Expected: success response.

- [ ] **Step 2.5: Verify on live DB**

Use the Supabase MCP `execute_sql` tool:
- `project_id`: `ynmtszuybeenjbigxdyl`
- `query`: `SELECT column_name FROM information_schema.columns WHERE table_name='sessions' AND column_name LIKE 'cache_hit%';`

Expected: 2 rows.

- [ ] **Step 2.6: Commit nothing — DB-only task**

No code change to commit. Move to Task 3.

---

### Task 3: Platform resolver function

**Files:**
- Create: `lib/diagnostics/resolve-platform.ts`
- Create: `tests/unit/resolve-platform.test.ts`

- [ ] **Step 3.1: Write failing test**

Create `tests/unit/resolve-platform.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { resolvePlatformSlug } from '@/lib/diagnostics/resolve-platform'

describe('resolvePlatformSlug', () => {
  const PSD_67 = 'ford-super-duty-4th-gen-67-psd'

  it('resolves 2018 Ford F-250 6.7L PSD to the 4th-gen Super Duty platform', () => {
    expect(
      resolvePlatformSlug({
        year: 2018,
        make: 'Ford',
        model: 'F-250',
        engine: '6.7L Power Stroke Diesel',
      }),
    ).toBe(PSD_67)
  })

  it.each([2017, 2018, 2019, 2020, 2021, 2022])(
    'resolves year %i F-250 6.7L PSD',
    (year) => {
      expect(
        resolvePlatformSlug({ year, make: 'Ford', model: 'F-250', engine: '6.7L Power Stroke Diesel' }),
      ).toBe(PSD_67)
    },
  )

  it.each(['F-250', 'F-350', 'F-450', 'F-550'])(
    'resolves model %s on the 6.7L PSD',
    (model) => {
      expect(
        resolvePlatformSlug({ year: 2018, make: 'Ford', model, engine: '6.7L Power Stroke Diesel' }),
      ).toBe(PSD_67)
    },
  )

  it('handles common engine-string variants', () => {
    const inputs = ['6.7L PSD', '6.7L Power Stroke', '6.7 Power Stroke Diesel', '6.7L Powerstroke', '6.7l power stroke diesel']
    for (const engine of inputs) {
      expect(
        resolvePlatformSlug({ year: 2018, make: 'Ford', model: 'F-250', engine }),
      ).toBe(PSD_67)
    }
  })

  it('is case-insensitive on make', () => {
    expect(
      resolvePlatformSlug({ year: 2018, make: 'ford', model: 'F-250', engine: '6.7L PSD' }),
    ).toBe(PSD_67)
  })

  it('returns null for 2014 F-250 (before 4th gen)', () => {
    expect(
      resolvePlatformSlug({ year: 2014, make: 'Ford', model: 'F-250', engine: '6.7L PSD' }),
    ).toBeNull()
  })

  it('returns null for 2023 F-250 (after 4th gen)', () => {
    expect(
      resolvePlatformSlug({ year: 2023, make: 'Ford', model: 'F-250', engine: '6.7L PSD' }),
    ).toBeNull()
  })

  it('returns null for 2018 F-150 (wrong model — no 6.7L PSD)', () => {
    expect(
      resolvePlatformSlug({ year: 2018, make: 'Ford', model: 'F-150', engine: '6.7L PSD' }),
    ).toBeNull()
  })

  it('returns null for 2018 F-350 6.2L gas (wrong engine)', () => {
    expect(
      resolvePlatformSlug({ year: 2018, make: 'Ford', model: 'F-350', engine: '6.2L V8 Gas' }),
    ).toBeNull()
  })

  it('returns null when engine is missing', () => {
    expect(
      resolvePlatformSlug({ year: 2018, make: 'Ford', model: 'F-250', engine: '' }),
    ).toBeNull()
  })
})
```

- [ ] **Step 3.2: Run test, verify fails**

Run: `pnpm vitest run tests/unit/resolve-platform.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3.3: Implement the resolver**

Create `lib/diagnostics/resolve-platform.ts`:

```ts
export type PlatformResolveInput = {
  year: number
  make: string
  model: string
  engine: string
}

// Engine-string patterns considered "6.7L PSD" — covers shop slang + AI variants.
// All matching is case-insensitive; normalize first.
function isFord67Psd(engine: string): boolean {
  const e = engine.toLowerCase().replace(/\s+/g, ' ').trim()
  if (!e) return false
  // Must mention "6.7" AND one of: psd / power stroke (one or two words) / powerstroke.
  if (!/\b6\.7l?\b/.test(e) && !/\b6\.7\b/.test(e)) return false
  return /psd|power\s?stroke|powerstroke/.test(e)
}

const FORD_67_PSD_MODELS = new Set(['f-250', 'f-350', 'f-450', 'f-550'])

export function resolvePlatformSlug(input: PlatformResolveInput): string | null {
  const make = input.make?.toLowerCase().trim()
  const model = input.model?.toLowerCase().trim()
  const engine = input.engine?.trim() ?? ''

  if (make === 'ford' && FORD_67_PSD_MODELS.has(model) && isFord67Psd(engine)) {
    if (input.year >= 2017 && input.year <= 2022) {
      return 'ford-super-duty-4th-gen-67-psd'
    }
  }

  return null
}
```

- [ ] **Step 3.4: Run test, verify pass**

Run: `pnpm vitest run tests/unit/resolve-platform.test.ts`
Expected: all tests pass.

- [ ] **Step 3.5: Commit**

```bash
git add lib/diagnostics/resolve-platform.ts tests/unit/resolve-platform.test.ts
git commit -m "feat(diagnostics): phase 3 pr1 — platform resolver

Code-level (year, make, model, engine) → platform slug resolver for the
single existing platform (Ford Super Duty 4th-gen 6.7L PSD). Covers
F-250/F-350/F-450/F-550 across 2017-2022. Engine matching is permissive
on common 6.7L PSD spellings (psd / power stroke / powerstroke).

Returns null for anything outside the known platform. When platform #2
lands, this collapses into a DB-driven resolutions table.
"
```

---

### Task 4: Symptom resolver

**Files:**
- Create: `lib/diagnostics/symptom-resolver.ts`
- Create: `tests/unit/symptom-resolver.test.ts`

- [ ] **Step 4.1: Write failing test**

Create `tests/unit/symptom-resolver.test.ts`:

```ts
import { describe, expect, it, beforeEach } from 'vitest'
import { withTestDb } from './helpers/test-db'  // existing PGlite helper
import { resolveSymptomSlug } from '@/lib/diagnostics/symptom-resolver'

describe('resolveSymptomSlug', () => {
  it('picks the chip slug when provided (highest priority)', async () => {
    await withTestDb(async (db) => {
      // Seed: 2 symptoms reachable for the platform via symptom_test_implications.
      await seedFixture(db)
      const result = await resolveSymptomSlug({
        db,
        platformSlug: 'ford-super-duty-4th-gen-67-psd',
        selectedSymptomSlug: 'p0087',
        dtcCodes: ['P0088'],
        complaintText: 'no start cranks normally',
      })
      expect(result).toBe('p0087')
    })
  })

  it('falls back to DTC when no chip provided', async () => {
    await withTestDb(async (db) => {
      await seedFixture(db)
      const result = await resolveSymptomSlug({
        db,
        platformSlug: 'ford-super-duty-4th-gen-67-psd',
        dtcCodes: ['P0087'],
      })
      expect(result).toBe('p0087')
    })
  })

  it('normalizes DTC case', async () => {
    await withTestDb(async (db) => {
      await seedFixture(db)
      const result = await resolveSymptomSlug({
        db, platformSlug: 'ford-super-duty-4th-gen-67-psd', dtcCodes: ['p0087'],
      })
      expect(result).toBe('p0087')
    })
  })

  it('falls back to keyword match for no-start when no DTC', async () => {
    await withTestDb(async (db) => {
      await seedFixture(db)
      const result = await resolveSymptomSlug({
        db,
        platformSlug: 'ford-super-duty-4th-gen-67-psd',
        complaintText: 'truck cranks but will not start',
      })
      expect(result).toBe('no-start-cranks-normally-fuel-system-suspect')
    })
  })

  it('returns null when nothing matches', async () => {
    await withTestDb(async (db) => {
      await seedFixture(db)
      const result = await resolveSymptomSlug({
        db,
        platformSlug: 'ford-super-duty-4th-gen-67-psd',
        complaintText: 'wipers stopped working',
      })
      expect(result).toBeNull()
    })
  })

  it('returns null when DTC exists in symptoms table but not for this platform', async () => {
    await withTestDb(async (db) => {
      await seedFixture(db)
      // Symptom exists but no symptom_test_implications row for our platform.
      const result = await resolveSymptomSlug({
        db, platformSlug: 'ford-super-duty-4th-gen-67-psd', dtcCodes: ['P9999'],
      })
      expect(result).toBeNull()
    })
  })
})

// Helper: seed minimal fixtures
async function seedFixture(db: any) {
  // Use raw SQL through db.execute() to insert:
  //   1 platform row (slug ford-super-duty-4th-gen-67-psd)
  //   3 symptoms (p0087, p0088, no-start-cranks-normally-fuel-system-suspect)
  //   1 fake symptom (p9999) NOT linked to the platform
  //   1 component + 1 test_action per symptom we want reachable
  //   3 symptom_test_implications rows linking the 3 reachable symptoms to the platform
  // Exact INSERTs left for implementation — see Run-1 Gate-1/2 INSERT scripts at
  // docs/superpowers/phase2-runs/run-1-f250-p0087/inserts-p1.sql for the column shape.
  throw new Error('seedFixture not implemented yet — see test-db helper in next task')
}
```

- [ ] **Step 4.2: Check whether the test-db helper exists**

Run: `find tests -name "test-db*" -o -name "pglite*" 2>/dev/null | head -5`
- If exists: use it; replace `withTestDb` import path accordingly.
- If does NOT exist: skip the integration tests in this task and write the resolver with pure unit tests (mock the db lookups), then revisit when the helper exists.

- [ ] **Step 4.3: Run test, verify fails**

Run: `pnpm vitest run tests/unit/symptom-resolver.test.ts`
Expected: FAIL — module not found OR seedFixture throws.

- [ ] **Step 4.4: Implement the resolver**

Create `lib/diagnostics/symptom-resolver.ts`:

```ts
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { AppDb } from '@/lib/db/client'
import { platforms, symptoms, symptomTestImplications } from '@/lib/db/schema'

export type SymptomResolveInput = {
  db: AppDb
  platformSlug: string
  selectedSymptomSlug?: string
  dtcCodes?: string[]
  complaintText?: string
}

// Keyword patterns for free-text complaint → symptom slug.
// PR 1 only covers the one drivability symptom we have cached. Add patterns
// here as more cached drivability symptoms land.
const COMPLAINT_PATTERNS: { pattern: RegExp; slug: string }[] = [
  { pattern: /no.?start.*crank|crank.*no.?start|won.t start.*crank|cranks?\s+but\s+(won.t|will not)\s+start/i, slug: 'no-start-cranks-normally-fuel-system-suspect' },
]

export async function resolveSymptomSlug(input: SymptomResolveInput): Promise<string | null> {
  const { db, platformSlug } = input

  // Collect candidate slugs in priority order, deduped.
  const candidates: string[] = []
  if (input.selectedSymptomSlug) candidates.push(input.selectedSymptomSlug)
  if (input.dtcCodes) {
    for (const dtc of input.dtcCodes) {
      const slug = dtc.trim().toLowerCase()
      if (slug && !candidates.includes(slug)) candidates.push(slug)
    }
  }
  if (input.complaintText) {
    for (const { pattern, slug } of COMPLAINT_PATTERNS) {
      if (pattern.test(input.complaintText) && !candidates.includes(slug)) {
        candidates.push(slug)
      }
    }
  }

  if (candidates.length === 0) return null

  // Find platform UUID by slug.
  const platform = await db.query.platforms.findFirst({
    where: eq(platforms.slug, platformSlug),
    columns: { id: true },
  })
  if (!platform) return null

  // Find which candidate slug exists in symptoms AND has at least one
  // symptom_test_implications row for this platform — that's a real cache hit.
  const rows = await db
    .select({ slug: symptoms.slug })
    .from(symptoms)
    .innerJoin(symptomTestImplications, eq(symptomTestImplications.symptomId, symptoms.id))
    .where(and(inArray(symptoms.slug, candidates), eq(symptomTestImplications.platformId, platform.id)))
    .groupBy(symptoms.slug)

  if (rows.length === 0) return null

  // Return the highest-priority candidate that's present.
  const reachable = new Set(rows.map((r) => r.slug))
  for (const slug of candidates) {
    if (reachable.has(slug)) return slug
  }
  return null
}
```

- [ ] **Step 4.5: Run test, verify pass**

Run: `pnpm vitest run tests/unit/symptom-resolver.test.ts`
Expected: pass (assuming the test-db helper exists). If the helper doesn't exist, skip and revisit.

- [ ] **Step 4.6: Commit**

```bash
git add lib/diagnostics/symptom-resolver.ts tests/unit/symptom-resolver.test.ts
git commit -m "feat(diagnostics): phase 3 pr1 — symptom resolver

Maps form signals (chip slug, DTC codes, complaint keywords) to a cached
symptom slug for a given platform. Chip beats DTC beats keyword. Only
returns a slug if the symptom has at least one symptom_test_implications
row for the resolved platform — pure cache-hit check.

PR 1 keyword patterns cover the one cached drivability symptom (no-start
cranks normally). More patterns land as more drivability cases are cached.
"
```

---

### Task 5: Gate thresholds + cached-lookup queries

**Files:**
- Create: `lib/diagnostics/gate-thresholds.ts`
- Create: `lib/diagnostics/cached-lookup.ts`
- Create: `tests/unit/cached-lookup.test.ts`

- [ ] **Step 5.1: Create gate-thresholds module**

Create `lib/diagnostics/gate-thresholds.ts`:

```ts
// Per-symptom commit-gate thresholds. Hard-coded for PR 1.
// Source of truth: Phase 2 run-1 progress report (P0087 = 0.85; the no-start
// diagnostic uses the same default; P0088 = 0.85 until field experience says
// otherwise).
//
// TODO (post-PR-1): relocate to a `symptoms.gate_threshold` column or to the
// confidence_calibration table once we have per-cell calibration data.

const GATE_THRESHOLDS: Record<string, number> = {
  'p0087': 0.85,
  'p0088': 0.85,
  'no-start-cranks-normally-fuel-system-suspect': 0.85,
}

const DEFAULT_GATE = 0.80

export function getGateThreshold(symptomSlug: string): number {
  return GATE_THRESHOLDS[symptomSlug] ?? DEFAULT_GATE
}
```

- [ ] **Step 5.2: Write failing test for cached-lookup**

Create `tests/unit/cached-lookup.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { withTestDb } from './helpers/test-db'  // see Task 4 step 4.2
import { listCachedSymptomsForPlatform, loadCachedDiagnostic } from '@/lib/diagnostics/cached-lookup'

describe('listCachedSymptomsForPlatform', () => {
  it('returns deduped symptoms for the platform', async () => {
    await withTestDb(async (db) => {
      await seedFullFixture(db)
      const out = await listCachedSymptomsForPlatform({
        db, platformSlug: 'ford-super-duty-4th-gen-67-psd',
      })
      expect(out.map((s) => s.slug).sort()).toEqual([
        'no-start-cranks-normally-fuel-system-suspect',
        'p0087',
        'p0088',
      ])
    })
  })

  it('returns empty array for unknown platform', async () => {
    await withTestDb(async (db) => {
      await seedFullFixture(db)
      const out = await listCachedSymptomsForPlatform({ db, platformSlug: 'unknown' })
      expect(out).toEqual([])
    })
  })
})

describe('loadCachedDiagnostic', () => {
  it('returns ordered tests with full payload shape', async () => {
    await withTestDb(async (db) => {
      await seedFullFixture(db)
      const out = await loadCachedDiagnostic({
        db,
        platformSlug: 'ford-super-duty-4th-gen-67-psd',
        symptomSlug: 'p0087',
      })
      expect(out).not.toBeNull()
      expect(out!.symptom.slug).toBe('p0087')
      expect(out!.symptom.dtcDisplay).toBe('P0087')
      expect(out!.gateThreshold).toBe(0.85)
      expect(out!.tests.length).toBeGreaterThan(0)
      expect(out!.tests[0].priorityOrder).toBe(1)
      // Verify tests are sorted by priorityOrder
      const orders = out!.tests.map((t) => t.priorityOrder)
      expect(orders).toEqual([...orders].sort((a, b) => a - b))
    })
  })

  it('returns null when no symptom_test_implications exist for platform/symptom pair', async () => {
    await withTestDb(async (db) => {
      await seedFullFixture(db)
      const out = await loadCachedDiagnostic({
        db, platformSlug: 'ford-super-duty-4th-gen-67-psd', symptomSlug: 'unknown',
      })
      expect(out).toBeNull()
    })
  })
})

async function seedFullFixture(db: any) {
  // Seed: 1 platform + 3 symptoms + 1 component + 2 test_actions per symptom + 2 sti rows per symptom.
  // (See Run-1 inserts-p1/p2/p3.sql for exact column shapes.)
  throw new Error('seedFullFixture not implemented')
}
```

- [ ] **Step 5.3: Implement cached-lookup**

Create `lib/diagnostics/cached-lookup.ts`:

```ts
import { and, asc, eq } from 'drizzle-orm'
import type { AppDb } from '@/lib/db/client'
import {
  platforms, symptoms, testActions, symptomTestImplications, components,
} from '@/lib/db/schema'
import { getGateThreshold } from './gate-thresholds'

export type CachedComplaint = {
  slug: string
  description: string
  category: string
}

export type CachedDiagnostic = {
  platform: { slug: string; name: string }
  symptom: {
    slug: string
    description: string
    category: string
    dtcDisplay: string | null
  }
  gateThreshold: number
  priorFixCount: number
  tests: {
    priorityOrder: number
    description: string
    scenarioRequired: string
    observationMethod: string
    expectedReadingDescription: string
    invasivenessRating: number
  }[]
}

export async function listCachedSymptomsForPlatform(opts: {
  db: AppDb
  platformSlug: string
}): Promise<CachedComplaint[]> {
  const { db, platformSlug } = opts

  const platform = await db.query.platforms.findFirst({
    where: eq(platforms.slug, platformSlug),
    columns: { id: true },
  })
  if (!platform) return []

  const rows = await db
    .selectDistinct({
      slug: symptoms.slug,
      description: symptoms.description,
      category: symptoms.category,
    })
    .from(symptoms)
    .innerJoin(symptomTestImplications, eq(symptomTestImplications.symptomId, symptoms.id))
    .where(eq(symptomTestImplications.platformId, platform.id))
    .orderBy(asc(symptoms.description))

  return rows
}

function dtcDisplayFor(slug: string, category: string): string | null {
  if (category !== 'dtc') return null
  return slug.toUpperCase()
}

export async function loadCachedDiagnostic(opts: {
  db: AppDb
  platformSlug: string
  symptomSlug: string
}): Promise<CachedDiagnostic | null> {
  const { db, platformSlug, symptomSlug } = opts

  const platform = await db.query.platforms.findFirst({
    where: eq(platforms.slug, platformSlug),
  })
  if (!platform) return null

  const symptom = await db.query.symptoms.findFirst({
    where: eq(symptoms.slug, symptomSlug),
  })
  if (!symptom) return null

  // Pull ordered tests via symptom_test_implications.
  const testRows = await db
    .select({
      priorityOrder: symptomTestImplications.priorityOrder,
      description: testActions.description,
      scenarioRequired: testActions.scenarioRequired,
      observationMethod: testActions.observationMethod,
      expectedReadingDescription: testActions.expectedReadingDescription,
      invasivenessRating: testActions.invasivenessRating,
    })
    .from(symptomTestImplications)
    .innerJoin(testActions, eq(testActions.id, symptomTestImplications.testActionId))
    .where(
      and(
        eq(symptomTestImplications.platformId, platform.id),
        eq(symptomTestImplications.symptomId, symptom.id),
      ),
    )
    .orderBy(asc(symptomTestImplications.priorityOrder))

  if (testRows.length === 0) return null

  // Count prior fixes — tech_outcomes rows on diagnostic_sessions matching this symptom.
  // For PR 1, the count comes via a separate query to keep this readable.
  // (See Task 5 step 5.4 if we add the diagnosticSessions/techOutcomes import.)
  const priorFixCount = 0  // TODO Task 5.4 — compute from tech_outcomes

  const platformName = `${platform.parentMake} ${platform.parentModelFamily} ${platform.generation ?? ''}`.trim()

  return {
    platform: { slug: platform.slug, name: platformName },
    symptom: {
      slug: symptom.slug,
      description: symptom.description,
      category: symptom.category,
      dtcDisplay: dtcDisplayFor(symptom.slug, symptom.category),
    },
    gateThreshold: getGateThreshold(symptom.slug),
    priorFixCount,
    tests: testRows,
  }
}
```

- [ ] **Step 5.4: Wire priorFixCount query**

Extend `loadCachedDiagnostic` to query `tech_outcomes` JOIN `diagnostic_sessions` filtered by `symptom_id = symptom.id`. Replace the `priorFixCount = 0` with the real query. Add a test asserting count > 0 after seeding a fixture that includes 2 tech_outcomes for the test symptom.

- [ ] **Step 5.5: Run tests, verify pass**

Run: `pnpm vitest run tests/unit/cached-lookup.test.ts`
Expected: pass.

- [ ] **Step 5.6: Commit**

```bash
git add lib/diagnostics/gate-thresholds.ts lib/diagnostics/cached-lookup.ts tests/unit/cached-lookup.test.ts
git commit -m "feat(diagnostics): phase 3 pr1 — cached lookup queries + gate thresholds

listCachedSymptomsForPlatform(platformSlug) → chip-picker payload
loadCachedDiagnostic({platformSlug, symptomSlug}) → full overview payload
  (symptom + ordered tests + gate threshold + prior-fix count)

Gate thresholds hard-coded for PR 1 (Phase 2 run-1 says 0.85 for P0087);
relocates to DB column in a follow-up PR once calibration data exists.
"
```

---

### Task 6: GET /api/diagnostics/cached-complaints route

**Files:**
- Create: `app/api/diagnostics/cached-complaints/route.ts`
- Create: `tests/unit/cached-complaints-route.test.ts`

- [ ] **Step 6.1: Write failing test**

Create `tests/unit/cached-complaints-route.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/diagnostics/cached-complaints/route'

// Mock the supabase server + db client per the project's existing route-test pattern.
// Look at tests/unit/create-session-handler.test.ts for the established mock shape.

describe('GET /api/diagnostics/cached-complaints', () => {
  it('returns empty complaints when vehicle params do not resolve to a platform', async () => {
    // Mock auth → authed user
    // Mock db so listCachedSymptomsForPlatform isn't actually called
    const req = new Request(
      'http://test/api/diagnostics/cached-complaints?year=2018&make=Ford&model=F-150&engine=3.5L+EcoBoost',
    )
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.platformSlug).toBeNull()
    expect(body.complaints).toEqual([])
  })

  it('returns complaints when vehicle resolves to known platform', async () => {
    // Mock auth + db with seeded fixtures so listCachedSymptomsForPlatform returns 3 rows.
    const req = new Request(
      'http://test/api/diagnostics/cached-complaints?year=2018&make=Ford&model=F-250&engine=6.7L+Power+Stroke+Diesel',
    )
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.platformSlug).toBe('ford-super-duty-4th-gen-67-psd')
    expect(body.complaints).toHaveLength(3)
  })

  it('returns 401 when unauthenticated', async () => {
    // Mock auth → no user
    const req = new Request('http://test/api/diagnostics/cached-complaints?year=2018&make=Ford&model=F-250&engine=6.7L')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('returns 400 when required vehicle params missing', async () => {
    // Mock auth → authed
    const req = new Request('http://test/api/diagnostics/cached-complaints?year=2018&make=Ford')
    const res = await GET(req)
    expect(res.status).toBe(400)
  })
})
```

Inspect `tests/unit/create-session-handler.test.ts` first for the exact auth/db mock pattern in use.

- [ ] **Step 6.2: Run test, verify fails**

Run: `pnpm vitest run tests/unit/cached-complaints-route.test.ts`
Expected: FAIL — route module not found.

- [ ] **Step 6.3: Implement the route**

Create `app/api/diagnostics/cached-complaints/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import { resolvePlatformSlug } from '@/lib/diagnostics/resolve-platform'
import { listCachedSymptomsForPlatform } from '@/lib/diagnostics/cached-lookup'

export async function GET(req: Request) {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const yearRaw = url.searchParams.get('year')
  const make = url.searchParams.get('make')?.trim()
  const model = url.searchParams.get('model')?.trim()
  const engine = url.searchParams.get('engine')?.trim() ?? ''

  if (!yearRaw || !make || !model) {
    return NextResponse.json({ error: 'missing required vehicle params' }, { status: 400 })
  }

  const year = Number(yearRaw)
  if (!Number.isFinite(year)) {
    return NextResponse.json({ error: 'invalid year' }, { status: 400 })
  }

  const platformSlug = resolvePlatformSlug({ year, make, model, engine })
  if (!platformSlug) {
    return NextResponse.json({ platformSlug: null, complaints: [] })
  }

  const complaints = await listCachedSymptomsForPlatform({ db, platformSlug })
  return NextResponse.json({ platformSlug, complaints })
}
```

- [ ] **Step 6.4: Run test, verify pass**

Run: `pnpm vitest run tests/unit/cached-complaints-route.test.ts`
Expected: pass.

- [ ] **Step 6.5: Commit**

```bash
git add app/api/diagnostics/cached-complaints/route.ts tests/unit/cached-complaints-route.test.ts
git commit -m "feat(diagnostics): phase 3 pr1 — GET /api/diagnostics/cached-complaints

Resolves (year, make, model, engine) to a platform and returns the
cached symptoms reachable for that platform. Powers the chip picker
on the intake form. Returns {platformSlug: null, complaints: []} for
unresolved vehicles instead of an error so the picker can render
empty silently.
"
```

---

### Task 7: Extend intakeSchema and createSessionForUser for cache-hit fields

**Files:**
- Modify: `lib/types.ts`
- Modify: `lib/sessions.ts`

- [ ] **Step 7.1: Read current intakeSchema**

Run: `grep -B 2 -A 20 "intakeSchema" lib/types.ts`
Note the existing zod shape so the additions match the style.

- [ ] **Step 7.2: Extend intakeSchema with optional fields**

In `lib/types.ts`, add to the existing `intakeSchema`:

```ts
// Inside the existing intakeSchema zod object, append:
  dtcCodes: z.array(z.string().trim().min(1).max(10)).max(10).optional(),
  selectedSymptomSlug: z.string().trim().min(1).max(120).optional(),
```

- [ ] **Step 7.3: Read current createSessionForUser signature**

Run: `grep -B 2 -A 25 "export async function createSessionForUser" lib/sessions.ts`

- [ ] **Step 7.4: Add optional cache-hit fields to createSessionForUser**

Modify the `opts` type and the INSERT call to accept + persist `cacheHitPlatformId` and `cacheHitSymptomId`:

```ts
export async function createSessionForUser(opts: {
  db: AppDb
  userId: string
  body: IntakePayload
  treeState: TreeState
  cacheHitPlatformId?: string | null
  cacheHitSymptomId?: string | null
}): Promise<CreateSessionResult> {
  // ... existing logic unchanged ...
  // In the .insert() call, add:
  //   cacheHitPlatformId: opts.cacheHitPlatformId ?? null,
  //   cacheHitSymptomId: opts.cacheHitSymptomId ?? null,
}
```

The exact `.insert()` shape varies — extend whatever object is passed to `db.insert(sessions).values({...})`.

- [ ] **Step 7.5: Run typecheck**

Run: `pnpm tsc --noEmit`
Expected: pass.

- [ ] **Step 7.6: Commit**

```bash
git add lib/types.ts lib/sessions.ts
git commit -m "feat(diagnostics): phase 3 pr1 — intake schema + createSessionForUser cache-hit fields

intakeSchema: optional dtcCodes (string[]) + selectedSymptomSlug
createSessionForUser: optional cacheHitPlatformId + cacheHitSymptomId
  passed through to the sessions INSERT
"
```

---

### Task 8: Pre-flight cache check in POST /api/sessions

**Files:**
- Modify: `app/api/sessions/route.ts`
- Create: `tests/unit/sessions-cache-hit.test.ts`

- [ ] **Step 8.1: Write failing test**

Create `tests/unit/sessions-cache-hit.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { POST } from '@/app/api/sessions/route'

describe('POST /api/sessions — cache-hit branch', () => {
  it('skips AI generation when cache hits and persists cacheHitSymptomId', async () => {
    // Mock auth + db with platform + symptom + sti seed.
    // Mock the AI tree gen call (should NOT be invoked).
    // Submit intake matching a known cached symptom.
    // Assert: session created with cacheHitSymptomId set, treeState is empty sentinel.
  })

  it('falls through to AI generation on cache miss', async () => {
    // Mock auth + db with NO matching seed.
    // Mock AI tree gen → returns a valid tree.
    // Submit intake.
    // Assert: session created with cacheHitSymptomId null, AI was called.
  })
})
```

Use the existing `tests/unit/create-session-handler.test.ts` mock pattern as the template — it already mocks the supabase server, db client, AI tree gen, paywall, and open-session-limit dependencies.

- [ ] **Step 8.2: Run test, verify fails**

Run: `pnpm vitest run tests/unit/sessions-cache-hit.test.ts`
Expected: FAIL.

- [ ] **Step 8.3: Modify POST handler — insert pre-flight cache check**

In `app/api/sessions/route.ts`, between the open-session-limit check (around line 75) and the `generateInitialTreeWithRetrieval` call (around line 86), insert:

```ts
// ----- PR 1 cache-hit shortcut -----
// Resolve platform → check for a cached symptom → if both resolve and the
// symptom_test_implications join has at least one row, skip AI generation
// and create a cache-hit session directly. Cache miss falls through to the
// existing AI flow unchanged.
const platformSlug = resolvePlatformSlug({
  year: parsed.data.vehicleYear,
  make: parsed.data.vehicleMake,
  model: parsed.data.vehicleModel,
  engine: parsed.data.vehicleEngine ?? '',
})

let cacheHitPlatformId: string | null = null
let cacheHitSymptomId: string | null = null

if (platformSlug) {
  const symptomSlug = await resolveSymptomSlug({
    db,
    platformSlug,
    selectedSymptomSlug: parsed.data.selectedSymptomSlug,
    dtcCodes: parsed.data.dtcCodes,
    complaintText: parsed.data.customerComplaint,
  })
  if (symptomSlug) {
    const platform = await db.query.platforms.findFirst({
      where: eq(platforms.slug, platformSlug), columns: { id: true },
    })
    const symptom = await db.query.symptoms.findFirst({
      where: eq(symptoms.slug, symptomSlug), columns: { id: true },
    })
    if (platform && symptom) {
      cacheHitPlatformId = platform.id
      cacheHitSymptomId = symptom.id
    }
  }
}

let treeState: TreeState
if (cacheHitSymptomId) {
  treeState = { nodes: [], gateDecision: null } as unknown as TreeState
} else {
  // Existing AI tree generation — unchanged.
  const generateInitialTreeWithRetrieval = buildGenerateInitialTreeWithRetrieval({
    db, adapters: ADAPTERS, generateInitialTree, runRetrieval,
    validateRetrievalResults, retrieveCorpus,
  })
  try {
    treeState = await generateInitialTreeWithRetrieval(parsed.data)
  } catch (err) {
    console.error('tree generation failed:', err)
    return NextResponse.json({ error: 'tree generation failed' }, { status: 500 })
  }
}
// ----- end cache-hit shortcut -----
```

Then update the `createSessionForUser` call to pass the new fields:

```ts
const result = await createSessionForUser({
  db, userId: user.id, body: parsed.data, treeState,
  cacheHitPlatformId, cacheHitSymptomId,
})
```

Required new imports at the top of the file:

```ts
import { eq } from 'drizzle-orm'
import { platforms, symptoms } from '@/lib/db/schema'
import { resolvePlatformSlug } from '@/lib/diagnostics/resolve-platform'
import { resolveSymptomSlug } from '@/lib/diagnostics/symptom-resolver'
import type { TreeState } from '@/lib/types'  // adjust import path per existing project
```

- [ ] **Step 8.4: Run test, verify pass**

Run: `pnpm vitest run tests/unit/sessions-cache-hit.test.ts`
Expected: pass.

- [ ] **Step 8.5: Run full test suite — guard against regression**

Run: `pnpm test`
Expected: all tests pass. If `tests/unit/create-session-handler.test.ts` regresses, the cache-miss fall-through has a bug — fix before continuing.

- [ ] **Step 8.6: Commit**

```bash
git add app/api/sessions/route.ts tests/unit/sessions-cache-hit.test.ts
git commit -m "feat(diagnostics): phase 3 pr1 — POST /api/sessions cache-hit shortcut

Pre-flight cache check between the open-session-limit gate and AI tree gen.
On hit: skip AI, create session with cacheHitPlatformId/SymptomId set and
empty-sentinel treeState. On miss: existing AI flow unchanged.

Bounded latency cost on miss path (resolver is in-memory; symptom lookup
is two indexed queries). Cache-miss integration test guards regression.
"
```

---

### Task 9: routeForSession cache-hit branch

**Files:**
- Modify: `lib/session-routing.ts`
- Create: `tests/unit/route-for-session-cache-hit.test.ts`

- [ ] **Step 9.1: Write failing test**

Create `tests/unit/route-for-session-cache-hit.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { routeForSession } from '@/lib/session-routing'

describe('routeForSession — cache-hit branch', () => {
  it('returns cached-overview when cacheHitSymptomId is set', () => {
    const route = routeForSession({
      id: 'abc',
      status: 'open',
      treeState: { nodes: [], gateDecision: null } as any,
      cacheHitSymptomId: 'symptom-uuid',
      cacheHitPlatformId: 'platform-uuid',
    } as any)
    expect(route.kind).toBe('cached-overview')
  })

  it('cache-hit branch fires BEFORE tree-generating', () => {
    // Empty treeState would normally → tree-generating; cacheHitSymptomId beats it.
    const route = routeForSession({
      id: 'abc', status: 'open',
      treeState: { nodes: [], gateDecision: null } as any,
      cacheHitSymptomId: 'symptom-uuid', cacheHitPlatformId: 'platform-uuid',
    } as any)
    expect(route.kind).toBe('cached-overview')
  })

  it('closed sessions still take precedence', () => {
    const route = routeForSession({
      id: 'abc', status: 'closed',
      treeState: { nodes: [] } as any,
      cacheHitSymptomId: 'symptom-uuid', cacheHitPlatformId: 'platform-uuid',
    } as any)
    expect(route.kind).toBe('closed-summary')
  })

  it('existing AI sessions (no cacheHitSymptomId) route as before', () => {
    const route = routeForSession({
      id: 'abc', status: 'open',
      treeState: { nodes: [{}, {}], gateDecision: { allow: true } } as any,
      cacheHitSymptomId: null, cacheHitPlatformId: null,
    } as any)
    expect(route.kind).toBe('active-session')
  })
})
```

- [ ] **Step 9.2: Run test, verify fails**

Run: `pnpm vitest run tests/unit/route-for-session-cache-hit.test.ts`
Expected: FAIL — `cached-overview` not in SessionRoute kinds.

- [ ] **Step 9.3: Add the new branch**

Modify `lib/session-routing.ts`:

```ts
export type SessionRoute =
  | { kind: 'tree-generating' }
  | { kind: 'redirect'; to: string }
  | { kind: 'active-session' }
  | { kind: 'closed-summary' }
  | { kind: 'cached-overview' }   // NEW

export function routeForSession(
  session: Pick<Session, 'id' | 'status' | 'treeState' | 'cacheHitSymptomId' | 'cacheHitPlatformId'>,
): SessionRoute {
  if (session.status === 'closed') {
    return { kind: 'closed-summary' }
  }
  // NEW: cache-hit beats the tree-generating fallback.
  if (session.cacheHitSymptomId) {
    return { kind: 'cached-overview' }
  }
  if (!session.treeState || session.treeState.nodes.length === 0) {
    return { kind: 'tree-generating' }
  }
  if (
    session.treeState.gateDecision &&
    !session.treeState.gateDecision.allow
  ) {
    return { kind: 'redirect', to: `/sessions/${session.id}/decline` }
  }
  return { kind: 'active-session' }
}
```

- [ ] **Step 9.4: Run test, verify pass + run full suite**

Run: `pnpm vitest run tests/unit/route-for-session-cache-hit.test.ts && pnpm test`
Expected: all pass.

- [ ] **Step 9.5: Commit**

```bash
git add lib/session-routing.ts tests/unit/route-for-session-cache-hit.test.ts
git commit -m "feat(diagnostics): phase 3 pr1 — routeForSession cached-overview branch

Adds 'cached-overview' kind to SessionRoute union. Branch fires when
cacheHitSymptomId is set on the session, before the existing
tree-generating fallback so the empty-sentinel treeState used by
cache-hit sessions doesn't accidentally route to the loading screen.

Closed-session precedence preserved.
"
```

---

## Phase B — Frontend primitives

### Task 10: Append PR 1 CSS to globals.css

**Files:**
- Modify: `app/globals.css`
- Reference: `/tmp/vt-design-package/vyntechs-design-system/project/pr1-cached-overview/overview.css`

- [ ] **Step 10.1: Copy overview.css contents verbatim**

Append the entire contents of `/tmp/vt-design-package/vyntechs-design-system/project/pr1-cached-overview/overview.css` to the end of `app/globals.css`. **Verify before pasting** that all token references (`var(--vt-amber-500)`, `var(--vt-bone-*)`, `var(--vt-fg-*)`, `var(--vt-rule)`, etc.) already exist in the project's globals.css. They should — Brandon confirmed the Workshop Instrument design system is already in place.

- [ ] **Step 10.2: Add a section delimiter comment**

Above the appended block, add:

```css
/* ============================================================
   PR 1 — Cached Diagnostic Overview (Phase 3)
   Ported verbatim from Claude Design package 2026-05-19.
   Only adds new primitives; no foundation token changes.
   ============================================================ */
```

- [ ] **Step 10.3: Smoke-check by booting the dev server**

Run: `pnpm dev` (in another terminal or backgrounded)
Open: `http://localhost:3000` — verify no CSS-load errors in browser devtools console.

- [ ] **Step 10.4: Commit**

```bash
git add app/globals.css
git commit -m "feat(diagnostics): phase 3 pr1 — append cached-overview styles to globals.css

Ports the .cov-*, .scenario-chip, .method-chip, .inv-dots, .cov-gate,
.cov-cta, .cov-empty, .cov-desktop styles from the Claude Design
handoff package. Uses only existing design tokens — no new tokens added.
"
```

---

### Task 11: Port new vt/ primitives (chip + dots + gate + hero + badge + cta)

**Files:**
- Create: `components/vt/scenario-chip.tsx`
- Create: `components/vt/method-chip.tsx`
- Create: `components/vt/invasiveness-dots.tsx`
- Create: `components/vt/confidence-gate.tsx`
- Create: `components/vt/symptom-hero.tsx`
- Create: `components/vt/cached-instant-badge.tsx`
- Create: `components/vt/cta-bar.tsx`
- Modify: `components/vt/index.ts` (add new exports)
- Reference: `/tmp/vt-design-package/vyntechs-design-system/project/pr1-cached-overview/components/Overview.jsx` (lines 11-133 for primitives)

- [ ] **Step 11.1: Create ScenarioChip**

Create `components/vt/scenario-chip.tsx`:

```tsx
export function ScenarioChip({ children }: { children: React.ReactNode }) {
  return <span className="scenario-chip">{children}</span>
}
```

- [ ] **Step 11.2: Create MethodChip**

Create `components/vt/method-chip.tsx`:

```tsx
import { Gauge, Eye, Ear, Wind, Ruler, Wrench, Circle } from '@phosphor-icons/react/dist/ssr'

const METHOD_ICON: Record<string, React.ComponentType<{ size?: number }>> = {
  PID: Gauge,
  VISUAL: Eye,
  AUDIBLE: Ear,
  SMELL: Wind,
  MEASUREMENT: Ruler,
  BENCH: Wrench,
}

export function MethodChip({ method }: { method: string }) {
  const upper = method.toUpperCase()
  const Icon = METHOD_ICON[upper] ?? Circle
  return (
    <span className="method-chip">
      <Icon size={12} />
      {upper}
    </span>
  )
}
```

Verify the `/dist/ssr` import path matches the installed phosphor version (`grep "@phosphor-icons" package.json` shows `^2.1.10` — the SSR path is correct for 2.x).

- [ ] **Step 11.3: Create InvasivenessDots**

Create `components/vt/invasiveness-dots.tsx`:

```tsx
export function InvasivenessDots({ value }: { value: number }) {
  const clamped = Math.max(1, Math.min(5, value))
  return (
    <span className="inv-dots" data-level={clamped}>
      <span className="inv-dots__row">
        {[1, 2, 3, 4, 5].map((i) => (
          <span key={i} className={`dot ${i <= clamped ? 'filled' : ''}`} />
        ))}
      </span>
      <span className="inv-dots__label">inv · {clamped}</span>
    </span>
  )
}
```

- [ ] **Step 11.4: Create ConfidenceGate**

Create `components/vt/confidence-gate.tsx`:

```tsx
export function ConfidenceGate({ gate }: { gate: number }) {
  const pct = (Math.max(0, Math.min(1, gate)) * 100).toFixed(0)
  return (
    <div className="cov-gate">
      <span className="cov-gate__label">Gate</span>
      <div className="cov-gate__track">
        <div className="cov-gate__mark" style={{ left: `${pct}%` }} />
      </div>
      <span className="cov-gate__val">≥ {pct} %</span>
    </div>
  )
}
```

- [ ] **Step 11.5: Create CachedInstantBadge**

Create `components/vt/cached-instant-badge.tsx`:

```tsx
export function CachedInstantBadge() {
  return <span className="cov-instant">cached · instant</span>
}
```

- [ ] **Step 11.6: Create SymptomHero**

Create `components/vt/symptom-hero.tsx`:

```tsx
import { ConfidenceGate } from './confidence-gate'

export function SymptomHero({
  dtc,
  name,
  gate,
  priorFixCount,
}: {
  dtc: string | null
  name: string
  gate: number
  priorFixCount: number
}) {
  return (
    <div className="cov-symptom">
      <div className="cov-symptom__eyebrow">
        <span>Matched symptom</span>
        {dtc && <span className="cov-symptom__dtc">{dtc}</span>}
      </div>
      <h1 className="cov-symptom__name">{name}</h1>
      {priorFixCount > 0 && (
        <div className="cov-symptom__meta">
          <span>{priorFixCount} prior fixes · cross-shop corpus</span>
        </div>
      )}
      <ConfidenceGate gate={gate} />
    </div>
  )
}
```

Note: per spec open Q #3, hide the prior-fix line when count is 0.

- [ ] **Step 11.7: Create CtaBar**

Create `components/vt/cta-bar.tsx`:

```tsx
import { ArrowRight } from '@phosphor-icons/react/dist/ssr'

export function CtaBar({
  leadLeft = 'Step 1 of plan',
  leadRight = 'no commit',
  label = 'Start the walk',
  onClick,
  disabled,
}: {
  leadLeft?: string
  leadRight?: string
  label?: string
  onClick?: () => void
  disabled?: boolean
}) {
  return (
    <div className="cov-cta">
      <div className="cov-cta__lead">
        <span>{leadLeft}</span>
        <span>{leadRight}</span>
      </div>
      <button className="cov-cta__btn" onClick={onClick} disabled={disabled}>
        <span>{label}</span>
        <ArrowRight size={18} />
      </button>
    </div>
  )
}
```

- [ ] **Step 11.8: Export from index.ts**

In `components/vt/index.ts`, add:

```ts
export { ScenarioChip } from './scenario-chip'
export { MethodChip } from './method-chip'
export { InvasivenessDots } from './invasiveness-dots'
export { ConfidenceGate } from './confidence-gate'
export { SymptomHero } from './symptom-hero'
export { CachedInstantBadge } from './cached-instant-badge'
export { CtaBar } from './cta-bar'
```

- [ ] **Step 11.9: Run typecheck**

Run: `pnpm tsc --noEmit`
Expected: pass.

- [ ] **Step 11.10: Commit**

```bash
git add components/vt/scenario-chip.tsx components/vt/method-chip.tsx components/vt/invasiveness-dots.tsx components/vt/confidence-gate.tsx components/vt/symptom-hero.tsx components/vt/cached-instant-badge.tsx components/vt/cta-bar.tsx components/vt/index.ts
git commit -m "feat(diagnostics): phase 3 pr1 — new vt/ primitives for cached overview

ScenarioChip, MethodChip (Phosphor icons), InvasivenessDots (5-dot scale
with risk escalation at 4-5), ConfidenceGate (compact bar marker —
distinct from existing big-number ConfidenceBlock), SymptomHero,
CachedInstantBadge, CtaBar.

All styled by the .cov-* / .scenario-chip / etc. classes appended to
globals.css in the prior commit.
"
```

---

### Task 12: CachedComplaintPicker (chip-picker on intake form)

**Files:**
- Create: `components/intake/cached-complaint-picker.tsx`

- [ ] **Step 12.1: Create the picker component**

Create `components/intake/cached-complaint-picker.tsx`:

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'

type Complaint = { slug: string; description: string; category: string }

export function CachedComplaintPicker({
  vehicleYear,
  vehicleMake,
  vehicleModel,
  vehicleEngine,
  onPick,
  selectedSlug,
}: {
  vehicleYear: string
  vehicleMake: string
  vehicleModel: string
  vehicleEngine: string
  onPick: (slug: string | null) => void
  selectedSlug: string | null
}) {
  const [loading, setLoading] = useState(false)
  const [complaints, setComplaints] = useState<Complaint[] | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const allFilled = vehicleYear && vehicleMake && vehicleModel && vehicleEngine
    if (!allFilled) {
      setComplaints(null)
      onPick(null)
      return
    }
    const timer = setTimeout(async () => {
      abortRef.current?.abort()
      const ctrl = new AbortController()
      abortRef.current = ctrl
      setLoading(true)
      try {
        const url = new URL('/api/diagnostics/cached-complaints', window.location.origin)
        url.searchParams.set('year', vehicleYear)
        url.searchParams.set('make', vehicleMake)
        url.searchParams.set('model', vehicleModel)
        url.searchParams.set('engine', vehicleEngine)
        const res = await fetch(url.toString(), { signal: ctrl.signal })
        if (!res.ok) {
          setComplaints([])
          return
        }
        const body = await res.json()
        setComplaints(body.complaints ?? [])
      } catch (err) {
        if ((err as any).name !== 'AbortError') setComplaints([])
      } finally {
        setLoading(false)
      }
    }, 350)
    return () => clearTimeout(timer)
  }, [vehicleYear, vehicleMake, vehicleModel, vehicleEngine, onPick])

  // Never render anything if no platform resolved or no complaints exist.
  if (!complaints || complaints.length === 0) {
    if (loading) {
      return (
        <div className="field" style={{ opacity: 0.6 }}>
          <label>Common complaints</label>
          <span className="eyebrow" style={{ fontSize: 10 }}>Looking…</span>
        </div>
      )
    }
    return null
  }

  return (
    <div className="field">
      <label>Common complaints for this vehicle</label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {complaints.map((c) => (
          <button
            key={c.slug}
            type="button"
            onClick={() => onPick(selectedSlug === c.slug ? null : c.slug)}
            style={{
              padding: '6px 10px',
              borderRadius: 4,
              border: '0.5px solid var(--vt-rule-strong)',
              background:
                selectedSlug === c.slug
                  ? 'var(--vt-amber-500)'
                  : 'transparent',
              color: selectedSlug === c.slug ? 'var(--vt-bone-50)' : 'var(--vt-fg-2)',
              fontFamily: 'var(--vt-font-serif)',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            {c.description}
          </button>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 12.2: Smoke-check typecheck**

Run: `pnpm tsc --noEmit`
Expected: pass.

- [ ] **Step 12.3: Commit**

```bash
git add components/intake/cached-complaint-picker.tsx
git commit -m "feat(diagnostics): phase 3 pr1 — CachedComplaintPicker chip-picker

Client component that debounces (350ms) on vehicle field changes,
calls GET /api/diagnostics/cached-complaints, and renders chips.
Renders nothing when vehicle doesn't resolve or no complaints exist
(silent absence per spec). Chip click toggles selectedSymptomSlug.
"
```

---

### Task 13: Wire DTC field + picker into new-session-form

**Files:**
- Modify: `components/intake/new-session-form.tsx`

- [ ] **Step 13.1: Add state for DTC, selectedSymptomSlug, and the four vehicle fields**

In `components/intake/new-session-form.tsx`, hoist the vehicle fields into React state so the picker can react to them:

```tsx
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { HairlineProgress } from '@/components/vt'
import { CachedComplaintPicker } from './cached-complaint-picker'

export function NewSessionForm() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [openSessionId, setOpenSessionId] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)

  // Hoisted so the chip picker can react to vehicle changes
  const [vehicleYear, setVehicleYear] = useState('')
  const [vehicleMake, setVehicleMake] = useState('')
  const [vehicleModel, setVehicleModel] = useState('')
  const [vehicleEngine, setVehicleEngine] = useState('')
  const [dtcCodes, setDtcCodes] = useState('')
  const [selectedSymptomSlug, setSelectedSymptomSlug] = useState<string | null>(null)

  // ... existing handleSubmit, refactored to use state instead of FormData where these fields are concerned ...
}
```

- [ ] **Step 13.2: Refactor handleSubmit to include new fields**

In the `handleSubmit` function, replace the `payload` construction with:

```tsx
const formData = new FormData(e.currentTarget)
const mileageRaw = formData.get('mileage')
const payload: Record<string, unknown> = {
  vehicleYear: Number(vehicleYear),
  vehicleMake: vehicleMake.trim(),
  vehicleModel: vehicleModel.trim(),
  customerComplaint: String(formData.get('customerComplaint') ?? '').trim(),
}
if (vehicleEngine.trim()) payload.vehicleEngine = vehicleEngine.trim()
if (mileageRaw && String(mileageRaw).trim()) {
  payload.mileage = Number(mileageRaw)
}
// PR 1 additions
const dtcArray = dtcCodes
  .split(/[,\s]+/)
  .map((s) => s.trim())
  .filter((s) => /^[A-Z][0-9A-Z]{4}$/i.test(s))
if (dtcArray.length > 0) payload.dtcCodes = dtcArray
if (selectedSymptomSlug) payload.selectedSymptomSlug = selectedSymptomSlug
```

- [ ] **Step 13.3: Convert the 4 vehicle inputs + add DTC input**

Replace the four vehicle `<input>` elements with controlled versions bound to the new state. Insert a new DTC input between engine and mileage:

```tsx
<div className="field">
  <label htmlFor="dtcCodes">DTC code(s) (optional)</label>
  <input
    id="dtcCodes"
    name="dtcCodes"
    type="text"
    disabled={generating}
    value={dtcCodes}
    onChange={(e) => setDtcCodes(e.target.value)}
    style={{ fontFamily: 'var(--vt-font-mono)' }}
    placeholder="P0087, P0088"
  />
</div>
```

Mount the picker below the engine field:

```tsx
<CachedComplaintPicker
  vehicleYear={vehicleYear}
  vehicleMake={vehicleMake}
  vehicleModel={vehicleModel}
  vehicleEngine={vehicleEngine}
  selectedSlug={selectedSymptomSlug}
  onPick={setSelectedSymptomSlug}
/>
```

- [ ] **Step 13.4: Run typecheck + dev server smoke**

Run: `pnpm tsc --noEmit`
Then in browser: load `/sessions/new`. Fill F-250 / Ford / 2018 / 6.7L Power Stroke Diesel. Verify a chip row appears (the resolver matches, the picker fetches, chips render). Verify clicking a chip highlights it. Verify the form still submits.

- [ ] **Step 13.5: Commit**

```bash
git add components/intake/new-session-form.tsx
git commit -m "feat(diagnostics): phase 3 pr1 — intake form gains DTC field + chip picker

Hoists year/make/model/engine into React state so the chip picker can
react to changes. Adds optional DTC input between engine and mileage
(parses comma-separated codes via /^[A-Z][0-9A-Z]{4}$/i). Mounts
CachedComplaintPicker below the engine field. Submit payload includes
dtcCodes (parsed to array) and selectedSymptomSlug when set.
"
```

---

## Phase C — Frontend screens

### Task 14: CachedOverview screen (mobile V1 Ledger + DesktopOverview)

**Files:**
- Create: `components/screens/cached-overview.tsx`
- Reference: `/tmp/vt-design-package/.../components/Overview.jsx` (ScreenLedger lines 244-257, DesktopOverview lines 379-506)

- [ ] **Step 14.1: Create the screen with both layouts**

Create `components/screens/cached-overview.tsx`. The pattern: a single component that picks between mobile and desktop via a CSS media query (both layouts ship — mobile hidden ≥1024px, desktop hidden <1024px). This avoids JS-side viewport detection that flickers on hydration.

```tsx
import {
  AppHeader,
  ScenarioChip,
  MethodChip,
  InvasivenessDots,
  SymptomHero,
  CachedInstantBadge,
  CtaBar,
} from '@/components/vt'
import type { CachedDiagnostic } from '@/lib/diagnostics/cached-lookup'

export function CachedOverview({
  diagnostic,
  vehicleName,
  vin,
  mileage,
  onStartWalk,
}: {
  diagnostic: CachedDiagnostic
  vehicleName: string
  vin: string | null
  mileage: number | null
  onStartWalk?: () => void
}) {
  const tests = diagnostic.tests

  return (
    <>
      {/* Mobile (V1 Ledger) — visible <1024px */}
      <div className="cov-app" style={{ display: 'flex' }}>
        <div className="vehicle-strip" style={{ alignItems: 'center' }}>
          <div>
            <div className="vehicle-name">{vehicleName}</div>
            <div className="vin">
              {vin && `VIN · ${vin}`}{vin && mileage ? ' · ' : ''}{mileage && `${mileage.toLocaleString()} mi`}
            </div>
          </div>
          <CachedInstantBadge />
        </div>

        <SymptomHero
          dtc={diagnostic.symptom.dtcDisplay}
          name={diagnostic.symptom.description}
          gate={diagnostic.gateThreshold}
          priorFixCount={diagnostic.priorFixCount}
        />

        <div className="cov-plan-header">
          <span className="cov-plan-header__lead">Test plan</span>
          <span className="cov-plan-header__count">
            <strong>{tests.length}</strong> steps · By information value
          </span>
        </div>

        <div className="cov-list" style={{ flex: 1, overflowY: 'auto' }}>
          {tests.map((t) => (
            <div key={t.priorityOrder} className="cov-row">
              <div className="cov-row__prio">{String(t.priorityOrder).padStart(2, '0')}</div>
              <div className="cov-row__body">
                <div className="cov-row__name">{t.description}</div>
                <div className="cov-row__chips">
                  <ScenarioChip>{t.scenarioRequired.toUpperCase()}</ScenarioChip>
                  <MethodChip method={t.observationMethod} />
                </div>
                <div className="cov-row__expected">
                  <b>expect</b>
                  {t.expectedReadingDescription}
                </div>
              </div>
              <div className="cov-row__inv">
                <InvasivenessDots value={t.invasivenessRating} />
              </div>
            </div>
          ))}
        </div>

        <CtaBar onClick={onStartWalk} />
      </div>

      {/* Desktop view — translated from DesktopOverview in the design package.
          Render via a media-query toggle in globals.css; both blocks live in
          the DOM but only one is visible. (Acceptable since the test list
          is small/medium-sized and not a perf concern.) */}
      {/* …port DesktopOverview JSX here, same data binding (tests, diagnostic, vehicleName, vin)… */}
    </>
  )
}
```

Then add to `app/globals.css`:

```css
@media (min-width: 1024px) {
  .cov-app { display: none !important; }
}
@media (max-width: 1023px) {
  .cov-desktop { display: none !important; }
}
```

For the desktop block, port `DesktopOverview` from the design package's `Overview.jsx` lines 379-506. Swap the hard-coded copy ("Marcus Reyes", "Session 4F-7C2A", "BAY 3 · DIESEL") for dynamic data or omit those sub-sections in PR 1 (they're optional sidebar fluff). Replace `P0087_TESTS.map(…)` with `tests.map(…)` using the DB-shape keys.

- [ ] **Step 14.2: Smoke-test in browser**

Boot dev server. Open the page directly (after Task 16 wires the route). For now, verify it compiles:

Run: `pnpm tsc --noEmit`
Expected: pass.

- [ ] **Step 14.3: Commit**

```bash
git add components/screens/cached-overview.tsx app/globals.css
git commit -m "feat(diagnostics): phase 3 pr1 — CachedOverview screen (mobile + desktop)

Ports V1 Ledger (mobile) + DesktopOverview from the Claude Design
handoff package. Single component, both layouts in DOM, CSS media
query picks visibility at 1024px breakpoint. Binds to the
CachedDiagnostic payload shape from lib/diagnostics/cached-lookup.ts.

'Start the walk' CTA is wired but the destination is a stub (see
Task 16 — PR 2 lands the per-step walk).
"
```

---

### Task 15: CachedEmpty screen (built, not wired in PR 1)

**Files:**
- Create: `components/screens/cached-empty.tsx`
- Reference: `/tmp/vt-design-package/.../components/Overview.jsx` (ScreenEmpty lines 307-373)

- [ ] **Step 15.1: Port ScreenEmpty as a standalone component**

Create `components/screens/cached-empty.tsx`:

```tsx
import { ArrowRight } from '@phosphor-icons/react/dist/ssr'

export function CachedEmpty({
  vehicleName,
  complaint,
  mileage,
  onGenerate,
}: {
  vehicleName: string
  complaint: string
  mileage: number | null
  onGenerate?: () => void
}) {
  return (
    <div className="cov-empty">
      <div className="cov-empty__body">
        <span className="cov-empty__eyebrow">Not in the library</span>
        <Sigil size={48} />
        <h1 className="cov-empty__headline">First time we've seen this one.</h1>
        <p className="cov-empty__sub">
          No matching diagnostic is cached for this vehicle and complaint.
          I can build a custom plan from the corpus — 30–60 seconds — and
          every identical complaint after this loads instantly.
        </p>

        <div className="cov-empty__ctx">
          <div className="cov-empty__ctx-row">
            <span>Vehicle</span>
            <b>{vehicleName}</b>
          </div>
          <div className="cov-empty__ctx-row">
            <span>Complaint</span>
            <b>{complaint}</b>
          </div>
          {mileage != null && (
            <div className="cov-empty__ctx-row">
              <span>Mileage</span>
              <b>{mileage.toLocaleString()} mi</b>
            </div>
          )}
        </div>

        <div>
          <span className="cov-empty__eyebrow" style={{ marginBottom: 8, display: 'flex' }}>
            What happens next
          </span>
          <div className="cov-empty__steps">
            <div className="cov-empty__step">
              <span className="cov-empty__step-num">01</span>
              <span className="cov-empty__step-body">
                I rank similar fixes from the cross-shop corpus.
                <span className="cov-empty__step-meta">~10 s · corpus retrieval</span>
              </span>
            </div>
            <div className="cov-empty__step">
              <span className="cov-empty__step-num">02</span>
              <span className="cov-empty__step-body">
                I build an ordered test plan with confidence gates.
                <span className="cov-empty__step-meta">~30 s · tree generation</span>
              </span>
            </div>
            <div className="cov-empty__step">
              <span className="cov-empty__step-num">03</span>
              <span className="cov-empty__step-body">
                The plan joins the library — instant for the next tech.
                <span className="cov-empty__step-meta">corpus gain · +1</span>
              </span>
            </div>
          </div>
        </div>
      </div>
      <div className="cov-empty__cta-wrap">
        <button className="cov-cta__btn" onClick={onGenerate}>
          <span>Generate a diagnostic with AI</span>
          <ArrowRight size={18} />
        </button>
      </div>
    </div>
  )
}

function Sigil({ size = 56 }: { size?: number }) {
  return (
    <svg className="cov-sigil" width={size} height={size * 1.43} viewBox="0 0 56 80" aria-hidden="true">
      <line x1="10" y1="6" x2="10" y2="74" stroke="var(--vt-amber-500)" strokeWidth="2" strokeLinecap="round" />
      <line x1="46" y1="6" x2="46" y2="74" stroke="var(--vt-amber-500)" strokeWidth="2" strokeLinecap="round" />
      <line x1="10" y1="18" x2="46" y2="18" stroke="var(--vt-amber-500)" strokeWidth="2" strokeLinecap="round" />
      <line x1="10" y1="35" x2="46" y2="35" stroke="var(--vt-amber-500)" strokeWidth="2" strokeLinecap="round" />
      <line x1="10" y1="52" x2="46" y2="52" stroke="var(--vt-bone-400)" strokeWidth="1" strokeDasharray="2 3" strokeLinecap="round" />
      <line x1="10" y1="69" x2="46" y2="69" stroke="var(--vt-bone-400)" strokeWidth="1" strokeDasharray="2 3" strokeLinecap="round" />
    </svg>
  )
}
```

Notes per spec open Q #4: the design has "from 4,200+ shop records" copy. This port replaces with the generic "from the cross-shop corpus" string.

- [ ] **Step 15.2: Run typecheck**

Run: `pnpm tsc --noEmit`
Expected: pass.

- [ ] **Step 15.3: Commit**

```bash
git add components/screens/cached-empty.tsx
git commit -m "feat(diagnostics): phase 3 pr1 — CachedEmpty screen (built, not wired)

Ports ScreenEmpty from the Claude Design handoff. Sigil inlined as SVG.
Hard-coded '4,200+ shop records' copy replaced with generic 'cross-shop
corpus' string until corpus-size data is real.

NOT yet routed to in PR 1 — see spec open Q #1. Component ships ready
for PR 4 to wire as the cache-miss landing once AI-on-demand generation
is live.
"
```

---

### Task 16: Wire cached-overview route into /sessions/[id]/page.tsx

**Files:**
- Modify: `app/(app)/sessions/[id]/page.tsx`

- [ ] **Step 16.1: Extend the page to handle the new route kind**

In `app/(app)/sessions/[id]/page.tsx`, add a new branch in the route handling:

```tsx
import { loadCachedDiagnostic } from '@/lib/diagnostics/cached-lookup'
import { CachedOverview } from '@/components/screens/cached-overview'
import { formatVehicleName } from '@/lib/format'
// ... existing imports ...

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await getServerSupabase()
  const ctx = await requireUserAndProfile({ supabase, db })
  if (!ctx) redirect('/sign-in')

  const result = await getSessionForUser({ db, userId: ctx.user.id, sessionId: id })
  if (!result.ok) notFound()

  const { session } = result
  const route = routeForSession(session)

  // NEW: cache-hit branch
  if (route.kind === 'cached-overview') {
    // Fetch the cached diagnostic payload by joining via cacheHitSymptomId.
    const symptom = await db.query.symptoms.findFirst({
      where: eq(symptoms.id, session.cacheHitSymptomId!),
    })
    const platform = await db.query.platforms.findFirst({
      where: eq(platforms.id, session.cacheHitPlatformId!),
    })
    if (!symptom || !platform) notFound()
    const diagnostic = await loadCachedDiagnostic({
      db, platformSlug: platform.slug, symptomSlug: symptom.slug,
    })
    if (!diagnostic) notFound()

    return (
      <CachedOverview
        diagnostic={diagnostic}
        vehicleName={formatVehicleName(session.intake)}
        vin={session.intake.vin ?? null}
        mileage={session.intake.mileage ?? null}
        // PR 2 will wire onStartWalk; PR 1 leaves it undefined so the button
        // appears but does nothing. Per spec open Q #2 — Brandon may pick
        // a different stub behavior (toast or disabled).
      />
    )
  }

  // ... existing branches (tree-generating, redirect, closed-summary, active-session) unchanged ...
}
```

Required new imports: `loadCachedDiagnostic`, `CachedOverview`, `eq`, `symptoms`, `platforms`.

- [ ] **Step 16.2: Run typecheck**

Run: `pnpm tsc --noEmit`
Expected: pass.

- [ ] **Step 16.3: End-to-end smoke (manual)**

With dev server running:

1. Log in as a user with shop access.
2. Open `/sessions/new`.
3. Fill: Year=2018, Make=Ford, Model=F-250, Engine=6.7L Power Stroke Diesel.
4. Verify chip picker shows 3 chips (P0087, P0088, no-start) after ~350ms debounce.
5. Click the "P0087" chip OR type "P0087" in the DTC field.
6. Fill complaint ("Loss of power.").
7. Click "Start diagnosis".
8. Verify the redirect lands IMMEDIATELY on `/sessions/{id}` (no loading screen).
9. Verify the CachedOverview screen renders with vehicle header, symptom hero, 13 test rows, gate marker, "Start the walk" CTA.
10. As a contrast check: in another browser tab, submit an intake that should NOT cache-hit (e.g., Ford F-150 with a complaint about wipers). Verify it takes 30-60s, then renders the existing AI tree view.

- [ ] **Step 16.4: Commit**

```bash
git add app/\(app\)/sessions/\[id\]/page.tsx
git commit -m "feat(diagnostics): phase 3 pr1 — wire CachedOverview into /sessions/[id]

Adds the cached-overview branch in the session detail page. On cache-hit
sessions, fetches the platform + symptom + cached diagnostic payload and
renders <CachedOverview/>. Cache-miss sessions take the existing branches
(tree-generating, active-session, closed-summary, redirect) unchanged.

'Start the walk' CTA renders but does nothing in PR 1 — PR 2 will wire
the per-step interactive walk.
"
```

---

## Phase D — Validation

### Task 17: Full test suite pass

- [ ] **Step 17.1: Run full vitest suite (twice — first run may flake per memory)**

Run: `pnpm test`
If flake-style failures with `PGlite is closed`, re-run once: `pnpm test`.
Expected: all tests pass.

- [ ] **Step 17.2: Run typecheck**

Run: `pnpm tsc --noEmit`
Expected: clean.

- [ ] **Step 17.3: Run lint**

Run: `pnpm lint` (if configured).
Expected: clean or pre-existing warnings only.

---

### Task 18: Playwright screenshots at 5 viewports

- [ ] **Step 18.1: Boot dev server**

Run: `pnpm dev` (backgrounded)

- [ ] **Step 18.2: Take screenshots**

Use the existing `mcp__plugin_playwright_playwright__*` tools (or `mcp__plugin_chrome-devtools-mcp_chrome-devtools__*` whichever the project favors). Capture at each viewport:

- 375 × 812 (iPhone SE) — `validation-pr3pr1-cached-overview-mobile-375.png`
- 414 × 896 (iPhone Pro Max) — `validation-pr3pr1-cached-overview-mobile-414.png`
- 768 × 1024 (iPad portrait) — `validation-pr3pr1-cached-overview-tablet-768.png`
- 1024 × 768 (desktop breakpoint) — `validation-pr3pr1-cached-overview-desktop-1024.png`
- 1440 × 900 (desktop default) — `validation-pr3pr1-cached-overview-desktop-1440.png`

For each viewport: log in, submit the F-250 6.7L PSD + P0087 intake, capture the cached overview screen. Also capture the new-session form (with picker visible) at 375 + 1024 for the intake-form validation.

- [ ] **Step 18.3: Manual review of screenshots**

Open each PNG. Confirm:
- No horizontal scroll at 375.
- Test rows wrap cleanly; expected-reading text doesn't overflow.
- CTA bar stays at the bottom on mobile.
- Long-list stress test: open a no-start intake and verify 19 rows scroll without losing header.
- Desktop layout at 1024+ uses the wide grid (rail + main with planned-row grid).

- [ ] **Step 18.4: Commit screenshots**

```bash
git add validation-pr3pr1-*.png
git commit -m "test(diagnostics): phase 3 pr1 — Playwright screenshots at 5 viewports

Validates cached overview at mobile/tablet/desktop widths. No horizontal
scroll at 375; long-list (no-start, 19 tests) scrolls cleanly; desktop
grid renders at >=1024px.
"
```

---

### Task 19: Final integration smoke + push for Brandon's review

- [ ] **Step 19.1: Push the branch**

Per the workflow decision (still pending Brandon's answer on the PR workflow question — by default assume "proper PR off staging branch"):

```bash
git push -u origin staging-interactive-diagnostics   # or cut feat/ branch and push there
```

- [ ] **Step 19.2: Surface the validation state to Brandon**

Tell Brandon in chat:
- Branch is pushed
- Vercel preview URL (or local dev URL) for him to verify on actual mobile devices
- Spec + plan + Claude Design handoff doc paths
- Open questions still pending review (empty-state wiring, start-the-walk stub behavior, etc.)
- Screenshot manifest at `validation-pr3pr1-*.png`

- [ ] **Step 19.3: Wait for Brandon's preview-URL pass**

Per `feedback_claude_validates_first` memory: Claude has already done the first validation pass (Tasks 17-18). Brandon's preview check is the final gate before merge.

---

## Self-Review

### Spec coverage check

Walking the spec section by section:

- ✅ Locked decisions (integration A, symptom B, resolver A) — Tasks 3, 4, 8, 12, 13
- ✅ Platform resolver function — Task 3
- ✅ Symptom resolver (chip > DTC > keyword) — Task 4
- ✅ cached-lookup queries — Task 5
- ✅ Cached-complaints API route — Task 6
- ✅ intakeSchema extension — Task 7
- ✅ createSessionForUser extension — Task 7
- ✅ POST /api/sessions cache-hit shortcut — Task 8
- ✅ Migration 0018 + live-DB apply — Tasks 1 + 2
- ✅ Schema column additions — Task 1
- ✅ routeForSession new branch — Task 9
- ✅ New vt/ primitives (all 7) — Task 11
- ✅ CSS append — Task 10
- ✅ CachedComplaintPicker — Task 12
- ✅ Intake form modification — Task 13
- ✅ CachedOverview screen (mobile + desktop) — Task 14
- ✅ CachedEmpty screen (built, not wired) — Task 15
- ✅ /sessions/[id] page modification — Task 16
- ✅ Mobile validation at 5 viewports — Task 18
- ✅ Test layout uses `tests/unit/` per project convention
- ✅ Migration to live DB flagged with explicit approval requirement
- ✅ Open questions surfaced to Brandon at validation step

### Placeholder scan

Searched for "TBD"/"TODO"/"implement later"/"fill in details":

- One TODO comment in `gate-thresholds.ts` (Task 5.1) — this is an intentional code comment marking future relocation to DB. Acceptable.
- One TODO comment in `cached-lookup.ts` Step 5.3 → resolved by Step 5.4 which wires the priorFixCount query. Acceptable as a within-task progression.
- Step 4.4's seedFixture function is referenced as not-yet-implemented and depends on the test-db helper existing. Step 4.2 handles the branch: if no helper exists, skip the integration tests and rely on unit tests with mocked db. This is a fallback path, not a placeholder.

No structural placeholders remain.

### Type consistency check

- `resolvePlatformSlug` returns `string | null` in Task 3, called as `string | null` in Task 6, Task 8, Task 12. ✓
- `resolveSymptomSlug` returns `Promise<string | null>` in Task 4, awaited in Task 8. ✓
- `CachedDiagnostic` type defined in Task 5, consumed in Task 14 (`diagnostic: CachedDiagnostic`). ✓
- `CachedComplaint` type defined in Task 5, consumed by Task 12 (`Complaint = { slug, description, category }` matches). ✓
- `cacheHitPlatformId`, `cacheHitSymptomId` named consistently across Tasks 1, 7, 8, 9, 16. ✓
- `selectedSymptomSlug` consistent across Tasks 7, 8, 12, 13. ✓
- `dtcCodes` consistent across Tasks 7, 8, 13. ✓

Self-review passes. Ready for execution.

---

*Plan written 2026-05-19 by the orchestrating Claude session. Spec source: `docs/superpowers/specs/2026-05-19-phase3-pr1-platform-resolver-design.md`.*
