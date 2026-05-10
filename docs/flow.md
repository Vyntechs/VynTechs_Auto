# Vyntechs end-to-end flow

Branch-tree map of every user surface, every AI call, and every external API
hit from the moment a tech submits intake to the moment a comeback follow-up
fires 7 / 30 days later. Verified against the live code on this branch
(2026-05-09).

`[AI #N]` = call to Claude. `[API]` = external HTTP API. Every choice the tech
can make is a branch.

```
INTAKE  (tech enters vehicle + complaint, hits Submit)
  │  POST /api/intake/submit
  │
  │  [API]    Corpus retrieval (vector search on prior cases)
  │  [API]    Web retrieval (NHTSA, manufacturer recall, forums, YouTube,
  │           Reddit, web search) — 6 adapters, run in parallel
  │  [AI #2]  Retrieval validator — grades web snippets for relevance
  │  [AI #1]  Tree engine — builds the diagnostic plan
  │
  ▼
ACTIVE SESSION  (the step-by-step screen)
  │  GET /sessions/[id] → routeForSession() in lib/session-routing.ts:
  │    closed → ClosedCaseSummary
  │    no tree → TreeGenerating (loading)
  │    gateDecision blocking → /sessions/[id]/decline
  │    otherwise → ActiveSession view
  │
  │  Each step shows: what to do · AI confidence · sometimes a capture request
  │
  ├── (a) Log a text observation
  │     │  POST /api/sessions/[id]/advance
  │     │
  │     │  [AI #3]  Tree engine — re-evaluates with the new info
  │     │  [API]    Re-runs corpus + web retrieval (same as intake)
  │     │  [AI #4]  Risk classifier — labels the next action
  │     │           (zero / low / medium / high / destructive)
  │     │
  │     ├── confidence ≥ threshold for the risk class → next step on Active
  │     └── confidence < threshold → DECLINE SCREEN
  │
  ├── (b) Capture photo / scan-tool screen / wiring diagram
  │     │  POST /api/sessions/[id]/capture
  │     │
  │     │  [AI #5]  Vision extractor — reads structured data off the image
  │     │           (DTCs, pin numbers, wire colors, build code, etc.)
  │     │
  │     └── back to Active Session (extracted facts feed AI #3 next time)
  │
  ├── (c) Capture audio / video
  │     │  POST /api/sessions/[id]/capture
  │     │
  │     │  [AI #6]  Audio transcriber — transcribes speech, tags acoustics
  │     │           (lifter tick, vacuum hiss, exhaust leak, etc.)
  │     │
  │     └── back to Active Session
  │
  ├── (d) Capture ambient conditions
  │     │  POST /api/sessions/[id]/ambient
  │     │
  │     │  [API]    Open-Meteo (free, no key) — temp + humidity for the
  │     │           tech's geolocation. Tech can override manually.
  │     │
  │     └── back to Active Session (saved on intake; AI sees it from now on)
  │
  └── (e) Abandon  (mistake / test / wrong vehicle / customer left)
        │  POST /api/sessions/[id]/abandon
        │
        └── session ends, no learning recorded

DECLINE SCREEN  (shown only when AI is uncertain about a risky step)
  │
  ├── (1) Hero card — answer the AI's specific question
  │     │  Yes/No  → POST /api/sessions/[id]/advance
  │     │  Snap-it → POST /api/sessions/[id]/capture
  │     │
  │     │  [AI #3 again]  Tree engine re-evaluates with the answer / photo
  │     │
  │     └── back to Active Session (or back to Decline with new content)
  │
  ├── (2) Gather more low-risk data
  │     └── back to Active Session (currently broken — fixing in next batch)
  │
  └── (3) Defer for curator review
        │  POST /api/sessions/[id]/decline-or-defer  (reason='defer')
        │
        │  [AI #7]  Decline-language generator — customer-facing copy
        │
        └── case parks; senior tech reviews 24-72h later
            (the "Decline this job" option is being deleted)

DIAGNOSIS DONE  (AI sets done=true and provides rootCauseSummary)
  │  Active Session renders DiagnosisProposedReview
  │
  └── Tech confirms + locks the diagnosis
        │  POST /api/sessions/[id]/lock-diagnosis
        │
        └── tree.phase = 'repairing'  → REPAIR PHASE

REPAIR PHASE  (chat-style, different view from Active Session)
  │
  ├── Tech logs repair observation
  │     │  POST /api/sessions/[id]/repair-observation
  │     │
  │     │  [AI #8]  Repair guidance — coach reply, tangential concerns
  │     │
  │     └── continue chatting
  │
  └── Close the case  → OUTCOME FORM  (/sessions/[id]/outcome)

OUTCOME FORM  (root cause, parts, time, verification)
  │  POST /api/sessions/[id]/close
  │
  │  [AI #9]  Outcome specificity validator
  │           ("wire harness" → reject; "driver-side block ground stud,
  │            corroded" → accept)
  │
  ├── too vague → 422, tech gets one rewrite then forced override
  └── specific → CASE CLOSED
                 │
                 │  [AI #10]  Corpus promotion — decides whether this case
                 │            joins the cross-shop corpus
                 │  [Cron]    Schedule 7-day + 30-day comeback follow-ups
                 │
                 ▼

7d / 30d FOLLOW-UP
  │
  └── "Did the fix hold?"
        ├── Yes → corpus confidence on this pattern increments
        └── No  → corpus confidence decays (AI gets less wrong over time)
```

## Headline numbers

- A typical case calls Claude **5–15 times** end-to-end:
  one tree update per observation, one risk classify per observation,
  one extractor per artifact, plus the close-time validators.
- External APIs hit on every intake/observation: web retrieval (6 adapters
  in parallel) and weather (only when ambient is requested).
- One database read/write per step. No new infra, no migrations on this
  branch.

## Where current pain points live on the map

- **Decline-screen redirect loop** (Gather button + Yes/No perceived as
  no-ops) → branches (1) and (2) under DECLINE SCREEN.
- **AC pressure deflection** (AI used to skip pressure work to dodge the
  ambient gate) → AI #1 / AI #3 prompt rule. Already fixed on this branch.
- **"Decline this job" removal** → branch (3) under DECLINE SCREEN, plus
  every type / schema / handler / test that names the option.
- **Lossy conversation history in curator view** → AI #3's `message` text
  isn't persisted per turn; only `nextNodeId` lands in `session_events`.
