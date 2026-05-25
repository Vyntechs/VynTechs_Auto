# Graph Schema

Storage primitive for the diagnostic database. Recommended implementation: PostgreSQL with Apache AGE extension, or Neo4j. The schema below is presented in Cypher syntax; AGE supports the same.

## Node types

### Platform
A specific vehicle architecture identifier. One platform may cover multiple year/model combinations; one year/model may belong to multiple platforms across systems.

```
(:Platform {
  id: string (unique),
  year_range: string,
  parent_make: string,
  parent_model_family: string,
  generation: string
})
```

### ArchitectureFact
A fact about a platform's architecture from Prompt 1's research output.

```
(:ArchitectureFact {
  id: string (unique),
  description: string,
  confidence: enum("TRAINING-CONFIRMED", "TRAINING-INFERRED", "FIELD-VERIFIED", "GAP"),
  field_verify_required: boolean
})
```

### Component
A physical component on the vehicle. Tagged to platforms via BELONGS_TO_PLATFORM edges.

```
(:Component {
  id: string (unique),
  name: string,
  kind: enum("sensor", "actuator", "pump", "valve", "module", "mechanical", "splice", "connector"),
  electrical_contract: string (e.g., "3-wire analog"),
  location: string,
  function: string
})
```

### TestAction
A single atomic test that can be performed against a component under a specific scenario. The fundamental unit of a diagnostic.

```
(:TestAction {
  id: string (unique),
  description: string,
  scenario_required: enum("key-off", "key-on", "cranking", "idle", "medium", "heavy", "hot-soak", "none"),
  meter_mode: string (nullable),
  expected_value: number (nullable),
  expected_unit: string (nullable),
  expected_tolerance: number (nullable),
  expected_observation: string (nullable, for non-numeric tests),
  invasiveness: integer (1-5),
  confidence_boost: number,
  source_citation: string
})
```

### BranchLogic
A decision rule that fires based on a test result. Captures impossibility halts, contradiction halts, and routing-to-next-test logic.

```
(:BranchLogic {
  id: string (unique),
  condition: string,
  verdict: enum("ok", "warn", "fail", "impossible"),
  next_action: string,
  reasoning: string
})
```

### Symptom
A customer concern, DTC, or observable behavior that triggers a diagnostic.

```
(:Symptom {
  id: string (unique),
  description: string,
  category: enum("dtc", "performance", "no-start", "drivability", "noise-vibration", "electrical", "other")
})
```

### TechOutcome
A single test result recorded by a technician during a diagnostic session. The unit of field data accumulation.

```
(:TechOutcome {
  id: string (unique),
  session_id: string,
  measured_value: number (nullable),
  measured_unit: string (nullable),
  measured_observation: string (nullable),
  verdict: enum("ok", "warn", "fail", "impossible"),
  recorded_at: timestamp,
  tech_id: string (nullable)
})
```

### DiagnosticSession
A complete diagnostic run by one tech. Aggregates outcomes and commits.

```
(:DiagnosticSession {
  id: string (unique),
  vehicle_id: string,
  symptom_id: string,
  tech_id: string,
  started_at: timestamp,
  completed_at: timestamp (nullable),
  final_verdict: enum("commit-allowed", "commit-refused", "incomplete"),
  resolved_component: string (nullable, what was actually replaced/repaired),
  cumulative_confidence: number
})
```

## Edge types

```
(:Platform)-[:HAS_ANCESTOR]->(:Platform)
  // generational lineage (T1XX descends from K2XX, etc.)

(:Platform)-[:EQUIVALENT_FOR_SYSTEM {system: string}]-(:Platform)
  // bidirectional. Written by Prompt 4A. 
  // The system tag means equivalence holds for that system only — 
  // two platforms may be equivalent for HVAC but not for driveline.

(:ArchitectureFact)-[:APPLIES_TO]->(:Platform)

(:Component)-[:BELONGS_TO_PLATFORM]->(:Platform)

(:Component)-[:CONNECTS_TO {mode: string, direction: string}]->(:Component)
  // mode: electrical-wire, fluid-line, mechanical-linkage, can-bus, lin-bus, etc.

(:Component)-[:REPORTS_TO]->(:Component)
  // sensor → module

(:Component)-[:CONTROLLED_BY]->(:Component)
  // actuator ← module

(:TestAction)-[:PROBES]->(:Component)

(:Symptom)-[:IMPLICATES_TEST {priority: integer}]->(:TestAction)
  // priority is the diagnostic ordering hint from Prompt 3

(:TestAction)-[:HAS_BRANCH]->(:BranchLogic)

(:BranchLogic)-[:ROUTES_TO]->(:TestAction)
  // chains tests together based on outcomes

(:TechOutcome)-[:OUTCOME_OF]->(:TestAction)

(:TechOutcome)-[:RECORDED_IN]->(:DiagnosticSession)

(:DiagnosticSession)-[:RESOLVED_BY]->(:Component)
  // attaches the final repair to the session for outcome learning
```

