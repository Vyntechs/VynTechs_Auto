# Vyntechs Orchestration — Phase 3 Kickoff

**Trigger phrases:** "orchestration phase 3" · "diagnostic skill build" · "platform resolver" · "wire diagnostic page to live DB"

**One-line for Brandon's paste at the start of a fresh session:**

```
Resume from docs/superpowers/handoffs/2026-05-19-orchestration-phase-3-kickoff.md
```

---

## What this is

Phase 1 (schema migration) and Phase 2 (manually running the 4-prompt chain to validate the data shape and build the F-250 6.7L PSD knowledge base) are done. Phase 3 is **turning that knowledge base into the shop-floor product** — the user-facing flow where a tech enters a vehicle + complaint and gets a diagnostic on screen, no AI involved at runtime for already-seen symptoms.

## State as of end-of-session 2026-05-19

| Thing | Where |
|---|---|
| Integration branch | `origin/staging-interactive-diagnostics` (head: `<commit-after-runs-6-7>`) |
| Live Supabase project | `ynmtszuybeenjbigxdyl` (Vyntechs Auto, the production DB) |
| Phase 2 progress report | `docs/superpowers/phase2-runs/PROGRESS-REPORT-2026-05-19.md` |
| Coverage tracker | `docs/superpowers/phase2-runs/COVERAGE-TRACKER.md` |
| Per-run artifacts | `docs/superpowers/phase2-runs/run-1` through `run-7/` (Runs 1-3: fuel diagnostics; Runs 4-7: platform knowledge for cooling, air/turbo, engine mechanical, electrical) |
| Phase 1 spec | `docs/superpowers/specs/2026-05-19-orchestration-schema-design.md` |
| Phase 2 spec | `docs/superpowers/specs/2026-05-19-orchestration-phase2-smallest-viable-test-design.md` |
| Original kickoff | `docs/superpowers/handoffs/2026-05-19-orchestration-build-kickoff.md` |
| Phase 2 kickoff | `docs/superpowers/handoffs/2026-05-19-orchestration-phase-2-kickoff.md` |
| JSON-to-SQL converter | `/tmp/json2sql.py` (gets wiped on reboot; recreate from Phase 2 commits if needed) |

## Live database snapshot at Phase 2 close

| Table | Active rows |
|---|---|
| `platforms` | 1 (Ford Super Duty 4th-gen 6.7L PSD, year range 2017-2022) |
| `architecture_facts` | 141 |
| `components` | 123 |
| `observable_properties` | 187 |
| `component_connections` | 188 |
| `symptoms` | 3 (P0087, P0088, no-start-cranks-normally-fuel-system-suspect) |
| `test_actions` | 28 |
| `branch_logic` | 83 |
| `symptom_test_implications` | 44 |
| `diagnostic_sessions` | 1 (Run 1 Gate 5 simulated walk) |
| `tech_outcomes` | 12 |
| `platform_equivalents` | 0 |

## What's locked from Phase 2

- **Five systems modeled end-to-end on the F-250 platform:** fuel, cooling, engine air + turbo + EGR + aftertreatment, engine mechanical + oil + glow plugs, electrical/charging/starting.
- **Three production-ready diagnostics:** P0087 (full simulated walk done), P0088, no-start-cranks-normally.
- **One FIELD-VERIFIED upgrade trail:** CP4 cavitation knock observable, with retirement-pattern lineage preserved.
- **Cross-system reuse validated:** PCM, HS-CAN, instrument cluster, engine gear train, EGR cooler, DEF system all referenced across multiple systems without duplication.
- **The schema works under production load.** Every gate, every retirement, every multi-symptom query returns clean data.

## What Phase 2 deliberately did NOT do (out of scope, now Phase 3 territory)

- **Cross-platform `platform_equivalents` population** — original spec Run 4 (2019 F-350 cache-hit) was not run. The schema supports it; just no rows. Phase 3 will add platform_equivalents as part of the platform-resolver work.
- **Real tech runs against a real vehicle** — original spec Run 5 was simulated in Run 1's Gate 5 but never run against an actual customer truck. This becomes natural in Phase 3 once the UI is wired and real techs use the system.
- **Diagnostics for cooling, air/turbo, engine mechanical, electrical systems** — architecture and topology are built; no symptom→tests bindings yet. These will be added on demand as customer complaints come in (Phase 3 design: AI builds new diagnostics on first encounter, caches them).

## Phase 3 scope — the front door to the data

The data layer is done. Phase 3 builds the user-facing flow that turns the data into a shop-floor product. Roughly five PRs of work, each shippable:

