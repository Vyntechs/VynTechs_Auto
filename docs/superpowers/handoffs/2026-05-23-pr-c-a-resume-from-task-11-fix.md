# PR-C/A · Resume from Task 11 Fix — Execution Continuation

**Date:** 2026-05-23 (afternoon)
**Branch:** `feat/topology-guided-walk`
**Last commit:** `38b58fb` (`feat(db): fuel-system seed data for interactive electrical topology`)
**Why this handoff exists:** Long-running execution session got context-heavy. /clear, then resume from this file.

**Brandon's one-line paste to start the resume session:**

```
Read docs/superpowers/handoffs/2026-05-23-pr-c-a-resume-from-task-11-fix.md and continue executing PR-C/A via superpowers:subagent-driven-development. You should be on branch feat/topology-guided-walk; if not, git fetch && git switch feat/topology-guided-walk.
```

---

## Where we are

Tasks 1-10 complete and committed. Task 11 (seed SQL) committed but has **2 must-fix spec-review issues** outstanding. Tasks 12-15 not started.

| Task | Status | Notes |
|---|---|---|
| 1. Migration SQL (0020) | ✅ done | Committed with 4 code-review fixes (journal, breakpoints, redundant indexes, partial unique index pattern) |
| 2. Local rehearsal | ✅ done | Applied to vyntechs_rehearsal, schema verified, one-default-per-slice constraint enforced |
| 3. Live Supabase apply | ✅ done | Applied via MCP apply_migration; all 9 schema checks verified on live |
| 4. Drizzle schema | ✅ done | Omitted unique() decl (matches existing is_retired table convention) |
| 5. Loader public types | ✅ done | Cascade stubs applied to 5 test files + app/design/page.tsx |
| 6. Loader: pins | ✅ done | |
| 7. Loader: connection electrical role + pin endpoints | ✅ done | Simplified to direct `connections: connectionRows` pass-through |
| 8. Loader: scenarios + wire states + readings | ✅ done | Added `TopologyWireState` type (13-value union) |
| 9. Loader: dataStatus + lastScenarioSlug | ✅ done | Uses `db.query.X.findFirst` form |
| 10. Loader unit tests | ✅ done | 8 new tests (plan said 7 but listed 8 distinct cases); 17/17 pass |
| 11. **Seed SQL** | ⚠ in_progress | Committed at `38b58fb` with 2 must-fix issues |
| 12. Local rehearsal of seed | pending | psql -f against vyntechs_rehearsal |
| 13. Live Supabase apply of seed | pending | **Pauses for Brandon's explicit approval** |
| 14. End-to-end loader check | pending | Run loadSystemTopology against F-350/P0087 session, verify shape |
| 15. Push branch + open PR | pending | Brandon merges via GitHub UI |

---

## Task 11 — two outstanding fixes

Spec reviewer (`a8c6a6f4ddddb6396`) approved with 2 must-fix issues. **Dispatch a fresh implementer subagent with these fix instructions.** Do NOT skip — Issue #1 is a functional gap.

### Issue 1 (must-fix): Missing connection INSERT — `frp-reg → hp-rail-bank-a`

**File:** `drizzle/data/2026-05-23-electrical-topology-fuel-seed.sql`

The Block 0.5 comment lists this connection as planned but the INSERT is missing. Component `sd4-67psd-hp-rail-bank-a` exists in live DB (confirmed in `drizzle/data/2026-05-20-fuel-system-tags.sql`). Without this row, the topology diagram won't render the edge from the FRP regulator to the driver-side rail (where it's physically bolted).

**Fix:** Add a 6th `INSERT INTO component_connections` to Block 0.5. Read the prototype (`mockups/topology-guidance/round-3-opus/topology.html` DATA.wires section) for the correct `connection_kind` and `direction` to use. The FRP regulator is bolted to the rail — likely `mechanical` kind, not `electrical-wire`. If `mechanical`, no electrical_role update needed in Block 3.

### Issue 2 (nit): Block 0.5 comment direction error

Around line 69, comment says `frp-sensor → shared-5v` but SQL inserts `shared-5v → frp-sensor` (SQL is correct, comment is wrong). Just fix the comment.

### Commit message for the fix

```
fix(db): add missing frp-reg → hp-rail-bank-a connection in seed
```

After the fix lands, **dispatch the code-quality reviewer** for Task 11 (it never ran — the spec-review fix loop preempted it).

---

## Deviations from the original plan worth knowing

These are noted in commit history but flagging here for the resume session:

1. **Plan's `UNIQUE (...)` → partial unique index** (Task 1 fix): codebase convention is `CREATE UNIQUE INDEX {table}_{cols}_active_unique WHERE is_retired = false`. Plan was the verbatim SQL; live DB has the partial-index version. Drizzle schema omits the unique declaration entirely (matches existing pattern for other is_retired tables — `components`, `architectureFacts`, etc.).

2. **3 missing components added in seed** (Task 11): Brandon approved INSERTing `frp-reg`, `shared-5v`, `shared-lref` into `components` as part of the seed because the prototype documents them but the live DB doesn't have them. Kinds: `actuator`, `splice`, `splice`.

3. **Pin slug naming for IMV**: IMV component is `sd4-67psd-imv` but pins use `vcv-a` / `vcv-b` (prototype convention). Documented in the seed file's header comment. FK is by component_id so the naming inconsistency is cosmetic.

4. **PCM-side pins not seeded** (Task 11): only component-side pins are in the seed. PCM-side pins can be added in a future PR. This means `from_pin_id` is NULL for connections originating at PCM.

5. **`TopologyWireState` type added** (Task 8): tightens `pinStates` from `Record<string, string>` to `Record<string, TopologyWireState>`. Task 5 code-review deferred item.

---

## Brandon's standing rules — still apply

- **No DB writes to production without explicit per-op approval** (Task 13 will surface the seed and wait).
- **Never push to main or merge to main** — Brandon merges via GitHub UI after validating the PR.
- **Per-op approval is for production writes only** — reads + local rehearsals are fine without approval.
- **Plain-English summaries to Brandon** — no SQL/jargon in chat unless contextually unavoidable (e.g., Task 13 SQL approval).

---

## Next-session execution sequence

1. Read this file (you're doing it).
2. Verify branch + last commit:
   ```bash
   git status && git log --oneline -3
   ```
   Expected: branch `feat/topology-guided-walk`, last commit `38b58fb` (or later if the fix already landed).

3. **Task 11 fix:** Dispatch implementer with Issues 1 & 2 fix instructions. After it lands, dispatch the code-quality reviewer for Task 11 (it never ran).

4. **Task 12 (local rehearsal):** Run `psql vyntechs_rehearsal -f drizzle/data/2026-05-23-electrical-topology-fuel-seed.sql`, then verify counts via the SQL block in the plan's Task 12 Step 2. Main thread.

5. **Task 13 (live seed apply):** Surface the seed to Brandon, ask for explicit approval, then apply via Supabase MCP `execute_sql` inside `BEGIN; ...; COMMIT;`. Verify counts. Main thread.

6. **Task 14 (end-to-end loader check):** Run `loadSystemTopology` against the F-350 / P0087 session (id `681de115-5de9-474e-9721-263f65066e08`). Confirm 7-9 components with prose, 9 pins, 8 scenarios, dataStatus populated, lastScenarioSlug=null. Main thread.

7. **Task 15 (open PR):** Push the branch (`git push -u origin feat/topology-guided-walk`), open PR against `staging-interactive-diagnostics` with the summary from the plan's Task 15. Brandon merges. Main thread.

---

## Branch state when this handoff was written

```
* 38b58fb feat(db): fuel-system seed data for interactive electrical topology
* 0df1b02 test(diagnostics): remove unused fixture ID variables
* 0a7a132 test(diagnostics): cover pins + scenarios + dataStatus in loader
* 94d6af2 feat(diagnostics): load system_data_status + per-session lastScenarioSlug
* 7a4151f feat(diagnostics): load scenarios + wire states + pin readings
* 2b4ebc6 feat(diagnostics): load electrical role + pin endpoints on connections
* f049f0e feat(diagnostics): load component_pins + new prose columns
* edfbbbe feat(diagnostics): extend SystemTopology types for pins + scenarios
* 527e263 style(db): normalize schema.ts callback + chain conventions
* a7d8c97 feat(db): Drizzle schema for interactive electrical topology
* f44830a fix(db): 0020 migration code-quality fixes from review
* 2a56d44 feat(db): migration for interactive electrical topology schema
* ed302a5 wip(electrical-topology): PR-C/A spec + plan + kickoff + prototype source
* 60dd23c docs(rules): mirror CLAUDE.md/AGENTS.md rules 5-11
```

13 commits unpushed on the feature branch. Push happens at Task 15.

---

## Related

- Original kickoff: `docs/superpowers/handoffs/2026-05-23-pr-c-a-execution-kickoff.md`
- Plan: `docs/superpowers/plans/2026-05-23-electrical-topology-schema-loader.md`
- Spec: `docs/superpowers/specs/2026-05-23-interactive-electrical-topology-design.md`
- Seed source (prototype): `mockups/topology-guidance/round-3-opus/topology.html`
