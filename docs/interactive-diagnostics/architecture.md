# Orchestration Architecture

Four prompts wired in sequence. Each one is a separate API call. Each one's output is consumed by the next prompt or written to the graph database. Diagnostics are not stored as documents — they are generated on demand by querying the graph.

## The sequence

```
USER INPUT (vehicle + symptom)
    ↓
[graph query: does this diagnostic already exist for this vehicle+symptom?]
    ↓
    ├── YES → serve cached query result
    │
    └── NO → run orchestration:
              ↓
              PROMPT 1: Research & Prefill
              ↓ (writes platform-tagged architecture facts to graph)
              ↓
              [user vets the baseline, corrects errors, narrates additions]
              ↓
              PROMPT 2: System Operation Intake
              ↓ (writes component nodes + relationship edges to graph)
              ↓
              PROMPT 3: Diagnostic Session Generator
              ↓ (writes test action nodes + branch logic + symptom-to-test edges)
              ↓
              PROMPT 4A: Cross-Vehicle Applicability
              ↓ (writes platform_equivalent edges)
              ↓
              GRAPH NOW CONTAINS EVERYTHING NEEDED
              ↓
              [graph query: render diagnostic view for this vehicle+symptom]
              ↓
              INTERACTIVE DIAGNOSTIC SURFACE
```

## Why four prompts and not more or fewer

Each prompt has a single responsibility. Each output is consumed by exactly one downstream user (either the next prompt or the graph database). Splitting further adds API overhead without adding modularity. Merging any two breaks the ability to cache, retry, or reuse intermediate results.

- **Prompt 1** is separate because the user vets its output before flowing into Prompt 2. The user must be able to correct training-data assumptions before they become structured model facts.
- **Prompt 2** is separate because it converts approved facts into the structured model schema. The intake step is reusable independently — Prompt 1 can be skipped entirely if the user wants to narrate from scratch.
- **Prompt 3** is separate because diagnostic generation has its own refusal-gated logic that should not be entangled with intake. The same structured model from Prompt 2 can spawn many diagnostics for different symptoms without re-running intake.
- **Prompt 4A** is separate because applicability is a different kind of reasoning from diagnostic generation — it operates over the graph after the diagnostic is built, not during.

## What each prompt writes to the graph

These are graph mutations, not document writes. The prompts produce structured output that the application layer translates into Cypher (or AGE-flavored Cypher) CREATE/MATCH/MERGE statements.

### Prompt 1 writes

```
MERGE (p:Platform {id: "ford-superduty-4thgen-67psd"})
SET p.year_range = "2017-2022",
    p.parent_make = "Ford",
    p.parent_model_family = "Super Duty"

MERGE (f:ArchitectureFact {
  id: "67psd-hpfuel-pump-type",
  description: "CP4.2 high-pressure pump, mechanical, cam-driven",
  confidence: "TRAINING-CONFIRMED",
  field_verify_required: false
})
MERGE (f)-[:APPLIES_TO]->(p)
```

### Prompt 2 writes

```
MERGE (c:Component {
  id: "67psd-frp-sensor",
  name: "FRP Sensor",
  kind: "sensor",
  electrical_contract: "3-wire analog (5V ref, low ref, signal)",
  location: "front of DS rail"
})
MERGE (c)-[:BELONGS_TO_PLATFORM]->(p {id: "ford-superduty-4thgen-67psd"})

MERGE (c)-[:REPORTS_TO]->(m:Component {id: "67psd-pcm"})
```

### Prompt 3 writes

```
MERGE (t:TestAction {
  id: "test-67psd-frp-signal-idle",
  description: "Back-probe FRP signal pin at idle",
  meter_mode: "DC V",
  expected_value: 2.8,
  expected_unit: "V",
  expected_tolerance: 0.3,
  invasiveness: 2,
  confidence_boost: 10,
  source_citation: "3-wire sensor electrical contract [LOGIC]"
})
MERGE (t)-[:PROBES]->(c {id: "67psd-frp-sensor"})

MERGE (sym:Symptom {id: "p0087-fuel-rail-pressure-too-low"})
MERGE (sym)-[:IMPLICATES_TEST {priority: 4}]->(t)

MERGE (b:BranchLogic {
  id: "branch-frp-signal-impossibility",
  condition: "reading > 5.25V",
  verdict: "impossible",
  next_action: "verify probe placement"
})
MERGE (t)-[:HAS_BRANCH]->(b)
```

### Prompt 4A writes

```
MERGE (p1:Platform {id: "2018-f250-67psd"})
MERGE (p2:Platform {id: "2019-f350-67psd"})
MERGE (p1)-[:EQUIVALENT_FOR_SYSTEM {system: "fuel"}]->(p2)
```

## How a diagnostic gets rendered

A diagnostic is a graph query. Example for `2018 F-250 6.7L PSD + P0087`:

```
MATCH (sym:Symptom {id: "p0087-fuel-rail-pressure-too-low"})
      -[r:IMPLICATES_TEST]->(t:TestAction)
      -[:PROBES]->(c:Component)
      -[:BELONGS_TO_PLATFORM]->(p:Platform)
WHERE p.id = "2018-f250-67psd" 
   OR EXISTS {
     MATCH (p)-[:EQUIVALENT_FOR_SYSTEM {system: "fuel"}]-(p2:Platform)
     WHERE p2.id = "2018-f250-67psd"
   }
WITH t, r, c
OPTIONAL MATCH (t)-[:HAS_BRANCH]->(b:BranchLogic)
OPTIONAL MATCH (t)<-[o:OUTCOME_OF]-(out:TechOutcome)
RETURN t, r.priority AS priority, c, collect(b) AS branches, collect(out) AS field_outcomes
ORDER BY r.priority DESC, t.invasiveness ASC
```

The result is the ordered test sequence, with branch logic attached to each test, and field outcomes from prior techs attached to each test. The application layer renders this as the interactive diagnostic surface.

## How outcomes write back to the graph

When a tech completes a test, the application layer writes a TechOutcome node:

```
MERGE (out:TechOutcome {
  session_id: "abc-123",
  test_id: "test-67psd-frp-signal-idle",
  measured_value: 2.78,
  measured_unit: "V",
  verdict: "ok",
  recorded_at: timestamp()
})
MERGE (out)-[:OUTCOME_OF]->(t {id: "test-67psd-frp-signal-idle"})
```

This is what makes the database compound. Every test action node accumulates field outcomes. After 50 techs run the same test, the node has 50 outcome edges with statistical distribution of what techs actually measured in the field. The AI's training-data-derived expected value can be compared to the field distribution, and discrepancies surface automatically.

## The fast-path for cached diagnostics

When a user enters `2019 F-350 6.7L Power Stroke + P0087`, the application layer checks:

1. Does a diagnostic exist for this exact platform+symptom? Run the rendering query above.
2. If the rendering query returns test nodes (because Prompt 4A established platform equivalence with 2018 F-250 which already has the diagnostic), serve those — no prompts run.
3. If the rendering query returns empty, run the orchestration.

Most user requests hit case 2 once the graph has been populated by even a small number of initial sessions. The orchestration only runs for genuinely novel vehicle+symptom combinations.