### PR 1 — Platform resolver + diagnostic lookup wired into the diagnosis page (SMALLEST, FIRST)

**Goal:** When a tech enters `2018 / Ford / F-250 / 6.7L Power Stroke Diesel + P0087` on the diagnosis page, the system resolves to the right platform, queries the database for the existing diagnostic, and surfaces the test sequence on screen. Zero AI calls.

**Work:**
- Add a small mapping layer (table or code) for `(year, make, model, engine) → platform_id`. Cover all 2017-2022 Ford Super Duty F-250/F-350/F-450/F-550 with 6.7L PSD → the single existing platform row.
- Wire the diagnosis page intake to call the resolver after the user fills in the form.
- Add a server-side query that takes `(platform_id, symptom_slug or DTC)` and returns: ordered test list + branch logic for each test.
- Render the test list on screen with priority order, scenario, observation method, expected reading, invasiveness rating.
- Behavior when no existing diagnostic: show "No cached diagnostic for this combination yet — generate one?" call to action (the AI invocation lands in PR 4).

**Validates:** the 3 existing fuel diagnostics become immediately usable by Mac and Angel for any applicable 2017-2022 Super Duty truck that comes in the shop. Real product value, no AI overhead.

### PR 2 — Diagnostic walk surface (full interactive flow)

**Goal:** The tech doesn't just see a list of tests — they walk through them step by step. Each step shows the test, expected reading, accepts the tech's actual reading or observation, then routes to the next step per the branch_logic table.

**Work:**
- A UI for stepping through test_actions in priority order, showing the test + expected + scenario.
- An input form for the tech's actual reading (numeric for measurements, observation text for visual/audible/smell).
- When the tech submits a reading, evaluate against branch_logic rows for that test → route to the appropriate next test (or terminal verdict).
- Cumulative confidence tracking visible on screen.
- Refusal-protocol behavior: gate threshold visible; commit-recommendation surfaces only above gate.

### PR 3 — Outcome recording

**Goal:** Every reading the tech submits gets recorded to `tech_outcomes` with a link to the active `diagnostic_sessions` row. The library compounds from real-world data.

**Work:**
- Create a `diagnostic_sessions` row when the tech starts a diagnostic walk.
- INSERT a `tech_outcomes` row per step the tech completes.
- At the end, the session row gets `final_verdict`, `resolved_component_id`, `cumulative_confidence`, `completed_at`.

### PR 4 — AI-on-demand for new symptoms (the hard one)

**Goal:** When the tech enters a complaint the database doesn't have for this platform, the skill calls the AI (Prompt 3) to generate a new diagnostic in real time, validates the JSON shape, INSERTs the new rows, then serves the diagnostic the same way as cached ones. Future identical complaints hit cached.