## Example queries

### Render a diagnostic for vehicle + symptom

```cypher
MATCH (sym:Symptom {id: $symptom_id})-[r:IMPLICATES_TEST]->(t:TestAction)
      -[:PROBES]->(c:Component)
      -[:BELONGS_TO_PLATFORM]->(p:Platform)
WHERE p.id = $vehicle_platform
   OR (p)-[:EQUIVALENT_FOR_SYSTEM {system: $system}]-(:Platform {id: $vehicle_platform})
OPTIONAL MATCH (t)-[:HAS_BRANCH]->(b:BranchLogic)
OPTIONAL MATCH (t)<-[:OUTCOME_OF]-(out:TechOutcome)
RETURN t, r.priority AS priority, c, 
       collect(DISTINCT b) AS branches,
       count(out) AS field_outcome_count,
       avg(out.measured_value) AS field_avg,
       stdev(out.measured_value) AS field_stdev
ORDER BY r.priority DESC, t.invasiveness ASC
```

### Find test actions with diverging field outcomes from training expectation

```cypher
MATCH (t:TestAction)<-[:OUTCOME_OF]-(out:TechOutcome)
WHERE out.measured_value IS NOT NULL
WITH t, avg(out.measured_value) AS field_avg, count(out) AS n
WHERE n >= 5 AND abs(field_avg - t.expected_value) > t.expected_tolerance * 2
RETURN t.id, t.expected_value, field_avg, n
ORDER BY abs(field_avg - t.expected_value) DESC
```

This query surfaces tests where the field has diverged from the AI-generated expectation. The application layer can use this to flag tests for review or to automatically update expected values from field data.

### Find the most common repair for a symptom across platforms

```cypher
MATCH (sym:Symptom {id: $symptom_id})<-[:IMPLICATES_TEST]-(t:TestAction)
      <-[:OUTCOME_OF]-(:TechOutcome)-[:RECORDED_IN]->(s:DiagnosticSession)
      -[:RESOLVED_BY]->(c:Component)
WHERE s.final_verdict = "commit-allowed"
RETURN c.name AS component_replaced, count(*) AS resolution_count
ORDER BY resolution_count DESC
```

This is the basis for the service manual the database becomes over time. After enough sessions, this query for any common symptom returns the actual statistical distribution of root causes from real field repairs — which is what a service manual is supposed to be.

## Indexing

Required indexes for query performance:

- Platform(id)
- Component(id), Component(BELONGS_TO_PLATFORM target)
- TestAction(id)
- Symptom(id)
- TechOutcome(session_id), TechOutcome(recorded_at)
- DiagnosticSession(vehicle_id, symptom_id)

## What the schema enforces structurally

- Components belong to platforms, not to diagnostics. A diagnostic does not "own" the FRP sensor; the platform does. Two diagnostics on the same platform reference the same component node.
- Test actions probe components. A test is not a property of a diagnostic; it is an atomic operation against a component that any diagnostic may use.
- Symptoms reference tests via priority-weighted edges. The same test may be implicated by multiple symptoms with different priorities. The graph naturally connects diagnoses through shared tests.
- Platform equivalence is a typed edge that lets one diagnostic serve many vehicles without duplication.
- Field outcomes attach to test nodes, not to diagnostics. Every tech who runs the FRP signal test contributes to the same node's outcome history, regardless of which symptom drove them to that test.

This is what makes branches connect naturally. Connection is the absence of duplication in the storage layer, not a process applied on top.
