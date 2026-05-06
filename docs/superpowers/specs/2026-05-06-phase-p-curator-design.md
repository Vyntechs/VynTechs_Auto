# Phase P — Curator Console Design

**Status:** Brainstorm complete 2026-05-06; pending Brandon final review.
**Implements:** Master spec §9.4 ("Curator console layout — `/curator` at viewport ≥ 1280px").
**Migration filename:** `0011_drift_alerts_lifecycle.sql` (reserved per `origin/docs/phase-p-handoff` 25d6031).

## Scope

Curator console for Brandon (sole curator at MVP). Five surfaces, role-gated, desktop-only:

1. **Recommendations review** (drift queue) — weekly Monday recommendations from the calibration cron
2. **Calibration thresholds dashboard** — read-only view of all per-cell cutoffs
3. **Deferred cases queue** — sessions the tech chose to defer to a curator
4. **Novel-pattern queue** — sessions where retrieval found no above-threshold corpus matches
5. **Corpus authoring** — form to write new corpus entries (curator-authored)

The console is read-mostly. Only the **Apply** action on a recommendation writes to `confidence_calibration`. Everything else writes to lifecycle fields on existing tables (`drift_alerts`, `corpus_entries`) or to a new lightweight queue table (`novel_pattern_queue`).

## Architecture

Same Next.js 16 codebase as the diagnostic app. Curator routes under `/curator/*`. Role-gate via Next.js middleware (NEW for this app — see Decision 4 in master plan's Stage 3 corrections; `apps/diagnostic/middleware.ts` doesn't yet exist). Sidebar nav with 5 entries. Desktop-only viewport (≥ 1280px); smaller screens render a graceful "use a desktop browser" message rather than a fallback layout.

Auth + role-gate flow:
1. Middleware reads supabase session.
2. If unauthed → `/sign-in`.
3. If authed and route is `/curator/*`, look up `profiles.role` for the user. If `!= 'curator'` → `/`.
4. If pass: page server component runs as usual; `requireUserAndProfile` remains in place as defense-in-depth and to supply typed `ctx`.

## Schema additions

### Migration `0011_drift_alerts_lifecycle.sql`

Adds 4 columns + 1 partial index to the existing `drift_alerts` table (Phase Q, migration `0010`), and creates the new `novel_pattern_queue` table:

```sql
-- Lifecycle fields on drift_alerts
ALTER TABLE drift_alerts
  ADD COLUMN decision text CHECK (decision IN ('applied','dismissed')),
  ADD COLUMN decided_at timestamp with time zone,
  ADD COLUMN decided_by_user_id uuid REFERENCES profiles(id),
  ADD COLUMN decision_note text;

CREATE INDEX drift_alerts_pending_idx ON drift_alerts (created_at DESC)
  WHERE decision IS NULL;

-- New queue: sessions flagged as novel patterns at session-close
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

-- RLS: curator role only
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

### Drizzle mirrors in `packages/db/src/schema/index.ts`

```ts
export const driftAlerts = pgTable('drift_alerts', {
  // ... existing columns from 0010 (id, riskClass, vehicleFamily, symptomClass,
  //     oldThreshold, newThreshold, comebackRate, sampleSize, createdAt) ...
  decision: text('decision', { enum: ['applied', 'dismissed'] }),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  decidedByUserId: uuid('decided_by_user_id').references(() => profiles.id),
  decisionNote: text('decision_note'),
}, (t) => ({
  pendingIdx: index('drift_alerts_pending_idx').on(t.createdAt.desc()).where(sql`decision IS NULL`),
}))

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
```

### Field semantics

**`drift_alerts` lifecycle:**
- `decision` — NULL until acted on; then `'applied'` or `'dismissed'`.
- `decided_at` — timestamp of the click.
- `decided_by_user_id` — FK to `profiles.id`. Future-proofs for second curator.
- `decision_note` — optional free-text on either Apply or Dismiss; blank allowed.

**`novel_pattern_queue`:**
- `max_retrieval_similarity` — the highest similarity score from rung-0 retrieval at session-close. Captured for context (lets the curator see *how* novel the case was).
- `reviewed_decision` — `'corpus'` (curator wrote a corpus entry) or `'dismissed'` (unique noise).
- `reviewed_note` — optional context.

### Why partial indexes

Both queues' hot path is "list pending only." Partial indexes (`WHERE decision IS NULL` / `WHERE reviewed_at IS NULL`) keep that query O(log pending) regardless of historical volume. As resolved rows accumulate, the index ignores them.

### Re-recommendation badge (derived at query time)

When a row with `decision = 'dismissed'` exists for the same `(risk_class, vehicle_family, symptom_class)` cell within the past 90 days, surface a "previously dismissed" badge on the new recommendation. Computed at query time, not stored:

```sql
SELECT da.*,
       EXISTS (
         SELECT 1 FROM drift_alerts d2
         WHERE d2.risk_class = da.risk_class
           AND d2.vehicle_family = da.vehicle_family
           AND d2.symptom_class = da.symptom_class
           AND d2.decision = 'dismissed'
           AND d2.decided_at > now() - interval '90 days'
           AND d2.id != da.id
       ) AS was_dismissed_recently