**Work:**
- Skill that invokes Prompt 3 via the Anthropic API with the structured model + new symptom payload.
- JSON schema validation on the response.
- SQL INSERT mirroring the patterns we built in Phase 2 (with the same enum translation table).
- Error recovery (malformed JSON: log + show error to tech, don't fail silently).
- Loading-state UX (the AI call takes 30-60 seconds; the tech needs to know what's happening).

### PR 5 — Cross-platform inheritance (`platform_equivalents`)

**Goal:** When a tech enters a vehicle on a platform that has no diagnostic for the symptom, but a related platform does, the system finds it via `platform_equivalents` and serves the equivalent.

**Work:**
- Cross-platform lookup query that walks the equivalents table.
- When a new platform is first seen with a complaint, invoke Prompt 4A to evaluate equivalence against existing platforms (if any).
- Use the equivalence verdict to either serve a cached diagnostic from the equivalent platform OR trigger a fresh PR-4-style generation.

## Hard constraints carried forward from Phase 1 & 2

- **No writes to live Supabase without explicit per-op approval for destructive ops.** Additive INSERTs within an approved gate plan are OK without per-op approval (per Brandon's 2026-05-19 clarification). Destructive writes (UPDATE existing rows, DELETE, retirement-flag flips) require explicit per-op approval at execution time, every time.
- **The orchestration project's Supabase target IS the production database** (`ynmtszuybeenjbigxdyl` — Vyntechs Auto). Treat all writes accordingly.
- **Brandon merges PRs himself.** Never merge `staging-interactive-diagnostics` to `main`. Never push to `main`.
- **`staging-interactive-diagnostics` is the integration branch** for all Phase 3 PRs.
- **Brandon is non-engineer founder.** Plain-English check-ins at every phase/PR boundary. No SQL/Drizzle/TypeScript jargon when surfacing decisions in chat. Reserve technical detail for spec/plan artifacts.
- **Mobile validation required for any UI that ships** — every page must pass mobile viewport (375-414px) before "done." (Becomes relevant from PR 1 onward since the diagnosis page IS UI.)
- **Avoid creating sim/test data in shop-visible tables without explicit approval** — the simulated F-250 + customer row from Phase 2 (`Vyntechs Simulation (Run 1)` in Young Motorsports' customer list) is in production. Future Phase 3 testing should either reuse these or get explicit approval for new ones, or use a separate test shop entity.
- **Brainstorm before code for any non-trivial change.** Invoke `superpowers:brainstorming` before touching code. First-try accuracy is much higher with planning.
- **Per-PR session pattern:** between PRs, Brandon `/clear`s. Each fresh session does its own exploratory then executes. The plan is the scope contract, not a pre-written typewriter script.

## What to do first when resuming Phase 3

1. Read this kickoff doc.
2. Read the Phase 2 progress report (`docs/superpowers/phase2-runs/PROGRESS-REPORT-2026-05-19.md`) and coverage tracker (`docs/superpowers/phase2-runs/COVERAGE-TRACKER.md`) for context on what's in the database.
3. Confirm with Brandon that PR 1 (platform resolver + diagnostic lookup) is the agreed starting point — or pick a different PR from the list above.
4. Invoke `superpowers:brainstorming` to design PR 1 step-by-step. Brainstorm should produce:
   - The mapping table or resolver function shape
   - The lookup query shape (platform_id + symptom → ordered tests + branches)
   - The diagnosis page integration point (where in the existing flow does the lookup happen?)
   - The UI for rendering the diagnostic on screen
   - Mobile validation plan
5. Write a Phase 3 PR 1 plan in `docs/superpowers/plans/2026-MM-DD-phase3-pr1-platform-resolver.md`.
6. Execute the plan with subagent-driven-development or feature-dev skill.

## Things to know about the codebase that affect Phase 3 work

- **The diagnosis page already exists** in the app. Find it and study its current intake form before designing the integration. (Likely under `app/` somewhere — Next.js app router.)
- **The orchestration tables live in the same Supabase project as the rest of the shop app.** That means Phase 3 UI work has direct database access via the existing Supabase client. No new connection plumbing needed.
- **The retirement pattern is the canonical way to update facts.** Phase 3 should follow it whenever a tech's outcome contradicts an existing TRAINING-INFERRED or GAP row. Use the 3-step BEGIN/UPDATE/INSERT/UPDATE/COMMIT sequence from Run 1's Gate 5.
- **`pnpm drizzle-kit generate` is still broken.** Hand-write any new migrations and journal entries (per `feedback_drizzle_kit_broken` memory). The schema for the orchestration tables is already in `lib/db/schema.ts` from Phase 1 migration 0017.

## Open questions for Phase 3

These can be parked until the relevant PR is being designed, but worth noting:

- **PR 4 design question:** Should the AI-on-demand flow run synchronously (block the user until diagnostic generates, ~30-60s) or async (kick off a job, notify the user when ready)? Sync is simpler but creates a long wait. Async needs a job queue but doesn't lock up the diagnosis page.
- **PR 4 trust question:** Should AI-generated diagnostics be served immediately to the tech, or should they require a tech-supervised "validate this looks right" pass before being trusted? The refusal protocol mitigates a lot of risk, but bad AI output still gets stored.
- **PR 2 UX question:** When a branch fires (e.g., "FRP reads near 0 PSI" → fail verdict → route to IMV test), should the UI auto-advance to the next test, or require a confirmation click? Auto-advance is faster but riskier if the tech mis-entered a reading.
- **Cooling/air/engine-mechanical/electrical diagnostics question:** Do we wire one or two of these into the existing database before PR 4 ships, or wait for PR 4's AI-on-demand to populate them naturally? Trade-off: pre-wiring gets more coverage faster but takes manual work; AI-on-demand is lazier but proves the production flow.

## Definition of "Phase 3 complete"

- All five PRs above shipped to `main`.
- At least one real customer truck's diagnostic has been driven through the live UI by Mac, Angel, or Brandon, with outcomes recorded.
- At least one AI-on-demand generation has happened on a previously-unseen symptom and been served back.
- At least one `platform_equivalents` row populated and one cross-platform cache-hit served.

When all of those are true, Phase 3 ships and the diagnostic orchestration system is a real product the shop relies on.
