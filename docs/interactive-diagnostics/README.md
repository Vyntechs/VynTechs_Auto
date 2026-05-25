# Vyntechs Diagnostic Orchestration — Handoff Package

## What this is

A four-prompt orchestration that turns plain-English vehicle system narration into interactive, refusal-gated diagnostic sessions that build a user-owned service manual database as a side effect of normal technician usage.

The goal is a graph-native diagnostic database that grows from real field cases. AI generates the initial diagnostic logic; field outcomes from technicians validate and correct it; over time, AI is only needed for novel cases the database hasn't seen.

## What to build

Wire the four prompts in this package into a working orchestration backed by a graph-capable database (recommended: PostgreSQL with Apache AGE extension, or Neo4j). The orchestration takes a user input — vehicle application plus symptom — and either serves an existing diagnostic from the graph or generates a new one by running the prompts in sequence.

## What's in this folder

**The four prompts (locked, tested in source session):**

1. `prompt-1-research-prefill.md` — vehicle architecture baseline from training data
2. `prompt-2-system-operation-intake.md` — structured component/relationship model from narration (or from Prompt 1 output the user vets)
3. `prompt-3-diagnostic-session.md` — interactive diagnostic paths with refusal gates, measured-value entry, contradiction halts
4. `prompt-4a-cross-vehicle-applicability.md` — platform equivalence detection so a diagnostic built for one vehicle automatically extends to architecturally-equivalent ones

**Reference artifacts (don't ship these — they show what Prompt 3's output looks like rendered):**

- `reference-prototype-fuel-system.html` — full interactive diagnostic for 6.7L Power Stroke fuel system covering P0087 and no-start concerns. This is what a finished diagnostic looks like in the UI when the graph query result is rendered.

**Architecture and data model:**

- `ARCHITECTURE.md` — the four-prompt orchestration sequence, what each prompt's input and output contract is, and how outputs become graph mutations rather than documents
- `GRAPH-SCHEMA.md` — node types, edge types, and example queries that produce diagnostic views over the graph

## What NOT to do

- Do not collapse the four prompts into fewer prompts. Each one has a single responsibility and a single downstream consumer. Collapsing them breaks the orchestration's ability to cache, retry, and reuse intermediate results.

- Do not store diagnostics as documents (JSON blobs, files, rows in a "diagnostics" table). Store them as graph traversals. The diagnostic a tech sees is generated on demand by querying the graph. If diagnostics get stored as documents, branches stop connecting naturally and the database stops compounding.

- Do not add a "merge" or "stitch" prompt. Connection between diagnostics is structural, not procedural. It happens because two diagnostics reference the same atomic test nodes via shared platform tags. Writing merge logic means the storage primitive is wrong.

- Do not fill gaps with training-data assumptions silently. Every inferred fact must be tagged LAW, LOGIC, or PATTERN. PATTERN-tagged facts must be marked "confirm" rather than asserted. The refusal protocol depends on honest gap labeling.

- Do not let the diagnostic generator fabricate components, pins, voltages, or duty cycles that aren't in the structured model from Prompt 2. If a diagnostic for a symptom needs a component the model doesn't have, the answer is to surface a gap and request a fresh intake pass — not to invent the component.

## How to test the orchestration is wired correctly

Run this sequence against your graph database:

1. User input: `2018 F-250 6.7L Power Stroke · P0087 fuel rail pressure too low`
2. Orchestration runs Prompt 1 (research), then Prompt 2 (intake — accept user narration of the fuel system), then Prompt 3 (generate diagnostic), then Prompt 4A (mark applicable to 2017–2019 F-250/F-350 6.7L PSD).
3. Render the resulting graph query as an interactive diagnostic surface (use the reference prototype as the rendering target).
4. Second user input: `2019 F-350 6.7L Power Stroke · P0088 fuel rail pressure too high`
5. The orchestration should NOT regenerate from scratch. It should detect via 4A's platform equivalence edges that 2019 F-350 ≡ 2018 F-250 for fuel system, find the existing diagnostic graph, and serve a query that routes into the over-pressure branch (which Prompt 3 already generated but the first user didn't walk).
6. Third user input: `2018 F-250 6.7L Power Stroke · no-start cranks normally`
7. Same platform, new symptom. The orchestration should query the graph for test nodes implicated by the no-start symptom, find that many overlap with the P0087 diagnostic (lift pump prime, filter inspection, FRP sensor electrical), pull those nodes (with their existing field outcomes attached), generate any missing nodes via Prompt 3, and serve the combined query.

If steps 5 and 7 both reuse nodes from step 3 without regenerating them, the orchestration is wired correctly. If steps 5 or 7 regenerate from scratch, the storage layer is not graph-native and the design is broken.

## Open question for the engineer wiring this

The source session did not lock down which graph database to use. The recommended choice is PostgreSQL with Apache AGE because it keeps everything in one database alongside existing application data. Neo4j is the alternative if AGE is rejected for any reason. Either works as long as the storage primitive is nodes-and-edges, not documents.
