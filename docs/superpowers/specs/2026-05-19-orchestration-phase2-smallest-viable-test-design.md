# Orchestration Phase 2 — Smallest Viable Test (Design Spec)

**Date:** 2026-05-19
**Branch:** `staging-interactive-diagnostics`
**Phase:** 2 of 3 (Phase 1 schema landed; Phase 3 is the Claude Code skill wrapper, gated on this phase passing)
**Status:** Design approved by Brandon 2026-05-19; awaiting written-spec review

## Why this phase exists

Phase 1 landed 12 new tables on live Supabase to support diagnostic orchestration. Phase 2 is the gate before any production code wraps around them: manually run the 4-prompt orchestration chain end-to-end against a real canonical case, verify the schema bends under real data, and surface any issues that need a follow-up migration before Phase 3 builds the skill wrapper.

This is "dry-fit the wiring harness with hand tools before crimping" applied to a diagnostic schema. The schema design is reversible (drop migration); a skill wrapper built on a bad schema is not.

## Scope (locked)

- Canonical vehicle: **2018 F-250 6.7L Power Stroke** (Ford Super Duty 4th gen 6.7 PSD platform)
- System of interest: **fuel system**
- Three symptoms walked: **P0087** (rail pressure low), **P0088** (rail pressure high), **no-start cranks normally**
- Cross-vehicle test: **2019 F-350 6.7L PSD** (same architecture; must resolve to the F-250's diagnostic via `platform_equivalents`)
- Outcomes are **simulated** (we pick plausible field values; no bench measurements)

## What's locked from Phase 1 that constrains Phase 2

- 12 new tables live on Supabase project `ynmtszuybeenjbigxdyl`
- Two-dimensional source tagging on every fact-bearing row: `source_provenance` (TRAINING-CONFIRMED / TRAINING-INFERRED / FIELD-VERIFIED / GAP) + `inference_class` (LAW / LOGIC / PATTERN, nullable)
- Retirement pattern (`is_retired` + `replaced_by_id` self-FK) on all 8 fact-bearing tables
- `platform_equivalents` requires canonical ordering: `platform_a_id < platform_b_id`
- All inserts to live Supabase require explicit per-batch approval from Brandon
- Brandon merges PRs himself; this branch (`staging-interactive-diagnostics`) is the integration target

## Approach: Approach A — Minimal harness

Throwaway per-run SQL scripts. Subagents emit prose + JSON sidecars. JSON drives SQL generation. No production translator code lands during Phase 2 — that's Phase 3's job. The contract that survives into Phase 3 is the subagent JSON shape itself.

Approach B (build the production translator now) was rejected because Phase 2's job is to find schema problems; building skill plumbing simultaneously muddies that test.

Approach C (hand-translate every INSERT from prose) was rejected because it diverges from how Phase 3 will work — the production skill must parse structured output, not human-eye it.

## Design

### Section 1 — Subagent invocation + JSON sidecar

**One fresh Sonnet subagent per prompt invocation.** Subagent context is exactly: the prompt's text (from `docs/interactive-diagnostics/prompts/`) + the inputs the production skill would pass it. No memory of this dev session. This is the closest possible simulation of "the production skill called this prompt as a single API request."

**Each subagent is instructed to emit BOTH the natural prompt output AND a JSON sidecar** matching the table shape it's about to write. The two outputs must be self-consistent. If they disagree, that's a real Phase 3 finding — the prompt isn't producing reliably translatable output and needs revision before the skill ships.

**JSON sidecar shape per prompt:**

- **Prompt 1** → `{ platform: {slug, year_range, parent_make, parent_model_family, generation}, architecture_facts: [{slug, description, source_provenance, inference_class, field_verify_required}] }`
- **Prompt 2** → `{ components: [...], observable_properties: [...], component_connections: [...] }` with each array's elements matching the relevant table's NOT NULL columns + nullable columns where the prompt provided values
- **Prompt 3** → `{ symptom: {slug, description, category}, test_actions: [...], branch_logic: [...], symptom_test_implications: [...] }`
- **Prompt 4A** → `{ platform_equivalents: [{platform_a_slug, platform_b_slug, system, verdict, verdict_reasoning, source_provenance}] }` — note: subagent emits slugs; SQL generation resolves slugs to UUIDs and applies the `a < b` canonical ordering rule before INSERT

**Why fresh dispatch matters:** Contamination by other context could mask prompt failures. Fresh subagents make Phase 2 an honest test of the prompts themselves.

**Schema constraints subagents must respect (or the INSERT will fail):**

- `test_actions.invasiveness` → integer `BETWEEN 1 AND 5`
- `test_actions.confidence_boost` → number `BETWEEN 0 AND 100`
- `diagnostic_sessions.cumulative_confidence` → number `BETWEEN 0 AND 100`
- `symptom_test_implications.priority` → integer `BETWEEN 1 AND 10`
- `component_connections` → `from_component_id <> to_component_id` (no self-loops)
- `platform_equivalents` → `platform_a_id < platform_b_id` (canonical UUID ordering applied post-emission)
- `tech_outcomes` → at least one of `measured_value` or `measured_observation` must be non-null

**Slug uniqueness shape varies by table:**

- **Globally unique slug** (one row, ever, even across retirement): `platforms.slug`, `symptoms.slug`
- **Partial-unique slug** (one *active* row at a time; retired rows don't compete): `architecture_facts.slug`, `components.slug`, `observable_properties.slug`, `test_actions.slug`, `branch_logic.slug`
- **Partial-unique tuple** (one active row per identity-tuple): `component_connections (from_id, to_id, connection_kind)`, `symptom_test_implications (symptom_id, test_action_id)`, `platform_equivalents (platform_a_id, platform_b_id, system)`

**Consequence for the retirement flip:** the new FIELD-VERIFIED row in Run 5 *can and should* reuse the retired GAP row's slug — the partial-unique index allows it because the old row is now `is_retired=true`. Slugs carry identity across retirement boundaries.

**`ON CONFLICT` syntax for partial-unique indexes requires the WHERE clause:**

```sql
INSERT INTO test_actions (...) VALUES (...)
ON CONFLICT (slug) WHERE is_retired = false DO UPDATE SET ...;
```

Without the `WHERE is_retired = false` clause, Postgres errors because the partial index isn't matched. For globally-unique slugs (platforms, symptoms), the plain `ON CONFLICT (slug) DO UPDATE` form is correct.

**Expected prompt-vocab vs schema-enum mismatches (Phase 2 surfaces these as findings; SQL generation translates them).**

The prompts in `docs/interactive-diagnostics/prompts/` predate the Phase 1 schema and use slightly different vocabulary. When SQL is generated from subagent JSON, the following translations apply. The original prompt vocab is preserved in the subagent transcript; the translated value is what lands in the DB.

| Field | Prompt vocab | Schema enum |
|---|---|---|
| `test_actions.scenario_required` | `medium`, `heavy` | `medium-load`, `heavy-load` |
| `observable_properties.observation_method` | `drained_into_container`, `removed_for_bench_inspection`, `borescope_or_mirror`, `audible_at_location`, `touch_temperature_at_surface`, `touch_vibration`, `smell_at_location`, `thermal_imaging`, `weight_or_mass_change`, `active_command_via_scan_tool`, `flow_rate_measurement` | not in schema — translate to closest valid value or surface as Phase 2 finding for migration 0018 |
| `observable_properties.housing_opacity_status` | `translucent`, `partial` | not in schema — translate to closest valid value or surface as finding |
| `components.kind` | `controller`, `conduit` | `module` (for controller); `mechanical` (for conduit, if structural) |
| `component_connections.connection_kind` | `data signal`, `control authority` | `can-bus` / `lin-bus` (for data signal, choose by network); `controlled_by` (for control authority) |
| `platform_equivalents.verdict` | `FULLY APPLICABLE`, `PARTIALLY APPLICABLE`, `NOT APPLICABLE`, `INSUFFICIENT DATA` | `FULLY`, `PARTIALLY`, `NOT`, `INSUFFICIENT` |
| `platform_equivalents.system` | `AC` | `hvac` |

**If translation drops information** (e.g., `drained_into_container` collapses to a generic value), that's a Phase 2 finding: either the prompts get revised in Phase 3 to emit schema-valid vocab, or migration 0018 extends the enum. Decision deferred until Phase 2 surfaces concrete cases.

### Section 2 — The 5-run flow + per-prompt approval gates

**Run directories live at `docs/superpowers/phase2-runs/run-N-<vehicle>-<symptom>/`** and contain:

- `subagent-output-pN.md` — full transcript per prompt (prose + JSON sidecar)
- `inserts-pN.sql` — SQL generated from each subagent's JSON
- `vet-notes.md` — Run 1 only; Brandon's line-item corrections from the vet step
- `tech-outcomes.sql` — Run 5 only; simulated outcomes + retirement flip
- `run-report.md` — end-of-run plain-English summary

**Run 1: full orchestration (5 gates)**

1. P1 subagent → architecture-fact vet step → P1 inserts (architecture_facts + platforms row). Gate.
2. P2 subagent (input = vetted narration from step 1) → P2 inserts (components, observable_properties, component_connections). Gate.
3. P3 subagent (× 1 for P0087) → P3 inserts (symptoms[P0087], test_actions, branch_logic, symptom_test_implications). Gate.
4. P4A subagent (no candidates yet — empty result expected). Gate ("nothing to insert" confirmation).
5. Simulated diagnostic walk for P0087 → diagnostic_sessions + tech_outcomes inserts. Gate.

Expected total: ~115 rows across the 12 tables.

**Run 2: same vehicle + P0088 (2 gates)**

P1, P2 skipped (platform + components exist). Orchestration runs P3 only (P0088 is a new symptom, but the components it implicates already have test_actions for P0087 — P3 must emit `ON CONFLICT` semantics for test_actions that already exist and only create the new `symptom_test_implications` rows linking P0088 to existing test_actions, plus any new test_actions specific to over-pressure paths).

1. P3 subagent → P3 inserts (new symptom, ~5 new test_actions for over-pressure branch, new symptom_test_implications links). Gate.
2. Simulated walk for P0088 → diagnostic_sessions + tech_outcomes. Gate.

**Run 3: same vehicle + no-start cranks normally (2 gates)**

Same skip pattern as Run 2. P3 invents a new symptom (no-start-cranks-normally), and reuses many of the same test_actions (lift pump prime, filter inspection, FRP electrical) via new `symptom_test_implications` rows.

1. P3 subagent → P3 inserts. Gate.
2. Simulated walk → outcomes. Gate.

**Run 4: 2019 F-350 6.7L PSD — cache-hit verification (2 gates)**

This run has a subtlety the kickoff missed: for the F-350 to *find* the F-250's diagnostic, `platform_equivalents` needs a row connecting them. That row hasn't been written yet (Run 1's P4A had no candidates).

1. Set up: write a 2019 F-350 platform row (if it doesn't exist), then invoke P4A subagent with F-250 as source diagnostic and F-350 as a single candidate. P4A returns FULLY APPLICABLE for fuel system. Insert that into `platform_equivalents` with canonical ordering applied. Gate.
2. Run the cache-hit SELECT: query for "diagnostic for F-350 + P0087." The query walks `platform_equivalents`, finds the F-350 ≡ F-250 for fuel, returns the F-250's diagnostic with zero new rows. Gate ("Pass" if cache hit returns the F-250's full test sequence).

**Phase 3 finding to log:** the production skill must run P4A against existing platforms when a new vehicle is first seen, BEFORE checking cache. Phase 2 just promoted this from "implicit assumption" to "documented orchestration step."

**Run 5: simulated outcomes + retirement flip (1 gate, multi-step setup)**

Setup (pre-Run-5, separately gated):
- Verify `vehicles` table has a row for the canonical 2018 F-250 with `platform_id` linking to the 6.7 PSD platform; insert if missing
- Verify Brandon's profile row exists (it does — he's an existing user)

Walk:
1. Brandon picks the simulated fault in plain English (e.g., "low-ref came back open")
2. I propose plausible measured values per diagnostic step that walk to that conclusion
3. Brandon approves the proposed outcome data
4. INSERT one diagnostic_sessions row + N tech_outcomes rows + retirement flip

Retirement flip (in same approval batch):
1. Brandon names one GAP observable_properties row he now knows firsthand
2. SQL: INSERT new row (same component_id, same description, but `source_provenance='FIELD-VERIFIED'` and `housing_opacity_status` set correctly), UPDATE old row (`is_retired=true`, `replaced_by_id=<new row id>`), COMMIT

**Why one flip is enough:** Phase 2 is proving the pattern works; not seeding a comprehensive field-verified knowledge base.

### Section 3 — Vet step, simulated outcomes, retirement flip (mechanics detail)

**Vet step (between P1 and P2 — Run 1 only):**

After P1 subagent returns, I render the JSON's architecture facts as a numbered plain-English list grouped by component, with each fact's tag visible. Brandon scans, calls out errors as plain text. Rules I follow when editing the JSON:

- Untouched fact → keeps original tag
- Corrected fact → tag becomes `FIELD-VERIFIED`, description updated to Brandon's wording
- Deleted fact → dropped from JSON entirely (not retired — it never existed in the DB)
- New fact added by Brandon → inserted as `FIELD-VERIFIED`

`vet-notes.md` captures the diff. The corrected JSON drives both (a) the rows we insert into `architecture_facts` and (b) the plain-English narration that goes to P2 as the user message.

**Simulated diagnostic walk (Run 5):**

After Run 4 confirms cache-hit, I run the cache-lookup query against the F-250 itself and surface the test sequence Prompt 3 generated. Brandon picks the "simulated fault" in plain English. I propose plausible measured values per step. Brandon approves. I generate INSERTs for one diagnostic_sessions row + one tech_outcomes row per simulated step.

Required fields on diagnostic_sessions: `vehicle_id` (the F-250 row, prerequisite), `symptom_id` (P0087), `shop_id` (Young Motorsports), `tech_id` (Brandon's profile), `final_verdict = 'commit-allowed'`, `resolved_component_id` (whichever component the simulated fault terminates at), `cumulative_confidence` (integer percentage that crossed the gate, e.g., `97` — note schema constraint is `BETWEEN 0 AND 100`, not `0..1`).

**Retirement flip:**

Brandon names one GAP observable_properties row he now knows firsthand. The retirement flip is THREE SQL statements in one transaction, and the order matters because the partial-unique index `observable_properties.slug WHERE is_retired = false` will reject a new INSERT if the old row hasn't been retired yet:

```sql
BEGIN;
-- 1. Retire the old GAP row FIRST. Its slug now leaves the active partial-unique index.
UPDATE observable_properties
SET is_retired = true, updated_at = NOW()
WHERE id = <old row id>;
-- 2. Insert the new FIELD-VERIFIED row, reusing the retired row's slug.
INSERT INTO observable_properties (slug, component_id, description, observation_method, housing_opacity_status, source_provenance, inference_class)
VALUES (<same slug as old row>, <same component_id>, <updated description>, <method>, <opacity>, 'FIELD-VERIFIED', NULL)
RETURNING id;
-- 3. Link the retired row to its replacement.
UPDATE observable_properties
SET replaced_by_id = <new row id from step 2>
WHERE id = <old row id>;
COMMIT;
```

The retirement-invariant CHECK constraint (`replaced_by_id IS NULL OR is_retired = true`) allows step 3 because the old row is already `is_retired = true` from step 1.

Verification SELECT after commit: `SELECT id, slug, source_provenance, is_retired, replaced_by_id FROM observable_properties WHERE slug = <X>` — should return two rows (the retired one pointing at the active one) and ordering them by `created_at` reveals the history.

### Section 4 — Success criteria

A run "passes" when:
- All approved inserts land without constraint failures
- Brandon and I agree the data looks right
- Run-specific milestone hits:
  - **Run 1:** ~115 rows across all 12 tables; the platforms row exists; vet step produced at least one FIELD-VERIFIED row (i.e., the vet step did real work, not just rubber-stamping)
  - **Run 2:** P3-only batch lands; zero duplicate components or observable_properties created; new symptom row + appropriate symptom_test_implications fanout to existing test_actions
  - **Run 3:** Same as Run 2
  - **Run 4:** Cache-hit SELECT returns the F-250's full test sequence ordered by `symptom_test_implications.priority`, with branch_logic attached, and produces zero new graph-table inserts
  - **Run 5:** N tech_outcomes rows insert; diagnostic_sessions completes; retirement chain leaves the GAP row with `is_retired=true` and `replaced_by_id` pointing at a valid FIELD-VERIFIED row

**Phase 2 as a whole is done when:**
- All 5 runs pass per criteria above
- Every run has a written `run-report.md` summarizing what was inserted and any surprises
- No schema changes were needed mid-test

**If schema changes were needed mid-test:** Phase 2 ends with a punch list for migration 0018 + a brief "what we learned" section in each affected run-report.md. Phase 3 does not start until that follow-up migration is applied.

## Hard constraints carried from Phase 1

- No writes to live Supabase without explicit per-batch approval. Every INSERT batch is gated. Reads (SELECTs for cache-hit verification, diagnostic queries) are not gated.
- Brandon merges PRs himself. Don't merge `staging-interactive-diagnostics` to `main`.
- Brandon is non-engineer founder. Plain-English check-ins at every gate. No SQL/Drizzle/TypeScript jargon when surfacing decisions in chat. Technical detail lives in this spec and the per-run artifacts.
- No mobile UI validation needed — Phase 2 is server-side orchestration; UI lands in Phase 3.

## Things this spec deliberately does NOT do

- Does not lock the production translator code shape. That's Phase 3's design problem.
- Does not specify how Prompt 3's HTML interactive surface output is handled. For Phase 2 we instruct subagents to skip the HTML artifact entirely — Phase 2 needs the structured data, not the rendering.
- Does not specify error recovery if a subagent emits malformed JSON. Phase 2's response is "stop, log the issue as a Phase 3 finding, fix the prompt or the SQL by hand." Mid-test recovery isn't worth automating for a 5-run test.
- Does not address `RLS` policies on the 10 graph tables. They're RLS-enabled-no-policy (server-side service-role reads only). Phase 2 reads/writes happen via the Supabase MCP using the service role, so RLS is not in the loop. Phase 3 may need `SELECT TO authenticated USING (true)` policies if the UI reads graph data client-side; flagged as a Phase 3 design question.

## Follow-up items (optional, not blocking)

These were noted by the Phase 1 code review and remain useful pickups, none blocking Phase 2:

1. **CI integration of `drizzle/tests/0017_schema_verification.sql`** — currently manual; could run via pglite or the rehearsal DB on every PR
2. **Cover 11 unindexed FK lints** with a migration 0018: indexes on the 8 `replaced_by_id` self-FKs (partial: `WHERE replaced_by_id IS NOT NULL`) + 3 unindexed FKs on diagnostic_sessions/tech_outcomes
3. **Decide on `SELECT TO authenticated USING (true)` RLS policies** for the 10 graph tables — surfaces during Phase 3 if client-side reads are needed
4. **Add `relations()` exports for the 3 junction tables** — only needed if Phase 3 wants typed-relations API on `componentConnections`, `symptomTestImplications`, `platformEquivalents`

## Artifacts this spec produces

By the end of Phase 2:

- Five run directories under `docs/superpowers/phase2-runs/`, each with subagent transcripts + generated SQL + run-report
- Live Supabase data: 1 platform, ~25-30 architecture_facts, ~12 components, ~25 observable_properties, ~15 component_connections, 3 symptoms, ~12-20 test_actions, ~10-15 branch_logic, ~20-25 symptom_test_implications, 1 platform_equivalents row, 1-3 diagnostic_sessions, ~10-15 tech_outcomes — exact counts will vary by what the prompts actually emit
- One retired observable_properties row + its FIELD-VERIFIED replacement
- A clean "Phase 2 complete; here's what we found; Phase 3 unblocked" summary written to `docs/superpowers/handoffs/2026-MM-DD-orchestration-phase3-kickoff.md`

## What unblocks once Phase 2 passes

Phase 3 — the Claude Code skill wrapper. The skill takes a user input (vehicle + symptom), checks the graph for an existing diagnostic, invokes prompts as needed, writes outcomes back. The JSON sidecar shape Phase 2 establishes is the skill's structured-output target.
