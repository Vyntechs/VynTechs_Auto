# VynTechs_Auto

> **Status:** Source-available technical prototype; not part of the current paid ShopOS release. Diagnostic guidance and operational file intake are unavailable. No live-shop deployment, diagnostic accuracy, or safety performance is claimed. Do not use this repository as repair instructions; technicians must rely on authorized, current service information and professional judgment.

An automotive diagnostic technician translated a safety-critical shop workflow into a stateful AI diagnostic system. The evidence in this repository is the working architecture: retrieval with provenance, explicit risk classification, confidence gates that fail closed, audit history, multi-tenant data boundaries, billing scaffolding, versioned migrations, and tests against real SQL behavior.

The prototype models a flow where a tech enters a vehicle and a complaint, and an internal score is compared with a configured action threshold that can block the proposed action. Designed as one subscription per shop.

## The problem

A misdiagnosis isn't a wrong answer. It's a customer who pays for the wrong part, comes back angry, and never trusts the shop again — a comeback.

Most "AI mechanic" tools are a chatbot with a service manual stapled on. They sound confident and guess. This prototype is built the other way around: risk is classified, an internal score is checked against configured policy, and the system can ask for more information instead of presenting a blocked action. The gate is implemented in code, not left to a prompt.

## Architecture

The core is a stateful decision-tree engine, not a single prompt. Every turn pulls evidence, advances the tree, and compares the proposed action's internal score with a configured action threshold before the action can be presented.

```
                        TECH: vehicle + complaint
                                  │
                    ┌─────────────▼─────────────┐
                    │   Two-rung retrieval        │  ← bounded by a 20s deadline,
                    │   (parallel, fail-soft)     │    never blocks the LLM call
                    │                             │
                    │  Rung 0  promotable case    │  pgvector cosine KNN
                    │          corpus (Voyage     │  verified case designs
                    │          voyage-3, 1024-dim)│  get a top-2 fast lane
                    │                             │
                    │  Rung 1  6 internet adapters│  nhtsa .90 · recall .85
                    │          weighted + budgeted│  forum .60 · youtube .55
                    │                             │  reddit .50 · web .50
                    └─────────────┬───────────────┘
                                  │  snippets graded by an LLM
                                  │  (keep only relevance ≥ 0.4)
                    ┌─────────────▼───────────────┐
                    │   Tree engine (Sonnet)      │  generate / update tree,
                    │   forced JSON, brace-        │  emit a proposedAction
                    │   recovery + shape validation│  with confidence 0–1
                    └─────────────┬───────────────┘
                                  │
                    ┌─────────────▼───────────────┐
                    │   Risk + policy gate        │  classify action:
                    │                             │  zero / low / medium /
                    │   ~15 regex rules FIRST      │  high / destructive
                    │   (Haiku only if no rule     │  destructive (cut wire,
                    │    matches; default = HIGH   │  reflash) matched first,
                    │    on any failure)          │  can't be downgraded
                    └─────────────┬───────────────┘
                                  │
     internal score ≥ configured threshold? ─ no ─▶  block · offer
                                  │                 [gather more low-risk · defer]
                                 yes                + show what would close the gap
                                  │
                    ┌─────────────▼───────────────┐
                    │  Repair phase (Sonnet)      │  root cause is LOCKED;
                    │  guidance only — server      │  output field-stripped to
                    │  guard drops any field that  │  {text, tangentialConcerns}
                    │  could re-diagnose          │  so it can't be hijacked
                    └─────────────────────────────┘
```

### The AI pipeline

