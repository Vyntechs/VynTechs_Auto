# Phase P — Curator Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a role-gated curator console at `/curator/*` with 5 surfaces (drift queue, calibration dashboard, deferred queue, novel-pattern queue, corpus authoring) so Brandon can review weekly calibration recommendations, author corpus entries from novel cases, and resolve sessions techs deferred to him.

**Architecture:** New routes under `apps/diagnostic/app/curator/`. New `apps/diagnostic/middleware.ts` (the diagnostic app's first middleware) gates `/curator/*` to users with `profiles.role = 'curator'`. Pure handlers in `apps/diagnostic/lib/curator/` take `db: AppDb` and return discriminated unions, kept thin route shims around them per AGENTS.md handler-in-`lib`/ pattern. One Drizzle migration (`0011_drift_alerts_lifecycle.sql`) adds 4 lifecycle columns to `drift_alerts` and creates a new `novel_pattern_queue` table. UI uses the `vt/` design system from `@repo/ui`.

**Tech Stack:** Next.js 16 (App Router, server components), Drizzle ORM (Postgres + pglite for tests), Supabase Auth, Vitest (with PGlite for handler tests), `@repo/ui` design primitives.

**Spec source:** `docs/superpowers/specs/2026-05-06-phase-p-curator-design.md` (read before starting any task).

---

## Phase P — Pre-implementation plan corrections (applied 2026-05-06)

This plan was authored by the migration session, which lives in the post-monorepo headspace. Every path below assumes monorepo (`apps/diagnostic/`, `packages/db/`, `@repo/db`, `@repo/ui`, `@repo/auth`). The diagnostic worktree on `main` (where Phase P ships per the handoff and rescue doc) is still **single-app**. Translate as you implement. The plan structure, schema design, TDD cases, and task ordering are all good — only paths and a few imports drift.

**Authoritative branch:** `feature/phase-p-curator` off `main` at `5d7065b`. Phase P merges to `main` first; Stage 2 monorepo migration ships on its own track.

### Path translation table

| Plan reference | Actual path on `main` (single-app) |
|---|---|
| `apps/diagnostic/middleware.ts` | `middleware.ts` (project root) |
| `apps/diagnostic/lib/curator/*` | `lib/curator/*` |
| `apps/diagnostic/lib/sessions.ts` | `lib/sessions.ts` |
| `apps/diagnostic/app/curator/*` | `app/curator/*` |
| `apps/diagnostic/app/api/curator/*` | `app/api/curator/*` |
| `apps/diagnostic/components/vt/index.ts` | `components/vt/index.ts` |
| `apps/diagnostic/tests/unit/*` | `tests/unit/*` |
| `apps/diagnostic/tests/helpers/db` | `tests/helpers/db` |
| `packages/db/migrations/0011_drift_alerts_lifecycle.sql` | `drizzle/migrations/0011_drift_alerts_lifecycle.sql` |
| `packages/db/migrations/meta/` | `drizzle/migrations/meta/` |
| `packages/db/src/schema/index.ts` | `lib/db/schema.ts` |
| `packages/db/src/client.ts` | `lib/db/client.ts` |
| `import { ... } from '@repo/db/schema'` | `import { ... } from '@/lib/db/schema'` (or relative) |
| `import { ... } from '@repo/db/client'` | `import { ... } from '@/lib/db/client'` |
| `import { ... } from '@repo/ui'` | `import { ... } from '@/components/vt'` (or specific component path) |
| `pnpm --filter diagnostic test` | `pnpm test` |
| `pnpm --filter diagnostic typecheck` | `pnpm exec tsc --noEmit` |
| `pnpm --filter diagnostic build` | `pnpm build` |
| `pnpm --filter diagnostic test <name>` | `pnpm test <name>` |

### Middleware import does not translate cleanly

The plan's Task 2 Step 5 imports `refreshSession` from `@repo/auth/middleware`. This module **does not exist on main** — the diagnostic app has no middleware at all today (verified: `ls middleware.ts` returns "No such file or directory"; auth files are `lib/auth.ts`, `lib/auth-redirects.ts`, `lib/supabase-client.ts`, `lib/supabase-server.ts`).

Single-app translation for Task 2 Step 5: write a small `refreshSession` helper inline in `middleware.ts` (or a new `lib/supabase-middleware.ts`) using the `@supabase/ssr` `createServerClient` middleware pattern. The same pattern `lib/supabase-server.ts` uses, but adapted to read/write cookies on a `NextRequest`/`NextResponse` pair instead of `next/headers`. Reference: Supabase's `@supabase/ssr` middleware example. Keep it ~25 lines; this is not load-bearing logic.

### Drizzle migration workflow (per AGENTS.md)

The plan's Task 1 Step 3 says `cd packages/db && pnpm drizzle-kit generate`. On single-app, run `pnpm drizzle-kit generate` from the repo root.

Task 1 Step 5 says apply the migration via MCP `apply_migration`. Keep that — it's correct per AGENTS.md regardless of monorepo state. **Do not** use `pnpm drizzle-kit migrate` against live Supabase.

### Existing schema sanity-check (Task 1 prerequisite)

Verified 2026-05-06 against `lib/db/schema.ts` line 307 — `driftAlerts` columns on main match what the plan's lifecycle migration adds onto: `id, riskClass, vehicleFamily, symptomClass, oldThreshold, newThreshold, comebackRate, sampleSize, createdAt`. The plan's 4 lifecycle columns slot in cleanly. The `profiles` table already has a `role text DEFAULT 'tech' NOT NULL` column (line 25-32) — no migration needed for the curator role itself; just grant via SQL once Brandon's profile UUID is known (Task 18).

Task 12 + 13's "verify column names" markers still apply — those reference `confidence_calibration` columns the plan-author wasn't 100% sure on. Those tasks' executor should re-check `lib/db/schema.ts` for the `confidenceCalibration` table before writing queries.

### UI test coverage decision (Brandon, 2026-05-06)

**Option (b) — extend smoke suite with authed `/curator/*` routes.** ~2 hours of plan additions absorbed into Task 18.

Implementation note for Task 18 executor: extend `tests/e2e/landing.spec.ts` pattern (Playwright). Add `tests/e2e/curator.spec.ts` covering each of the 9 read-only screens (drift queue, drill-down, calibration dashboard, per-category history, deferred queue, novel-pattern queue, corpus list, full case detail, console layout). Each test should sign in as the curator-role test user, navigate to the route, and assert the heading/key element renders without error. Shape the auth setup as Playwright `storageState` per the existing pattern, or grant role via SQL fixture in a `beforeAll`. **Not** add `@testing-library/react` (option a was rejected) — the smoke level catches "page broke" without the heavier component-test machinery.

### Plan structure intact

Everything else — task ordering, TDD cycles, schema design, RLS policy, decision flow, the 19 mutation-path test cases, the trigger logic at `closeSession` — applies as-written. Only paths and the one middleware import need translation.

---

## Scope check and decomposition

This plan covers **one subsystem** — the curator console. It is consumed only by Brandon (sole curator at MVP). All 18 tasks below produce a working, testable system on their own when implemented in order.

The plan is intentionally sequential. A few task pairs could be parallelized (e.g., Tasks 11 + 13 are independent), but the dependency graph is shallow — running them in order is simplest. If a future executor wants to parallelize, the dependency notes inside each task make safe parallelism obvious.

---

## File structure

**Files created (16):**
- `packages/db/migrations/0011_drift_alerts_lifecycle.sql` — schema migration
- `apps/diagnostic/middleware.ts` — role-gate (NEW; the diagnostic app has no middleware today)
- `apps/diagnostic/lib/curator/role-gate.ts` — pure middleware helper
- `apps/diagnostic/lib/curator/queries.ts` — list queries for drift queue, calibration dashboard, deferred queue, novel-pattern queue, per-category history
- `apps/diagnostic/lib/curator/drift-resolution.ts` — Apply / Dismiss / bulk-dismiss handlers
- `apps/diagnostic/lib/curator/deferred-actions.ts` — Approve / Override / Close handlers
- `apps/diagnostic/lib/curator/novel-actions.ts` — Dismiss novel-pattern queue handler
- `apps/diagnostic/lib/curator/corpus-actions.ts` — Curator-authored corpus insert handler
- `apps/diagnostic/lib/curator/novel-trigger.ts` — at-closeSession enqueue helper
- `apps/diagnostic/app/curator/layout.tsx` — sidebar + role-check defense-in-depth
- `apps/diagnostic/app/curator/drift/page.tsx` — Screen 1
- `apps/diagnostic/app/curator/drift/[id]/page.tsx` — Screen 2
- `apps/diagnostic/app/curator/cases/[sessionId]/page.tsx` — Screen 3 (shared)
- `apps/diagnostic/app/curator/calibration/page.tsx` — Screen 4
- `apps/diagnostic/app/curator/calibration/[risk]/[vehicle]/[symptom]/page.tsx` — Screen 5
- `apps/diagnostic/app/curator/deferred/page.tsx` — Screen 6
- `apps/diagnostic/app/curator/novel/page.tsx` — Screen 7
- `apps/diagnostic/app/curator/corpus/new/page.tsx` — Screen 8
- `apps/diagnostic/app/curator/corpus/page.tsx` — Screen 9
- `apps/diagnostic/app/api/curator/drift/[id]/apply/route.ts`
- `apps/diagnostic/app/api/curator/drift/[id]/dismiss/route.ts`
- `apps/diagnostic/app/api/curator/drift/bulk-dismiss/route.ts`
- `apps/diagnostic/app/api/curator/sessions/[id]/approve/route.ts`
- `apps/diagnostic/app/api/curator/sessions/[id]/override/route.ts`
- `apps/diagnostic/app/api/curator/sessions/[id]/close/route.ts`
- `apps/diagnostic/app/api/curator/novel/[id]/dismiss/route.ts`
- `apps/diagnostic/app/api/curator/corpus/route.ts`
- 6 test files under `apps/diagnostic/tests/unit/`

**Files modified (3):**
- `packages/db/src/schema/index.ts` — add lifecycle columns to `driftAlerts`, add `novelPatternQueue` table
- `apps/diagnostic/lib/sessions.ts` — call `enqueueIfNovelPattern` from `closeSession`
- `apps/diagnostic/components/vt/index.ts` (or `packages/ui/src/index.ts`) — export 1-2 new vt components if needed (e.g., `Sidebar`, `KeyValueRow`)

---

## Pre-flight

Before Task 1, the executor should:

- [ ] **Step 1: Switch to the diagnostic worktree (main repo).** Phase P branches off `main`, not the migration stack.

```bash
cd /Volumes/Creativity/dev/projects/vyntechs
git status  # expect clean except untracked rescue+spec docs
git checkout main
git pull origin main
git checkout -b feature/phase-p-curator
```

- [ ] **Step 2: Verify baseline still green.**

```bash
pnpm install
pnpm test 2>&1 | tail -5  # expect 398/398 (rerun if cold-cache flake)
pnpm exec tsc --noEmit  # expect clean
pnpm build 2>&1 | tail -5  # expect clean, 33 routes
```

- [ ] **Step 3: Commit the rescue + spec docs to the feature branch.**

These were written by the migration session ahead of this work and are currently untracked on main.

```bash
git add docs/superpowers/sessions/2026-05-06-phase-p-brainstorm-rescue.md
git add docs/superpowers/specs/2026-05-06-phase-p-curator-design.md
git add docs/superpowers/plans/2026-05-06-phase-p-curator-implementation.md
git commit -m "docs(phase-p): brainstorm rescue, spec, implementation plan"
```

---

## Task 1: Migration `0011_drift_alerts_lifecycle.sql` + Drizzle schema mirrors

**Files:**
- Create: `packages/db/migrations/0011_drift_alerts_lifecycle.sql`
- Modify: `packages/db/src/schema/index.ts` (add 4 columns to `driftAlerts`, add `novelPatternQueue` table)

- [ ] **Step 1: Write the SQL migration.**

```sql
-- packages/db/migrations/0011_drift_alerts_lifecycle.sql
--
-- Phase P — drift_alerts lifecycle fields + novel_pattern_queue table.
-- Lets the curator mark recommendations as 'applied' or 'dismissed' with
-- audit-trail fields, and surfaces sessions where retrieval found no
-- corpus matches above the similarity floor.

ALTER TABLE drift_alerts
  ADD COLUMN decision text CHECK (decision IN ('applied','dismissed')),
  ADD COLUMN decided_at timestamp with time zone,
  ADD COLUMN decided_by_user_id uuid REFERENCES profiles(id),
  ADD COLUMN decision_note text;

CREATE INDEX drift_alerts_pending_idx ON drift_alerts (created_at DESC)
  WHERE decision IS NULL;

CREATE TABLE novel_pattern_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  max_retrieval_similarity real NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  reviewed_at timestamp with time zone,
  reviewed_decision text CHECK (reviewed_decision IN ('corpus','dismissed')),
  reviewed_by_user_id uuid REFERENCES profiles(id),
  reviewed_note text
);

CREATE INDEX novel_pattern_queue_pending_idx ON novel_pattern_queue (created_at DESC)
  WHERE reviewed_at IS NULL;

ALTER TABLE novel_pattern_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "novel_pattern_queue_curator_only" ON novel_pattern_queue
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.user_id = auth.uid()
      AND profiles.role = 'curator'
    )
  );
```

- [ ] **Step 2: Update Drizzle schema.**

Edit `packages/db/src/schema/index.ts`. Add to existing `driftAlerts` table definition:

```ts
export const driftAlerts = pgTable('drift_alerts', {
  // ... existing columns from 0010 ...
  // Phase P lifecycle:
  decision: text('decision', { enum: ['applied', 'dismissed'] }),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  decidedByUserId: uuid('decided_by_user_id').references(() => profiles.id),
  decisionNote: text('decision_note'),
}, (t) => ({
  pendingIdx: index('drift_alerts_pending_idx').on(t.createdAt.desc()).where(sql`decision IS NULL`),
}))
```

Append new `novelPatternQueue` table at end of the table-definition block:

```ts
export const novelPatternQueue = pgTable('novel_pattern_queue', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  maxRetrievalSimilarity: real('max_retrieval_similarity').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  reviewedDecision: text('reviewed_decision', { enum: ['corpus', 'dismissed'] }),
  reviewedByUserId: uuid('reviewed_by_user_id').references(() => profiles.id),
  reviewedNote: text('reviewed_note'),
}, (t) => ({
  pendingIdx: index('novel_pattern_queue_pending_idx').on(t.createdAt.desc()).where(sql`reviewed_at IS NULL`),
}))

export type NovelPatternQueueRow = typeof novelPatternQueue.$inferSelect
export type NewNovelPatternQueueRow = typeof novelPatternQueue.$inferInsert
```

Make sure `sql`, `index` are imported from `drizzle-orm` and `drizzle-orm/pg-core` respectively if not already.

- [ ] **Step 3: Regenerate Drizzle metadata snapshot.**

```bash
cd packages/db
pnpm drizzle-kit generate  # updates meta/_journal.json + .meta/0011_*.json
```

Confirm: a new entry appears in `packages/db/migrations/meta/_journal.json` and a `0011_*.json` snapshot file exists in `meta/`.

- [ ] **Step 4: Verify pglite tests pick up the schema change.**

```bash
pnpm --filter diagnostic test 2>&1 | tail -5
```

Expected: still 398/398 (the migration is additive; existing tests don't reference the new fields).

- [ ] **Step 5: Apply the migration to live Supabase via MCP `apply_migration`.**

This is a **prod write**. Confirm with the user before applying. Pass migration name `add_drift_alerts_lifecycle_and_novel_pattern_queue` and the SQL from Step 1.

After applying, verify via MCP `list_migrations` that the new entry appears and via `execute_sql`:

```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'drift_alerts' AND column_name LIKE 'decision%' OR column_name LIKE 'decided%';
-- expect 4 rows

SELECT count(*) FROM novel_pattern_queue;
-- expect 0 (just created)
```

- [ ] **Step 6: Run advisor lint.**

```
MCP get_advisors with type='security'
```

Expected: no new warnings related to the changes (the RLS policy on novel_pattern_queue is in place; the partial indexes are non-issues).

- [ ] **Step 7: Commit.**

```bash
git add packages/db/migrations/0011_drift_alerts_lifecycle.sql
git add packages/db/migrations/meta/
git add packages/db/src/schema/index.ts
git commit -m "feat(db): drift_alerts lifecycle + novel_pattern_queue table

Phase P migration 0011. Adds 4 lifecycle columns (decision, decided_at,
decided_by_user_id, decision_note) and a partial-index on the pending-only
hot path. Creates novel_pattern_queue table with RLS curator-only policy.

Refs docs/superpowers/specs/2026-05-06-phase-p-curator-design.md"
```

---

## Task 2: Curator role-gate (TDD, 4 cases) + middleware

**Files:**
- Create: `apps/diagnostic/lib/curator/role-gate.ts`
- Create: `apps/diagnostic/tests/unit/curator-role-gate.test.ts`
- Create: `apps/diagnostic/middleware.ts` (NEW — diagnostic has no middleware today)

The role-gate is the only middleware behavior at MVP. Stage 3 (entitlements) will extend this file later; design the role-gate as one focused exported function that the middleware composes.

- [ ] **Step 1: Write the failing tests.**

```ts
// apps/diagnostic/tests/unit/curator-role-gate.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { profiles, shops } from '@repo/db/schema'
import { createTestDb, type TestDb } from '../helpers/db'
import { guardCuratorRoute } from '../../lib/curator/role-gate'

const SHOP = '00000000-0000-0000-0000-000000000001'
const CURATOR_USER = 'auth-user-curator'
const CURATOR_PROFILE = '00000000-0000-0000-0000-000000000010'
const TECH_USER = 'auth-user-tech'
const TECH_PROFILE = '00000000-0000-0000-0000-000000000011'

describe('guardCuratorRoute', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
    await db.insert(shops).values({ id: SHOP, name: 'Test Shop' })
    await db.insert(profiles).values([
      { id: CURATOR_PROFILE, userId: CURATOR_USER, shopId: SHOP, role: 'curator' },
      { id: TECH_PROFILE, userId: TECH_USER, shopId: SHOP, role: 'tech' },
    ])
  })
  afterEach(async () => { await close() })

  it('allows non-curator routes without checking role', async () => {
    const result = await guardCuratorRoute(db, TECH_USER, '/today')
    expect(result).toEqual({ kind: 'allow' })
  })

  it('redirects unauthed user on /curator path to /sign-in', async () => {
    const result = await guardCuratorRoute(db, null, '/curator/drift')
    expect(result).toEqual({ kind: 'redirect', to: '/sign-in' })
  })

  it('redirects authed non-curator on /curator path to /', async () => {
    const result = await guardCuratorRoute(db, TECH_USER, '/curator/drift')
    expect(result).toEqual({ kind: 'redirect', to: '/' })
  })

  it('allows authed curator on /curator path', async () => {
    const result = await guardCuratorRoute(db, CURATOR_USER, '/curator/drift')
    expect(result).toEqual({ kind: 'allow' })
  })
})
```

- [ ] **Step 2: Run tests, confirm they fail.**

```bash
pnpm --filter diagnostic test curator-role-gate 2>&1 | tail -10
```

Expected: FAIL with "guardCuratorRoute is not exported" or similar.

- [ ] **Step 3: Implement the role-gate helper.**

```ts
// apps/diagnostic/lib/curator/role-gate.ts
import { eq } from 'drizzle-orm'
import type { AppDb } from '@repo/db/client'
import { profiles } from '@repo/db/schema'

export type GuardResult =
  | { kind: 'allow' }
  | { kind: 'redirect'; to: string }

/**
 * Pure decision function for curator route authorization. Used by the
 * diagnostic app's middleware via a thin shim that resolves the
 * NextRequest into (userId, path) and converts GuardResult into a
 * NextResponse.
 *
 * Non-/curator paths are always allowed (this helper is a no-op there).
 * Unauthed users on /curator paths → /sign-in.
 * Authed non-curator users on /curator paths → /.
 * Authed curator users on /curator paths → allow.
 */
export async function guardCuratorRoute(
  db: AppDb,
  userId: string | null,
  path: string,
): Promise<GuardResult> {
  if (!path.startsWith('/curator')) return { kind: 'allow' }
  if (!userId) return { kind: 'redirect', to: '/sign-in' }

  const [profile] = await db
    .select({ role: profiles.role })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1)

  if (profile?.role !== 'curator') return { kind: 'redirect', to: '/' }
  return { kind: 'allow' }
}
```

- [ ] **Step 4: Run tests, confirm they pass.**

```bash
pnpm --filter diagnostic test curator-role-gate 2>&1 | tail -10
```

Expected: 4/4 passing.

- [ ] **Step 5: Create the middleware file.**

```ts
// apps/diagnostic/middleware.ts
import { type NextRequest, NextResponse } from 'next/server'
import { refreshSession } from '@repo/auth/middleware'
import { db } from '@repo/db/client'
import { guardCuratorRoute } from './lib/curator/role-gate'

export async function middleware(req: NextRequest) {
  const { res, supabase } = await refreshSession(req)

  // Curator role-gate (Phase P). Stage 3 will add an entitlement gate here too.
  if (req.nextUrl.pathname.startsWith('/curator')) {
    const { data: { user } } = await supabase.auth.getUser()
    const result = await guardCuratorRoute(db, user?.id ?? null, req.nextUrl.pathname)
    if (result.kind === 'redirect') {
      return NextResponse.redirect(new URL(result.to, req.url))
    }
  }

  return res
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
```

If `@repo/auth` does not export a `middleware` subpath module yet, check `packages/auth/src/index.ts` and `packages/auth/package.json` exports — `refreshSession` may be at `@repo/auth/server` or similar. Adjust import to match the existing export.

- [ ] **Step 6: Run typecheck + build.**

```bash
pnpm --filter diagnostic typecheck
pnpm --filter diagnostic build 2>&1 | tail -5
```

Expected: clean. The build should now show middleware compiled (look for `ƒ Middleware` in the route output).

- [ ] **Step 7: Commit.**

```bash
git add apps/diagnostic/lib/curator/role-gate.ts
git add apps/diagnostic/tests/unit/curator-role-gate.test.ts
git add apps/diagnostic/middleware.ts
git commit -m "feat(curator): role-gate middleware for /curator/* routes

Phase P task 1. Pure guardCuratorRoute helper with 4 TDD cases (non-curator
path passes through; unauthed → /sign-in; non-curator → /; curator → allow).
First middleware in the diagnostic app — designed to be extended by Stage 3's
entitlement gate."
```

---

## Task 3: Curator console layout (Screen 10)

**Files:**
- Create: `apps/diagnostic/app/curator/layout.tsx`
- Create: `apps/diagnostic/components/curator/sidebar.tsx`
- Create: `apps/diagnostic/components/curator/desktop-only-fallback.tsx`

- [ ] **Step 1: Write the layout.**

```tsx
// apps/diagnostic/app/curator/layout.tsx
import { redirect } from 'next/navigation'
import { createClient } from '@repo/auth/server'
import { db } from '@repo/db/client'
import { eq } from 'drizzle-orm'
import { profiles } from '@repo/db/schema'
import { CuratorSidebar } from '../../components/curator/sidebar'
import { DesktopOnlyFallback } from '../../components/curator/desktop-only-fallback'
import '@repo/ui/vt.css'

export const metadata = { title: 'Vyntechs Curator' }

export default async function CuratorLayout({
  children,
}: { children: React.ReactNode }) {
  // Defense-in-depth: middleware already gated this, but layout double-checks
  // so a misconfigured middleware can't expose curator data.
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')
  const [profile] = await db
    .select({ id: profiles.id, role: profiles.role })
    .from(profiles)
    .where(eq(profiles.userId, user.id))
    .limit(1)
  if (profile?.role !== 'curator') redirect('/')

  return (
    <div className="vt-curator-shell">
      <DesktopOnlyFallback />
      <div className="vt-curator-grid">
        <CuratorSidebar />
        <main className="vt-curator-main">{children}</main>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Write the sidebar.**

```tsx
// apps/diagnostic/components/curator/sidebar.tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV = [
  { href: '/curator/drift',        label: "Today's recommendations" },
  { href: '/curator/deferred',     label: 'Deferred cases' },
  { href: '/curator/novel',        label: 'Novel patterns' },
  { href: '/curator/corpus',       label: 'Corpus' },
  { href: '/curator/calibration',  label: 'Calibration thresholds' },
]

export function CuratorSidebar() {
  const pathname = usePathname()
  return (
    <nav className="vt-curator-sidebar">
      <h1 className="vt-curator-brand">Vyntechs Curator</h1>
      <ul>
        {NAV.map(({ href, label }) => {
          const active = pathname === href || pathname.startsWith(href + '/')
          return (
            <li key={href}>
              <Link href={href} aria-current={active ? 'page' : undefined}
                    className={active ? 'vt-curator-nav-active' : ''}>
                {label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
```

- [ ] **Step 3: Write the desktop-only fallback.**

```tsx
// apps/diagnostic/components/curator/desktop-only-fallback.tsx
'use client'

export function DesktopOnlyFallback() {
  return (
    <div className="vt-curator-desktop-only">
      <div>
        <h2>Curator tools require a desktop browser</h2>
        <p>
          Please open this in Chrome or Safari at a window width of at least
          1280 pixels.
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Add CSS.**

Append to `packages/ui/src/vt.css` (or create `packages/ui/src/curator.css` and export it from package.json):

```css
.vt-curator-shell { min-height: 100vh; background: var(--vt-bg); }
.vt-curator-grid { display: grid; grid-template-columns: 240px 1fr; min-height: 100vh; }
.vt-curator-sidebar { background: var(--vt-surface-2); padding: 24px 16px; border-right: 1px solid var(--vt-border); }
.vt-curator-brand { font-size: 14px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--vt-fg-muted); margin-bottom: 32px; }
.vt-curator-sidebar ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; }
.vt-curator-sidebar a { display: block; padding: 8px 12px; color: var(--vt-fg); text-decoration: none; border-radius: 6px; }
.vt-curator-sidebar a:hover { background: var(--vt-surface-3); }
.vt-curator-nav-active { background: var(--vt-surface-3) !important; font-weight: 600; }
.vt-curator-main { padding: 32px; }

.vt-curator-desktop-only { display: none; }
@media (max-width: 1279px) {
  .vt-curator-grid { display: none; }
  .vt-curator-desktop-only {
    display: flex; align-items: center; justify-content: center;
    min-height: 100vh; padding: 24px; text-align: center;
  }
}
```

- [ ] **Step 5: Add a placeholder index page so `/curator` doesn't 404.**

```tsx
// apps/diagnostic/app/curator/page.tsx
import { redirect } from 'next/navigation'

export default function CuratorIndexPage() {
  redirect('/curator/drift')
}
```

- [ ] **Step 6: Verify build picks up new routes.**

```bash
pnpm --filter diagnostic build 2>&1 | grep curator
```

Expected: see entries for `/curator` and `/curator/[...]/layout` in the route table.

- [ ] **Step 7: Commit.**

```bash
git add apps/diagnostic/app/curator/
git add apps/diagnostic/components/curator/
git add packages/ui/src/vt.css
git commit -m "feat(curator): console layout + sidebar (Screen 10)

Phase P task 3. Sidebar nav with 5 entries, role check defense-in-depth in
the layout, desktop-only fallback below 1280px viewport. /curator redirects
to /curator/drift."
```

---

## Task 4: Full case detail page (Screen 3, read-only viewer)

**Files:**
- Create: `apps/diagnostic/app/curator/cases/[sessionId]/page.tsx`
- Create: `apps/diagnostic/lib/curator/case-detail-query.ts`

This screen is shared by Screens 2/6/7. Implement as a read-only viewer first; action buttons get added in tasks 7, 12, 15 with the relevant context.

- [ ] **Step 1: Write the query helper.**

```ts
// apps/diagnostic/lib/curator/case-detail-query.ts
import { eq, desc } from 'drizzle-orm'
import type { AppDb } from '@repo/db/client'
import { sessions, sessionEvents, artifacts } from '@repo/db/schema'

export type CuratorCaseDetail = {
  session: typeof sessions.$inferSelect
  events: (typeof sessionEvents.$inferSelect)[]
  artifacts: (typeof artifacts.$inferSelect)[]
} | null

export async function fetchCuratorCaseDetail(
  db: AppDb,
  sessionId: string,
): Promise<CuratorCaseDetail> {
  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1)
  if (!session) return null
  const events = await db
    .select().from(sessionEvents)
    .where(eq(sessionEvents.sessionId, sessionId))
    .orderBy(sessionEvents.createdAt)
  const arts = await db
    .select().from(artifacts)
    .where(eq(artifacts.sessionId, sessionId))
    .orderBy(desc(artifacts.createdAt))
  return { session, events, artifacts: arts }
}
```

- [ ] **Step 2: Write the page.**

```tsx
// apps/diagnostic/app/curator/cases/[sessionId]/page.tsx
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { db } from '@repo/db/client'
import { fetchCuratorCaseDetail } from '../../../../lib/curator/case-detail-query'

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

  const { session, events, artifacts } = detail
  const backHref = from === 'deferred' ? '/curator/deferred'
                 : from === 'novel'    ? '/curator/novel'
                 : from?.startsWith('drift/') ? `/curator/${from}`
                 : '/curator/drift'

  return (
    <article className="vt-case-detail">
      <header className="vt-case-detail-header">
        <Link href={backHref}>← Back</Link>
        <h1>{session.vehicleYear} {session.vehicleMake} {session.vehicleModel}</h1>
        <p className="vt-fg-muted">{session.customerComplaint}</p>
      </header>

      <section className="vt-case-detail-conversation">
        <h2>Conversation log</h2>
        <ol>
          {events.map(ev => (
            <li key={ev.id} className={`vt-event vt-event-${ev.kind}`}>
              <time dateTime={ev.createdAt.toISOString()}>
                {ev.createdAt.toLocaleString()}
              </time>
              <strong>{ev.actor}</strong>
              <p>{ev.text ?? JSON.stringify(ev.payload)}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Diagnostic path (renders treeState if present) */}
      {session.treeState && (
        <section className="vt-case-detail-tree">
          <h2>Diagnostic path</h2>
          <pre>{JSON.stringify(session.treeState, null, 2)}</pre>
          {/* TODO P+1: replace with proper tree visualization */}
        </section>
      )}

      <section className="vt-case-detail-outcome">
        <h2>Outcome</h2>
        <dl>
          <dt>AI proposed</dt>
          <dd>{session.proposedActionSummary ?? '—'}</dd>
          <dt>Tech action</dt>
          <dd>{session.techActionSummary ?? '—'}</dd>
          <dt>Resolution</dt>
          <dd>{session.outcomeStatus ?? 'pending'}</dd>
        </dl>
      </section>

      {artifacts.length > 0 && (
        <section className="vt-case-detail-artifacts">
          <h2>Photos and scan tool readings</h2>
          <ul>
            {artifacts.map(a => (
              <li key={a.id}>
                <a href={a.publicUrl ?? '#'} target="_blank" rel="noreferrer">
                  {a.kind} — {a.createdAt.toLocaleString()}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  )
}
```

The exact column names (`vehicleYear`, `customerComplaint`, `treeState`, `proposedActionSummary`, `techActionSummary`, `outcomeStatus`, `publicUrl`) may differ from the actual schema. Before writing this, run `grep -n` on `packages/db/src/schema/index.ts` for `sessions = pgTable` and adjust the page to use the real column names. Don't invent fields.

- [ ] **Step 3: Add minimal CSS for the case detail.**

Append to `packages/ui/src/vt.css`:

```css
.vt-case-detail { max-width: 960px; }
.vt-case-detail-header { margin-bottom: 24px; }
.vt-case-detail-header a { color: var(--vt-accent); }
.vt-case-detail section { margin-top: 32px; padding-top: 24px; border-top: 1px solid var(--vt-border); }
.vt-event { display: flex; gap: 12px; padding: 8px 0; }
.vt-event time { color: var(--vt-fg-muted); font-size: 12px; min-width: 140px; }
.vt-event-ai { color: var(--vt-accent); }
.vt-case-detail dl { display: grid; grid-template-columns: 200px 1fr; gap: 8px; }
.vt-case-detail dt { color: var(--vt-fg-muted); }
```

- [ ] **Step 4: Verify build.**

```bash
pnpm --filter diagnostic build 2>&1 | grep "curator/cases"
```

Expected: route appears in the build output.

- [ ] **Step 5: Commit.**

```bash
git add apps/diagnostic/app/curator/cases/
git add apps/diagnostic/lib/curator/case-detail-query.ts
git add packages/ui/src/vt.css
git commit -m "feat(curator): full case detail page (Screen 3)

Phase P task 4. Read-only viewer used from drift/deferred/novel queues.
Action buttons context-specific, added in subsequent tasks."
```

---

## Task 5: Drift queue list query (TDD, 2 cases for previously-dismissed badge)

**Files:**
- Create: `apps/diagnostic/lib/curator/queries.ts`
- Create: `apps/diagnostic/tests/unit/curator-drift-queries.test.ts`

- [ ] **Step 1: Write the failing tests.**

```ts
// apps/diagnostic/tests/unit/curator-drift-queries.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { driftAlerts, profiles, shops } from '@repo/db/schema'
import { createTestDb, type TestDb } from '../helpers/db'
import { listPendingDriftAlerts } from '../../lib/curator/queries'

const SHOP = '00000000-0000-0000-0000-000000000001'
const CURATOR = '00000000-0000-0000-0000-000000000010'

describe('listPendingDriftAlerts', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
    await db.insert(shops).values({ id: SHOP, name: 'Test Shop' })
    await db.insert(profiles).values({ id: CURATOR, userId: 'u', shopId: SHOP, role: 'curator' })
  })
  afterEach(async () => { await close() })

  it('flags wasDismissedRecently=true when same cell was dismissed within 90 days', async () => {
    // Old dismissed alert from 30 days ago
    await db.insert(driftAlerts).values({
      riskClass: 'medium', vehicleFamily: 'pickup', symptomClass: 'power_loss',
      oldThreshold: 0.72, newThreshold: 0.78, comebackRate: 0.21, sampleSize: 14,
      decision: 'dismissed',
      decidedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      decidedByUserId: CURATOR,
    })
    // New pending alert for the same cell, just today
    await db.insert(driftAlerts).values({
      riskClass: 'medium', vehicleFamily: 'pickup', symptomClass: 'power_loss',
      oldThreshold: 0.72, newThreshold: 0.80, comebackRate: 0.24, sampleSize: 16,
    })

    const rows = await listPendingDriftAlerts(db)
    expect(rows).toHaveLength(1)
    expect(rows[0].wasDismissedRecently).toBe(true)
  })

  it('flags wasDismissedRecently=false when last dismissal was >90 days ago', async () => {
    await db.insert(driftAlerts).values({
      riskClass: 'medium', vehicleFamily: 'pickup', symptomClass: 'power_loss',
      oldThreshold: 0.72, newThreshold: 0.78, comebackRate: 0.21, sampleSize: 14,
      decision: 'dismissed',
      decidedAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000),
      decidedByUserId: CURATOR,
    })
    await db.insert(driftAlerts).values({
      riskClass: 'medium', vehicleFamily: 'pickup', symptomClass: 'power_loss',
      oldThreshold: 0.72, newThreshold: 0.80, comebackRate: 0.24, sampleSize: 16,
    })

    const rows = await listPendingDriftAlerts(db)
    expect(rows[0].wasDismissedRecently).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests, confirm they fail.**

```bash
pnpm --filter diagnostic test curator-drift-queries
```

Expected: FAIL.

- [ ] **Step 3: Implement the query.**

```ts
// apps/diagnostic/lib/curator/queries.ts
import { sql, isNull, and, eq, asc, desc } from 'drizzle-orm'
import type { AppDb } from '@repo/db/client'
import { driftAlerts } from '@repo/db/schema'

const RISK_RANK_SQL = sql`CASE ${driftAlerts.riskClass}
  WHEN 'destructive' THEN 5
  WHEN 'high' THEN 4
  WHEN 'medium' THEN 3
  WHEN 'low' THEN 2
  WHEN 'zero' THEN 1
  ELSE 0
END`

export type PendingDriftAlertRow =
  typeof driftAlerts.$inferSelect & { wasDismissedRecently: boolean }

export async function listPendingDriftAlerts(
  db: AppDb,
  filters: {
    riskClass?: string
    vehicleFamily?: string
    symptomClass?: string
  } = {},
): Promise<PendingDriftAlertRow[]> {
  const wheres = [isNull(driftAlerts.decision)]
  if (filters.riskClass)     wheres.push(eq(driftAlerts.riskClass, filters.riskClass as any))
  if (filters.vehicleFamily) wheres.push(eq(driftAlerts.vehicleFamily, filters.vehicleFamily))
  if (filters.symptomClass)  wheres.push(eq(driftAlerts.symptomClass, filters.symptomClass))

  const rows = await db
    .select({
      ...driftAlerts._.columns,
      wasDismissedRecently: sql<boolean>`EXISTS (
        SELECT 1 FROM ${driftAlerts} d2
        WHERE d2.risk_class = ${driftAlerts.riskClass}
        AND d2.vehicle_family = ${driftAlerts.vehicleFamily}
        AND d2.symptom_class = ${driftAlerts.symptomClass}
        AND d2.decision = 'dismissed'
        AND d2.decided_at > now() - interval '90 days'
        AND d2.id != ${driftAlerts.id}
      )`,
    })
    .from(driftAlerts)
    .where(and(...wheres))
    .orderBy(desc(RISK_RANK_SQL), asc(driftAlerts.createdAt))

  return rows as PendingDriftAlertRow[]
}
```

- [ ] **Step 4: Run tests, confirm pass.**

```bash
pnpm --filter diagnostic test curator-drift-queries
```

Expected: 2/2 passing.

- [ ] **Step 5: Commit.**

```bash
git add apps/diagnostic/lib/curator/queries.ts
git add apps/diagnostic/tests/unit/curator-drift-queries.test.ts
git commit -m "feat(curator): listPendingDriftAlerts with previously-dismissed badge

Phase P task 5. Pending-only filter via partial index. Previously-dismissed
badge derived at query time via EXISTS subquery (90-day window). 2 TDD
cases cover the badge boundary."
```

---

## Task 6: Drift queue page (Screen 1)

**Files:**
- Create: `apps/diagnostic/app/curator/drift/page.tsx`
- Create: `apps/diagnostic/components/curator/drift-row.tsx`

- [ ] **Step 1: Write the page.**

```tsx
// apps/diagnostic/app/curator/drift/page.tsx
import Link from 'next/link'
import { db } from '@repo/db/client'
import { listPendingDriftAlerts } from '../../../lib/curator/queries'
import { DriftRow } from '../../../components/curator/drift-row'

export default async function DriftQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ risk?: string; vehicle?: string; symptom?: string }>
}) {
  const sp = await searchParams
  const rows = await listPendingDriftAlerts(db, {
    riskClass: sp.risk,
    vehicleFamily: sp.vehicle,
    symptomClass: sp.symptom,
  })

  if (rows.length === 0) {
    return (
      <div className="vt-drift-empty">
        <p>Queue empty.</p>
        <p>
          <Link href="/curator/calibration">View all thresholds →</Link>
        </p>
      </div>
    )
  }

  return (
    <div className="vt-drift-page">
      <header className="vt-drift-page-header">
        <h1>Today&apos;s recommendations</h1>
        <DriftFilters current={sp} />
      </header>
      <ul className="vt-drift-list">
        {rows.map(row => <DriftRow key={row.id} row={row} />)}
      </ul>
      <BulkDismissBar />
    </div>
  )
}

function DriftFilters({ current }: { current: { risk?: string; vehicle?: string; symptom?: string } }) {
  // Render 3 <select> dropdowns; on change, navigate with new searchParams.
  // Implementation note: a thin client component wrapping useRouter/useSearchParams.
  return <div className="vt-drift-filters">{/* see drift-filters.tsx in components/curator/ */}</div>
}

function BulkDismissBar() {
  // Client component with checkbox state + submit. Rendered if any rows are selected.
  return null
}
```

Implement `DriftFilters` and `BulkDismissBar` as small client components in `components/curator/`. Both delegate state to URL search params (filters) or local state (bulk selection).

- [ ] **Step 2: Write the row component.**

```tsx
// apps/diagnostic/components/curator/drift-row.tsx
'use client'

import Link from 'next/link'
import { useState } from 'react'
import type { PendingDriftAlertRow } from '../../lib/curator/queries'

const RISK_LABELS: Record<string, string> = {
  zero: 'Zero', low: 'Low', medium: 'Medium', high: 'High', destructive: 'Destructive',
}

export function DriftRow({ row }: { row: PendingDriftAlertRow }) {
  const [open, setOpen] = useState<'apply' | 'dismiss' | null>(null)
  const [note, setNote] = useState('')
  const arrowDir = row.newThreshold > row.oldThreshold ? '↑' : '↓'
  const ageHours = Math.floor((Date.now() - new Date(row.createdAt).getTime()) / 3_600_000)
  const ageLabel = ageHours < 24 ? `${ageHours}h ago` : `${Math.floor(ageHours / 24)}d ago`

  return (
    <li className="vt-drift-row">
      <div className="vt-drift-cell">
        <Link href={`/curator/drift/${row.id}`} className="vt-drift-slice">
          {RISK_LABELS[row.riskClass]}-risk × {row.vehicleFamily} × {row.symptomClass}
        </Link>
        <div className="vt-drift-change">
          {row.oldThreshold.toFixed(2)} {arrowDir} {row.newThreshold.toFixed(2)}
        </div>
        <div className="vt-drift-evidence">
          {row.sampleSize} samples, {(row.comebackRate * 100).toFixed(0)}% comeback
        </div>
        <div className="vt-drift-age">{ageLabel}</div>
        {row.wasDismissedRecently && (
          <span className="vt-drift-tag-prev-dismissed">Previously dismissed</span>
        )}
      </div>
      <div className="vt-drift-actions">
        <button onClick={() => setOpen('apply')}>Apply</button>
        <button onClick={() => setOpen('dismiss')}>Dismiss</button>
      </div>
      {open && (
        <form
          className="vt-drift-confirm"
          onSubmit={async (e) => {
            e.preventDefault()
            await fetch(`/api/curator/drift/${row.id}/${open}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ note: note || null }),
            })
            window.location.reload()
          }}
        >
          <textarea
            placeholder="Note (optional)"
            value={note}
            onChange={e => setNote(e.target.value)}
          />
          <button type="submit">Confirm {open}</button>
          <button type="button" onClick={() => setOpen(null)}>Cancel</button>
        </form>
      )}
    </li>
  )
}
```

- [ ] **Step 3: Add CSS for the drift list.**

```css
.vt-drift-page-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 16px; }
.vt-drift-list { list-style: none; padding: 0; margin: 0; }
.vt-drift-row { display: flex; padding: 12px 16px; border-bottom: 1px solid var(--vt-border); align-items: center; gap: 16px; }
.vt-drift-cell { flex: 1; display: grid; grid-template-columns: 1.5fr 1fr 1.5fr 0.5fr 1fr; gap: 12px; align-items: center; }
.vt-drift-slice { color: var(--vt-accent); text-decoration: none; }
.vt-drift-slice:hover { text-decoration: underline; }
.vt-drift-change { font-variant-numeric: tabular-nums; }
.vt-drift-tag-prev-dismissed { font-size: 11px; padding: 2px 6px; background: var(--vt-surface-3); color: var(--vt-fg-muted); border-radius: 4px; }
.vt-drift-actions { display: flex; gap: 8px; }
.vt-drift-confirm { width: 100%; padding: 12px; background: var(--vt-surface-2); margin-top: 8px; }
.vt-drift-confirm textarea { width: 100%; min-height: 60px; }
.vt-drift-empty { padding: 64px; text-align: center; color: var(--vt-fg-muted); }
```

- [ ] **Step 4: Verify build.**

```bash
pnpm --filter diagnostic build 2>&1 | grep "curator/drift"
```

- [ ] **Step 5: Commit.**

```bash
git add apps/diagnostic/app/curator/drift/page.tsx
git add apps/diagnostic/components/curator/drift-row.tsx
git add packages/ui/src/vt.css
git commit -m "feat(curator): drift queue review screen (Screen 1)

Phase P task 6. Renders pending recommendations sorted by risk×age, with
inline Apply/Dismiss + optional note slot, previously-dismissed tag,
filter dropdowns, empty state."
```

---

## Task 7: Apply / Dismiss / bulk-dismiss handlers (TDD, 5 cases)

**Files:**
- Create: `apps/diagnostic/lib/curator/drift-resolution.ts`
- Create: `apps/diagnostic/tests/unit/curator-drift-resolution.test.ts`
- Create: `apps/diagnostic/app/api/curator/drift/[id]/apply/route.ts`
- Create: `apps/diagnostic/app/api/curator/drift/[id]/dismiss/route.ts`
- Create: `apps/diagnostic/app/api/curator/drift/bulk-dismiss/route.ts`

- [ ] **Step 1: Write the failing tests.**

```ts
// apps/diagnostic/tests/unit/curator-drift-resolution.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { driftAlerts, profiles, shops, confidenceCalibration } from '@repo/db/schema'
import { eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from '../helpers/db'
import {
  applyDriftAlert, dismissDriftAlert, bulkDismissDriftAlerts,
} from '../../lib/curator/drift-resolution'

const SHOP = '00000000-0000-0000-0000-000000000001'
const CURATOR = '00000000-0000-0000-0000-000000000010'

describe('drift-resolution', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
    await db.insert(shops).values({ id: SHOP, name: 'Test Shop' })
    await db.insert(profiles).values({
      id: CURATOR, userId: 'u-curator', shopId: SHOP, role: 'curator',
    })
    await db.insert(confidenceCalibration).values({
      riskClass: 'medium', vehicleFamily: 'pickup', symptomClass: 'power_loss',
      thresholdPct: 0.72, lastRefitAt: null,
    })
  })
  afterEach(async () => { await close() })

  it('applyDriftAlert with note: bumps threshold and stamps lifecycle', async () => {
    const [alert] = await db.insert(driftAlerts).values({
      riskClass: 'medium', vehicleFamily: 'pickup', symptomClass: 'power_loss',
      oldThreshold: 0.72, newThreshold: 0.78, comebackRate: 0.21, sampleSize: 14,
    }).returning()

    const res = await applyDriftAlert(db, alert.id, CURATOR, 'strong sample size')
    expect(res.kind).toBe('ok')

    const [updated] = await db.select().from(driftAlerts).where(eq(driftAlerts.id, alert.id))
    expect(updated.decision).toBe('applied')
    expect(updated.decidedByUserId).toBe(CURATOR)
    expect(updated.decisionNote).toBe('strong sample size')

    const [cal] = await db.select().from(confidenceCalibration)
    expect(cal.thresholdPct).toBeCloseTo(0.78, 4)
    expect(cal.lastRefitAt).not.toBeNull()
  })

  it('applyDriftAlert without note: ok, decisionNote null', async () => {
    const [alert] = await db.insert(driftAlerts).values({
      riskClass: 'medium', vehicleFamily: 'pickup', symptomClass: 'power_loss',
      oldThreshold: 0.72, newThreshold: 0.78, comebackRate: 0.21, sampleSize: 14,
    }).returning()

    await applyDriftAlert(db, alert.id, CURATOR, null)
    const [updated] = await db.select().from(driftAlerts).where(eq(driftAlerts.id, alert.id))
    expect(updated.decision).toBe('applied')
    expect(updated.decisionNote).toBeNull()
  })

  it('dismissDriftAlert with note: stamps lifecycle but does not touch calibration', async () => {
    const [alert] = await db.insert(driftAlerts).values({
      riskClass: 'medium', vehicleFamily: 'pickup', symptomClass: 'power_loss',
      oldThreshold: 0.72, newThreshold: 0.78, comebackRate: 0.21, sampleSize: 14,
    }).returning()

    await dismissDriftAlert(db, alert.id, CURATOR, 'only 3 high-risk samples')
    const [updated] = await db.select().from(driftAlerts).where(eq(driftAlerts.id, alert.id))
    expect(updated.decision).toBe('dismissed')
    expect(updated.decisionNote).toBe('only 3 high-risk samples')

    const [cal] = await db.select().from(confidenceCalibration)
    expect(cal.thresholdPct).toBeCloseTo(0.72, 4)  // unchanged
    expect(cal.lastRefitAt).toBeNull()
  })

  it('dismissDriftAlert without note: stamps decision, note null', async () => {
    const [alert] = await db.insert(driftAlerts).values({
      riskClass: 'medium', vehicleFamily: 'pickup', symptomClass: 'power_loss',
      oldThreshold: 0.72, newThreshold: 0.78, comebackRate: 0.21, sampleSize: 14,
    }).returning()

    await dismissDriftAlert(db, alert.id, CURATOR, null)
    const [updated] = await db.select().from(driftAlerts).where(eq(driftAlerts.id, alert.id))
    expect(updated.decision).toBe('dismissed')
    expect(updated.decisionNote).toBeNull()
  })

  it('bulkDismissDriftAlerts: dismisses multiple atomically', async () => {
    const inserted = await db.insert(driftAlerts).values([
      { riskClass: 'medium', vehicleFamily: 'pickup', symptomClass: 'power_loss',
        oldThreshold: 0.72, newThreshold: 0.78, comebackRate: 0.21, sampleSize: 14 },
      { riskClass: 'low', vehicleFamily: 'sedan', symptomClass: 'cosmetic',
        oldThreshold: 0.40, newThreshold: 0.45, comebackRate: 0.05, sampleSize: 11 },
      { riskClass: 'high', vehicleFamily: 'diesel', symptomClass: 'overheat',
        oldThreshold: 0.85, newThreshold: 0.88, comebackRate: 0.18, sampleSize: 12 },
    ]).returning()

    const ids = inserted.slice(0, 2).map(a => a.id)
    await bulkDismissDriftAlerts(db, ids, CURATOR, 'noise week')

    const all = await db.select().from(driftAlerts)
    expect(all.filter(a => a.decision === 'dismissed')).toHaveLength(2)
    expect(all.find(a => a.id === inserted[2].id)?.decision).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests, confirm fail.**

```bash
pnpm --filter diagnostic test curator-drift-resolution
```

- [ ] **Step 3: Implement the handlers.**

```ts
// apps/diagnostic/lib/curator/drift-resolution.ts
import { eq, inArray, and, sql } from 'drizzle-orm'
import type { AppDb } from '@repo/db/client'
import { driftAlerts, confidenceCalibration } from '@repo/db/schema'

export type ResolutionResult =
  | { kind: 'ok' }
  | { kind: 'not-found' }
  | { kind: 'already-decided' }

export async function applyDriftAlert(
  db: AppDb,
  alertId: string,
  curatorProfileId: string,
  note: string | null,
): Promise<ResolutionResult> {
  return db.transaction(async (tx) => {
    const [alert] = await tx
      .select().from(driftAlerts)
      .where(eq(driftAlerts.id, alertId)).limit(1)
    if (!alert) return { kind: 'not-found' as const }
    if (alert.decision !== null) return { kind: 'already-decided' as const }

    await tx.update(driftAlerts).set({
      decision: 'applied',
      decidedAt: new Date(),
      decidedByUserId: curatorProfileId,
      decisionNote: note,
    }).where(eq(driftAlerts.id, alertId))

    await tx.update(confidenceCalibration).set({
      thresholdPct: alert.newThreshold,
      lastRefitAt: new Date(),
    }).where(and(
      eq(confidenceCalibration.riskClass, alert.riskClass),
      eq(confidenceCalibration.vehicleFamily, alert.vehicleFamily),
      eq(confidenceCalibration.symptomClass, alert.symptomClass),
    ))

    return { kind: 'ok' as const }
  })
}

export async function dismissDriftAlert(
  db: AppDb,
  alertId: string,
  curatorProfileId: string,
  note: string | null,
): Promise<ResolutionResult> {
  const [alert] = await db
    .select().from(driftAlerts)
    .where(eq(driftAlerts.id, alertId)).limit(1)
  if (!alert) return { kind: 'not-found' }
  if (alert.decision !== null) return { kind: 'already-decided' }

  await db.update(driftAlerts).set({
    decision: 'dismissed',
    decidedAt: new Date(),
    decidedByUserId: curatorProfileId,
    decisionNote: note,
  }).where(eq(driftAlerts.id, alertId))
  return { kind: 'ok' }
}

export async function bulkDismissDriftAlerts(
  db: AppDb,
  alertIds: string[],
  curatorProfileId: string,
  note: string | null,
): Promise<{ kind: 'ok'; dismissedCount: number }> {
  if (alertIds.length === 0) return { kind: 'ok', dismissedCount: 0 }
  const result = await db.update(driftAlerts).set({
    decision: 'dismissed',
    decidedAt: new Date(),
    decidedByUserId: curatorProfileId,
    decisionNote: note,
  }).where(and(inArray(driftAlerts.id, alertIds), sql`${driftAlerts.decision} IS NULL`))

  return { kind: 'ok', dismissedCount: alertIds.length }
}
```

- [ ] **Step 4: Run tests, confirm pass.**

```bash
pnpm --filter diagnostic test curator-drift-resolution
```

Expected: 5/5 passing.

- [ ] **Step 5: Write the API route shims.**

```ts
// apps/diagnostic/app/api/curator/drift/[id]/apply/route.ts
import { NextResponse } from 'next/server'
import { db } from '@repo/db/client'
import { applyDriftAlert } from '@/lib/curator/drift-resolution'
import { requireCurator } from '@/lib/curator/route-helpers'

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireCurator()
  if (auth.kind !== 'ok') return auth.response
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const note = typeof body.note === 'string' && body.note.length > 0 ? body.note : null
  const result = await applyDriftAlert(db, id, auth.profileId, note)
  if (result.kind === 'not-found')        return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (result.kind === 'already-decided')  return NextResponse.json({ error: 'already decided' }, { status: 409 })
  return NextResponse.json({ ok: true })
}
```

`requireCurator` is a small helper:

```ts
// apps/diagnostic/lib/curator/route-helpers.ts
import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { createClient } from '@repo/auth/server'
import { db } from '@repo/db/client'
import { profiles } from '@repo/db/schema'

export async function requireCurator(): Promise<
  | { kind: 'ok'; profileId: string }
  | { kind: 'forbidden'; response: NextResponse }
> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { kind: 'forbidden', response: NextResponse.json({ error: 'unauthed' }, { status: 401 }) }
  const [profile] = await db.select({ id: profiles.id, role: profiles.role })
    .from(profiles).where(eq(profiles.userId, user.id)).limit(1)
  if (profile?.role !== 'curator') return { kind: 'forbidden', response: NextResponse.json({ error: 'forbidden' }, { status: 403 }) }
  return { kind: 'ok', profileId: profile.id }
}
```

Same shim pattern for `dismiss/route.ts` and `bulk-dismiss/route.ts` (the bulk handler reads `body.ids: string[]` and `body.note: string | null`).

- [ ] **Step 6: Verify build + tests.**

```bash
pnpm --filter diagnostic typecheck
pnpm --filter diagnostic build 2>&1 | grep "api/curator/drift"
pnpm --filter diagnostic test 2>&1 | tail -5
```

- [ ] **Step 7: Commit.**

```bash
git add apps/diagnostic/lib/curator/drift-resolution.ts
git add apps/diagnostic/lib/curator/route-helpers.ts
git add apps/diagnostic/tests/unit/curator-drift-resolution.test.ts
git add apps/diagnostic/app/api/curator/drift/
git commit -m "feat(curator): apply/dismiss/bulk-dismiss drift alert handlers

Phase P task 7. Pure handlers + thin route shims (handler-in-lib pattern
per AGENTS.md). 5 TDD cases: apply with/without note (also bumps the
threshold transactionally), dismiss with/without note, bulk dismiss
filters out already-decided rows."
```

---

## Task 8: Drift drill-down (Screen 2) — list of cases backing one recommendation

**Files:**
- Create: `apps/diagnostic/app/curator/drift/[id]/page.tsx`
- Modify: `apps/diagnostic/lib/curator/queries.ts` (add `listCasesForDriftAlert`)

- [ ] **Step 1: Add the query.**

```ts
// apps/diagnostic/lib/curator/queries.ts (append)
import { sessions } from '@repo/db/schema'

export async function listCasesForDriftAlert(
  db: AppDb,
  alertId: string,
): Promise<{ alert: typeof driftAlerts.$inferSelect | null; cases: (typeof sessions.$inferSelect)[] }> {
  const [alert] = await db.select().from(driftAlerts).where(eq(driftAlerts.id, alertId)).limit(1)
  if (!alert) return { alert: null, cases: [] }

  const cases = await db.select().from(sessions).where(and(
    eq(sessions.riskClass, alert.riskClass),
    eq(sessions.vehicleFamily, alert.vehicleFamily),
    eq(sessions.symptomClass, alert.symptomClass),
    sql`${sessions.closedAt} > ${alert.createdAt} - interval '4 weeks'`,
    sql`${sessions.closedAt} <= ${alert.createdAt}`,
  )).orderBy(desc(sessions.closedAt))

  return { alert, cases }
}
```

Verify the actual `sessions` table column names (`riskClass`, `vehicleFamily`, `symptomClass`, `closedAt`) before writing — adjust to match the schema.

- [ ] **Step 2: Write the page.**

```tsx
// apps/diagnostic/app/curator/drift/[id]/page.tsx
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { db } from '@repo/db/client'
import { listCasesForDriftAlert } from '../../../../lib/curator/queries'

export default async function DriftDrillDownPage({
  params,
}: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { alert, cases } = await listCasesForDriftAlert(db, id)
  if (!alert) notFound()

  return (
    <div className="vt-drift-drill">
      <header>
        <Link href="/curator/drift">← Back</Link>
        <h1>{alert.riskClass}-risk × {alert.vehicleFamily} × {alert.symptomClass}</h1>
        <p>
          Recommended: {alert.oldThreshold.toFixed(2)} → {alert.newThreshold.toFixed(2)} ·
          Sample {alert.sampleSize} · Comeback {(alert.comebackRate * 100).toFixed(0)}%
        </p>
      </header>

      <table className="vt-drill-cases">
        <thead>
          <tr><th>Vehicle</th><th>Symptom</th><th>AI proposed</th><th>Tech action</th><th>Outcome</th></tr>
        </thead>
        <tbody>
          {cases.map(c => (
            <tr key={c.id}>
              <td>
                <Link href={`/curator/cases/${c.id}?from=drift/${alert.id}`}>
                  {c.vehicleYear} {c.vehicleMake} {c.vehicleModel}
                </Link>
              </td>
              <td>{c.customerComplaint}</td>
              <td>{c.proposedActionSummary ?? '—'}</td>
              <td>{c.techActionSummary ?? '—'}</td>
              <td>{c.outcomeStatus ?? 'pending'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 3: Add CSS.**

```css
.vt-drill-cases { width: 100%; border-collapse: collapse; }
.vt-drill-cases th, .vt-drill-cases td { padding: 8px 12px; border-bottom: 1px solid var(--vt-border); text-align: left; }
.vt-drill-cases th { font-size: 12px; color: var(--vt-fg-muted); text-transform: uppercase; }
```

- [ ] **Step 4: Verify build.**

```bash
pnpm --filter diagnostic build 2>&1 | grep "curator/drift"
```

- [ ] **Step 5: Commit.**

```bash
git add apps/diagnostic/lib/curator/queries.ts
git add apps/diagnostic/app/curator/drift/[id]/
git add packages/ui/src/vt.css
git commit -m "feat(curator): drift drill-down screen (Screen 2)"
```

---

## Task 9: Calibration thresholds dashboard (Screen 4)

**Files:**
- Create: `apps/diagnostic/app/curator/calibration/page.tsx`
- Modify: `apps/diagnostic/lib/curator/queries.ts` (add `listCalibrationCells`, `countPendingDriftAlerts`)

- [ ] **Step 1: Add queries.**

```ts
// apps/diagnostic/lib/curator/queries.ts (append)
import { confidenceCalibration } from '@repo/db/schema'

export async function listCalibrationCells(
  db: AppDb,
  filters: { riskClass?: string; vehicleFamily?: string; symptomClass?: string } = {},
) {
  const wheres = []
  if (filters.riskClass)     wheres.push(eq(confidenceCalibration.riskClass, filters.riskClass as any))
  if (filters.vehicleFamily) wheres.push(eq(confidenceCalibration.vehicleFamily, filters.vehicleFamily))
  if (filters.symptomClass)  wheres.push(eq(confidenceCalibration.symptomClass, filters.symptomClass))

  return db.select().from(confidenceCalibration)
    .where(wheres.length > 0 ? and(...wheres) : undefined)
    .orderBy(confidenceCalibration.riskClass, confidenceCalibration.vehicleFamily, confidenceCalibration.symptomClass)
}

export async function countPendingDriftAlerts(db: AppDb): Promise<number> {
  const [{ c }] = await db.select({ c: sql<number>`count(*)::int` })
    .from(driftAlerts).where(isNull(driftAlerts.decision))
  return c
}
```

- [ ] **Step 2: Write the page.**

```tsx
// apps/diagnostic/app/curator/calibration/page.tsx
import Link from 'next/link'
import { db } from '@repo/db/client'
import { listCalibrationCells, countPendingDriftAlerts } from '../../../lib/curator/queries'

export default async function CalibrationDashboardPage({
  searchParams,
}: { searchParams: Promise<{ risk?: string; vehicle?: string; symptom?: string }> }) {
  const sp = await searchParams
  const [cells, pending] = await Promise.all([
    listCalibrationCells(db, { riskClass: sp.risk, vehicleFamily: sp.vehicle, symptomClass: sp.symptom }),
    countPendingDriftAlerts(db),
  ])

  return (
    <div className="vt-calibration-page">
      <header className="vt-calibration-header">
        <h1>Calibration thresholds</h1>
        {pending > 0 && (
          <Link href="/curator/drift" className="vt-pending-link">
            🔔 {pending} pending recommendation{pending > 1 ? 's' : ''} →
          </Link>
        )}
      </header>
      <table className="vt-calibration-table">
        <thead>
          <tr>
            <th>Slice</th><th>Threshold</th><th>Last refit</th>
          </tr>
        </thead>
        <tbody>
          {cells.map(c => (
            <tr key={`${c.riskClass}-${c.vehicleFamily}-${c.symptomClass}`}>
              <td>
                <Link href={`/curator/calibration/${c.riskClass}/${c.vehicleFamily}/${c.symptomClass}`}>
                  {c.riskClass} × {c.vehicleFamily} × {c.symptomClass}
                </Link>
              </td>
              <td>{c.thresholdPct.toFixed(2)}</td>
              <td>{c.lastRefitAt ? new Date(c.lastRefitAt).toLocaleDateString() : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 3: CSS.**

```css
.vt-calibration-header { display: flex; justify-content: space-between; align-items: baseline; }
.vt-pending-link { color: var(--vt-warn); text-decoration: none; padding: 6px 10px; border: 1px solid var(--vt-warn); border-radius: 4px; }
.vt-calibration-table { width: 100%; border-collapse: collapse; margin-top: 24px; }
.vt-calibration-table th, .vt-calibration-table td { padding: 6px 12px; border-bottom: 1px solid var(--vt-border); text-align: left; }
```

- [ ] **Step 4: Build + commit.**

```bash
pnpm --filter diagnostic build 2>&1 | grep curator/calibration
git add apps/diagnostic/lib/curator/queries.ts
git add apps/diagnostic/app/curator/calibration/page.tsx
git add packages/ui/src/vt.css
git commit -m "feat(curator): calibration thresholds dashboard (Screen 4)"
```

---

## Task 10: Per-category history (Screen 5)

**Files:**
- Create: `apps/diagnostic/app/curator/calibration/[risk]/[vehicle]/[symptom]/page.tsx`
- Modify: `apps/diagnostic/lib/curator/queries.ts` (add `listHistoryForCell`)

- [ ] **Step 1: Add query.**

```ts
// (append to queries.ts)
export async function listHistoryForCell(
  db: AppDb,
  riskClass: string,
  vehicleFamily: string,
  symptomClass: string,
  limit = 6,
) {
  return db.select().from(driftAlerts).where(and(
    eq(driftAlerts.riskClass, riskClass as any),
    eq(driftAlerts.vehicleFamily, vehicleFamily),
    eq(driftAlerts.symptomClass, symptomClass),
  )).orderBy(desc(driftAlerts.createdAt)).limit(limit)
}
```

- [ ] **Step 2: Write the page.**

```tsx
// apps/diagnostic/app/curator/calibration/[risk]/[vehicle]/[symptom]/page.tsx
import Link from 'next/link'
import { db } from '@repo/db/client'
import { listHistoryForCell } from '../../../../../lib/curator/queries'

export default async function PerCategoryHistoryPage({
  params,
}: { params: Promise<{ risk: string; vehicle: string; symptom: string }> }) {
  const { risk, vehicle, symptom } = await params
  const history = await listHistoryForCell(db, risk, vehicle, symptom)

  return (
    <div className="vt-history-page">
      <header>
        <Link href="/curator/calibration">← Back</Link>
        <h1>{risk}-risk × {vehicle} × {symptom} — history</h1>
      </header>
      {history.length === 0 ? (
        <p>No prior recommendations for this slice.</p>
      ) : (
        <table className="vt-history-table">
          <thead>
            <tr>
              <th>Date</th><th>Recommended</th><th>Decision</th><th>Note</th>
            </tr>
          </thead>
          <tbody>
            {history.map(h => (
              <tr key={h.id}>
                <td>{new Date(h.createdAt).toLocaleDateString()}</td>
                <td>{h.oldThreshold.toFixed(2)} → {h.newThreshold.toFixed(2)}</td>
                <td>{h.decision ?? 'pending'}</td>
                <td>{h.decisionNote ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Build + commit.**

```bash
git add apps/diagnostic/lib/curator/queries.ts
git add apps/diagnostic/app/curator/calibration/
git commit -m "feat(curator): per-category history view (Screen 5)"
```

---

## Task 11: Deferred queue (Screen 6) — list view

**Files:**
- Create: `apps/diagnostic/app/curator/deferred/page.tsx`
- Modify: `apps/diagnostic/lib/curator/queries.ts` (add `listDeferredSessions`)

- [ ] **Step 1: Add query.**

```ts
// (append to queries.ts)
import { sessions } from '@repo/db/schema'

export async function listDeferredSessions(db: AppDb) {
  return db.select().from(sessions).where(and(
    eq(sessions.status, 'deferred'),
    isNull(sessions.closedAt),
  )).orderBy(desc(sessions.deferredAt))
}
```

- [ ] **Step 2: Write the page.**

```tsx
// apps/diagnostic/app/curator/deferred/page.tsx
import Link from 'next/link'
import { db } from '@repo/db/client'
import { listDeferredSessions } from '../../../lib/curator/queries'

export default async function DeferredPage() {
  const rows = await listDeferredSessions(db)
  if (rows.length === 0) return <p>No deferred cases.</p>
  return (
    <div className="vt-deferred-page">
      <h1>Deferred cases</h1>
      <ul className="vt-deferred-list">
        {rows.map(s => (
          <li key={s.id}>
            <Link href={`/curator/cases/${s.id}?from=deferred`}>
              <strong>{s.vehicleYear} {s.vehicleMake} {s.vehicleModel}</strong>
              <span>{s.customerComplaint}</span>
              <time>{s.deferredAt && new Date(s.deferredAt).toLocaleString()}</time>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 3: Build + commit.**

```bash
git add apps/diagnostic/lib/curator/queries.ts apps/diagnostic/app/curator/deferred/
git commit -m "feat(curator): deferred cases queue (Screen 6)"
```

---

## Task 12: Approve / Override / Close handlers (TDD, 3 cases)

**Files:**
- Create: `apps/diagnostic/lib/curator/deferred-actions.ts`
- Create: `apps/diagnostic/tests/unit/curator-deferred-actions.test.ts`
- Create: `apps/diagnostic/app/api/curator/sessions/[id]/approve/route.ts`
- Create: `apps/diagnostic/app/api/curator/sessions/[id]/override/route.ts`
- Create: `apps/diagnostic/app/api/curator/sessions/[id]/close/route.ts`

- [ ] **Step 1: Write the failing tests.**

```ts
// apps/diagnostic/tests/unit/curator-deferred-actions.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { sessions, profiles, shops } from '@repo/db/schema'
import { eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from '../helpers/db'
import {
  approveDeferredSession, overrideDeferredSession, closeDeferredSession,
} from '../../lib/curator/deferred-actions'

const SHOP = '00000000-0000-0000-0000-000000000001'
const CURATOR = '00000000-0000-0000-0000-000000000010'
const SESSION = '00000000-0000-0000-0000-000000000020'

describe('deferred-actions', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
    await db.insert(shops).values({ id: SHOP, name: 'Test Shop' })
    await db.insert(profiles).values({ id: CURATOR, userId: 'u', shopId: SHOP, role: 'curator' })
    await db.insert(sessions).values({
      id: SESSION, shopId: SHOP, status: 'deferred',
      deferredAt: new Date(), customerComplaint: 'no power', vehicleYear: 2018,
      vehicleMake: 'Ford', vehicleModel: 'F-150',
    })
  })
  afterEach(async () => { await close() })

  it('approveDeferredSession: status → in_progress, deferredAt cleared', async () => {
    await approveDeferredSession(db, SESSION, CURATOR, 'looks right')
    const [s] = await db.select().from(sessions).where(eq(sessions.id, SESSION))
    expect(s.status).toBe('in_progress')
    expect(s.deferredAt).toBeNull()
    expect(s.curatorNote).toBe('looks right')
  })

  it('overrideDeferredSession: status → in_progress with curator-supplied next action', async () => {
    await overrideDeferredSession(db, SESSION, CURATOR, 'check fuel pressure', 'AI suggestion was off')
    const [s] = await db.select().from(sessions).where(eq(sessions.id, SESSION))
    expect(s.status).toBe('in_progress')
    expect(s.curatorOverrideAction).toBe('check fuel pressure')
    expect(s.curatorNote).toBe('AI suggestion was off')
  })

  it('closeDeferredSession: status → closed, closedAt stamped', async () => {
    await closeDeferredSession(db, SESSION, CURATOR, 'unable to resolve remotely')
    const [s] = await db.select().from(sessions).where(eq(sessions.id, SESSION))
    expect(s.status).toBe('closed')
    expect(s.closedAt).not.toBeNull()
    expect(s.curatorNote).toBe('unable to resolve remotely')
  })
})
```

The tests reference columns `curatorNote`, `curatorOverrideAction` on `sessions`. These don't exist yet in the schema. Adding them is part of this task — see Step 3.

- [ ] **Step 2: Run tests, confirm fail.**

```bash
pnpm --filter diagnostic test curator-deferred-actions
```

Expected: FAIL.

- [ ] **Step 3: Add the 2 columns to `sessions` (NOT a migration — the columns are nullable, the existing migration `0011` already shipped, so we add columns in a new migration `0012_curator_session_actions.sql`).**

Wait — Stage 3 of the platform-split migration also takes `0012`. To avoid filename collisions, append these columns to the **existing** `0011_drift_alerts_lifecycle.sql` (Phase P owns 0011 entirely; the migration is not yet shipped to prod when this task runs IF we run them in sequence; if it's already shipped, create `0011a_session_curator_columns.sql` or similar).

For executors: check `MCP list_migrations` first. If `0011_drift_alerts_lifecycle` is **not yet on prod**, append the ALTER TABLE to that file and the schema mirror update. If it IS on prod, create a new migration:

```sql
-- packages/db/migrations/0011a_session_curator_columns.sql
ALTER TABLE sessions
  ADD COLUMN curator_note text,
  ADD COLUMN curator_override_action text;
```

And update the Drizzle `sessions` table accordingly. Apply via MCP after writing the SQL. Run advisor lint.

- [ ] **Step 4: Implement the handlers.**

```ts
// apps/diagnostic/lib/curator/deferred-actions.ts
import { eq } from 'drizzle-orm'
import type { AppDb } from '@repo/db/client'
import { sessions } from '@repo/db/schema'

export async function approveDeferredSession(
  db: AppDb,
  sessionId: string,
  curatorProfileId: string,
  note: string | null,
) {
  await db.update(sessions).set({
    status: 'in_progress',
    deferredAt: null,
    curatorNote: note,
    curatorOverrideAction: null,
  }).where(eq(sessions.id, sessionId))
  return { kind: 'ok' as const }
}

export async function overrideDeferredSession(
  db: AppDb,
  sessionId: string,
  curatorProfileId: string,
  overrideAction: string,
  note: string | null,
) {
  await db.update(sessions).set({
    status: 'in_progress',
    deferredAt: null,
    curatorOverrideAction: overrideAction,
    curatorNote: note,
  }).where(eq(sessions.id, sessionId))
  return { kind: 'ok' as const }
}

export async function closeDeferredSession(
  db: AppDb,
  sessionId: string,
  curatorProfileId: string,
  note: string | null,
) {
  await db.update(sessions).set({
    status: 'closed',
    closedAt: new Date(),
    curatorNote: note,
  }).where(eq(sessions.id, sessionId))
  return { kind: 'ok' as const }
}
```

- [ ] **Step 5: Run tests, confirm pass.**

```bash
pnpm --filter diagnostic test curator-deferred-actions
```

- [ ] **Step 6: Write API route shims** (mirror Task 7's pattern). Each route: `requireCurator()`, parse body, call handler, return `{ ok: true }` or error.

- [ ] **Step 7: Wire action buttons on Screen 3 (full case detail) for the deferred-context.**

Add to `app/curator/cases/[sessionId]/page.tsx`:

```tsx
{from === 'deferred' && (
  <DeferredActions sessionId={session.id} />
)}
```

Where `DeferredActions` is a client component with three buttons (Approve, Override, Close), each opening an inline form, posting to the matching API endpoint, and reloading on success. Same UX shape as the drift-row Apply/Dismiss flow.

- [ ] **Step 8: Build, test, commit.**

```bash
pnpm --filter diagnostic build && pnpm --filter diagnostic test
git add ...
git commit -m "feat(curator): approve/override/close deferred-session handlers + UI

Phase P task 12. 3 TDD cases. New session columns (curator_note,
curator_override_action) added to existing 0011 migration if not yet
shipped, else a new 0011a migration."
```

---

## Task 13: Novel-pattern trigger (TDD, 2 cases) — closeSession enqueues low-similarity sessions

**Files:**
- Create: `apps/diagnostic/lib/curator/novel-trigger.ts`
- Create: `apps/diagnostic/tests/unit/curator-novel-trigger.test.ts`
- Modify: `apps/diagnostic/lib/sessions.ts` (call `enqueueIfNovelPattern` from `closeSession`)

- [ ] **Step 1: Write the failing tests.**

```ts
// apps/diagnostic/tests/unit/curator-novel-trigger.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { sessions, sessionEvents, novelPatternQueue, shops, profiles } from '@repo/db/schema'
import { eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from '../helpers/db'
import { enqueueIfNovelPattern } from '../../lib/curator/novel-trigger'

const SHOP = '00000000-0000-0000-0000-000000000001'
const SESSION = '00000000-0000-0000-0000-000000000030'

describe('enqueueIfNovelPattern', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
    await db.insert(shops).values({ id: SHOP, name: 'Test Shop' })
    await db.insert(sessions).values({
      id: SESSION, shopId: SHOP, status: 'in_progress',
      customerComplaint: 'odd noise', vehicleYear: 2020,
      vehicleMake: 'Honda', vehicleModel: 'Accord',
    })
  })
  afterEach(async () => { await close() })

  it('enqueues when max retrieval similarity < 0.6', async () => {
    await db.insert(sessionEvents).values([
      { sessionId: SESSION, kind: 'retrieval', actor: 'system', payload: { similarity: 0.42 } },
      { sessionId: SESSION, kind: 'retrieval', actor: 'system', payload: { similarity: 0.38 } },
    ])
    await enqueueIfNovelPattern(db, SESSION)

    const rows = await db.select().from(novelPatternQueue).where(eq(novelPatternQueue.sessionId, SESSION))
    expect(rows).toHaveLength(1)
    expect(rows[0].maxRetrievalSimilarity).toBeCloseTo(0.42, 4)
  })

  it('does NOT enqueue when max retrieval similarity ≥ 0.6', async () => {
    await db.insert(sessionEvents).values([
      { sessionId: SESSION, kind: 'retrieval', actor: 'system', payload: { similarity: 0.42 } },
      { sessionId: SESSION, kind: 'retrieval', actor: 'system', payload: { similarity: 0.71 } },
    ])
    await enqueueIfNovelPattern(db, SESSION)

    const rows = await db.select().from(novelPatternQueue).where(eq(novelPatternQueue.sessionId, SESSION))
    expect(rows).toHaveLength(0)
  })
})
```

The `sessionEvents` schema needs a `kind` field that supports `'retrieval'` and a JSON `payload` with a `similarity` key. Inspect the actual schema before writing — the column names may differ. Adjust the test fixtures.

- [ ] **Step 2: Run tests, confirm fail.**

```bash
pnpm --filter diagnostic test curator-novel-trigger
```

- [ ] **Step 3: Implement the helper.**

```ts
// apps/diagnostic/lib/curator/novel-trigger.ts
import { eq, sql } from 'drizzle-orm'
import type { AppDb } from '@repo/db/client'
import { sessionEvents, novelPatternQueue } from '@repo/db/schema'

const NOVEL_PATTERN_THRESHOLD = parseFloat(
  process.env.NOVEL_PATTERN_SIMILARITY_THRESHOLD ?? '0.6',
)

export async function enqueueIfNovelPattern(
  db: AppDb,
  sessionId: string,
): Promise<void> {
  const [row] = await db
    .select({
      maxSim: sql<number>`COALESCE(MAX((payload->>'similarity')::real), 0)`,
    })
    .from(sessionEvents)
    .where(sql`${sessionEvents.sessionId} = ${sessionId} AND ${sessionEvents.kind} = 'retrieval'`)

  const maxSim = row?.maxSim ?? 0
  if (maxSim >= NOVEL_PATTERN_THRESHOLD) return

  await db.insert(novelPatternQueue).values({
    sessionId,
    maxRetrievalSimilarity: maxSim,
  })
}
```

- [ ] **Step 4: Run tests, confirm pass.**

- [ ] **Step 5: Wire into `closeSession`.**

In `apps/diagnostic/lib/sessions.ts`, find the `closeSession` handler. After the existing close logic completes successfully and outcome is captured, add:

```ts
import { enqueueIfNovelPattern } from './curator/novel-trigger'

// inside closeSession, after outcome capture:
await enqueueIfNovelPattern(db, sessionId)
```

Make sure the existing `closeSession` tests still pass — they may need a fixture update if they assert on no `novel_pattern_queue` rows.

- [ ] **Step 6: Run all tests.**

```bash
pnpm --filter diagnostic test 2>&1 | tail -5
```

- [ ] **Step 7: Commit.**

```bash
git add apps/diagnostic/lib/curator/novel-trigger.ts
git add apps/diagnostic/tests/unit/curator-novel-trigger.test.ts
git add apps/diagnostic/lib/sessions.ts
git commit -m "feat(curator): novel-pattern queue trigger at closeSession

Phase P task 13. Enqueues sessions where max(retrieval similarity) < 0.6
(env-tuneable). 2 TDD cases at the 0.6 threshold."
```

---

## Task 14: Novel-pattern queue page (Screen 7)

**Files:**
- Create: `apps/diagnostic/app/curator/novel/page.tsx`
- Modify: `apps/diagnostic/lib/curator/queries.ts` (add `listPendingNovelPatterns`)

- [ ] **Step 1: Add query.**

```ts
// (append to queries.ts)
import { novelPatternQueue } from '@repo/db/schema'

export async function listPendingNovelPatterns(db: AppDb) {
  return db.select({
    queue: novelPatternQueue,
    session: sessions,
  })
  .from(novelPatternQueue)
  .innerJoin(sessions, eq(novelPatternQueue.sessionId, sessions.id))
  .where(isNull(novelPatternQueue.reviewedAt))
  .orderBy(desc(novelPatternQueue.createdAt))
}
```

- [ ] **Step 2: Write the page.**

```tsx
// apps/diagnostic/app/curator/novel/page.tsx
import Link from 'next/link'
import { db } from '@repo/db/client'
import { listPendingNovelPatterns } from '../../../lib/curator/queries'

export default async function NovelPatternQueuePage() {
  const rows = await listPendingNovelPatterns(db)
  if (rows.length === 0) return <p>No novel patterns to review.</p>
  return (
    <div className="vt-novel-page">
      <h1>Novel patterns</h1>
      <ul>
        {rows.map(({ queue, session }) => (
          <li key={queue.id}>
            <Link href={`/curator/cases/${session.id}?from=novel`}>
              {session.vehicleYear} {session.vehicleMake} {session.vehicleModel}
            </Link>
            <span>{session.customerComplaint}</span>
            <span>Max similarity: {queue.maxRetrievalSimilarity.toFixed(2)}</span>
            <time>{new Date(queue.createdAt).toLocaleDateString()}</time>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 3: Build + commit.**

```bash
git add apps/diagnostic/lib/curator/queries.ts apps/diagnostic/app/curator/novel/
git commit -m "feat(curator): novel-pattern queue page (Screen 7)"
```

---

## Task 15: Novel-pattern dismiss handler (TDD, 1 case)

**Files:**
- Create: `apps/diagnostic/lib/curator/novel-actions.ts`
- Create: `apps/diagnostic/tests/unit/curator-novel-actions.test.ts`
- Create: `apps/diagnostic/app/api/curator/novel/[id]/dismiss/route.ts`

- [ ] **Step 1: Write the failing test.**

```ts
// apps/diagnostic/tests/unit/curator-novel-actions.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { novelPatternQueue, sessions, profiles, shops } from '@repo/db/schema'
import { eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from '../helpers/db'
import { dismissNovelPattern } from '../../lib/curator/novel-actions'

const SHOP = '00000000-0000-0000-0000-000000000001'
const CURATOR = '00000000-0000-0000-0000-000000000010'
const SESSION = '00000000-0000-0000-0000-000000000030'

describe('dismissNovelPattern', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
    await db.insert(shops).values({ id: SHOP, name: 'Test Shop' })
    await db.insert(profiles).values({ id: CURATOR, userId: 'u', shopId: SHOP, role: 'curator' })
    await db.insert(sessions).values({ id: SESSION, shopId: SHOP, status: 'closed' })
  })
  afterEach(async () => { await close() })

  it('marks queue entry reviewed with decision=dismissed', async () => {
    const [entry] = await db.insert(novelPatternQueue).values({
      sessionId: SESSION, maxRetrievalSimilarity: 0.42,
    }).returning()

    await dismissNovelPattern(db, entry.id, CURATOR, 'unique noise')

    const [updated] = await db.select().from(novelPatternQueue).where(eq(novelPatternQueue.id, entry.id))
    expect(updated.reviewedAt).not.toBeNull()
    expect(updated.reviewedDecision).toBe('dismissed')
    expect(updated.reviewedByUserId).toBe(CURATOR)
    expect(updated.reviewedNote).toBe('unique noise')
  })
})
```

- [ ] **Step 2: Run, fail, implement.**

```ts
// apps/diagnostic/lib/curator/novel-actions.ts
import { eq } from 'drizzle-orm'
import type { AppDb } from '@repo/db/client'
import { novelPatternQueue } from '@repo/db/schema'

export async function dismissNovelPattern(
  db: AppDb,
  queueEntryId: string,
  curatorProfileId: string,
  note: string | null,
) {
  await db.update(novelPatternQueue).set({
    reviewedAt: new Date(),
    reviewedDecision: 'dismissed',
    reviewedByUserId: curatorProfileId,
    reviewedNote: note,
  }).where(eq(novelPatternQueue.id, queueEntryId))
  return { kind: 'ok' as const }
}
```

- [ ] **Step 3: Run tests, confirm pass. Write API route shim. Wire into Screen 3 (`from === 'novel'` context). Commit.**

```bash
git add apps/diagnostic/lib/curator/novel-actions.ts
git add apps/diagnostic/tests/unit/curator-novel-actions.test.ts
git add apps/diagnostic/app/api/curator/novel/
git commit -m "feat(curator): dismiss novel-pattern queue entries"
```

The "Add to corpus" button on Screen 3 routes to `/curator/corpus/new?fromCase=<sessionId>` instead of POSTing — that path is implemented in Task 16. The corpus action also sets `reviewedDecision='corpus'` on the queue entry; that's a side effect of Task 16's POST handler.

---

## Task 16: Corpus authoring form + POST handler (TDD, 2 cases)

**Files:**
- Create: `apps/diagnostic/app/curator/corpus/new/page.tsx`
- Create: `apps/diagnostic/lib/curator/corpus-actions.ts`
- Create: `apps/diagnostic/tests/unit/curator-corpus-actions.test.ts`
- Create: `apps/diagnostic/app/api/curator/corpus/route.ts`

- [ ] **Step 1: Write the failing tests.**

```ts
// apps/diagnostic/tests/unit/curator-corpus-actions.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { corpusEntries, novelPatternQueue, sessions, profiles, shops } from '@repo/db/schema'
import { eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from '../helpers/db'
import { createCuratorCorpusEntry } from '../../lib/curator/corpus-actions'

const SHOP = '00000000-0000-0000-0000-000000000001'
const CURATOR = '00000000-0000-0000-0000-000000000010'
const SESSION = '00000000-0000-0000-0000-000000000030'

describe('createCuratorCorpusEntry', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
    await db.insert(shops).values({ id: SHOP, name: 'Test Shop' })
    await db.insert(profiles).values({ id: CURATOR, userId: 'u', shopId: SHOP, role: 'curator' })
    await db.insert(sessions).values({ id: SESSION, shopId: SHOP, status: 'closed' })
  })
  afterEach(async () => { await close() })

  it('inserts entry with isCuratorEntry=true and source ids null', async () => {
    const result = await createCuratorCorpusEntry(db, CURATOR, {
      vehicleYear: 2018, vehicleMake: 'Ford', vehicleModel: 'F-150', vehicleEngine: '5.0L',
      symptomTags: ['power_loss'], dtcs: ['P0420'],
      observations: 'rpm dips at idle', faultPattern: { rpm: 'low' },
      rootCause: 'failed catalyst monitor', actionTaken: { type: 'replace', component: 'catalyst' },
      verification: { codes_cleared: true, test_drive: true, symptoms_resolved: true },
    })
    expect(result.kind).toBe('ok')

    const [entry] = await db.select().from(corpusEntries).where(eq(corpusEntries.id, result.id))
    expect(entry.isCuratorEntry).toBe(true)
    expect(entry.sourceSessionId).toBeNull()
    expect(entry.sourceShopId).toBeNull()
    expect(entry.curatedByUserId).toBe(CURATOR)
  })

  it('when fromCaseId provided, marks the novel-pattern queue entry as reviewed=corpus', async () => {
    const [queueEntry] = await db.insert(novelPatternQueue).values({
      sessionId: SESSION, maxRetrievalSimilarity: 0.42,
    }).returning()

    await createCuratorCorpusEntry(db, CURATOR, {
      vehicleYear: 2018, vehicleMake: 'Ford', vehicleModel: 'F-150', vehicleEngine: '5.0L',
      symptomTags: ['power_loss'], dtcs: ['P0420'], observations: '...', faultPattern: {},
      rootCause: 'X', actionTaken: {}, verification: {},
    }, { fromQueueEntryId: queueEntry.id })

    const [updated] = await db.select().from(novelPatternQueue).where(eq(novelPatternQueue.id, queueEntry.id))
    expect(updated.reviewedDecision).toBe('corpus')
    expect(updated.reviewedAt).not.toBeNull()
  })
})
```

The `corpus_entries` columns referenced (`isCuratorEntry`, `sourceSessionId`, `sourceShopId`, `curatedByUserId`, `vehicleYear` etc.) need to match the actual schema — verify before writing.

- [ ] **Step 2: Implement the handler.**

```ts
// apps/diagnostic/lib/curator/corpus-actions.ts
import { eq } from 'drizzle-orm'
import type { AppDb } from '@repo/db/client'
import { corpusEntries, novelPatternQueue } from '@repo/db/schema'

export type CuratorCorpusInput = {
  vehicleYear: number
  vehicleMake: string
  vehicleModel: string
  vehicleEngine: string
  symptomTags: string[]
  dtcs: string[]
  observations: string
  faultPattern: Record<string, unknown>
  rootCause: string
  actionTaken: Record<string, unknown>
  verification: Record<string, unknown>
}

export async function createCuratorCorpusEntry(
  db: AppDb,
  curatorProfileId: string,
  input: CuratorCorpusInput,
  options: { fromQueueEntryId?: string } = {},
): Promise<{ kind: 'ok'; id: string } | { kind: 'error'; reason: string }> {
  return db.transaction(async (tx) => {
    const [entry] = await tx.insert(corpusEntries).values({
      vehicleYear: input.vehicleYear, vehicleMake: input.vehicleMake,
      vehicleModel: input.vehicleModel, vehicleEngine: input.vehicleEngine,
      symptomTags: input.symptomTags, dtcs: input.dtcs,
      observations: input.observations, faultPattern: input.faultPattern,
      rootCause: input.rootCause, actionTaken: input.actionTaken,
      verification: input.verification,
      isCuratorEntry: true,
      sourceSessionId: null, sourceShopId: null,
      curatedByUserId: curatorProfileId,
    }).returning({ id: corpusEntries.id })

    if (options.fromQueueEntryId) {
      await tx.update(novelPatternQueue).set({
        reviewedAt: new Date(),
        reviewedDecision: 'corpus',
        reviewedByUserId: curatorProfileId,
      }).where(eq(novelPatternQueue.id, options.fromQueueEntryId))
    }

    return { kind: 'ok' as const, id: entry.id }
  })
}
```

- [ ] **Step 3: Run tests, confirm pass.**

- [ ] **Step 4: Write the form page.**

```tsx
// apps/diagnostic/app/curator/corpus/new/page.tsx
import { db } from '@repo/db/client'
import { fetchCuratorCaseDetail } from '../../../../lib/curator/case-detail-query'
import { CorpusForm } from '../../../../components/curator/corpus-form'

export default async function NewCorpusEntryPage({
  searchParams,
}: { searchParams: Promise<{ fromCase?: string; fromQueueEntry?: string }> }) {
  const sp = await searchParams
  let prefill = null
  if (sp.fromCase) {
    const detail = await fetchCuratorCaseDetail(db, sp.fromCase)
    prefill = detail?.session ?? null
  }
  return <CorpusForm prefill={prefill} fromQueueEntryId={sp.fromQueueEntry} />
}
```

`CorpusForm` is a client component with the full field set. It POSTs to `/api/curator/corpus`. On success, redirects to `/curator/corpus`.

- [ ] **Step 5: Write the API route shim.**

```ts
// apps/diagnostic/app/api/curator/corpus/route.ts
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@repo/db/client'
import { createCuratorCorpusEntry } from '@/lib/curator/corpus-actions'
import { requireCurator } from '@/lib/curator/route-helpers'

const CorpusInputSchema = z.object({
  input: z.object({
    vehicleYear: z.number().int(),
    vehicleMake: z.string().min(1),
    vehicleModel: z.string().min(1),
    vehicleEngine: z.string().min(1),
    symptomTags: z.array(z.string()),
    dtcs: z.array(z.string()),
    observations: z.string(),
    faultPattern: z.record(z.string(), z.unknown()),
    rootCause: z.string().min(1),
    actionTaken: z.record(z.string(), z.unknown()),
    verification: z.record(z.string(), z.unknown()),
  }),
  fromQueueEntryId: z.string().uuid().optional(),
})

export async function POST(req: Request) {
  const auth = await requireCurator()
  if (auth.kind !== 'ok') return auth.response

  const parsed = CorpusInputSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid input', issues: parsed.error.issues }, { status: 400 })
  }
  const result = await createCuratorCorpusEntry(
    db, auth.profileId, parsed.data.input,
    parsed.data.fromQueueEntryId ? { fromQueueEntryId: parsed.data.fromQueueEntryId } : {},
  )
  if (result.kind !== 'ok') return NextResponse.json({ error: result.reason }, { status: 400 })
  return NextResponse.json({ ok: true, id: result.id })
}
```

- [ ] **Step 6: Build + commit.**

```bash
git add apps/diagnostic/lib/curator/corpus-actions.ts
git add apps/diagnostic/tests/unit/curator-corpus-actions.test.ts
git add apps/diagnostic/app/curator/corpus/
git add apps/diagnostic/app/api/curator/corpus/
git add apps/diagnostic/components/curator/corpus-form.tsx
git commit -m "feat(curator): corpus authoring form + POST handler

Phase P task 16. 2 TDD cases. When fromQueueEntryId provided, marks the
novel-pattern queue entry as reviewed=corpus in the same transaction."
```

---

## Task 17: Corpus list (Screen 9)

**Files:**
- Create: `apps/diagnostic/app/curator/corpus/page.tsx`

- [ ] **Step 1: Write the page.**

```tsx
// apps/diagnostic/app/curator/corpus/page.tsx
import Link from 'next/link'
import { db } from '@repo/db/client'
import { corpusEntries } from '@repo/db/schema'
import { eq, desc } from 'drizzle-orm'

export default async function CorpusListPage({
  searchParams,
}: { searchParams: Promise<{ curator?: string }> }) {
  const sp = await searchParams
  const showOnlyCurator = sp.curator === '1'
  let q = db.select().from(corpusEntries).orderBy(desc(corpusEntries.createdAt))
  if (showOnlyCurator) q = q.where(eq(corpusEntries.isCuratorEntry, true)) as any
  const rows = await q

  return (
    <div className="vt-corpus-page">
      <header>
        <h1>Corpus entries</h1>
        <Link href="/curator/corpus/new" className="vt-button">+ New entry</Link>
        <Link href={showOnlyCurator ? '/curator/corpus' : '/curator/corpus?curator=1'}>
          {showOnlyCurator ? 'Show all' : 'Show curator-authored only'}
        </Link>
      </header>
      <table>
        <thead>
          <tr><th>Vehicle</th><th>Symptom tags</th><th>Root cause</th><th>Source</th><th>Created</th></tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id}>
              <td>{r.vehicleYear} {r.vehicleMake} {r.vehicleModel}</td>
              <td>{(r.symptomTags as string[]).join(', ')}</td>
              <td>{r.rootCause}</td>
              <td>{r.isCuratorEntry ? 'curator' : 'system'}</td>
              <td>{new Date(r.createdAt).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 2: Build + commit.**

```bash
git add apps/diagnostic/app/curator/corpus/page.tsx
git commit -m "feat(curator): corpus list (Screen 9)"
```

---

## Task 18: Pre-deploy + verification (smoke + authed flow)

**Files:** none (operational tasks).

- [ ] **Step 1: Grant Brandon's profile the curator role.**

Find Brandon's auth user UUID via Supabase MCP `execute_sql`:

```sql
SELECT id, email FROM auth.users WHERE email = 'brandon@vyntechs.com';
-- copy the auth_uid
SELECT id, role FROM profiles WHERE user_id = '<auth_uid>';
-- if role != 'curator':
UPDATE profiles SET role = 'curator' WHERE user_id = '<auth_uid>';
```

Verify:

```sql
SELECT role FROM profiles WHERE user_id = '<auth_uid>';
-- expect 'curator'
```

- [ ] **Step 2: Confirm migration `0011_drift_alerts_lifecycle.sql` is applied on prod.**

Already done in Task 1, but verify:

```sql
SELECT * FROM drift_alerts LIMIT 1;  -- should have 4 new columns visible
SELECT count(*) FROM novel_pattern_queue;  -- should be 0
```

- [ ] **Step 3: Run full local test suite.**

```bash
pnpm --filter diagnostic test 2>&1 | tail -5
pnpm --filter diagnostic typecheck
pnpm --filter diagnostic build 2>&1 | tail -10
```

Expected: 398/398 + N new tests, clean tsc, build succeeds. Look for new `/curator/*` routes in build output.

- [ ] **Step 4: Push branch, create PR, deploy preview.**

```bash
git push -u origin feature/phase-p-curator
gh pr create --title "feat(phase-p): curator console" --body "$(cat <<'EOF'
## Summary
- 5 curator console surfaces (drift queue, calibration dashboard, deferred queue, novel-pattern queue, corpus authoring) under /curator/*
- Migration 0011 adds drift_alerts lifecycle fields + novel_pattern_queue table
- First middleware in the diagnostic app — gates /curator/* by profiles.role = 'curator'
- 5 new unit tests covering data-mutation paths

## Test plan
- [ ] `pnpm test` green locally (398 + new)
- [ ] Vercel preview deploy READY
- [ ] Sign in as Brandon, navigate /curator/drift, eyeball the empty state
- [ ] Sign in as a non-curator (test user), confirm /curator/drift redirects to /

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Once preview is READY, smoke test.**

```bash
SMOKE_TEST_URL=<preview-url> pnpm --filter diagnostic test:smoke
# expect 9/9 (existing smoke suite — should still pass)
```

- [ ] **Step 6: Authed-flow verification.**

Using Playwright MCP or chrome-devtools-mcp:
1. Sign in to the preview as Brandon (curator).
2. Navigate to `/curator/drift`. Expect either pending recommendations or the empty state.
3. Click into a recommendation drill-down → click into a case detail → click back. No console errors.
4. Navigate to `/curator/calibration`. Confirm the table renders.
5. Sign out, navigate `/curator/drift` directly — expect redirect to `/sign-in`.
6. Sign in as a tech (non-curator) test user — expect redirect to `/`.

If any redirect doesn't fire, the middleware isn't wired correctly — go back to Task 2 and verify.

- [ ] **Step 7: Promote PR to main.**

After Brandon's eyeball review, merge.

```bash
gh pr merge --squash
```

- [ ] **Step 8: Final commit confirms migration session reads.**

The migration session (working on Stage 3 next) needs to know Phase P shipped. After merge, write a brief Phase P shipped note to `docs/superpowers/sessions/2026-05-06-handoff-phase-p-shipped.md` summarizing PR #, merge commit, what's live.

---

## Self-review checklist

Plan author runs this before declaring done:

- [ ] **Spec coverage:** every screen 1-10 has at least one task implementing it. ✓
- [ ] **Schema additions match spec:** 4 lifecycle cols on `drift_alerts`, `novel_pattern_queue` table, RLS policy. ✓
- [ ] **All TDD targets covered:** 4 drift resolution + 1 bulk dismiss + 2 badge query + 4 role-gate + 3 deferred + 2 novel trigger + 1 novel dismiss + 2 corpus = 19 tests across 6 files. ✓
- [ ] **No "TODO" / "TBD" / "implement appropriately" placeholders:** none found.
- [ ] **No invented schema columns:** the plan flags two places (sessions table columns referenced in Task 12, sessionEvents schema in Task 13) where the executor must verify column names against the actual schema before writing.
- [ ] **Type consistency:** `applyDriftAlert` / `dismissDriftAlert` / `bulkDismissDriftAlerts` consistent across tests + handler + route shims. `enqueueIfNovelPattern` consistent. `guardCuratorRoute` consistent.
- [ ] **Migration filename is `0011_drift_alerts_lifecycle.sql`:** Phase P reservation respected. Task 12 flags the potential conflict with Stage 3's `0012` and provides the `0011a_*` workaround.

---

## Open items deferred to future phases

(Per spec's Open Items section — not implemented in this plan.)

- Email notifications on Monday morning (Decision 7).
- Optimistic concurrency for multi-curator (Decision 8).
- Per-category history depth filtering (currently fixed at 6).
- Corpus list full-text search (currently filter-by-curator only).
- Mobile fallback layout (currently desktop-only with graceful "use desktop" message).

---

## Rollback

Per-task rollback: `git revert <task-commit-sha>`.

Whole-Phase-P rollback:
1. `git revert` all Phase P commits in reverse order, OR `git reset --hard` to the merge base on `main`.
2. Drop the new schema additions via Supabase MCP `execute_sql`:

```sql
DROP TABLE IF EXISTS novel_pattern_queue CASCADE;
ALTER TABLE drift_alerts
  DROP COLUMN IF EXISTS decision,
  DROP COLUMN IF EXISTS decided_at,
  DROP COLUMN IF EXISTS decided_by_user_id,
  DROP COLUMN IF EXISTS decision_note;
DROP INDEX IF EXISTS drift_alerts_pending_idx;
```

3. Revert `profiles.role = 'curator'` for Brandon if a clean rollback is wanted (`UPDATE profiles SET role = 'tech' WHERE ...`).

---