FROM drift_alerts da
WHERE decision IS NULL
ORDER BY ...;
```

90 days is configurable; chosen to match a roughly quarterly re-evaluation cadence.

## UI screens

### Screen 1: Recommendations review — `/curator/drift`

Lines list of pending drift alerts. Each row, left to right:
- **Slice description** (clickable; opens Screen 2): *"medium-risk × pickup × power_loss"*
- **Threshold change**: *"72 → 78"* with directional arrow + color
- **Evidence**: *"14 samples, 21% comeback, last 4 weeks"*
- **Age**: *"5 days ago"*
- **Previously-dismissed badge** (when `was_dismissed_recently`): small grey tag
- **Apply / Dismiss buttons**: click → inline note slot opens (optional) → confirm

**Sort:** `risk_class` severity DESC (`destructive > high > medium > low > zero`), then `created_at` ASC. Old high-risk pending floats to top.

**Filters:** risk class, vehicle family, symptom class. All "*" by default.

**Empty state:** *"Queue empty. Last update: <created_at>. View all thresholds →"* linking to Screen 4.

**Bulk actions:** checkbox column + "Dismiss N selected" button. Useful for bad-data weeks.

### Screen 2: Recommendation drill-down — `/curator/drift/[id]`

Separate screen (not inline, not modal). Lists the cases backing the recommendation. Each row:
- Vehicle (year/make/model/engine)
- Symptom presented (original complaint)
- AI's proposed action + confidence at the time
- What the tech actually did
- Outcome: clean / comeback / pending

Click a row → Screen 3 (full case detail).

Back button returns to `/curator/drift` with filter/sort state preserved.

### Screen 3: Full case detail — `/curator/cases/[sessionId]`

Shared screen, used from Screens 2 (drift drill-down), 6 (deferred queue), 7 (novel-pattern queue). Top to bottom:
- Header: vehicle + customer complaint
- Conversation log: every AI/tech exchange, time-stamped, photos inline
- Diagnostic path visual: tree showing AI's reasoning trajectory
- AI's proposed action + confidence
- Tech's action + override note (if any)
- Outcome
- Side panels: similar past cases retrieved, corpus entries pulled, follow-up timestamps

Action buttons at bottom — context-specific:
- **From Screen 2:** no actions (informational only). Apply/Dismiss decision happens on Screen 1.
- **From Screen 6 (deferred):** **Approve** (greenlights AI's last suggestion → resumes session), **Override** (curator supplies a different next action → resumes), **Close** (terminates).
- **From Screen 7 (novel-pattern):** **Add to corpus** (jumps to Screen 8 with case fields pre-filled via query param), **Dismiss** (mark reviewed; case is unique noise).

Back button returns to whichever queue.

### Screen 4: Calibration thresholds dashboard — `/curator/calibration`

Read-only table of the entire `confidence_calibration` table. Columns:
- Slice description (clickable; opens Screen 5)
- Current threshold
- Sample size (last 30 days)
- Comeback rate (last 30 days)
- Last refit date (`last_refit_at`)

**Sort:** alphabetical by slice description default; click any column header to re-sort.

**Filters:** risk class, vehicle family, symptom class.

**Pending-recommendations indicator:** *"🔔 N pending recommendations →"* link in top-right when `count(drift_alerts WHERE decision IS NULL) > 0`. Jumps to Screen 1.

### Screen 5: Per-category history — `/curator/calibration/[risk]/[vehicle]/[symptom]`

Separate screen. Shows the last 6 drift alerts for that specific cell:
- Date the cron generated the alert
- Recommended threshold change (X → Y)
- Decision (applied / dismissed / pending)
- Decision note if any
- Decided-by user

Sorted DESC by `created_at`.

Back button returns to Screen 4.

### Screen 6: Deferred cases queue — `/curator/deferred`

Lines of sessions where the tech chose `defer` after a gated action. Each row:
- Session reference (vehicle + customer complaint)
- Time deferred
- AI's last suggestion + confidence
- Current state (which step of the diagnostic tree the AI was on)

Sort: `deferred_at DESC` (newest first).

Click → Screen 3.

### Screen 7: Novel-pattern queue — `/curator/novel`

Lines of sessions where Rung-0 retrieval pulled no corpus entries with similarity ≥ 0.6. Each row:
- Session reference (vehicle + customer complaint)
- Max retrieval similarity (e.g. *"0.42"*) — gives curator a sense of *how* novel
- Time flagged
- Outcome (the case must have resolved successfully to be flagged)

Sort: `created_at DESC` for the queue table.

Click → Screen 3.

### Screen 8: Corpus authoring — `/curator/corpus/new`

Form fields mirror the existing `corpus_entries` schema:
- Vehicle: year, make, model, engine
- Symptom tags (multi-select)
- DTCs (multi-input)
- Observations (free-text)
- Fault pattern (structured: rpm, load, temp, fuel trim)
- Root cause (free-text, with specificity hint)
- Action taken (type, location, identifier, part info)
- Verification (codes cleared, test drive done, symptoms resolved)

**Pre-fill from Screen 7:** if `?fromCase=<sessionId>` query param, populate fields from that session.

**Save:** insert into `corpus_entries` with `is_curator_entry = true`, `source_session_id = NULL`, `source_shop_id = NULL` (per existing nullable FKs — no schema change needed).

Confirmation toast → redirect to Screen 9.

### Screen 9: Corpus list — `/curator/corpus`

Read-only table of all corpus entries. Filter by `is_curator_entry`. Click an entry → read-only detail view (out of scope for this phase; future enhancement).

### Screen 10: Console layout

Sidebar nav (always visible, left side, 240px wide):
- Today's recommendations (Screen 1)
- Deferred cases (Screen 6)
- Novel patterns (Screen 7)
- Corpus (Screen 9)
- Calibration thresholds (Screen 4)

Active item highlighted. Header bar shows "Vyntechs Curator" + signed-in name.

**Role-gate:** middleware checks `profiles.role === 'curator'` for every `/curator/*` route. Non-curators redirect to `/`. Curator role is granted via Supabase MCP `execute_sql` once Brandon's profile UUID is known.

**Viewport handling:** `min-width: 1280px` on the console's root container. Below threshold, render a centered card: *"Curator tools require a desktop browser. Please open this in Chrome or Safari at a window width of at least 1280 pixels."* No fallback layout.

## Triggers and flows

### Drift alert generation (existing — Phase Q)

Cron runs Monday 06:00 UTC. For each `confidence_calibration` cell, check whether the last-4-weeks comeback data warrants a threshold move (≥5 points + ≥10 samples). If yes, write a row to `drift_alerts`. Already shipped.

### Drift alert resolution (Phase P, new)

**Apply** click on Screen 1:
1. UPDATE `confidence_calibration.threshold_pct = drift_alerts.new_threshold` for the matching cell.
2. UPDATE `confidence_calibration.last_refit_at = now()`.
3. UPDATE `drift_alerts SET decision='applied', decided_at=now(), decided_by_user_id=<uid>, decision_note=<text or NULL>` for the row.
4. All three writes in a single transaction.

**Dismiss** click on Screen 1:
1. UPDATE `drift_alerts SET decision='dismissed', decided_at=now(), decided_by_user_id=<uid>, decision_note=<text or NULL>`.

**Bulk dismiss:** same UPDATE in a single statement against multiple ids.

### Deferred queue trigger (existing flow)

`advanceSession` runs `gateProposedAction()`. When gated, returns `options: ['gather_more_low_risk', 'decline', 'defer']`. Tech picking `'defer'` → `/api/sessions/[id]/decline-or-defer` → `declineOrDeferSessionForUser` writes to `sessions` (existing column set). No Phase P schema change required.

Deferred queue's query: `SELECT * FROM sessions WHERE status = 'deferred' AND closed_at IS NULL ORDER BY deferred_at DESC`.

### Novel-pattern queue trigger (Phase P, new)

At `closeSession` (existing handler in `lib/sessions.ts`), after the session is closed, compute `max(similarity_score)` across the session's rung-0 retrievals (existing data in `session_events`). If `max_similarity < 0.6`, INSERT into `novel_pattern_queue` with `max_retrieval_similarity = <value>`.

**Why no outcome filter:** at session-close, the 7-day/30-day comeback windows haven't elapsed; "successful outcome" is ambiguous to compute. Enqueue on similarity alone, and let the curator dismiss noise on Screen 3 (the **Dismiss** button records `reviewed_decision='dismissed'`). This also surfaces sessions the tech declined or couldn't resolve — sometimes those are exactly the novel patterns worth corpus authoring.

The threshold (0.6) is configurable via env var `NOVEL_PATTERN_SIMILARITY_THRESHOLD`; chosen as the conservative default. Tuneable based on observed signal-to-noise.

When Brandon clicks **Add to corpus** or **Dismiss** on Screen 3 from this queue, UPDATE `novel_pattern_queue SET reviewed_at=now(), reviewed_decision=..., reviewed_by_user_id=<uid>, reviewed_note=<text or NULL>`.

## Decisions

| # | Question | Resolution |
|---|----------|-----------|
| 1 | Drift alert lifecycle | Apply + Dismiss with audit trail (4 fields per row) |
| 2 | Apply button placement | Two pages (drift queue + calibration dashboard) plus per-category history |
| 3 | Curator-authored corpus FK | Collapsed — already nullable, no migration needed |
| 4 | Optional decision note | On both Apply and Dismiss; blank allowed |
| 5 | Re-recommendation when previously dismissed | Re-generate with "previously dismissed" badge (90-day window) |
| 6 | Pagination / bulk actions | Single scrollable page with bulk-dismiss |
| 7 | Notifications (deferred to future) | None at MVP; revisit if Brandon's cadence drifts |
| 8 | Concurrent curator races (deferred to future) | Last-write-wins; OK for single-curator MVP |

## Open items / future work

- **Notifications (Decision 7):** if Brandon's cadence drifts, add Monday-morning email with pending count.
- **Optimistic concurrency (Decision 8):** when a second curator is hired, switch to optimistic-lock pattern with version columns.
- **Per-category history depth:** currently shows last 6 alerts. May want filtering by date range or "show all."
- **Corpus list filtering / search:** Screen 9 is intentionally minimal at MVP.
- **Mobile fallback:** desktop-only by design; if Brandon ever needs to triage from a phone, build a separate read-only mobile view (post-MVP).

## Implementation breakdown (sketch — full plan in writing-plans)

| Task | Surfaces touched | Schema | Risk |
|------|------------------|--------|------|
| P1 | Console layout (Screen 10), sidebar, role-gate middleware | none | Low |
| P2 | Deferred queue (Screen 6) | reads existing `sessions` | Low |
| P3 | Drift queue (Screens 1-2) + lifecycle migration | adds 4 cols to `drift_alerts` | Medium |
| P4 | Novel-pattern queue (Screen 7) + queue table | adds `novel_pattern_queue` table + closeSession trigger | Medium |
| P5 | Full case detail (Screen 3) — shared | reads existing tables | Low |
| P6 | Corpus authoring form (Screen 8) | inserts into existing `corpus_entries` | Low |
| P7 | Calibration dashboard + history (Screens 4-5) | reads `confidence_calibration` + `drift_alerts` | Low |

**Total surfaces:** 10 screens, 1 migration (`0011_drift_alerts_lifecycle.sql`), 1 new table (`novel_pattern_queue`), 4 new columns on `drift_alerts`. Estimated 3-5 implementation sessions depending on TDD depth.

**Test coverage targets:**
- Drift alert resolution transaction (Apply path): 4 cases (Apply with note, Apply without note, Dismiss with note, Dismiss without note).
- Bulk dismiss: 1 case (3 rows dismissed atomically).
- Re-recommendation badge query: 2 cases (within 90 days = badge, outside = no badge).
- Novel-pattern queue trigger at closeSession: 2 cases (similarity < 0.6 = enqueue, ≥ 0.6 = skip).
- Role-gate middleware: 4 cases (curator allowed, non-curator redirected, unauthed redirected, public route allowed).

## Source

This design was produced by the migration session 2026-05-06 after taking over the frozen diagnostic session `b386921b-c8d9-4155-8acb-7ce96d2bf4fd`. Brainstorm rescue capture at `docs/superpowers/sessions/2026-05-06-phase-p-brainstorm-rescue.md`. All decisions captured here were affirmed by Brandon during the resumed brainstorm.