- **One LLM provider, two tiers.** A single Anthropic client. `claude-sonnet-4-6` (overridable via `ANTHROPIC_MODEL`) does the heavy reasoning — tree generation, vision extraction, retrieval grading, repair guidance, outcome validation. `claude-haiku-4-5` is used in exactly one place: the fallback risk classifier. No Opus tier — the work doesn't need it.
- **Rules first, LLM second.** The risk classifier runs ~15 regex rules before it ever calls a model. Destructive actions — cut/splice a wire, reflash an ECU — are matched first so they can never be quietly downgraded. If a rule matches, no LLM runs. If the model is called and returns malformed JSON, the action defaults to `high`. Fail-closed policy is the default.
- **Threshold policy is explicit, not a validated accuracy score.** Configured action thresholds live per `(risk class × vehicle family × symptom class)` cell; the most-specific configuration wins, with fallbacks of `zero 0 · low .70 · medium .80 · high .90 · destructive .95`. A weekly Beta-Binomial job can propose an advisory change from recorded comeback outcomes. Drift writes an alert for a human curator only when it clears `0.05` with a sample of `10+`; the job cannot write the threshold table, and proposals are clamped to `[0.5, 0.99]`. These are policy controls, not validated probabilities or evidence of diagnostic accuracy or safety performance.
- **Vision is earned, not default.** Four Sonnet vision extractors read scan screens (DTCs, freeze-frame, PIDs), wiring diagrams (wire colors, pins, grounds, splices), and steered generic photos. The tree prompt is told *not* to ask for photos by default — vision is expensive, text confirms are cheap. Video is stored describe-first, no extraction. (Audio transcription is a known stub: the SDK has no native audio block yet, so that path is documented as API-pending, not silently broken.)
- **The corpus is designed to self-curate.** The architecture can promote closed cases into a shared corpus. Each entry's internal ranking score is roughly `successes / (successes + comebacks)` (Laplace-smoothed, capped at 0.99). Comebacks decay it; an entry with `3+` comebacks that outnumber its successes auto-retires. The ranking model gives shop-owner-verified cases the highest source weight.

### Data, auth, billing

- **Multi-tenant by shop.** `shops → profiles → customers → vehicles → sessions`, on Drizzle over postgres-js (not the Supabase client) with `prepare: false` for the pooler. Sessions carry typed JSONB — intake, tree state, outcome — and an append-only `session_events` audit log captures every AI turn.
- **Closed-by-default paywall.** Node-runtime middleware refreshes the Supabase session, role-gates `/curator/*`, then enforces access against an exempt allowlist. API routes get a JSON 401/403; pages redirect. The same check ships *inside* the API handlers as defense-in-depth against a curl bypass.
- **Two independent access axes.** A `role` column (`tech`/`owner`) for the shop, and a separate curator/founder gate (`isCurator` flag or matched founder email). The role column is deliberately *not* used for curator access — every self-signup is an owner, and that would otherwise hand everyone the keys.
- **Stripe, per shop.** One customer per tenant, Checkout + Billing Portal, signature-verified webhooks that write back only subscription status and period end. No usage metering, no per-seat math — one subscription per shop.
- **Knowledge graph.** A normalized electrical-topology model (platforms, components, pins, connections, scenarios, readings) sits alongside the corpus, every node carrying source provenance (`TRAINING-CONFIRMED` / `FIELD-VERIFIED` / `GAP`) and an inference class (`LAW` / `LOGIC` / `PATTERN`).

## How it's built

Brandon directs AI-assisted implementation and owns the domain, product, and architecture decisions. He inspects changes and accepts work through tests and observed behavior; AI collaborators are credited in the commit history.

## Verification surface

- Extensive unit and integration coverage exercises database behavior against PGlite rather than replacing the SQL layer with framework mocks.
- Schema changes are preserved as versioned Postgres migrations.
- Where handler extraction applies, thin route shims delegate to domain handlers with injected dependencies, keeping the core behavior independently testable.

## Stack

Next.js 16 (App Router, Node runtime) · React 19 · TypeScript · Drizzle ORM over postgres-js · Supabase (auth, Postgres, Storage) · pgvector + Voyage AI `voyage-3` embeddings · Anthropic SDK (`claude-sonnet-4-6` / `claude-haiku-4-5`) with ephemeral prompt caching on every static system prompt · Stripe · Zod · `@xyflow/react` + dagre for the topology diagrams · Vitest + Playwright.

## Run

```bash
pnpm install
cp .env.example .env.local   # fill in Supabase, Anthropic, Voyage, Stripe, CRON_SECRET
pnpm dev
pnpm test                    # Vitest, pglite-backed
```

Migrations are applied to live Supabase through its own migration history (the Drizzle filenames are kept for source control). Deploys run on Vercel; the two cron jobs (`comeback-prompts-daily`, `calibration-weekly`) are wired in `vercel.json` and gated by a constant-time `CRON_SECRET` check.
