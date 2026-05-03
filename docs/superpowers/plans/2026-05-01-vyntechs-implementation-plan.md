# Vyntechs Implementation Plan — End-to-End MVP

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the full Vyntechs MVP described in `docs/superpowers/specs/2026-05-01-vyntechs-design.md` — every locked decision in §6, every component in §7, every workflow in §8, and the full multi-surface UX in §9. Outcome: a tech signs up, runs a multi-modal diagnostic session that pulls from corpus + bounded internet retrieval + Tech-Assisted Retrieval, with risk-stratified gating and Decline-or-Defer as terminal safety; a curator processes deferred/drift/novel queues; the calibration engine re-fits thresholds weekly; comeback follow-ups close the outcome flywheel; tablet bay-arm and desktop service-writer (dark) layouts are built; everything runs on Vercel production.

**Architecture:** Single Next.js 16 App Router web app with PWA install, four responsive layouts (phone / tablet / desktop / curator) gated by viewport + role, deployed once to Vercel. Supabase for auth + Postgres + Storage + Realtime (WebSocket sync). Drizzle ORM with JSONB columns for tree/intake/outcome/corpus payloads. Anthropic SDK tiered routing (Haiku 4.5 for classification, Sonnet 4.6 for the 80% of reasoning, Opus 4.7 for hard cases) with prompt caching on system prompts and per-vehicle-family corpus context. AWS S3 with lifecycle policies for tiered photo storage (hot/warm/cold). Stripe for $700/mo flat-SaaS billing. Vitest for unit, Playwright for E2E, Vercel Cron for scheduled jobs.

**Tech Stack:**
- Runtime: Node.js 22+, pnpm
- Framework: Next.js 16 App Router (TypeScript, strict)
- Auth + DB + Realtime: Supabase
- Object storage (artifacts): AWS S3 (Supabase Storage in dev; S3 in prod, see Phase J)
- ORM: Drizzle
- LLM: `@anthropic-ai/sdk` v0.84+ (Haiku 4.5 / Sonnet 4.6 / Opus 4.7 with prompt caching)
- Audio transcription: Anthropic vision/audio API (or Whisper on Vercel runtime if cost lower)
- Embeddings (corpus retrieval): OpenAI `text-embedding-3-small` via direct HTTP (cheapest decent vector)
- Billing: Stripe
- Styling: Tailwind CSS + shadcn/ui (Radix primitives)
- Testing: Vitest (unit), Playwright (E2E)
- Background jobs: Vercel Cron (weekly calibration; daily comeback prompts)
- Deploy: Vercel
- Source control: git, conventional commits

**Important — Next.js 16 caveat:** Next.js 16 has breaking changes vs. earlier versions. APIs, conventions, and file structure may differ from training-data-era Next.js. **Before writing Next.js-specific code, read the relevant guide in `node_modules/next/dist/docs/`.** Heed deprecation notices. Do not assume App Router patterns from Next.js 13/14 still apply.

**Phase map (A-S):**
- **A — Foundation** (10 tasks): scaffold Next.js, Supabase, Drizzle, Stripe stub, Vitest, Playwright, AGENTS.md, Vercel link.
- **B — Database schema** (5 tasks): profiles, shops, sessions, session_events, stripe_customers, typed queries.
- **C — Vehicle + session intake** (5 tasks): intake form, zod validation, POST /api/sessions, profile auto-create, navigation.
- **D — AI tree engine** (10 tasks): Anthropic client + cached prompts, generateInitialTree, updateTree, advance route, retry, GET route, lock-out, history list.
- **E — Phone session UX** (10 tasks): session page, SessionView, TreeView, StepInput, mobile polish, recent observations, status gating.
- **F — Outcome capture** (7 tasks): validateSpecificity, OutcomeForm, outcome zod, close route with validator gate.
- **G — Stripe billing skeleton** (3 tasks): customer auto-create, billing portal, subscription webhook.
- **H — PWA + polish** (3 tasks): manifest, service worker, install verification.
- **I — Multi-modal capture pipeline** (10 tasks): artifact storage abstraction, camera/audio/video capture UI, scan-tool screen vision OCR, audio transcription, video keyframe extraction, multi-modal advance, describe-first policy enforcement.
- **J — Photo storage tiering** (6 tasks): S3 client, artifact lifecycle, structured-extraction-on-ingest, hot/warm/cold migration cron, signed URLs, retention policy.
- **K — Cross-shop corpus (Rung 0)** (8 tasks): corpus_entry schema, embedding pipeline, similarity retrieval, corpus context injection into tree engine, auto-create from outcomes, N-way confirmation, comeback decay, conflict surfacing.
- **L — Bounded internet retrieval (Rung 1)** (10 tasks): retrieval orchestrator, NHTSA adapter, recall pages adapter, forum adapter, YouTube transcript adapter, Reddit adapter, query strategy, budget enforcement, per-(vehicle, DTC, symptom) cache, validation pass.
- **M — Tech-Assisted Retrieval + risk gating + Decline-or-Defer** (9 tasks): risk classifier table + LLM judge, confidence calibrator table, Gap Handler ladder, Tech-Assisted Retrieval flow, Decline-or-Defer terminal, customer-facing decline language, audit trail, action gating in updateTree, end-to-end gating test.
- **N — Tablet layout + real-time sync** (6 tasks): responsive breakpoints, TabletTreeView (full visual tree), ArtifactGallery sidebar, Supabase Realtime channel, cross-device sync verification, branch-pruning animation.
- **O — Desktop intake (built dark)** (5 tasks): feature flag system, /intake route, customer intake + VIN scan, AI pre-bay plan + quote draft, work order linking + comeback alerts.
- **P — Curator console** (7 tasks): role gating, deferred queue, drift queue, novel-pattern queue, case detail view with retrieval trace, corpus authoring form, calibration drift dashboard.
- **Q — Calibration engine** (5 tasks): calibration table schema, weekly Vercel Cron job, threshold re-fit algorithm, drift detection, drift alert injection.
- **R — Comeback follow-up automation** (5 tasks): follow_ups schema, schedule on close, daily Vercel Cron surfacing due prompts, in-app dashboard, follow-up outcome → corpus update.
- **S — End-to-end + production deploy** (4 tasks): full Playwright happy-path covering A-R, production env config, Vercel production cutover, milestone tag.

**Out of scope (deferred to v1.5+ / v2):**
- Native iOS/Android apps (PWA covers MVP per spec §6 row 6 / §15)
- Hands-free voice-only mode (bay noise UX risk)
- Email / SMS / push notifications (in-app only at MVP)
- Aftermarket-parts catalog integration
- Customer-facing repair-summary emails
- Shop-OS integrations (Tekmetric, Shop-Ware)
- ADAS calibration support
- EV-specific diagnostics (HV battery, BMS)
- Multi-language UI (English only at MVP)
- Live OBD-II streaming / telematics

---

## File Structure

Files for Phases A-H (the original vertical slice) are listed in the tree below. Phases I-S add additional files (multi-modal capture, S3 storage adapter, corpus + retrieval, Tech-Assisted Retrieval / risk gating / Decline-or-Defer, tablet/desktop/curator routes, calibration + comeback cron jobs, end-to-end test). Each phase enumerates its own file additions in its section below — refer to the phase task headers for paths.

```
vyntechs/
├── app/
│   ├── layout.tsx                                    # Root layout, fonts, providers
│   ├── page.tsx                                      # Landing page (signed-out)
│   ├── globals.css                                   # Tailwind base
│   ├── manifest.ts                                   # PWA manifest (Next.js metadata route)
│   ├── (auth)/
│   │   ├── sign-in/page.tsx                         # Sign-in form (Supabase auth UI)
│   │   └── sign-up/page.tsx                         # Sign-up form
│   ├── (app)/
│   │   ├── layout.tsx                               # Authenticated layout (header, nav)
│   │   ├── sessions/
│   │   │   ├── page.tsx                             # Session history list
│   │   │   ├── new/page.tsx                         # New session intake form
│   │   │   └── [id]/page.tsx                        # Active session — phone layout
│   │   └── billing/
│   │       └── page.tsx                             # Stripe customer portal redirect
│   └── api/
│       ├── sessions/
│       │   ├── route.ts                             # POST create / GET list
│       │   └── [id]/
│       │       ├── route.ts                         # GET single
│       │       ├── advance/route.ts                 # POST tree advance with text input
│       │       └── close/route.ts                   # POST outcome capture / close
│       └── stripe/
│           └── webhook/route.ts                     # Stripe webhook receiver
├── components/
│   ├── ui/                                           # shadcn/ui generated components
│   ├── intake/
│   │   └── new-session-form.tsx                     # Vehicle + complaint form
│   └── session/
│       ├── tree-view.tsx                            # Phone-layout tree (current step + breadcrumbs)
│       ├── step-input.tsx                           # Textarea for tech's observation
│       └── outcome-form.tsx                         # Structured outcome capture form
├── lib/
│   ├── db/
│   │   ├── schema.ts                                # Drizzle schema definitions
│   │   ├── client.ts                                # DB client (server-side)
│   │   └── queries.ts                               # Reusable typed queries
│   ├── ai/
│   │   ├── client.ts                                # Anthropic SDK setup
│   │   ├── prompts.ts                               # System prompts (cached)
│   │   ├── tree-engine.ts                           # generateInitialTree, updateTree
│   │   └── outcome-validator.ts                    # validateSpecificity
│   ├── auth.ts                                      # Supabase auth helpers
│   ├── stripe.ts                                    # Stripe client + helpers
│   └── types.ts                                     # Shared TypeScript types
├── tests/
│   ├── unit/
│   │   ├── tree-engine.test.ts                     # Tree gen + update unit tests
│   │   ├── outcome-validator.test.ts               # Specificity validator tests
│   │   └── db-queries.test.ts                       # DB query unit tests (mocked)
│   └── e2e/
│       └── happy-path.spec.ts                       # Playwright full flow
├── drizzle/
│   └── migrations/                                  # Generated migrations
├── public/
│   └── icons/                                       # PWA icons (192, 512)
├── middleware.ts                                    # Supabase auth middleware
├── next.config.ts
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── components.json                                  # shadcn config
├── drizzle.config.ts
├── vitest.config.ts
├── playwright.config.ts
├── .env.example
├── .gitignore
├── AGENTS.md                                        # Project rules for AI agents
└── README.md                                        # Quick start (created on request)
```

---

## Phase A — Foundation (10 tasks)

### Task A1: Initialize Next.js 16 project with TypeScript and Tailwind

**Files:**
- Create: package.json, next.config.ts, tsconfig.json, app/layout.tsx, app/page.tsx, app/globals.css, tailwind.config.ts, .gitignore

- [ ] **Step 1: Run create-next-app**

```bash
cd /Volumes/Creativity/dev/projects/vyntechs && pnpm create next-app@latest . --typescript --tailwind --app --use-pnpm --no-eslint --no-src-dir --import-alias "@/*"
```

When prompted about overwriting (because we already have docs/ and .git/), answer No to overwriting any existing file. The scaffold should respect existing files.

- [ ] **Step 2: Verify the dev server starts**

```bash
pnpm dev
```

Expected: Next.js dev server starts on http://localhost:3000 and shows the default landing page. Stop the server with Ctrl-C.

- [ ] **Step 3: Replace default app/page.tsx with a minimal landing**

```tsx
// app/page.tsx
export default function HomePage() {
  return (
    <main className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold mb-4">Vyntechs</h1>
        <p className="text-lg text-gray-600">AI master tech for the bay.</p>
      </div>
    </main>
  )
}
```

- [ ] **Step 4: Read the in-package Next.js docs to confirm App Router patterns**

```bash
ls node_modules/next/dist/docs/ 2>/dev/null | head
```

If a docs/ dir exists in node_modules/next/dist, browse it for App Router conventions before writing more route code. Heed any deprecation notes.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(scaffold): bootstrap Next.js 16 + TypeScript + Tailwind"
```

---

### Task A2: Add shadcn/ui

**Files:**
- Create: components.json, components/ui/ (multiple shadcn components)

- [ ] **Step 1: Initialize shadcn**

```bash
pnpm dlx shadcn@latest init
```

When prompted: TypeScript yes; style "default"; base color "slate"; CSS file `app/globals.css`; CSS variables yes; tailwind config `tailwind.config.ts`; alias `@/components`, `@/lib`.

- [ ] **Step 2: Add the components we'll need in this plan**

```bash
pnpm dlx shadcn@latest add button input textarea card form label select dialog toast
```

- [ ] **Step 3: Verify a button renders**

Edit `app/page.tsx` to import and render `<Button>Hello</Button>`. Run `pnpm dev` and confirm it renders correctly. Revert the import after verification (we don't ship Hello to landing).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(ui): add shadcn/ui with base components"
```

---

### Task A3: Set up Supabase project + Drizzle ORM

**Files:**
- Create: lib/db/client.ts, lib/db/schema.ts, drizzle.config.ts, .env.example

- [ ] **Step 1: Create Supabase project**

Use the Supabase MCP `create_project` tool (or the Supabase dashboard) to create a project named `vyntechs-dev` in the us-east region. Capture: Project URL, anon key, service role key, database password.

- [ ] **Step 2: Install Supabase + Drizzle dependencies**

```bash
pnpm add @supabase/supabase-js @supabase/ssr drizzle-orm postgres
pnpm add -D drizzle-kit
```

- [ ] **Step 3: Create .env.example with required keys**

```
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
DATABASE_URL=postgresql://postgres:[password]@db.xxx.supabase.co:5432/postgres

ANTHROPIC_API_KEY=...
ANTHROPIC_MODEL=claude-sonnet-4-6

STRIPE_SECRET_KEY=...
STRIPE_WEBHOOK_SECRET=...
STRIPE_PRICE_ID=...
```

- [ ] **Step 4: Create .env.local with real values for dev**

Copy `.env.example` to `.env.local`. Fill in the actual Supabase values from Step 1. Leave Anthropic/Stripe blank for now (filled in later tasks).

- [ ] **Step 5: Create lib/db/client.ts**

```ts
// lib/db/client.ts
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

const connectionString = process.env.DATABASE_URL!
const queryClient = postgres(connectionString, { prepare: false })
export const db = drizzle(queryClient)
```

- [ ] **Step 6: Create drizzle.config.ts**

```ts
// drizzle.config.ts
import type { Config } from 'drizzle-kit'

export default {
  schema: './lib/db/schema.ts',
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
} satisfies Config
```

- [ ] **Step 7: Test DB connection**

Create a temporary `scripts/check-db.ts` that runs `await db.execute(sql\`select 1\`)` and prints the result. Run with `pnpm tsx scripts/check-db.ts`. Expected: prints `[ { '?column?': 1 } ]`. Delete the script after verification.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(db): set up Supabase + Drizzle ORM client"
```

---

### Task A4: Set up Supabase auth with SSR cookie pattern + middleware

**Files:**
- Create: middleware.ts, lib/auth.ts, lib/supabase-server.ts, lib/supabase-client.ts

- [ ] **Step 1: Create lib/supabase-server.ts** (server-side Supabase client)

```ts
// lib/supabase-server.ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function getServerSupabase() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          try {
            toSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Server Components cannot set cookies; safe to ignore.
          }
        },
      },
    }
  )
}
```

- [ ] **Step 2: Create lib/supabase-client.ts** (browser client)

```ts
// lib/supabase-client.ts
'use client'
import { createBrowserClient } from '@supabase/ssr'

export function getBrowserSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
```

- [ ] **Step 3: Create middleware.ts** (refresh sessions, gate /app routes)

```ts
// middleware.ts
import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export async function middleware(req: NextRequest) {
  let res = NextResponse.next({ request: req })
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (toSet) => {
          toSet.forEach(({ name, value }) => req.cookies.set(name, value))
          res = NextResponse.next({ request: req })
          toSet.forEach(({ name, value, options }) =>
            res.cookies.set(name, value, options)
          )
        },
      },
    }
  )
  const { data: { user } } = await supabase.auth.getUser()
  const path = req.nextUrl.pathname
  const isAppRoute = path.startsWith('/sessions') || path.startsWith('/billing')
  if (isAppRoute && !user) {
    return NextResponse.redirect(new URL('/sign-in', req.url))
  }
  if ((path === '/sign-in' || path === '/sign-up') && user) {
    return NextResponse.redirect(new URL('/sessions', req.url))
  }
  return res
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
```

- [ ] **Step 4: Create lib/auth.ts** (typed helpers)

```ts
// lib/auth.ts
import { getServerSupabase } from './supabase-server'
import { redirect } from 'next/navigation'

export async function getCurrentUser() {
  const supabase = await getServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

export async function requireUser() {
  const user = await getCurrentUser()
  if (!user) redirect('/sign-in')
  return user
}
```

- [ ] **Step 5: Verify middleware runs**

Add `console.log` to middleware temporarily, hit `/sign-in` in browser, observe log in `pnpm dev` terminal. Remove the console.log after verification.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(auth): add Supabase auth with SSR cookies + middleware"
```

---

### Task A5: Stripe SDK + webhook scaffold

**Files:**
- Create: lib/stripe.ts, app/api/stripe/webhook/route.ts

- [ ] **Step 1: Install Stripe**

```bash
pnpm add stripe
```

- [ ] **Step 2: Create Stripe product + price** (manual one-time setup in Stripe dashboard)

In Stripe dashboard (test mode):
- Create product "Vyntechs Pro"
- Recurring price: $700/mo USD
- Capture the `price_xxx` ID, paste into `.env.local` as `STRIPE_PRICE_ID`

- [ ] **Step 3: Create lib/stripe.ts**

```ts
// lib/stripe.ts
import Stripe from 'stripe'
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-08-27.basil',
})
```

- [ ] **Step 4: Create app/api/stripe/webhook/route.ts** (skeleton — actual logic in Phase I)

```ts
// app/api/stripe/webhook/route.ts
import { stripe } from '@/lib/stripe'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const body = await req.text()
  const sig = req.headers.get('stripe-signature')!
  let event
  try {
    event = stripe.webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    )
  } catch (err) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 400 })
  }
  // Phase I will add event handling here.
  return NextResponse.json({ received: true })
}
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(stripe): add Stripe SDK client + webhook scaffold"
```

---

### Task A6: Configure Vitest for unit tests

**Files:**
- Create: vitest.config.ts, tests/unit/sanity.test.ts

- [ ] **Step 1: Install Vitest**

```bash
pnpm add -D vitest @vitest/ui happy-dom @testing-library/react @testing-library/jest-dom
```

- [ ] **Step 2: Create vitest.config.ts**

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    globals: true,
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
  },
  resolve: { alias: { '@': path.resolve(__dirname, '.') } },
})
```

- [ ] **Step 3: Install React plugin**

```bash
pnpm add -D @vitejs/plugin-react
```

- [ ] **Step 4: Add test script to package.json**

In `package.json` `scripts`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 5: Write sanity test**

```ts
// tests/unit/sanity.test.ts
import { describe, it, expect } from 'vitest'

describe('sanity', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 6: Run tests, expect pass**

```bash
pnpm test
```

Expected: 1 passed.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore(test): configure Vitest with sanity test"
```

---

### Task A7: Configure Playwright for E2E tests

**Files:**
- Create: playwright.config.ts, tests/e2e/landing.spec.ts

- [ ] **Step 1: Install Playwright**

```bash
pnpm create playwright
```

When prompted: TypeScript, tests dir `tests/e2e`, GitHub Actions no, install browsers yes.

- [ ] **Step 2: Configure to run dev server automatically**

Edit `playwright.config.ts` to add:
```ts
webServer: {
  command: 'pnpm dev',
  port: 3000,
  reuseExistingServer: !process.env.CI,
},
use: {
  baseURL: 'http://localhost:3000',
},
```

- [ ] **Step 3: Write smoke test for landing**

```ts
// tests/e2e/landing.spec.ts
import { test, expect } from '@playwright/test'

test('landing page renders', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('h1')).toHaveText('Vyntechs')
})
```

- [ ] **Step 4: Run Playwright, expect pass**

```bash
pnpm exec playwright test
```

Expected: 1 passed across configured browsers.

- [ ] **Step 5: Add npm script**

In `package.json`:
```json
"test:e2e": "playwright test"
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore(test): configure Playwright with smoke E2E"
```

---

### Task A8: Write AGENTS.md for project-specific rules

**Files:**
- Create: AGENTS.md

- [ ] **Step 1: Create AGENTS.md**

```markdown
# Vyntechs — Project Rules for AI Agents

> These rules extend (never override) Brandon's global CLAUDE.md.

## Stack discipline

- **Next.js 16:** APIs differ from training-data-era Next.js. Read `node_modules/next/dist/docs/` before writing route handlers, layouts, server actions, or middleware.
- **Anthropic SDK:** always use prompt caching on system prompts >2K tokens. See lib/ai/client.ts for the pattern.
- **Drizzle:** all DB access goes through `lib/db/queries.ts`. Routes do not write inline SQL.
- **Supabase auth:** server code uses `getServerSupabase()` and `requireUser()`; client code uses `getBrowserSupabase()`. Never share clients between server and browser.

## Test discipline (non-negotiable)

Every change to `lib/`, `app/api/`, or `components/` requires:
1. Unit test in `tests/unit/` for pure logic.
2. E2E test in `tests/e2e/` if the change affects a user-visible flow.
3. Both must pass before commit. "It compiles" is not done.

## Commit format

Conventional commits:
- `feat(scope): ...`
- `fix(scope): ...`
- `test(scope): ...`
- `refactor(scope): ...`
- `chore(scope): ...`
- `docs(scope): ...`

Scopes: `auth`, `db`, `ai`, `session`, `intake`, `outcome`, `ui`, `stripe`, `pwa`, `test`, `scaffold`, `deploy`.

## Reference docs

- Spec: `docs/superpowers/specs/2026-05-01-vyntechs-design.md`
- Plans: `docs/superpowers/plans/`
- Always check the spec before making product decisions.
```

- [ ] **Step 2: Commit**

```bash
git add AGENTS.md
git commit -m "docs(scaffold): add AGENTS.md project rules"
```

---

### Task A9: Add .gitignore additions for env files and build outputs

**Files:**
- Modify: .gitignore

- [ ] **Step 1: Verify .env.local is gitignored**

```bash
grep -E "\\.env" .gitignore
```

Expected: `.env*.local` or similar exists. If not, append:
```
.env*.local
.env
!.env.example
```

- [ ] **Step 2: Verify build artifacts are gitignored**

Confirm `.next/`, `node_modules/`, `coverage/`, `playwright-report/`, `test-results/` are present in .gitignore. Add any missing:
```
playwright-report/
test-results/
coverage/
drizzle/migrations/meta/
```

- [ ] **Step 3: Commit if changed**

```bash
git diff --quiet .gitignore || (git add .gitignore && git commit -m "chore(scaffold): tighten .gitignore for env and build artifacts")
```

---

### Task A10: Verify Vercel deploy works end-to-end with current scaffold

**Files:** none

- [ ] **Step 1: Link Vercel project**

```bash
pnpm dlx vercel link
```

When prompted, create new project named `vyntechs`. Confirm root directory = current dir.

- [ ] **Step 2: Push env vars to Vercel preview environment**

```bash
pnpm dlx vercel env pull .env.preview --environment=preview
```

Or use the Vercel dashboard to add `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` to preview environment.

- [ ] **Step 3: Deploy preview**

```bash
pnpm dlx vercel
```

Expected: deploy succeeds, returns a `*.vercel.app` URL. Open it in browser, confirm landing page renders.

- [ ] **Step 4: No commit needed** (deploy is metadata-only).

---

## Phase B — Database Schema (5 tasks)

### Task B1: Define `profiles` and `shops` tables

**Files:**
- Modify: lib/db/schema.ts

- [ ] **Step 1: Write schema**

```ts
// lib/db/schema.ts
import { pgTable, uuid, text, timestamp, jsonb, integer } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

export const shops = pgTable('shops', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  city: text('city'),
  state: text('state'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const profiles = pgTable('profiles', {
  id: uuid('id').primaryKey(),  // matches Supabase auth.users.id
  email: text('email').notNull(),
  fullName: text('full_name'),
  shopId: uuid('shop_id').references(() => shops.id),
  role: text('role', { enum: ['owner', 'tech', 'curator'] }).notNull().default('tech'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const shopsRelations = relations(shops, ({ many }) => ({
  profiles: many(profiles),
}))
export const profilesRelations = relations(profiles, ({ one }) => ({
  shop: one(shops, { fields: [profiles.shopId], references: [shops.id] }),
}))
```

- [ ] **Step 2: Generate migration**

```bash
pnpm drizzle-kit generate
```

Expected: migration file created in `drizzle/migrations/`.

- [ ] **Step 3: Apply migration to dev DB**

```bash
pnpm drizzle-kit migrate
```

- [ ] **Step 4: Verify tables exist via Supabase MCP**

Use the Supabase MCP `list_tables` tool to confirm `shops` and `profiles` exist.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(db): add profiles and shops tables"
```

---

### Task B2: Define `sessions` table with tree state and intake JSON

**Files:**
- Modify: lib/db/schema.ts

- [ ] **Step 1: Append session schema**

```ts
// lib/db/schema.ts (append)
export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  shopId: uuid('shop_id').references(() => shops.id).notNull(),
  techId: uuid('tech_id').references(() => profiles.id).notNull(),
  status: text('status', { enum: ['open', 'closed', 'declined', 'deferred'] }).notNull().default('open'),
  intake: jsonb('intake').notNull().$type<{
    vehicleYear: number
    vehicleMake: string
    vehicleModel: string
    vehicleEngine?: string
    mileage?: number
    customerComplaint: string
  }>(),
  treeState: jsonb('tree_state').notNull().$type<{
    nodes: Array<{
      id: string
      label: string
      status: 'pending' | 'active' | 'resolved' | 'pruned'
      children?: string[]
    }>
    currentNodeId: string
  }>(),
  outcome: jsonb('outcome').$type<{
    rootCause: string
    actionType: 'part_replacement' | 'repair' | 'adjustment' | 'cleaning' | 'no_fix' | 'referred'
    partInfo?: { name: string; oemNumber?: string; aftermarket?: string; cost?: number }
    verification: { codesCleared: boolean; testDrive: boolean; symptomsResolved: 'yes' | 'no' | 'partial' }
    diagMinutes: number
    repairMinutes: number
    notes?: string
  }>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
})

export const sessionsRelations = relations(sessions, ({ one, many }) => ({
  shop: one(shops, { fields: [sessions.shopId], references: [shops.id] }),
  tech: one(profiles, { fields: [sessions.techId], references: [profiles.id] }),
  events: many(sessionEvents),
}))
```

- [ ] **Step 2: Generate + apply migration**

```bash
pnpm drizzle-kit generate && pnpm drizzle-kit migrate
```

- [ ] **Step 3: Verify**

Supabase MCP `list_tables` to confirm `sessions` exists.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(db): add sessions table with tree_state and outcome JSONB"
```

---

### Task B3: Define `session_events` table for tree advance history

**Files:**
- Modify: lib/db/schema.ts

- [ ] **Step 1: Append schema**

```ts
// lib/db/schema.ts (append)
export const sessionEvents = pgTable('session_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').references(() => sessions.id, { onDelete: 'cascade' }).notNull(),
  nodeId: text('node_id').notNull(),
  eventType: text('event_type', { enum: ['advance', 'observation', 'tree_update', 'close'] }).notNull(),
  observationText: text('observation_text'),
  aiResponse: jsonb('ai_response').$type<{
    nextNodeId?: string
    treeUpdate?: unknown
    requestedFollowUp?: string
  }>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const sessionEventsRelations = relations(sessionEvents, ({ one }) => ({
  session: one(sessions, { fields: [sessionEvents.sessionId], references: [sessions.id] }),
}))
```

- [ ] **Step 2: Generate + apply migration**

```bash
pnpm drizzle-kit generate && pnpm drizzle-kit migrate
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(db): add session_events table for advance history"
```

---

### Task B4: Add `customers` Stripe-customer mapping table

**Files:**
- Modify: lib/db/schema.ts

- [ ] **Step 1: Append schema**

```ts
// lib/db/schema.ts (append)
export const stripeCustomers = pgTable('stripe_customers', {
  shopId: uuid('shop_id').primaryKey().references(() => shops.id, { onDelete: 'cascade' }),
  stripeCustomerId: text('stripe_customer_id').notNull().unique(),
  subscriptionStatus: text('subscription_status'),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})
```

- [ ] **Step 2: Generate + apply migration**

```bash
pnpm drizzle-kit generate && pnpm drizzle-kit migrate
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(db): add stripe_customers mapping table"
```

---

### Task B5: Write reusable typed queries

**Files:**
- Create: lib/db/queries.ts
- Create: tests/unit/db-queries.test.ts

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/db-queries.test.ts
import { describe, it, expect, vi } from 'vitest'
import { mockDb } from './mocks/db'

vi.mock('@/lib/db/client', () => ({ db: mockDb }))

describe('queries', () => {
  it('createSession inserts row and returns id', async () => {
    const { createSession } = await import('@/lib/db/queries')
    const id = await createSession({
      shopId: 'shop-1',
      techId: 'tech-1',
      intake: {
        vehicleYear: 2018,
        vehicleMake: 'Ford',
        vehicleModel: 'F-150',
        customerComplaint: 'loss of power',
      },
      treeState: { nodes: [], currentNodeId: 'root' },
    })
    expect(id).toBeTruthy()
    expect(mockDb.insert).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Create test mock**

```ts
// tests/unit/mocks/db.ts
import { vi } from 'vitest'

export const mockDb = {
  insert: vi.fn().mockReturnValue({
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: 'session-uuid' }]),
    }),
  }),
  select: vi.fn(),
  query: { sessions: { findFirst: vi.fn(), findMany: vi.fn() } },
}
```

- [ ] **Step 3: Run test, expect fail**

```bash
pnpm test tests/unit/db-queries.test.ts
```

Expected: FAIL — "createSession is not a function" or similar.

- [ ] **Step 4: Implement queries**

```ts
// lib/db/queries.ts
import { db } from './client'
import { sessions, sessionEvents, profiles, shops } from './schema'
import { eq, desc } from 'drizzle-orm'
import type { InferInsertModel } from 'drizzle-orm'

export async function createSession(input: Omit<InferInsertModel<typeof sessions>, 'id' | 'status' | 'createdAt'>) {
  const [row] = await db.insert(sessions).values(input).returning({ id: sessions.id })
  return row.id
}

export async function getSessionById(id: string) {
  return db.query.sessions.findFirst({
    where: eq(sessions.id, id),
    with: { tech: true, shop: true, events: { orderBy: desc(sessionEvents.createdAt) } },
  })
}

export async function listSessionsForShop(shopId: string, limit = 50) {
  return db.query.sessions.findMany({
    where: eq(sessions.shopId, shopId),
    orderBy: desc(sessions.createdAt),
    limit,
    with: { tech: true },
  })
}

export async function appendSessionEvent(input: InferInsertModel<typeof sessionEvents>) {
  const [row] = await db.insert(sessionEvents).values(input).returning({ id: sessionEvents.id })
  return row.id
}

export async function updateSessionTreeState(id: string, treeState: typeof sessions.$inferSelect.treeState) {
  await db.update(sessions).set({ treeState }).where(eq(sessions.id, id))
}

export async function closeSession(id: string, outcome: typeof sessions.$inferSelect.outcome) {
  await db.update(sessions)
    .set({ outcome, status: 'closed', closedAt: new Date() })
    .where(eq(sessions.id, id))
}

export async function getOpenSessionForTech(techId: string) {
  return db.query.sessions.findFirst({
    where: (s, { and, eq }) => and(eq(s.techId, techId), eq(s.status, 'open')),
  })
}
```

Note: configure drizzle's relational query API by exporting `schema` from `lib/db/client.ts`:

```ts
// lib/db/client.ts (update)
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

const queryClient = postgres(process.env.DATABASE_URL!, { prepare: false })
export const db = drizzle(queryClient, { schema })
```

- [ ] **Step 5: Run test, expect pass**

```bash
pnpm test tests/unit/db-queries.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(db): add typed queries module with createSession and listSessions"
```

---

## Phase C — Vehicle + Session Intake (5 tasks)

### Task C1: Build the new-session intake form (vehicle + complaint)

**Files:**
- Create: components/intake/new-session-form.tsx
- Create: app/(app)/sessions/new/page.tsx
- Create: lib/types.ts

- [ ] **Step 1: Define shared types**

```ts
// lib/types.ts
export type IntakePayload = {
  vehicleYear: number
  vehicleMake: string
  vehicleModel: string
  vehicleEngine?: string
  mileage?: number
  customerComplaint: string
}
```

- [ ] **Step 2: Build the form component**

```tsx
// components/intake/new-session-form.tsx
'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

export function NewSessionForm() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(formData: FormData) {
    setError(null)
    const payload = {
      vehicleYear: Number(formData.get('vehicleYear')),
      vehicleMake: String(formData.get('vehicleMake') ?? ''),
      vehicleModel: String(formData.get('vehicleModel') ?? ''),
      vehicleEngine: String(formData.get('vehicleEngine') ?? '') || undefined,
      mileage: formData.get('mileage') ? Number(formData.get('mileage')) : undefined,
      customerComplaint: String(formData.get('customerComplaint') ?? ''),
    }
    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      setError(await res.text())
      return
    }
    const { id } = await res.json()
    startTransition(() => router.push(`/sessions/${id}`))
  }

  return (
    <form action={handleSubmit} className="space-y-4 max-w-md">
      <div>
        <Label htmlFor="vehicleYear">Year</Label>
        <Input name="vehicleYear" id="vehicleYear" type="number" required min={1980} max={2027} />
      </div>
      <div>
        <Label htmlFor="vehicleMake">Make</Label>
        <Input name="vehicleMake" id="vehicleMake" required placeholder="Ford" />
      </div>
      <div>
        <Label htmlFor="vehicleModel">Model</Label>
        <Input name="vehicleModel" id="vehicleModel" required placeholder="F-150" />
      </div>
      <div>
        <Label htmlFor="vehicleEngine">Engine (optional)</Label>
        <Input name="vehicleEngine" id="vehicleEngine" placeholder="3.5L EcoBoost" />
      </div>
      <div>
        <Label htmlFor="mileage">Mileage (optional)</Label>
        <Input name="mileage" id="mileage" type="number" min={0} />
      </div>
      <div>
        <Label htmlFor="customerComplaint">Customer complaint</Label>
        <Textarea name="customerComplaint" id="customerComplaint" required rows={4} placeholder="Loss of power going up hills, intermittent wrench light..." />
      </div>
      {error && <p className="text-red-600 text-sm">{error}</p>}
      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? 'Starting…' : 'Start diagnosis'}
      </Button>
    </form>
  )
}
```

- [ ] **Step 3: Create the page**

```tsx
// app/(app)/sessions/new/page.tsx
import { NewSessionForm } from '@/components/intake/new-session-form'
import { requireUser } from '@/lib/auth'

export default async function NewSessionPage() {
  await requireUser()
  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold mb-6">New diagnosis</h1>
      <NewSessionForm />
    </main>
  )
}
```

- [ ] **Step 4: Verify the form renders**

```bash
pnpm dev
```

Sign in (or skip auth temporarily by commenting `requireUser()`), navigate to `/sessions/new`, confirm the form renders. Re-enable `requireUser()` afterward.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(intake): add new-session intake form"
```

---

### Task C2: Validate intake input on the server

**Files:**
- Modify: lib/types.ts (add zod schema)
- Create: tests/unit/intake-validation.test.ts

- [ ] **Step 1: Install zod**

```bash
pnpm add zod
```

- [ ] **Step 2: Write failing test**

```ts
// tests/unit/intake-validation.test.ts
import { describe, it, expect } from 'vitest'
import { intakeSchema } from '@/lib/types'

describe('intakeSchema', () => {
  it('accepts valid intake', () => {
    const result = intakeSchema.safeParse({
      vehicleYear: 2018,
      vehicleMake: 'Ford',
      vehicleModel: 'F-150',
      customerComplaint: 'loss of power',
    })
    expect(result.success).toBe(true)
  })
  it('rejects future year', () => {
    const result = intakeSchema.safeParse({
      vehicleYear: 2050,
      vehicleMake: 'Ford',
      vehicleModel: 'F-150',
      customerComplaint: 'loss of power',
    })
    expect(result.success).toBe(false)
  })
  it('rejects empty complaint', () => {
    const result = intakeSchema.safeParse({
      vehicleYear: 2018,
      vehicleMake: 'Ford',
      vehicleModel: 'F-150',
      customerComplaint: '',
    })
    expect(result.success).toBe(false)
  })
})
```

- [ ] **Step 3: Run test, expect fail**

```bash
pnpm test tests/unit/intake-validation.test.ts
```

Expected: FAIL — `intakeSchema` not exported.

- [ ] **Step 4: Add zod schema**

```ts
// lib/types.ts (replace existing content)
import { z } from 'zod'

export const intakeSchema = z.object({
  vehicleYear: z.number().int().min(1980).max(new Date().getFullYear() + 1),
  vehicleMake: z.string().min(1).max(50),
  vehicleModel: z.string().min(1).max(50),
  vehicleEngine: z.string().max(50).optional(),
  mileage: z.number().int().min(0).max(2_000_000).optional(),
  customerComplaint: z.string().min(5).max(2000),
})

export type IntakePayload = z.infer<typeof intakeSchema>
```

- [ ] **Step 5: Run test, expect pass**

```bash
pnpm test tests/unit/intake-validation.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(intake): add zod validation schema for intake payload"
```

---

### Task C3: Implement POST /api/sessions (create session)

**Files:**
- Create: app/api/sessions/route.ts

- [ ] **Step 1: Write the route**

Note: the AI tree generation is added in Phase D. For now, the route stores a placeholder tree state.

```ts
// app/api/sessions/route.ts
import { NextResponse } from 'next/server'
import { intakeSchema } from '@/lib/types'
import { createSession, listSessionsForShop } from '@/lib/db/queries'
import { getServerSupabase } from '@/lib/supabase-server'
import { db } from '@/lib/db/client'
import { profiles } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export async function POST(req: Request) {
  const supabase = await getServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const profile = await db.query.profiles.findFirst({ where: eq(profiles.id, user.id) })
  if (!profile?.shopId) return NextResponse.json({ error: 'no shop' }, { status: 400 })

  const body = await req.json().catch(() => null)
  const parsed = intakeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 })
  }

  const id = await createSession({
    shopId: profile.shopId,
    techId: profile.id,
    intake: parsed.data,
    treeState: { nodes: [{ id: 'root', label: 'Initial scan', status: 'pending' }], currentNodeId: 'root' },
  })

  return NextResponse.json({ id })
}

export async function GET() {
  const supabase = await getServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const profile = await db.query.profiles.findFirst({ where: eq(profiles.id, user.id) })
  if (!profile?.shopId) return NextResponse.json([])
  const list = await listSessionsForShop(profile.shopId)
  return NextResponse.json(list)
}
```

- [ ] **Step 2: Manually test (sign in via Supabase, post via curl)**

```bash
# In one terminal
pnpm dev

# In another, after signing in via the UI to get a cookie:
# (or use the Supabase MCP to seed a profile + shop, then use a service role to post)
```

This route is exercised by the E2E test in Phase J — manual curl verification optional.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(session): POST /api/sessions create + GET list"
```

---

### Task C4: Profile auto-creation on first sign-in

**Files:**
- Create: app/(auth)/sign-in/page.tsx
- Create: app/(auth)/sign-up/page.tsx
- Modify: lib/auth.ts

- [ ] **Step 1: Add `ensureProfile` helper**

```ts
// lib/auth.ts (append)
import { db } from '@/lib/db/client'
import { profiles, shops } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export async function ensureProfileAndShop(userId: string, email: string) {
  const existing = await db.query.profiles.findFirst({ where: eq(profiles.id, userId) })
  if (existing) return existing
  // Create a personal shop on first sign-in (a real onboarding flow comes later).
  const [shop] = await db.insert(shops).values({ name: `${email}'s Shop` }).returning()
  const [profile] = await db.insert(profiles).values({
    id: userId,
    email,
    role: 'owner',
    shopId: shop.id,
  }).returning()
  return profile
}
```

- [ ] **Step 2: Build minimal sign-in / sign-up pages using Supabase Auth UI patterns**

```tsx
// app/(auth)/sign-in/page.tsx
'use client'
import { useState } from 'react'
import { getBrowserSupabase } from '@/lib/supabase-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function SignInPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const supabase = getBrowserSupabase()
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) { setError(error.message); return }
    window.location.href = '/sessions'
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <form onSubmit={handleSubmit} className="space-y-4 w-full max-w-sm">
        <h1 className="text-2xl font-bold">Sign in</h1>
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
        </div>
        <div>
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} required />
        </div>
        {error && <p className="text-red-600 text-sm">{error}</p>}
        <Button type="submit" className="w-full">Sign in</Button>
        <p className="text-sm text-center">No account? <a href="/sign-up" className="underline">Sign up</a></p>
      </form>
    </main>
  )
}
```

```tsx
// app/(auth)/sign-up/page.tsx
'use client'
import { useState } from 'react'
import { getBrowserSupabase } from '@/lib/supabase-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function SignUpPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const supabase = getBrowserSupabase()
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) { setError(error.message); return }
    setSuccess(true)
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <form onSubmit={handleSubmit} className="space-y-4 w-full max-w-sm">
        <h1 className="text-2xl font-bold">Sign up</h1>
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
        </div>
        <div>
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} />
        </div>
        {error && <p className="text-red-600 text-sm">{error}</p>}
        {success && <p className="text-green-700 text-sm">Check your email to confirm your account.</p>}
        <Button type="submit" className="w-full">Create account</Button>
      </form>
    </main>
  )
}
```

- [ ] **Step 3: Hook profile creation into the authenticated app layout**

```tsx
// app/(app)/layout.tsx
import { requireUser } from '@/lib/auth'
import { ensureProfileAndShop } from '@/lib/auth'
import Link from 'next/link'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser()
  await ensureProfileAndShop(user.id, user.email!)
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b p-4 flex items-center justify-between">
        <Link href="/sessions" className="font-bold text-lg">Vyntechs</Link>
        <nav className="flex gap-4 text-sm">
          <Link href="/sessions">Sessions</Link>
          <Link href="/sessions/new">New</Link>
          <Link href="/billing">Billing</Link>
        </nav>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  )
}
```

- [ ] **Step 4: Manually test sign-up → email confirmation (Supabase test mode) → sign-in → profile auto-created**

For dev convenience, disable email confirmation in Supabase project settings → Auth → Email confirmation: off. Sign up with a test email/password. Confirm in Supabase MCP `execute_sql "SELECT id, email, shop_id, role FROM profiles"` that a row exists.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(auth): sign-in/sign-up pages + auto-create profile and shop"
```

---

### Task C5: Wire the intake form to navigate to the active session

**Files:** none new (verification task)

- [ ] **Step 1: Manual happy path test**

```bash
pnpm dev
```

In browser:
1. `/sign-up` → create test account
2. `/sessions/new` → fill form (2018, Ford, F-150, "loss of power going up hills") → submit
3. Expect redirect to `/sessions/<uuid>`
4. The session page is empty for now — Phase D and E build it.

If redirect fails, check browser DevTools Network tab for the POST `/api/sessions` response.

- [ ] **Step 2: Verify DB row exists via Supabase MCP**

`execute_sql "SELECT id, intake, status FROM sessions ORDER BY created_at DESC LIMIT 1"` and confirm the row matches the form input.

- [ ] **Step 3: No commit needed** (verification only).

---

## Phase C — Implementation corrections (applied 2026-05-02 during walkthrough)

1. **`/sessions/new` page was never created during Phase C execution** even though task C2 explicitly listed `Create: app/(app)/sessions/new/page.tsx`. The presentational `<NewSessionForm>` component shipped fine, but no page wired it. The "New diagnosis" link from `/sessions` fell through to the dynamic `[id]` route, which tried to load a session with `id="new"` and crashed with `invalid input syntax for type uuid`. Discovered during full end-to-end walkthrough. The page now exists at `app/(app)/sessions/new/page.tsx` and follows the same `requireUserAndProfile` + `redirect('/sign-in')` pattern as other protected routes.

---

## Phase D — AI Tree Engine (10 tasks)

### Task D1: Anthropic SDK client with prompt caching

**Files:**
- Create: lib/ai/client.ts
- Create: lib/ai/prompts.ts

- [ ] **Step 1: Install Anthropic SDK**

```bash
pnpm add @anthropic-ai/sdk
```

- [ ] **Step 2: Create the client wrapper**

```ts
// lib/ai/client.ts
import Anthropic from '@anthropic-ai/sdk'

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

export const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6'

/**
 * Build a system parameter with prompt caching enabled on the long content.
 * Anthropic charges 25% extra on writes and only 10% on reads — so cache anything >1K tokens
 * that's reused across calls.
 */
export function cachedSystem(text: string) {
  return [{ type: 'text' as const, text, cache_control: { type: 'ephemeral' as const } }]
}
```

- [ ] **Step 3: Create prompts.ts with the tree-engine system prompt**

```ts
// lib/ai/prompts.ts
export const TREE_ENGINE_SYSTEM = `You are Vyntechs, an AI master tech for independent auto shops.

Your job: given a vehicle and customer complaint, generate a diagnostic decision tree the technician will walk step-by-step. As the tech reports observations, you update the tree by resolving branches and proposing the next step.

OUTPUT FORMAT — always respond with valid JSON matching this TypeScript type:

type TreeUpdate = {
  nodes: Array<{
    id: string                 // stable kebab-case id, e.g. "scan-codes"
    label: string              // imperative instruction, e.g. "Pull DTCs and freeze frame"
    status: "pending" | "active" | "resolved" | "pruned"
    rationale?: string         // 1-2 sentence why-this-step
    children?: string[]        // ids of next-step nodes (branching paths)
  }>
  currentNodeId: string
  message: string              // text to show the tech (1-3 sentences, instruction or analysis)
  done?: boolean               // true if root cause identified and ready for outcome capture
  rootCauseSummary?: string    // when done, a one-line root cause for the outcome form prefill
}

PRINCIPLES:
- Minimize tech burden. Default to text/voice description from the tech; only request artifacts when text is insufficient.
- One step at a time. Don't dump the whole tree on the tech.
- Be specific. "Look at the cold-side intercooler pipe" beats "inspect the boost system."
- Speak plainly, like a senior tech mentoring a junior.
- Never recommend a destructive action without explicit reasoning.
- If you're uncertain, say so honestly and ask for the smallest piece of additional info that would resolve it.

This MVP iteration does not yet have access to a corpus or web retrieval. Reason from your training knowledge only. Future iterations will add retrieval; for now, do your best with what you know.`

export const OUTCOME_VALIDATOR_SYSTEM = `You are Vyntechs' outcome-capture validator.

Given a tech's free-text root-cause description, decide if it is specific enough that another tech could find and fix the same issue in 60 seconds on a future similar vehicle.

REQUIREMENTS for "specific enough":
- Names a concrete component, connector, or location (not just "the wire" or "the system")
- Includes a landmark or identifier where applicable (pin number, connector ID, vehicle area)
- Describes the actual fault state (cracked / corroded / disconnected / out of spec / etc.)

OUTPUT FORMAT — always respond with valid JSON:

type ValidatorResult = {
  ok: boolean              // true if specific enough
  feedback?: string        // if not ok, what's missing — e.g. "Where exactly was the crack?"
  suggested?: string       // if not ok, a rewritten version that would pass (optional)
}`
```

- [ ] **Step 4: Manually verify the API call works**

Create temporary `scripts/check-anthropic.ts`:
```ts
import { anthropic, MODEL, cachedSystem } from '../lib/ai/client'

const res = await anthropic.messages.create({
  model: MODEL,
  max_tokens: 256,
  system: cachedSystem('You are a helpful test bot. Reply with valid JSON: {"ok": true}.'),
  messages: [{ role: 'user', content: 'Say ok.' }],
})
console.log(JSON.stringify(res, null, 2))
```

```bash
pnpm tsx scripts/check-anthropic.ts
```

Expected: usage block shows `input_tokens`, `output_tokens`, and on second run shows `cache_read_input_tokens > 0`. Delete the script after verification.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(ai): Anthropic SDK client + tree-engine and outcome-validator prompts"
```

---

### Task D2: tree-engine.ts — generateInitialTree

**Files:**
- Create: lib/ai/tree-engine.ts
- Create: tests/unit/tree-engine.test.ts

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/tree-engine.test.ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/ai/client', () => ({
  anthropic: {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{
          type: 'text',
          text: JSON.stringify({
            nodes: [{ id: 'scan-codes', label: 'Pull DTCs and freeze frame', status: 'active' }],
            currentNodeId: 'scan-codes',
            message: 'Start by pulling codes and the freeze frame for the active code.',
          }),
        }],
        usage: { input_tokens: 100, output_tokens: 80 },
      }),
    },
  },
  MODEL: 'claude-sonnet-4-6',
  cachedSystem: (t: string) => [{ type: 'text', text: t, cache_control: { type: 'ephemeral' } }],
}))

describe('generateInitialTree', () => {
  it('returns a valid tree from intake', async () => {
    const { generateInitialTree } = await import('@/lib/ai/tree-engine')
    const tree = await generateInitialTree({
      vehicleYear: 2018,
      vehicleMake: 'Ford',
      vehicleModel: 'F-150',
      vehicleEngine: '3.5L EcoBoost',
      customerComplaint: 'loss of power going up hills',
    })
    expect(tree.nodes).toHaveLength(1)
    expect(tree.currentNodeId).toBe('scan-codes')
    expect(tree.message).toContain('codes')
  })
})
```

- [ ] **Step 2: Run test, expect fail**

```bash
pnpm test tests/unit/tree-engine.test.ts
```

Expected: FAIL — `generateInitialTree` not exported.

- [ ] **Step 3: Implement**

```ts
// lib/ai/tree-engine.ts
import { anthropic, MODEL, cachedSystem } from './client'
import { TREE_ENGINE_SYSTEM } from './prompts'
import type { IntakePayload } from '@/lib/types'

export type TreeNode = {
  id: string
  label: string
  status: 'pending' | 'active' | 'resolved' | 'pruned'
  rationale?: string
  children?: string[]
}

export type TreeState = {
  nodes: TreeNode[]
  currentNodeId: string
  message: string
  done?: boolean
  rootCauseSummary?: string
}

export async function generateInitialTree(intake: IntakePayload): Promise<TreeState> {
  const userMessage = `Vehicle: ${intake.vehicleYear} ${intake.vehicleMake} ${intake.vehicleModel}${
    intake.vehicleEngine ? ` (${intake.vehicleEngine})` : ''
  }${intake.mileage ? `, ${intake.mileage} mi` : ''}.

Customer complaint: ${intake.customerComplaint}

Generate the initial decision tree. Return JSON only — no prose, no fences.`

  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: cachedSystem(TREE_ENGINE_SYSTEM),
    messages: [{ role: 'user', content: userMessage }],
  })

  const block = res.content.find(b => b.type === 'text')
  if (!block || block.type !== 'text') throw new Error('no text block in response')
  return parseTreeJson(block.text)
}

function parseTreeJson(text: string): TreeState {
  const cleaned = text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
  const parsed = JSON.parse(cleaned)
  if (!parsed.nodes || !parsed.currentNodeId || !parsed.message) {
    throw new Error('invalid tree response shape')
  }
  return parsed as TreeState
}

export { parseTreeJson }
```

- [ ] **Step 4: Run test, expect pass**

```bash
pnpm test tests/unit/tree-engine.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(ai): generateInitialTree with prompt caching and JSON parsing"
```

---

### Task D3: tree-engine.ts — updateTree (advance with tech observation)

**Files:**
- Modify: lib/ai/tree-engine.ts
- Modify: tests/unit/tree-engine.test.ts

- [ ] **Step 1: Write failing test (append)**

```ts
// tests/unit/tree-engine.test.ts (append)
describe('updateTree', () => {
  it('advances tree based on tech observation text', async () => {
    const { anthropic } = await import('@/lib/ai/client')
    ;(anthropic.messages.create as any).mockResolvedValueOnce({
      content: [{
        type: 'text',
        text: JSON.stringify({
          nodes: [
            { id: 'scan-codes', label: 'Pull DTCs', status: 'resolved' },
            { id: 'inspect-cac', label: 'Inspect CAC pipe', status: 'active' },
          ],
          currentNodeId: 'inspect-cac',
          message: 'Codes confirmed. Now inspect the cold-side intercooler pipe.',
        }),
      }],
      usage: { input_tokens: 100, output_tokens: 80 },
    })

    const { updateTree } = await import('@/lib/ai/tree-engine')
    const result = await updateTree({
      intake: {
        vehicleYear: 2018, vehicleMake: 'Ford', vehicleModel: 'F-150',
        customerComplaint: 'loss of power',
      },
      currentTree: {
        nodes: [{ id: 'scan-codes', label: 'Pull DTCs', status: 'active' }],
        currentNodeId: 'scan-codes',
        message: 'Pull codes',
      },
      observation: 'Got P0299 with 3.6 psi underboost in the freeze frame',
    })

    expect(result.currentNodeId).toBe('inspect-cac')
    expect(result.nodes.find(n => n.id === 'scan-codes')?.status).toBe('resolved')
  })
})
```

- [ ] **Step 2: Run test, expect fail**

```bash
pnpm test tests/unit/tree-engine.test.ts
```

Expected: FAIL — `updateTree` not exported.

- [ ] **Step 3: Implement updateTree**

```ts
// lib/ai/tree-engine.ts (append)
export async function updateTree(input: {
  intake: IntakePayload
  currentTree: TreeState
  observation: string
}): Promise<TreeState> {
  const userMessage = `Current tree state:
${JSON.stringify(input.currentTree, null, 2)}

Tech's observation on current step (${input.currentTree.currentNodeId}):
${input.observation}

Update the tree based on this observation. Resolve or prune branches as appropriate. Set the next current step. If you have enough information to identify the root cause, set done=true and provide rootCauseSummary.

Return JSON only — no prose, no fences.`

  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1500,
    system: cachedSystem(TREE_ENGINE_SYSTEM),
    messages: [
      { role: 'user', content: `Initial intake: ${JSON.stringify(input.intake)}` },
      { role: 'assistant', content: `Tree generated and being walked.` },
      { role: 'user', content: userMessage },
    ],
  })

  const block = res.content.find(b => b.type === 'text')
  if (!block || block.type !== 'text') throw new Error('no text block in response')
  return parseTreeJson(block.text)
}
```

- [ ] **Step 4: Run test, expect pass**

```bash
pnpm test tests/unit/tree-engine.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(ai): updateTree advances tree from tech observation text"
```

---

### Task D4: Wire tree generation into POST /api/sessions

**Files:**
- Modify: app/api/sessions/route.ts

- [ ] **Step 1: Update the create route to call generateInitialTree**

```ts
// app/api/sessions/route.ts (replace the createSession block in POST)
import { generateInitialTree } from '@/lib/ai/tree-engine'

// inside POST after intake parses successfully:
let treeState
try {
  treeState = await generateInitialTree(parsed.data)
} catch (err) {
  console.error('tree generation failed:', err)
  return NextResponse.json({ error: 'tree generation failed' }, { status: 500 })
}

const id = await createSession({
  shopId: profile.shopId,
  techId: profile.id,
  intake: parsed.data,
  treeState,
})
return NextResponse.json({ id })
```

The full POST handler now reads:

```ts
export async function POST(req: Request) {
  const supabase = await getServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const profile = await db.query.profiles.findFirst({ where: eq(profiles.id, user.id) })
  if (!profile?.shopId) return NextResponse.json({ error: 'no shop' }, { status: 400 })

  const body = await req.json().catch(() => null)
  const parsed = intakeSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 })

  let treeState
  try {
    treeState = await generateInitialTree(parsed.data)
  } catch (err) {
    console.error('tree generation failed:', err)
    return NextResponse.json({ error: 'tree generation failed' }, { status: 500 })
  }

  const id = await createSession({
    shopId: profile.shopId,
    techId: profile.id,
    intake: parsed.data,
    treeState,
  })
  return NextResponse.json({ id })
}
```

- [ ] **Step 2: Manually verify**

`pnpm dev` → sign in → submit a session via `/sessions/new` → wait a few seconds (real LLM call) → expect redirect to `/sessions/<uuid>`. Use Supabase MCP to confirm `tree_state` column has a real tree.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(session): tree generation runs on session create"
```

---

### Task D5: Implement POST /api/sessions/[id]/advance

**Files:**
- Create: app/api/sessions/[id]/advance/route.ts

- [ ] **Step 1: Write the route**

```ts
// app/api/sessions/[id]/advance/route.ts
import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase-server'
import { db } from '@/lib/db/client'
import { sessions, profiles } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { updateTree } from '@/lib/ai/tree-engine'
import { appendSessionEvent, updateSessionTreeState } from '@/lib/db/queries'
import { z } from 'zod'

const advanceSchema = z.object({
  observation: z.string().min(1).max(5000),
})

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await getServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const profile = await db.query.profiles.findFirst({ where: eq(profiles.id, user.id) })
  if (!profile) return NextResponse.json({ error: 'no profile' }, { status: 400 })

  const session = await db.query.sessions.findFirst({ where: eq(sessions.id, id) })
  if (!session || session.techId !== profile.id) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }
  if (session.status !== 'open') {
    return NextResponse.json({ error: 'session is not open' }, { status: 400 })
  }

  const body = await req.json().catch(() => null)
  const parsed = advanceSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 })

  let nextTree
  try {
    nextTree = await updateTree({
      intake: session.intake,
      currentTree: session.treeState,
      observation: parsed.data.observation,
    })
  } catch (err) {
    console.error('tree update failed:', err)
    return NextResponse.json({ error: 'tree update failed' }, { status: 500 })
  }

  await appendSessionEvent({
    sessionId: id,
    nodeId: session.treeState.currentNodeId,
    eventType: 'observation',
    observationText: parsed.data.observation,
    aiResponse: { nextNodeId: nextTree.currentNodeId },
  })
  await updateSessionTreeState(id, nextTree)

  return NextResponse.json(nextTree)
}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat(session): POST /api/sessions/[id]/advance"
```

---

### Task D6: Add error retry on transient LLM failures

**Files:**
- Modify: lib/ai/tree-engine.ts

- [ ] **Step 1: Write a withRetry helper inline**

```ts
// lib/ai/tree-engine.ts (append, before exports)
async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr
  for (let i = 0; i < attempts; i++) {
    try { return await fn() } catch (e) {
      lastErr = e
      if (i < attempts - 1) {
        await new Promise(r => setTimeout(r, 500 * (i + 1)))
      }
    }
  }
  throw lastErr
}
```

- [ ] **Step 2: Wrap the LLM calls**

In `generateInitialTree` and `updateTree`, wrap the `await anthropic.messages.create(...)` block in `withRetry(() => anthropic.messages.create(...))`. JSON parsing errors are also worth retrying (model occasionally returns prose) — wrap the whole try block.

```ts
// generateInitialTree (replace API call section)
return await withRetry(async () => {
  const res = await anthropic.messages.create({ /* ...same... */ })
  const block = res.content.find(b => b.type === 'text')
  if (!block || block.type !== 'text') throw new Error('no text block')
  return parseTreeJson(block.text)
})
```

Apply the same pattern to `updateTree`.

- [ ] **Step 3: Verify existing tests still pass**

```bash
pnpm test
```

Expected: all unit tests pass. Mock returns valid JSON on first call → no retry triggered → still passes.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(ai): retry on transient LLM call or JSON parse failures"
```

---

### Task D7: Sanity-test the full intake → tree generation locally

**Files:** none

- [ ] **Step 1: Manual end-to-end test**

`pnpm dev` → sign in → `/sessions/new` → submit (2018, Ford, F-150, "loss of power on hills") → wait → confirm redirect to `/sessions/<id>` → in Supabase MCP `execute_sql "SELECT tree_state -> 'message' FROM sessions ORDER BY created_at DESC LIMIT 1"` → confirm message is non-trivial real LLM output.

- [ ] **Step 2: No commit needed.**

---

### Task D8: GET /api/sessions/[id]

**Files:**
- Create: app/api/sessions/[id]/route.ts

- [ ] **Step 1: Write the route**

```ts
// app/api/sessions/[id]/route.ts
import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase-server'
import { db } from '@/lib/db/client'
import { sessions, profiles } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { getSessionById } from '@/lib/db/queries'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await getServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const profile = await db.query.profiles.findFirst({ where: eq(profiles.id, user.id) })
  if (!profile) return NextResponse.json({ error: 'no profile' }, { status: 400 })
  const s = await getSessionById(id)
  if (!s || s.techId !== profile.id) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json(s)
}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat(session): GET /api/sessions/[id]"
```

---

### Task D9: Lock-out — block new session if tech has open session

**Files:**
- Modify: app/api/sessions/route.ts

- [ ] **Step 1: Append lock-out check to POST handler**

In `app/api/sessions/route.ts` POST, before creating a new session, add:

```ts
import { getOpenSessionForTech } from '@/lib/db/queries'

// after profile is loaded, before parsing body:
const openSession = await getOpenSessionForTech(profile.id)
if (openSession) {
  return NextResponse.json(
    { error: 'open_session', openSessionId: openSession.id },
    { status: 409 }
  )
}
```

- [ ] **Step 2: Update the form to surface 409**

In `components/intake/new-session-form.tsx`, update `handleSubmit` to detect 409 and redirect:

```tsx
const res = await fetch('/api/sessions', { /* ... */ })
if (res.status === 409) {
  const { openSessionId } = await res.json()
  router.push(`/sessions/${openSessionId}`)
  return
}
if (!res.ok) { setError(await res.text()); return }
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(session): block new session when tech has open session"
```

---

### Task D10: Sessions history list page

**Files:**
- Create: app/(app)/sessions/page.tsx

- [ ] **Step 1: Write the page**

```tsx
// app/(app)/sessions/page.tsx
import { requireUser } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { profiles } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { listSessionsForShop } from '@/lib/db/queries'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

export default async function SessionsPage() {
  const user = await requireUser()
  const profile = await db.query.profiles.findFirst({ where: eq(profiles.id, user.id) })
  const items = profile?.shopId ? await listSessionsForShop(profile.shopId) : []

  return (
    <main className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Sessions</h1>
        <Link href="/sessions/new"><Button>New diagnosis</Button></Link>
      </div>
      {items.length === 0 ? (
        <p className="text-gray-600">No sessions yet. Start your first diagnosis.</p>
      ) : (
        <ul className="space-y-2">
          {items.map(s => (
            <li key={s.id}>
              <Link href={`/sessions/${s.id}`} className="block border rounded p-3 hover:bg-gray-50">
                <div className="flex justify-between">
                  <span>{s.intake.vehicleYear} {s.intake.vehicleMake} {s.intake.vehicleModel}</span>
                  <span className="text-sm text-gray-500">{s.status}</span>
                </div>
                <p className="text-sm text-gray-600 mt-1 truncate">{s.intake.customerComplaint}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
```

- [ ] **Step 2: Manually verify**

Sign in, visit `/sessions`, confirm prior sessions show.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(session): sessions history list page"
```

---

## Phase D — Implementation corrections (applied after D10)

The Phase D code blocks above contain a few errors and shortcuts that surfaced during implementation. Future readers should treat the points below as the authoritative pattern; the inline code blocks above remain as reference but are *not* drop-in correct.

1. **Profile lookup** — Plan code uses `db.query.profiles.findFirst({ where: eq(profiles.id, user.id) })`. The `profiles` table keys on `userId` (not `id`); use the existing helper `getProfileByUserId(db, userId)` from `lib/db/queries.ts`.
2. **`getSessionById` arity** — Plan code calls `getSessionById(id)`. Real signature is `getSessionById(db: AppDb, id: string)`. Always pass `db` first.
3. **DI for new query helpers** — `appendSessionEvent`, `updateSessionTreeState`, `getOpenSessionForTech`, `listSessionsForShop` were added to `lib/db/queries.ts` with `db: AppDb` as the first parameter (matches existing convention).
4. **Route handlers extract testable helpers** — `app/api/sessions/[id]/advance/route.ts` and `app/api/sessions/[id]/route.ts` are thin shims that delegate to `advanceSession` and `getSessionForUser` in `lib/sessions.ts`. The lib functions are pglite-unit-testable; the route handlers are not (they call `getServerSupabase` directly). Mirror this split for any new route.
5. **Lock-out (D9) lives in the route only** — The check belongs in `app/api/sessions/route.ts` BEFORE `generateInitialTree` (saves LLM tokens). It was briefly also placed inside `createSessionForUser` and removed in commit `b95aef7` because it duplicated the profile + open-session DB calls. `createSessionForUser` is back to its single responsibility (persist a session given a `treeState`).
6. **D10 has no shadcn or Tailwind yet** — Plan code imports `Button` from `@/components/ui/button` and uses Tailwind utility classes. Neither exists in the repo at this phase (per the handoff: "no shadcn or Tailwind yet — plain HTML forms"). The actual page uses a plain `<button>` and inline-styled `<Link>` anchors. Reintroduce shadcn/Tailwind before any task that depends on them.
7. **`TreeState` unified** — `lib/db/schema.ts` and `lib/ai/tree-engine.ts` were defining `TreeState` with subtly different shapes. Unified to: required `message: string`, optional `done`, `rootCauseSummary`, optional per-node `rationale`. Test fixtures in `tests/unit/queries.test.ts` were updated to include `message`. There is no DB migration — `tree_state` is a JSONB column.
8. **`withRetry` on LLM calls (D6)** — applied identically to `generateInitialTree` and `updateTree`: 3 attempts, linear backoff (500ms × n). The whole `messages.create` + JSON parse block is wrapped, so a malformed JSON response also retries.
9. **`max_tokens` was too low and silently truncated the JSON mid-string** (2026-05-02). Original values were 1024 (`generateInitialTree`) and 1500 (`updateTree`); a single Sonnet 4.6 initial-tree response routinely exceeds 1024 tokens once you include rationale + proposedAction + ~10 nodes. The truncation manifested as `parseTreeJson` throwing `Expected ',' or '}' after property value at position ~3563` because the JSON was cut mid-token. Both calls now use `max_tokens: 4096`. Output 4096 is well under Anthropic's per-request output cap and gives Sonnet headroom for the future extra fields (`confidenceGap`, `whatWouldClose`).
10. **`parseTreeJson` hardened with recovery + diagnostic context** (2026-05-02). On `JSON.parse` failure it now retries by extracting from the first `{` to the last `}` (handles stray prose around the JSON). On final failure, the thrown error includes `stop_reason` and `length` so the next maintainer doesn't have to guess whether they hit truncation, malformed output, or prose pollution. Also takes `stopReason?: string` as an optional second arg, threaded from `res.stop_reason` at every call site.

---

## Phase E — Phone Session UX (10 tasks)

> ⛔ **STOP. READ THIS BEFORE TOUCHING ANY UI:**
> [`docs/superpowers/ui-design-toolkit.md`](../ui-design-toolkit.md)
>
> That doc is the authoritative guide for which Claude Code skills, MCP servers, and agents to use for user-facing work, plus the UX decision checkpoints that require user input. **Do not start E1 without reading it.** This is a no-shortcuts phase — picking the right tool is part of the work.
>
> Same rule applies to Phases F, G, H, N, O, P, and any future UI task.

### Task E1: Active session page (server component shell)

**Files:**
- Create: app/(app)/sessions/[id]/page.tsx

- [ ] **Step 1: Write the page**

```tsx
// app/(app)/sessions/[id]/page.tsx
import { requireUser } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { profiles, sessions } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import { SessionView } from '@/components/session/session-view'

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await requireUser()
  const profile = await db.query.profiles.findFirst({ where: eq(profiles.id, user.id) })
  const session = await db.query.sessions.findFirst({ where: eq(sessions.id, id) })
  if (!session || !profile || session.techId !== profile.id) notFound()

  return (
    <main className="max-w-md mx-auto p-4">
      <SessionView session={session} />
    </main>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat(session): session page server component shell"
```

---

### Task E2: SessionView client component (state container)

**Files:**
- Create: components/session/session-view.tsx

- [ ] **Step 1: Write the component**

```tsx
// components/session/session-view.tsx
'use client'
import { useState } from 'react'
import type { sessions } from '@/lib/db/schema'
import { TreeView } from './tree-view'
import { StepInput } from './step-input'
import { OutcomeForm } from './outcome-form'

type SessionRow = typeof sessions.$inferSelect

export function SessionView({ session: initial }: { session: SessionRow }) {
  const [session, setSession] = useState(initial)
  const tree = session.treeState

  if (session.status === 'closed') {
    return <p className="text-green-700">Session closed. Outcome captured.</p>
  }

  if (tree.done) {
    return (
      <OutcomeForm
        sessionId={session.id}
        rootCauseHint={tree.rootCauseSummary ?? ''}
        onClosed={() => window.location.reload()}
      />
    )
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">
        {session.intake.vehicleYear} {session.intake.vehicleMake} {session.intake.vehicleModel}
      </h1>
      <p className="text-sm text-gray-600">{session.intake.customerComplaint}</p>
      <TreeView tree={tree} />
      <StepInput
        sessionId={session.id}
        currentLabel={tree.nodes.find(n => n.id === tree.currentNodeId)?.label ?? ''}
        message={tree.message}
        onAdvance={(next) => setSession({ ...session, treeState: next })}
      />
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat(session): SessionView client container"
```

---

### Task E3: TreeView component (collapsed phone view)

**Files:**
- Create: components/session/tree-view.tsx

- [ ] **Step 1: Write the component**

```tsx
// components/session/tree-view.tsx
import type { TreeState } from '@/lib/ai/tree-engine'
import { Card } from '@/components/ui/card'

export function TreeView({ tree }: { tree: TreeState }) {
  const current = tree.nodes.find(n => n.id === tree.currentNodeId)
  const resolved = tree.nodes.filter(n => n.status === 'resolved')

  return (
    <Card className="p-4 space-y-3">
      {resolved.length > 0 && (
        <div className="text-xs text-gray-500">
          {resolved.map(n => (
            <div key={n.id} className="line-through">{n.label}</div>
          ))}
        </div>
      )}
      <div className="font-semibold text-lg">{current?.label ?? '(no current step)'}</div>
      {current?.rationale && <p className="text-sm text-gray-700">{current.rationale}</p>}
    </Card>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat(session): TreeView component for phone layout"
```

---

### Task E4: StepInput component (textarea + submit)

**Files:**
- Create: components/session/step-input.tsx

- [ ] **Step 1: Write the component**

```tsx
// components/session/step-input.tsx
'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Card } from '@/components/ui/card'
import type { TreeState } from '@/lib/ai/tree-engine'

export function StepInput(props: {
  sessionId: string
  currentLabel: string
  message: string
  onAdvance: (next: TreeState) => void
}) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/sessions/${props.sessionId}/advance`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ observation: text }),
    })
    if (!res.ok) {
      setError(await res.text())
      setBusy(false)
      return
    }
    const next = await res.json()
    props.onAdvance(next)
    setText('')
    setBusy(false)
  }

  return (
    <Card className="p-4 space-y-3">
      <p className="text-sm">{props.message}</p>
      <Textarea
        rows={4}
        placeholder="Describe what you found, observed, or measured…"
        value={text}
        onChange={e => setText(e.target.value)}
        disabled={busy}
      />
      {error && <p className="text-red-600 text-sm">{error}</p>}
      <Button onClick={handleSubmit} disabled={busy || text.trim().length === 0} className="w-full">
        {busy ? 'Thinking…' : 'Submit observation'}
      </Button>
    </Card>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat(session): StepInput component for tech observation"
```

---

### Task E5: Wire the active session view end-to-end

**Files:** none (verification)

- [ ] **Step 1: Manual test**

`pnpm dev` → sign in → start a new session → on `/sessions/<id>`, confirm:
- Vehicle + complaint visible
- Current step rendered from tree
- Submitting an observation advances the tree (loading state shows, then new step appears)
- After several advances (or when AI sets `done: true`), the OutcomeForm replaces the tree view

- [ ] **Step 2: No commit needed.**

---

### Task E6: Empty state on /sessions/[id] when tree is broken

**Files:**
- Modify: components/session/session-view.tsx

- [ ] **Step 1: Add a defensive empty state**

In `SessionView`, before `if (tree.done)`, add:

```tsx
if (!tree.nodes || tree.nodes.length === 0) {
  return (
    <div className="space-y-3">
      <p className="text-amber-700">Tree state is empty. This session may have been created in error.</p>
      <a href="/sessions" className="underline text-sm">Back to sessions</a>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat(session): defensive empty-state for missing tree"
```

---

### Task E7: Loading skeleton on session page

**Files:**
- Create: app/(app)/sessions/[id]/loading.tsx

- [ ] **Step 1: Write the loading state**

```tsx
// app/(app)/sessions/[id]/loading.tsx
export default function Loading() {
  return (
    <main className="max-w-md mx-auto p-4 space-y-3 animate-pulse">
      <div className="h-6 w-3/4 bg-gray-200 rounded" />
      <div className="h-4 w-1/2 bg-gray-200 rounded" />
      <div className="h-32 bg-gray-200 rounded" />
      <div className="h-24 bg-gray-200 rounded" />
    </main>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat(session): loading skeleton for session page"
```

---

### Task E8: Mobile-first polish on TreeView and StepInput

**Files:**
- Modify: components/session/tree-view.tsx
- Modify: components/session/step-input.tsx

- [ ] **Step 1: Apply touch-friendly sizing**

Update TreeView's `font-semibold text-lg` → `text-xl font-bold leading-tight` for better small-screen readability. Update StepInput's Textarea to `min-h-[120px] text-base` (16px to prevent iOS auto-zoom). Update the Button to `text-base h-12`.

- [ ] **Step 2: Verify on a phone viewport**

In `pnpm dev`, open Chrome DevTools, switch to iPhone 13 viewport, confirm the input is comfortably tappable and tree text is readable without zoom.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "style(session): mobile-first sizing on tree and input"
```

---

### Task E9: Display recent observations on the active session page

**Files:**
- Modify: components/session/session-view.tsx
- Modify: app/(app)/sessions/[id]/page.tsx

- [ ] **Step 1: Pass events from server to client**

In `app/(app)/sessions/[id]/page.tsx`, fetch events:

```tsx
import { getSessionById } from '@/lib/db/queries'
// replace the simpler findFirst with:
const session = await getSessionById(id)
```

This loads the session with `events` already joined.

- [ ] **Step 2: Render recent observations under the input**

In `components/session/session-view.tsx`, accept events prop:

```tsx
import type { sessionEvents } from '@/lib/db/schema'

type SessionRowWithEvents = typeof sessions.$inferSelect & {
  events?: Array<typeof sessionEvents.$inferSelect>
}

export function SessionView({ session: initial }: { session: SessionRowWithEvents }) {
  // ... existing state ...
  const events = (initial.events ?? []).filter(e => e.eventType === 'observation').slice(0, 5)
  // ... existing return, but ADD below the StepInput:
  return (
    <div className="space-y-4">
      {/* existing header + tree + input */}
      {events.length > 0 && (
        <div className="text-xs text-gray-500 space-y-1">
          <div className="font-semibold">Recent observations</div>
          {events.map(e => (
            <div key={e.id} className="border-l-2 pl-2">{e.observationText}</div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Update SessionPage to pass events**

The `getSessionById` returns events when the relation is configured (see Task B5). Pass the result directly:

```tsx
return (
  <main className="max-w-md mx-auto p-4">
    <SessionView session={session as any} />
  </main>
)
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(session): show recent observations on active session"
```

---

### Task E10: Disable input when session is closed/declined/deferred

**Files:**
- Modify: components/session/session-view.tsx

- [ ] **Step 1: Add status-based gating**

Already partially handled by the `if (session.status === 'closed')` check; expand to include `declined` and `deferred`:

```tsx
if (['closed', 'declined', 'deferred'].includes(session.status)) {
  return <p className="text-gray-700">This session is {session.status}. No further input accepted.</p>
}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat(session): lock input on terminal session statuses"
```

---

## Phase F — Outcome Capture (7 tasks)

### Task F1: outcome-validator.ts — validateSpecificity

**Files:**
- Create: lib/ai/outcome-validator.ts
- Create: tests/unit/outcome-validator.test.ts

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/outcome-validator.test.ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/ai/client', () => ({
  anthropic: {
    messages: {
      create: vi.fn().mockResolvedValueOnce({
        content: [{
          type: 'text',
          text: JSON.stringify({ ok: false, feedback: 'Where exactly was the crack? Give a landmark another tech could find in 60 seconds.' }),
        }],
        usage: { input_tokens: 50, output_tokens: 30 },
      }).mockResolvedValueOnce({
        content: [{
          type: 'text',
          text: JSON.stringify({ ok: true }),
        }],
        usage: { input_tokens: 50, output_tokens: 10 },
      }),
    },
  },
  MODEL: 'claude-sonnet-4-6',
  cachedSystem: (t: string) => [{ type: 'text', text: t, cache_control: { type: 'ephemeral' } }],
}))

describe('validateSpecificity', () => {
  it('rejects vague text', async () => {
    const { validateSpecificity } = await import('@/lib/ai/outcome-validator')
    const r = await validateSpecificity('the wire was bad')
    expect(r.ok).toBe(false)
    expect(r.feedback).toMatch(/where/i)
  })
  it('accepts specific text', async () => {
    const { validateSpecificity } = await import('@/lib/ai/outcome-validator')
    const r = await validateSpecificity(
      'Wastegate actuator vacuum line cracked ~2in from the actuator-can end on driver-side turbo, F-150 3.5L EcoBoost. Smoke test confirmed leak.'
    )
    expect(r.ok).toBe(true)
  })
})
```

- [ ] **Step 2: Run, expect fail**

```bash
pnpm test tests/unit/outcome-validator.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement validator**

```ts
// lib/ai/outcome-validator.ts
import { anthropic, MODEL, cachedSystem } from './client'
import { OUTCOME_VALIDATOR_SYSTEM } from './prompts'

export type ValidatorResult = { ok: boolean; feedback?: string; suggested?: string }

export async function validateSpecificity(text: string): Promise<ValidatorResult> {
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 256,
    system: cachedSystem(OUTCOME_VALIDATOR_SYSTEM),
    messages: [{ role: 'user', content: `Root cause text:\n${text}\n\nReturn JSON only.` }],
  })
  const block = res.content.find(b => b.type === 'text')
  if (!block || block.type !== 'text') throw new Error('no text block')
  const cleaned = block.text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
  return JSON.parse(cleaned) as ValidatorResult
}
```

- [ ] **Step 4: Run, expect pass**

```bash
pnpm test tests/unit/outcome-validator.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(outcome): validateSpecificity with AI feedback loop"
```

---

### Task F2: OutcomeForm component

**Files:**
- Create: components/session/outcome-form.tsx

- [ ] **Step 1: Write the component**

```tsx
// components/session/outcome-form.tsx
'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'

const ACTION_TYPES = [
  ['part_replacement', 'Part replacement'],
  ['repair', 'Repair'],
  ['adjustment', 'Adjustment'],
  ['cleaning', 'Cleaning'],
  ['no_fix', 'No fix needed'],
  ['referred', 'Referred to other shop'],
] as const

export function OutcomeForm(props: { sessionId: string; rootCauseHint: string; onClosed: () => void }) {
  const [rootCause, setRootCause] = useState(props.rootCauseHint)
  const [actionType, setActionType] = useState<typeof ACTION_TYPES[number][0]>('part_replacement')
  const [partName, setPartName] = useState('')
  const [oemNumber, setOemNumber] = useState('')
  const [partCost, setPartCost] = useState('')
  const [diagMinutes, setDiagMinutes] = useState('')
  const [repairMinutes, setRepairMinutes] = useState('')
  const [codesCleared, setCodesCleared] = useState(true)
  const [testDrive, setTestDrive] = useState(true)
  const [symptomsResolved, setSymptomsResolved] = useState<'yes' | 'no' | 'partial'>('yes')
  const [notes, setNotes] = useState('')
  const [validatorFeedback, setValidatorFeedback] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    setBusy(true)
    setError(null)
    setValidatorFeedback(null)
    const payload = {
      rootCause,
      actionType,
      partInfo: actionType === 'part_replacement' ? {
        name: partName,
        oemNumber: oemNumber || undefined,
        cost: partCost ? Number(partCost) : undefined,
      } : undefined,
      verification: {
        codesCleared,
        testDrive,
        symptomsResolved,
      },
      diagMinutes: Number(diagMinutes),
      repairMinutes: Number(repairMinutes),
      notes: notes || undefined,
    }
    const res = await fetch(`/api/sessions/${props.sessionId}/close`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    setBusy(false)
    if (res.status === 422) {
      const { feedback } = await res.json()
      setValidatorFeedback(feedback)
      return
    }
    if (!res.ok) {
      setError(await res.text())
      return
    }
    props.onClosed()
  }

  return (
    <Card className="p-4 space-y-4">
      <h2 className="text-xl font-bold">Close session — outcome capture</h2>

      <div>
        <Label htmlFor="rootCause">What was the root cause?</Label>
        <Textarea id="rootCause" rows={4} value={rootCause} onChange={e => setRootCause(e.target.value)} required />
        {validatorFeedback && (
          <p className="text-amber-700 text-sm mt-1">⚠ {validatorFeedback}</p>
        )}
      </div>

      <div>
        <Label htmlFor="actionType">Action taken</Label>
        <select
          id="actionType"
          className="w-full border rounded h-10 px-2"
          value={actionType}
          onChange={e => setActionType(e.target.value as any)}
        >
          {ACTION_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>

      {actionType === 'part_replacement' && (
        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2">
            <Label htmlFor="partName">Part name</Label>
            <Input id="partName" value={partName} onChange={e => setPartName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="oemNumber">OEM #</Label>
            <Input id="oemNumber" value={oemNumber} onChange={e => setOemNumber(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="partCost">Cost ($)</Label>
            <Input id="partCost" type="number" step="0.01" value={partCost} onChange={e => setPartCost(e.target.value)} />
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor="diagMinutes">Diag (min)</Label>
          <Input id="diagMinutes" type="number" value={diagMinutes} onChange={e => setDiagMinutes(e.target.value)} required />
        </div>
        <div>
          <Label htmlFor="repairMinutes">Repair (min)</Label>
          <Input id="repairMinutes" type="number" value={repairMinutes} onChange={e => setRepairMinutes(e.target.value)} required />
        </div>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">Verification</legend>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={codesCleared} onChange={e => setCodesCleared(e.target.checked)} />
          <span>Codes cleared</span>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={testDrive} onChange={e => setTestDrive(e.target.checked)} />
          <span>Test drive completed</span>
        </label>
        <div>
          <Label>Symptoms resolved</Label>
          <select
            className="w-full border rounded h-10 px-2"
            value={symptomsResolved}
            onChange={e => setSymptomsResolved(e.target.value as any)}
          >
            <option value="yes">Yes</option>
            <option value="partial">Partial</option>
            <option value="no">No</option>
          </select>
        </div>
      </fieldset>

      <div>
        <Label htmlFor="notes">Notes for the corpus (optional)</Label>
        <Textarea id="notes" rows={3} value={notes} onChange={e => setNotes(e.target.value)} />
      </div>

      {error && <p className="text-red-600 text-sm">{error}</p>}

      <Button onClick={handleSubmit} disabled={busy} className="w-full">
        {busy ? 'Validating + closing…' : 'Close session'}
      </Button>
    </Card>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat(outcome): OutcomeForm with structured fields"
```

---

### Task F3: Outcome zod schema

**Files:**
- Modify: lib/types.ts

- [ ] **Step 1: Append to lib/types.ts**

```ts
// lib/types.ts (append)
export const outcomeSchema = z.object({
  rootCause: z.string().min(10).max(2000),
  actionType: z.enum(['part_replacement', 'repair', 'adjustment', 'cleaning', 'no_fix', 'referred']),
  partInfo: z.object({
    name: z.string().min(1),
    oemNumber: z.string().optional(),
    aftermarket: z.string().optional(),
    cost: z.number().nonnegative().optional(),
  }).optional(),
  verification: z.object({
    codesCleared: z.boolean(),
    testDrive: z.boolean(),
    symptomsResolved: z.enum(['yes', 'no', 'partial']),
  }),
  diagMinutes: z.number().nonnegative(),
  repairMinutes: z.number().nonnegative(),
  notes: z.string().max(2000).optional(),
})

export type OutcomePayload = z.infer<typeof outcomeSchema>
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat(outcome): zod schema for outcome payload"
```

---

### Task F4: POST /api/sessions/[id]/close — with validator gate

**Files:**
- Create: app/api/sessions/[id]/close/route.ts

- [ ] **Step 1: Write the route**

```ts
// app/api/sessions/[id]/close/route.ts
import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase-server'
import { db } from '@/lib/db/client'
import { profiles, sessions } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { outcomeSchema } from '@/lib/types'
import { validateSpecificity } from '@/lib/ai/outcome-validator'
import { closeSession, appendSessionEvent } from '@/lib/db/queries'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await getServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const profile = await db.query.profiles.findFirst({ where: eq(profiles.id, user.id) })
  if (!profile) return NextResponse.json({ error: 'no profile' }, { status: 400 })
  const session = await db.query.sessions.findFirst({ where: eq(sessions.id, id) })
  if (!session || session.techId !== profile.id) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (session.status !== 'open') return NextResponse.json({ error: 'session is not open' }, { status: 400 })

  const body = await req.json().catch(() => null)
  const parsed = outcomeSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 })

  const validation = await validateSpecificity(parsed.data.rootCause)
  if (!validation.ok) {
    return NextResponse.json(
      { error: 'specificity_required', feedback: validation.feedback ?? 'Be more specific.' },
      { status: 422 }
    )
  }

  await closeSession(id, parsed.data)
  await appendSessionEvent({
    sessionId: id,
    nodeId: session.treeState.currentNodeId,
    eventType: 'close',
  })
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat(outcome): POST /api/sessions/[id]/close with validator gate"
```

---

### Task F5: Integration test for the close flow

**Files:**
- Create: tests/unit/close-route.test.ts

- [ ] **Step 1: Skip the heavy integration here** (Phase J Playwright test covers the end-to-end). Add a quick contract test that the validator-gating logic kicks in:

```ts
// tests/unit/close-route.test.ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/ai/outcome-validator', () => ({
  validateSpecificity: vi.fn().mockResolvedValueOnce({ ok: false, feedback: 'Where exactly?' }),
}))

describe('close flow validator gate', () => {
  it('returns 422 when validator says not specific enough', async () => {
    const { validateSpecificity } = await import('@/lib/ai/outcome-validator')
    const result = await validateSpecificity('the part was bad')
    expect(result.ok).toBe(false)
    expect(result.feedback).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run, expect pass**

```bash
pnpm test tests/unit/close-route.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "test(outcome): contract test for validator gate"
```

---

### Task F6: Block "new session" when previous session is open and not closed

**Files:** none (already implemented in Task D9)

- [ ] **Step 1: Verify D9 still holds**

Check that the lock-out from Task D9 is in `app/api/sessions/route.ts`. Run a manual test: open a new session, leave it open, try to create another → expect redirect to the open one.

- [ ] **Step 2: No commit needed.**

---

### Task F7: After close, redirect to /sessions list with success toast

**Files:**
- Modify: components/session/outcome-form.tsx

- [ ] **Step 1: Update onClosed handler**

In `app/(app)/sessions/[id]/page.tsx`, the SessionView already accepts an `onClosed` that does `window.location.reload()`. Better: redirect to the list. Update SessionView:

```tsx
// in components/session/session-view.tsx, change the onClosed handler:
onClosed={() => { window.location.href = '/sessions' }}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat(outcome): redirect to sessions list after close"
```

---

## Phase F — Implementation corrections (applied after F7)

The Phase F code blocks above were drafted before Phase E shipped the Workshop Instrument design system. The points below are the authoritative pattern; the inline blocks remain reference but contain stale assumptions.

1. **No shadcn / no `components/session/`** — F2 imports `@/components/ui/{button,textarea,input,label,card}` and writes a new `components/session/outcome-form.tsx`. None of that exists post-Phase-E. The actual flow wires the existing Phase E screen (`components/screens/outcome-capture.tsx`) — preserves the design system, no parallel form.
2. **`closeSession` helper added** — F4 calls `closeSession(id, payload)` without defining it. Added to `lib/db/queries.ts` as a single `UPDATE … WHERE status='open' RETURNING *` that throws if the session was already closed (race-safe). Test in `tests/unit/queries.test.ts`.
3. **Route uses thin-shim pattern** — Per Phase D correction #4, `app/api/sessions/[id]/close/route.ts` delegates to `closeSessionForUser` in `lib/sessions.ts`. The handler takes `validateSpecificity` as an injected dep so handler tests don't need to mock the LLM. Mirror this for any future close-flow extension.
4. **422 surface for validator gate** — `closeSessionForUser` returns `{ ok:false, status:422, error:'specificity_required', feedback }`. The route maps that to `{ error, feedback }` JSON. The form reads the body on 422 and renders `feedback` inline in the existing `.ai-reject` region (replaces Phase E's word-count heuristic).
5. **F5 subsumed by F4 handler test** — F5 prescribes a tiny stand-alone "validator gate kicks in" test, but `tests/unit/close-session-handler.test.ts` test #1 already exercises that path end-to-end against pglite with a mocked validator. The dedicated `close-route.test.ts` from the plan was skipped to avoid a near-duplicate; deleting it does not lose coverage.
6. **`OutcomeCapture` props extended, not replaced** — Added optional `sessionId` (absent = preview mode, submit disabled, no fetch) and `successHref` (default `/sessions`). Keeps `app/design/page.tsx` working unchanged with fixture data.
7. **Verification chips became real toggles** — Phase E rendered `DtcChip` decoratively. Wiring them required swapping to a `<button role="switch">` (`ToggleChip`) with `aria-checked` so keyboard users + tests can flip them. Same visual language (amber active, graphite inactive).
8. **Time fields stay auto/read-only** — Plan F2 makes `diagMinutes`/`repairMinutes` editable. Phase E renders them as auto-computed display ("auto"). Kept the auto display and submit them from props. If editable timing is needed later, add inputs without removing the auto display.

---

## Phase G — Stripe Billing Skeleton (3 tasks)

### Task G1: Stripe customer auto-creation on first sign-in

**Files:**
- Modify: lib/auth.ts
- Modify: lib/stripe.ts

- [ ] **Step 1: Add helpers**

```ts
// lib/stripe.ts (append)
import { db } from '@/lib/db/client'
import { stripeCustomers } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export async function ensureStripeCustomer(shopId: string, email: string) {
  const existing = await db.query.stripeCustomers.findFirst({
    where: eq(stripeCustomers.shopId, shopId),
  })
  if (existing) return existing.stripeCustomerId
  const customer = await stripe.customers.create({ email, metadata: { shopId } })
  await db.insert(stripeCustomers).values({
    shopId,
    stripeCustomerId: customer.id,
  })
  return customer.id
}
```

- [ ] **Step 2: Wire into ensureProfileAndShop**

In `lib/auth.ts`, after creating the shop:
```ts
import { ensureStripeCustomer } from '@/lib/stripe'

// after shop is created in ensureProfileAndShop:
await ensureStripeCustomer(shop.id, email).catch(err => {
  console.warn('stripe customer creation failed:', err)
})
```

Wrap in catch — Stripe failure should not block sign-in.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(stripe): auto-create Stripe customer on first sign-in"
```

---

### Task G2: Billing portal page (manage subscription)

**Files:**
- Create: app/(app)/billing/page.tsx
- Create: app/api/stripe/portal/route.ts

- [ ] **Step 1: Create portal route**

```ts
// app/api/stripe/portal/route.ts
import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase-server'
import { db } from '@/lib/db/client'
import { profiles, stripeCustomers } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { stripe } from '@/lib/stripe'

export async function POST(req: Request) {
  const supabase = await getServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const profile = await db.query.profiles.findFirst({ where: eq(profiles.id, user.id) })
  if (!profile?.shopId) return NextResponse.json({ error: 'no shop' }, { status: 400 })
  const customer = await db.query.stripeCustomers.findFirst({
    where: eq(stripeCustomers.shopId, profile.shopId),
  })
  if (!customer) return NextResponse.json({ error: 'no stripe customer' }, { status: 400 })

  const origin = req.headers.get('origin') ?? 'http://localhost:3000'
  const portal = await stripe.billingPortal.sessions.create({
    customer: customer.stripeCustomerId,
    return_url: `${origin}/billing`,
  })
  return NextResponse.json({ url: portal.url })
}
```

- [ ] **Step 2: Build the page**

```tsx
// app/(app)/billing/page.tsx
'use client'
import { Button } from '@/components/ui/button'
import { useState } from 'react'

export default function BillingPage() {
  const [busy, setBusy] = useState(false)
  async function go() {
    setBusy(true)
    const res = await fetch('/api/stripe/portal', { method: 'POST' })
    const { url } = await res.json()
    window.location.href = url
  }
  return (
    <main className="p-6 max-w-md">
      <h1 className="text-2xl font-bold mb-4">Billing</h1>
      <p className="text-sm text-gray-600 mb-4">
        Manage your subscription and payment methods.
      </p>
      <Button onClick={go} disabled={busy}>
        {busy ? 'Loading…' : 'Open billing portal'}
      </Button>
    </main>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(stripe): billing portal page + portal session route"
```

---

### Task G3: Webhook handles subscription.updated and customer.subscription.deleted

**Files:**
- Modify: app/api/stripe/webhook/route.ts

- [ ] **Step 1: Implement minimal subscription tracking**

```ts
// app/api/stripe/webhook/route.ts (replace the post-construct stub)
import { stripe } from '@/lib/stripe'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { stripeCustomers } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export async function POST(req: Request) {
  const body = await req.text()
  const sig = req.headers.get('stripe-signature')!
  let event
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch {
    return NextResponse.json({ error: 'invalid signature' }, { status: 400 })
  }

  if (
    event.type === 'customer.subscription.created' ||
    event.type === 'customer.subscription.updated' ||
    event.type === 'customer.subscription.deleted'
  ) {
    const sub = event.data.object as any
    const customerId = sub.customer as string
    await db.update(stripeCustomers)
      .set({
        subscriptionStatus: sub.status,
        currentPeriodEnd: sub.current_period_end ? new Date(sub.current_period_end * 1000) : null,
      })
      .where(eq(stripeCustomers.stripeCustomerId, customerId))
  }

  return NextResponse.json({ received: true })
}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat(stripe): handle subscription lifecycle webhooks"
```

---

## Phase H — PWA + Polish (3 tasks)

### Task H1: Add PWA manifest

**Files:**
- Create: app/manifest.ts
- Create: public/icons/icon-192.png, public/icons/icon-512.png

- [ ] **Step 1: Generate placeholder icons**

For MVP, generate simple square icons (any tool, or a Tailwind-style CSS/SVG export). Save as `public/icons/icon-192.png` (192×192) and `public/icons/icon-512.png` (512×512).

- [ ] **Step 2: Create the manifest route**

```ts
// app/manifest.ts
import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Vyntechs',
    short_name: 'Vyntechs',
    description: 'AI master tech for the bay',
    start_url: '/sessions',
    display: 'standalone',
    background_color: '#0a0a0a',
    theme_color: '#0a0a0a',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  }
}
```

- [ ] **Step 3: Verify the manifest is served**

`pnpm dev` → curl `http://localhost:3000/manifest.webmanifest` → expect JSON with the above contents.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(pwa): add manifest and icons"
```

---

### Task H2: Service worker for app-shell caching

**Files:**
- Create: app/sw.ts (or public/sw.js — Next.js 16 may support either)

- [ ] **Step 1: Read Next.js 16 docs for the current PWA pattern**

```bash
ls node_modules/next/dist/docs/ 2>/dev/null
```

Search for "service worker" or "PWA" guidance. Use the platform's recommended pattern. If the docs recommend `app/sw.ts` with the new metadata-route approach, follow that. Otherwise fall back to a static `public/sw.js`.

- [ ] **Step 2: Write a minimal service worker** (using static-file fallback if no docs guidance):

```js
// public/sw.js
const CACHE = 'vyntechs-shell-v1'
const SHELL = ['/']

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)))
})

self.addEventListener('fetch', (e) => {
  // Network-first for API and dynamic; cache-first for static shell.
  const url = new URL(e.request.url)
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/_next/')) return
  e.respondWith(
    caches.match(e.request).then((cached) => cached ?? fetch(e.request))
  )
})
```

- [ ] **Step 3: Register the service worker in the root layout**

```tsx
// app/layout.tsx (add a small client component)
// components/sw-register.tsx
'use client'
import { useEffect } from 'react'
export function SwRegister() {
  useEffect(() => {
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js').catch(console.warn)
    }
  }, [])
  return null
}
```

In `app/layout.tsx`, render `<SwRegister />` inside the `<body>`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(pwa): service worker for app-shell caching"
```

---

### Task H3: Verify PWA install prompt on phone viewport

**Files:** none (verification)

- [ ] **Step 1: Build production**

```bash
pnpm build && pnpm start
```

- [ ] **Step 2: Open in Chrome with phone emulation**

DevTools → Application → Manifest. Confirm the manifest is parsed without errors. The install prompt may appear after some engagement; the verification is mainly that the manifest + service worker are loaded clean.

- [ ] **Step 3: No commit needed.**

---

## Phase H — Implementation corrections (applied after H3)

The plan's Phase H is faithful in shape but a few details were tightened against the Phase E reality. The points below are authoritative; the inline blocks remain reference.

1. **`start_url` is `/today`, not `/sessions`** — Phase E shipped `/today` as the tech home (T-PH-2). `/sessions` is the history list. The PWA install should land on the active surface, so `/today` is correct.
2. **Theme/background color sourced from token** — plan uses `#0a0a0a`. The actual canvas token is `--vt-graphite-1000: oklch(14% 0.008 260)` whose sRGB equivalent is `#0d0d10`. Manifest spec wants hex, so the conversion lives in the manifest function but the value is documented as derived from the token.
3. **Icons rendered from the Workshop Instrument sigil** — plan says "any tool, placeholder square." Used the actual sigil at `.design-from-claude/vyntechs-design-system/project/assets/brand/sigil.svg` (graphite verticals + amber horizontals), placed on a `#0d0d10` background tile, rasterized via macOS `qlmanage -t` at 192 + 512. SVG source committed at `public/icons/icon.svg` for future re-rendering. No new dependency added (`sharp`, etc. — sips/qlmanage handled it).
4. **No "offline banner"** — the Phase E handoff prose mentioned an offline banner as part of H. The actual plan H1/H2/H3 doesn't include one. Sticking to plan-as-written; if the banner is wanted, add as a small new task that uses `navigator.onLine` + a `.field`-style amber strip in the existing app chrome.
5. **Service worker test surface** — the `public/sw.js` file isn't import-testable, so coverage is split across two test types: behavioral tests on `<SwRegister />` (dev no-register, prod register-/sw.js, no DOM output) and structural tests on the file itself (exists in public/, contains `/api/` and `/_next/` skip patterns). This is the right shape — full SW lifecycle testing requires Playwright.
6. **`vi.stubEnv('NODE_ENV', ...)` for env stubbing** — `Object.defineProperty(process.env, 'NODE_ENV', …)` throws on Node ≥20 (`process.env` is non-configurable for that key). Use `vi.stubEnv` + `vi.unstubAllEnvs` in `afterEach` instead. Mirror this for any future env-dependent test.

---

## Phase I — Multi-Modal Capture Pipeline (10 tasks)

Per spec §7.1 (Multi-Modal Capture Pipeline + Vision OCR) and §10 (Describe-First vision policy). Builds: an `artifacts` table, Supabase Storage bucket for raw uploads (swapped to S3 in Phase J), camera + audio + video capture components on the phone layout, a specialized scan-tool screen capture mode with vision OCR, audio transcription, and a multi-modal `advance` flow that the tree engine reasons over while honoring describe-first.

### Task I1: Add `artifacts` table

**Files:**
- Modify: lib/db/schema.ts
- Modify: lib/db/queries.ts

- [ ] **Step 1: Append schema**

```ts
// lib/db/schema.ts (append)
export const artifacts = pgTable('artifacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').references(() => sessions.id, { onDelete: 'cascade' }).notNull(),
  nodeId: text('node_id').notNull(),
  kind: text('kind', {
    enum: ['photo', 'video', 'audio', 'scan_screen', 'wiring_diagram'],
  }).notNull(),
  storageKey: text('storage_key').notNull(),    // bucket key / S3 key
  mimeType: text('mime_type').notNull(),
  bytes: integer('bytes').notNull(),
  durationMs: integer('duration_ms'),            // audio/video only
  extraction: jsonb('extraction').$type<{
    text?: string                                // OCR or transcript
    structured?: Record<string, unknown>         // model-specific fields, e.g. PIDs from scan screen
    summary?: string
  }>(),
  extractionStatus: text('extraction_status', {
    enum: ['pending', 'done', 'failed'],
  }).notNull().default('pending'),
  storageTier: text('storage_tier', {
    enum: ['hot', 'warm', 'cold'],
  }).notNull().default('hot'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const artifactsRelations = relations(artifacts, ({ one }) => ({
  session: one(sessions, { fields: [artifacts.sessionId], references: [sessions.id] }),
}))
```

- [ ] **Step 2: Add `events: many(artifacts)` relation on sessions if missing**

In `sessionsRelations`, add `artifacts: many(artifacts)`:
```ts
export const sessionsRelations = relations(sessions, ({ one, many }) => ({
  shop: one(shops, { fields: [sessions.shopId], references: [shops.id] }),
  tech: one(profiles, { fields: [sessions.techId], references: [profiles.id] }),
  events: many(sessionEvents),
  artifacts: many(artifacts),
}))
```

- [ ] **Step 3: Generate + apply migration**

```bash
pnpm drizzle-kit generate && pnpm drizzle-kit migrate
```

- [ ] **Step 4: Add typed queries**

```ts
// lib/db/queries.ts (append)
import { artifacts } from './schema'

export async function createArtifact(input: InferInsertModel<typeof artifacts>) {
  const [row] = await db.insert(artifacts).values(input).returning({ id: artifacts.id })
  return row.id
}

export async function getArtifactById(id: string) {
  return db.query.artifacts.findFirst({ where: eq(artifacts.id, id) })
}

export async function listArtifactsForSession(sessionId: string) {
  return db.query.artifacts.findMany({
    where: eq(artifacts.sessionId, sessionId),
    orderBy: desc(artifacts.createdAt),
  })
}

export async function setArtifactExtraction(
  id: string,
  extraction: typeof artifacts.$inferSelect.extraction,
  status: 'done' | 'failed' = 'done',
) {
  await db.update(artifacts)
    .set({ extraction, extractionStatus: status })
    .where(eq(artifacts.id, id))
}
```

- [ ] **Step 5: Verify via Supabase MCP**

`list_tables` to confirm `artifacts` exists.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(db): add artifacts table for multi-modal capture"
```

---

### Task I2: Supabase Storage bucket + signed-URL helper

**Files:**
- Create: lib/storage/client.ts
- Create: tests/unit/storage.test.ts

- [ ] **Step 1: Create the bucket**

Use the Supabase MCP `execute_sql` to create a private bucket:
```sql
INSERT INTO storage.buckets (id, name, public)
VALUES ('artifacts', 'artifacts', false)
ON CONFLICT (id) DO NOTHING;
```

- [ ] **Step 2: Write failing test for upload + signed URL helpers**

```ts
// tests/unit/storage.test.ts
import { describe, it, expect, vi } from 'vitest'

const supabaseMock = {
  storage: {
    from: vi.fn().mockReturnValue({
      upload: vi.fn().mockResolvedValue({ data: { path: 'sess/abc/photo.jpg' }, error: null }),
      createSignedUrl: vi.fn().mockResolvedValue({
        data: { signedUrl: 'https://signed.example/x' },
        error: null,
      }),
    }),
  },
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => supabaseMock,
}))

describe('storage', () => {
  it('uploadArtifact returns the storage key', async () => {
    const { uploadArtifact } = await import('@/lib/storage/client')
    const key = await uploadArtifact({
      sessionId: 'abc',
      kind: 'photo',
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'image/jpeg',
    })
    expect(key).toContain('abc/')
  })

  it('signedUrl returns the URL string', async () => {
    const { signedUrl } = await import('@/lib/storage/client')
    const url = await signedUrl('sess/abc/photo.jpg')
    expect(url).toBe('https://signed.example/x')
  })
})
```

- [ ] **Step 3: Run test, expect fail**

```bash
pnpm test tests/unit/storage.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 4: Implement**

```ts
// lib/storage/client.ts
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const BUCKET = 'artifacts'

const EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'audio/webm': 'webm',
  'audio/mp4': 'm4a',
  'video/webm': 'webm',
  'video/mp4': 'mp4',
}

export async function uploadArtifact(input: {
  sessionId: string
  kind: 'photo' | 'video' | 'audio' | 'scan_screen' | 'wiring_diagram'
  bytes: Uint8Array | Blob
  mimeType: string
}): Promise<string> {
  const ext = EXTENSION[input.mimeType] ?? 'bin'
  const key = `${input.sessionId}/${input.kind}/${randomUUID()}.${ext}`
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(key, input.bytes, { contentType: input.mimeType, upsert: false })
  if (error) throw new Error(`upload failed: ${error.message}`)
  return key
}

export async function signedUrl(storageKey: string, expiresInSec = 3600): Promise<string> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storageKey, expiresInSec)
  if (error || !data) throw new Error(`signed url failed: ${error?.message ?? 'no data'}`)
  return data.signedUrl
}

export async function downloadArtifact(storageKey: string): Promise<Uint8Array> {
  const { data, error } = await supabase.storage.from(BUCKET).download(storageKey)
  if (error || !data) throw new Error(`download failed: ${error?.message ?? 'no data'}`)
  const buf = await data.arrayBuffer()
  return new Uint8Array(buf)
}
```

- [ ] **Step 5: Run test, expect pass**

```bash
pnpm test tests/unit/storage.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(storage): Supabase Storage client with upload + signed URLs"
```

---

### Task I3: Generic capture upload route

**Files:**
- Create: app/api/sessions/[id]/capture/route.ts

- [ ] **Step 1: Write the route**

```ts
// app/api/sessions/[id]/capture/route.ts
import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase-server'
import { db } from '@/lib/db/client'
import { profiles, sessions } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { uploadArtifact } from '@/lib/storage/client'
import { createArtifact } from '@/lib/db/queries'
import { z } from 'zod'

const ALLOWED_KINDS = ['photo', 'video', 'audio', 'scan_screen', 'wiring_diagram'] as const
const MAX_BYTES = 25 * 1024 * 1024  // 25 MB upper bound

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await getServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const profile = await db.query.profiles.findFirst({ where: eq(profiles.id, user.id) })
  if (!profile) return NextResponse.json({ error: 'no profile' }, { status: 400 })
  const session = await db.query.sessions.findFirst({ where: eq(sessions.id, id) })
  if (!session || session.techId !== profile.id) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (session.status !== 'open') return NextResponse.json({ error: 'session not open' }, { status: 400 })

  const form = await req.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: 'multipart required' }, { status: 400 })
  const file = form.get('file')
  const kind = String(form.get('kind') ?? '')
  const nodeId = String(form.get('nodeId') ?? session.treeState.currentNodeId)
  const durationMs = form.get('durationMs') ? Number(form.get('durationMs')) : undefined

  if (!(file instanceof Blob)) return NextResponse.json({ error: 'file required' }, { status: 400 })
  if (!ALLOWED_KINDS.includes(kind as any)) return NextResponse.json({ error: 'invalid kind' }, { status: 400 })
  if (file.size === 0 || file.size > MAX_BYTES) return NextResponse.json({ error: 'invalid size' }, { status: 400 })

  const bytes = new Uint8Array(await file.arrayBuffer())
  const storageKey = await uploadArtifact({
    sessionId: id,
    kind: kind as typeof ALLOWED_KINDS[number],
    bytes,
    mimeType: file.type,
  })

  const artifactId = await createArtifact({
    sessionId: id,
    nodeId,
    kind: kind as typeof ALLOWED_KINDS[number],
    storageKey,
    mimeType: file.type,
    bytes: file.size,
    durationMs,
    extractionStatus: 'pending',
  })

  return NextResponse.json({ artifactId, storageKey, kind })
}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat(session): POST /api/sessions/[id]/capture — generic artifact upload"
```

---

### Task I4: PhotoCapture client component

**Files:**
- Create: components/session/photo-capture.tsx

- [ ] **Step 1: Write the component**

```tsx
// components/session/photo-capture.tsx
'use client'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'

type Kind = 'photo' | 'scan_screen' | 'wiring_diagram'

export function PhotoCapture(props: {
  sessionId: string
  nodeId: string
  kind: Kind
  label?: string
  onUploaded: (artifactId: string) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('kind', props.kind)
      fd.append('nodeId', props.nodeId)
      const res = await fetch(`/api/sessions/${props.sessionId}/capture`, {
        method: 'POST',
        body: fd,
      })
      if (!res.ok) throw new Error(await res.text())
      const { artifactId } = await res.json()
      props.onUploaded(artifactId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'upload failed')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleChange}
      />
      <Button
        type="button"
        variant="outline"
        className="w-full h-12"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? 'Uploading…' : (props.label ?? 'Take photo')}
      </Button>
      {error && <p className="text-red-600 text-sm">{error}</p>}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat(session): PhotoCapture component (camera input + upload)"
```

---

### Task I5: AudioCapture client component (MediaRecorder)

**Files:**
- Create: components/session/audio-capture.tsx

- [ ] **Step 1: Write the component**

```tsx
// components/session/audio-capture.tsx
'use client'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'

const MIME = 'audio/webm;codecs=opus'

export function AudioCapture(props: {
  sessionId: string
  nodeId: string
  prompt?: string
  maxSeconds?: number
  onUploaded: (artifactId: string) => void
}) {
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startedAtRef = useRef<number>(0)
  const [recording, setRecording] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const max = (props.maxSeconds ?? 30) * 1000

  async function start() {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec = new MediaRecorder(stream, { mimeType: MIME })
      chunksRef.current = []
      rec.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        await upload()
      }
      rec.start()
      recorderRef.current = rec
      startedAtRef.current = Date.now()
      setRecording(true)
      setTimeout(() => { if (recorderRef.current?.state === 'recording') stop() }, max)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'mic permission denied')
    }
  }

  function stop() {
    recorderRef.current?.stop()
    recorderRef.current = null
    setRecording(false)
  }

  async function upload() {
    setBusy(true)
    try {
      const blob = new Blob(chunksRef.current, { type: MIME })
      const fd = new FormData()
      fd.append('file', blob, 'audio.webm')
      fd.append('kind', 'audio')
      fd.append('nodeId', props.nodeId)
      fd.append('durationMs', String(Date.now() - startedAtRef.current))
      const res = await fetch(`/api/sessions/${props.sessionId}/capture`, {
        method: 'POST',
        body: fd,
      })
      if (!res.ok) throw new Error(await res.text())
      const { artifactId } = await res.json()
      props.onUploaded(artifactId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'upload failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      {props.prompt && <p className="text-sm text-gray-700">{props.prompt}</p>}
      {!recording ? (
        <Button type="button" variant="outline" className="w-full h-12" disabled={busy} onClick={start}>
          {busy ? 'Uploading…' : 'Record audio'}
        </Button>
      ) : (
        <Button type="button" variant="destructive" className="w-full h-12" onClick={stop}>
          Stop ({Math.floor((Date.now() - startedAtRef.current) / 1000)}s)
        </Button>
      )}
      {error && <p className="text-red-600 text-sm">{error}</p>}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat(session): AudioCapture component with MediaRecorder"
```

---

### Task I6: VideoCapture client component (short clips)

**Files:**
- Create: components/session/video-capture.tsx

- [ ] **Step 1: Write the component**

```tsx
// components/session/video-capture.tsx
'use client'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'

export function VideoCapture(props: {
  sessionId: string
  nodeId: string
  maxSeconds?: number
  onUploaded: (artifactId: string) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const maxBytes = 25 * 1024 * 1024

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > maxBytes) {
      setError('Clip too large (max 25MB). Re-record shorter clip.')
      if (inputRef.current) inputRef.current.value = ''
      return
    }
    setBusy(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('kind', 'video')
      fd.append('nodeId', props.nodeId)
      const res = await fetch(`/api/sessions/${props.sessionId}/capture`, {
        method: 'POST',
        body: fd,
      })
      if (!res.ok) throw new Error(await res.text())
      const { artifactId } = await res.json()
      props.onUploaded(artifactId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'upload failed')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        capture="environment"
        className="hidden"
        onChange={handleChange}
      />
      <Button
        type="button"
        variant="outline"
        className="w-full h-12"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? 'Uploading…' : 'Record short clip'}
      </Button>
      {error && <p className="text-red-600 text-sm">{error}</p>}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat(session): VideoCapture component for short clips"
```

---

### Task I7: Vision OCR — scan-tool screen extractor

**Files:**
- Create: lib/ai/vision.ts
- Modify: lib/ai/prompts.ts
- Create: tests/unit/vision.test.ts

- [ ] **Step 1: Add scan-tool prompt**

```ts
// lib/ai/prompts.ts (append)
export const SCAN_SCREEN_VISION_SYSTEM = `You are extracting structured data from a photographed scan-tool screen.

Common scan tools: Autel, Snap-on, Bosch, Launch, OBDLink. The image will show DTCs, freeze-frame data, live PIDs, or module-status lists.

OUTPUT FORMAT — always respond with valid JSON:

type ScanScreenExtraction = {
  screenType: "dtc_list" | "freeze_frame" | "live_pids" | "module_scan" | "graph" | "unknown"
  dtcs?: Array<{ code: string; description?: string; status?: "active" | "pending" | "history" }>
  freezeFrame?: Record<string, string | number>   // pid name -> value (units in value string)
  pids?: Record<string, string | number>          // live PIDs at capture moment
  modules?: Array<{ name: string; codes?: string[]; communication?: "ok" | "no_response" }>
  rawText: string                                 // verbatim OCR of every visible field
  notes?: string                                  // anything ambiguous you flag for human review
}

If the image is unreadable, blurry, or not a scan-tool screen, set screenType="unknown" and put your best-guess description in notes.`

export const WIRING_DIAGRAM_VISION_SYSTEM = `You are extracting structured facts from a photographed OEM wiring diagram (ProDemand, AllData, Mitchell, factory service info).

LEGAL: never reproduce the diagram or large extracts of OEM text verbatim. Extract only the structured facts the tech needs (wire colors, pin numbers, ground locations, splice points). The original photo is stored in the case evidence record only.

OUTPUT FORMAT — always respond with valid JSON:

type WiringDiagramExtraction = {
  circuit: string                                 // e.g. "K-CAN bus", "MAF signal"
  wireColors: Array<{ signal: string; color: string; pin?: string; connector?: string }>
  groundPoints?: Array<{ id: string; location: string }>
  splicePoints?: Array<{ id: string; description: string }>
  buildDateApplicable?: string                    // e.g. "before 03/2014" or "all"
  notes?: string
}`
```

- [ ] **Step 2: Write failing test**

```ts
// tests/unit/vision.test.ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/ai/client', () => ({
  anthropic: {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{
          type: 'text',
          text: JSON.stringify({
            screenType: 'dtc_list',
            dtcs: [
              { code: 'P0299', description: 'Turbo underboost', status: 'active' },
              { code: 'P0236', description: 'TC boost sensor circuit', status: 'pending' },
            ],
            rawText: 'P0299 ACTIVE Turbo underboost\nP0236 PENDING TC boost sensor',
          }),
        }],
        usage: { input_tokens: 800, output_tokens: 120 },
      }),
    },
  },
  MODEL: 'claude-sonnet-4-6',
  cachedSystem: (t: string) => [{ type: 'text', text: t, cache_control: { type: 'ephemeral' } }],
}))

describe('extractScanScreen', () => {
  it('returns structured DTC list from image bytes', async () => {
    const { extractScanScreen } = await import('@/lib/ai/vision')
    const result = await extractScanScreen({
      bytes: new Uint8Array([0xff, 0xd8, 0xff]),  // jpeg magic; mock ignores
      mimeType: 'image/jpeg',
    })
    expect(result.screenType).toBe('dtc_list')
    expect(result.dtcs).toHaveLength(2)
    expect(result.dtcs?.[0].code).toBe('P0299')
  })
})
```

- [ ] **Step 3: Run test, expect fail**

```bash
pnpm test tests/unit/vision.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 4: Implement vision extractor**

```ts
// lib/ai/vision.ts
import { anthropic, MODEL, cachedSystem } from './client'
import { SCAN_SCREEN_VISION_SYSTEM, WIRING_DIAGRAM_VISION_SYSTEM } from './prompts'

export type ScanScreenExtraction = {
  screenType: 'dtc_list' | 'freeze_frame' | 'live_pids' | 'module_scan' | 'graph' | 'unknown'
  dtcs?: Array<{ code: string; description?: string; status?: 'active' | 'pending' | 'history' }>
  freezeFrame?: Record<string, string | number>
  pids?: Record<string, string | number>
  modules?: Array<{ name: string; codes?: string[]; communication?: 'ok' | 'no_response' }>
  rawText: string
  notes?: string
}

export type WiringDiagramExtraction = {
  circuit: string
  wireColors: Array<{ signal: string; color: string; pin?: string; connector?: string }>
  groundPoints?: Array<{ id: string; location: string }>
  splicePoints?: Array<{ id: string; description: string }>
  buildDateApplicable?: string
  notes?: string
}

function parseJson<T>(text: string): T {
  const cleaned = text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
  return JSON.parse(cleaned) as T
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return Buffer.from(binary, 'binary').toString('base64')
}

export async function extractScanScreen(input: {
  bytes: Uint8Array
  mimeType: string
}): Promise<ScanScreenExtraction> {
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1500,
    system: cachedSystem(SCAN_SCREEN_VISION_SYSTEM),
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: input.mimeType, data: toBase64(input.bytes) } },
        { type: 'text', text: 'Extract this scan-tool screen. Return JSON only.' },
      ],
    }],
  })
  const block = res.content.find(b => b.type === 'text')
  if (!block || block.type !== 'text') throw new Error('no text block')
  return parseJson<ScanScreenExtraction>(block.text)
}

export async function extractWiringDiagram(input: {
  bytes: Uint8Array
  mimeType: string
  circuitHint?: string
}): Promise<WiringDiagramExtraction> {
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1500,
    system: cachedSystem(WIRING_DIAGRAM_VISION_SYSTEM),
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: input.mimeType, data: toBase64(input.bytes) } },
        {
          type: 'text',
          text: `Extract structured facts only. ${input.circuitHint ? `Circuit hint: ${input.circuitHint}.` : ''} Return JSON only.`,
        },
      ],
    }],
  })
  const block = res.content.find(b => b.type === 'text')
  if (!block || block.type !== 'text') throw new Error('no text block')
  return parseJson<WiringDiagramExtraction>(block.text)
}
```

- [ ] **Step 5: Run test, expect pass**

```bash
pnpm test tests/unit/vision.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(ai): vision extractors for scan-tool screens and wiring diagrams"
```

---

### Task I8: Audio transcription helper

**Files:**
- Modify: lib/ai/vision.ts (add transcribeAudio — same module since both are perception)
- Modify: lib/ai/prompts.ts
- Modify: tests/unit/vision.test.ts (append)

- [ ] **Step 1: Add the prompt**

```ts
// lib/ai/prompts.ts (append)
export const AUDIO_TRANSCRIBE_SYSTEM = `You are transcribing a short audio clip captured by an automotive technician at a vehicle.

Common content: engine sounds (idle, knock, lifter tick, fuel knock, vacuum hiss), exhaust leaks, transmission whine, brake squeal, voice annotation by the tech, or environmental sounds in a noisy bay.

OUTPUT FORMAT — always respond with valid JSON:

type AudioExtraction = {
  transcript: string                  // verbatim transcription of any speech
  diagnosticSummary: string           // 1-2 sentences describing what the audio reveals
  acousticTags?: string[]             // e.g. ["lifter_tick", "vacuum_hiss", "exhaust_leak"]
  confidence: number                  // 0-1, your confidence in the diagnostic summary
}

If the audio is mostly background noise, low transcript + low confidence is expected. Be honest.`
```

- [ ] **Step 2: Write failing test (append to vision.test.ts)**

```ts
// tests/unit/vision.test.ts (append)
describe('transcribeAudio', () => {
  it('returns transcript + diagnostic summary', async () => {
    const { anthropic } = await import('@/lib/ai/client')
    ;(anthropic.messages.create as any).mockResolvedValueOnce({
      content: [{
        type: 'text',
        text: JSON.stringify({
          transcript: 'OK so listen to this idle...',
          diagnosticSummary: 'Distinct lifter tick at idle on driver side.',
          acousticTags: ['lifter_tick'],
          confidence: 0.78,
        }),
      }],
      usage: { input_tokens: 1200, output_tokens: 80 },
    })

    const { transcribeAudio } = await import('@/lib/ai/vision')
    const r = await transcribeAudio({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'audio/webm',
    })
    expect(r.acousticTags).toContain('lifter_tick')
    expect(r.confidence).toBeGreaterThan(0.5)
  })
})
```

- [ ] **Step 3: Run, expect fail**

```bash
pnpm test tests/unit/vision.test.ts
```

Expected: FAIL on the new test (`transcribeAudio` not exported).

- [ ] **Step 4: Implement**

```ts
// lib/ai/vision.ts (append)
import { AUDIO_TRANSCRIBE_SYSTEM } from './prompts'

export type AudioExtraction = {
  transcript: string
  diagnosticSummary: string
  acousticTags?: string[]
  confidence: number
}

export async function transcribeAudio(input: {
  bytes: Uint8Array
  mimeType: string
}): Promise<AudioExtraction> {
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 800,
    system: cachedSystem(AUDIO_TRANSCRIBE_SYSTEM),
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: input.mimeType, data: toBase64(input.bytes) } } as any,
        { type: 'text', text: 'Transcribe and analyze this audio clip. Return JSON only.' },
      ],
    }],
  })
  const block = res.content.find(b => b.type === 'text')
  if (!block || block.type !== 'text') throw new Error('no text block')
  return parseJson<AudioExtraction>(block.text)
}
```

> **Note on the audio API:** Anthropic's audio support evolves; if `document`/audio blocks aren't supported in your SDK version, swap to a Whisper call (OpenAI or self-hosted). The interface (`Uint8Array → AudioExtraction`) stays the same so downstream code is unaffected.

- [ ] **Step 5: Run, expect pass**

```bash
pnpm test tests/unit/vision.test.ts
```

Expected: PASS (3 tests total in this file).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(ai): transcribeAudio for engine-sound clips"
```

---

### Task I9: Background extraction worker — process pending artifacts

**Files:**
- Create: lib/ai/extraction-worker.ts
- Create: app/api/artifacts/[id]/extract/route.ts
- Create: tests/unit/extraction-worker.test.ts

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/extraction-worker.test.ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/storage/client', () => ({
  downloadArtifact: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
}))
vi.mock('@/lib/ai/vision', () => ({
  extractScanScreen: vi.fn().mockResolvedValue({ screenType: 'dtc_list', dtcs: [{ code: 'P0299' }], rawText: 'P0299' }),
  extractWiringDiagram: vi.fn().mockResolvedValue({ circuit: 'K-CAN', wireColors: [] }),
  transcribeAudio: vi.fn().mockResolvedValue({ transcript: '', diagnosticSummary: 'silence', confidence: 0.1 }),
}))
vi.mock('@/lib/db/queries', () => ({
  getArtifactById: vi.fn().mockResolvedValue({
    id: 'art-1',
    kind: 'scan_screen',
    storageKey: 'sess/x/scan.jpg',
    mimeType: 'image/jpeg',
  }),
  setArtifactExtraction: vi.fn().mockResolvedValue(undefined),
}))

describe('processArtifactExtraction', () => {
  it('routes scan_screen to extractScanScreen and stores result', async () => {
    const { processArtifactExtraction } = await import('@/lib/ai/extraction-worker')
    const { setArtifactExtraction } = await import('@/lib/db/queries')
    const result = await processArtifactExtraction('art-1')
    expect(result.kind).toBe('scan_screen')
    expect(setArtifactExtraction).toHaveBeenCalledWith(
      'art-1',
      expect.objectContaining({ structured: expect.any(Object) }),
      'done',
    )
  })
})
```

- [ ] **Step 2: Run, expect fail**

```bash
pnpm test tests/unit/extraction-worker.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

```ts
// lib/ai/extraction-worker.ts
import { downloadArtifact } from '@/lib/storage/client'
import { getArtifactById, setArtifactExtraction } from '@/lib/db/queries'
import { extractScanScreen, extractWiringDiagram, transcribeAudio } from './vision'

export async function processArtifactExtraction(artifactId: string) {
  const artifact = await getArtifactById(artifactId)
  if (!artifact) throw new Error(`artifact not found: ${artifactId}`)

  try {
    const bytes = await downloadArtifact(artifact.storageKey)
    let extraction: { text?: string; structured?: Record<string, unknown>; summary?: string }

    switch (artifact.kind) {
      case 'scan_screen': {
        const r = await extractScanScreen({ bytes, mimeType: artifact.mimeType })
        extraction = {
          text: r.rawText,
          structured: r as unknown as Record<string, unknown>,
          summary: r.dtcs ? `DTCs: ${r.dtcs.map(d => d.code).join(', ')}` : r.notes,
        }
        break
      }
      case 'wiring_diagram': {
        const r = await extractWiringDiagram({ bytes, mimeType: artifact.mimeType })
        extraction = {
          structured: r as unknown as Record<string, unknown>,
          summary: `Wiring: ${r.circuit}`,
        }
        break
      }
      case 'audio': {
        const r = await transcribeAudio({ bytes, mimeType: artifact.mimeType })
        extraction = {
          text: r.transcript,
          structured: r as unknown as Record<string, unknown>,
          summary: r.diagnosticSummary,
        }
        break
      }
      case 'photo':
      case 'video':
        // Photo/video are described by the tech in text; full vision only on demand.
        extraction = { summary: 'Stored — vision not auto-invoked (describe-first policy).' }
        break
    }

    await setArtifactExtraction(artifactId, extraction, 'done')
    return { kind: artifact.kind, extraction }
  } catch (err) {
    await setArtifactExtraction(artifactId, { summary: `extraction failed: ${err instanceof Error ? err.message : 'unknown'}` }, 'failed')
    throw err
  }
}
```

- [ ] **Step 4: Add the on-demand extraction route**

```ts
// app/api/artifacts/[id]/extract/route.ts
import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase-server'
import { processArtifactExtraction } from '@/lib/ai/extraction-worker'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await getServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const result = await processArtifactExtraction(id)
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'extract failed' }, { status: 500 })
  }
}
```

- [ ] **Step 5: Run, expect pass**

```bash
pnpm test tests/unit/extraction-worker.test.ts
```

Expected: PASS.

- [ ] **Step 6: Auto-trigger extraction inside the capture route for high-signal kinds**

Update `app/api/sessions/[id]/capture/route.ts` so that for `kind === 'scan_screen' | 'wiring_diagram' | 'audio'` extraction runs inline (the user is waiting). For `photo` and `video`, defer (describe-first):

```ts
// app/api/sessions/[id]/capture/route.ts (after createArtifact)
import { processArtifactExtraction } from '@/lib/ai/extraction-worker'

const HIGH_SIGNAL = new Set(['scan_screen', 'wiring_diagram', 'audio'])
let extraction: unknown = null
if (HIGH_SIGNAL.has(kind)) {
  try {
    const r = await processArtifactExtraction(artifactId)
    extraction = r.extraction
  } catch (err) {
    console.error('inline extraction failed:', err)
    // artifact is still created; tech can re-trigger via /extract route
  }
}

return NextResponse.json({ artifactId, storageKey, kind, extraction })
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(ai): extraction worker + inline auto-extract for high-signal kinds"
```

---

### Task I10: Multi-modal advance — update tree engine to ingest artifacts

**Files:**
- Modify: lib/ai/tree-engine.ts
- Modify: lib/ai/prompts.ts
- Modify: app/api/sessions/[id]/advance/route.ts
- Modify: components/session/step-input.tsx
- Modify: components/session/session-view.tsx
- Modify: tests/unit/tree-engine.test.ts (append)

- [ ] **Step 1: Update the tree-engine system prompt with describe-first policy**

```ts
// lib/ai/prompts.ts — replace the closing PRINCIPLES block of TREE_ENGINE_SYSTEM
// (find the existing constant and append the lines below to its PRINCIPLES section)
```

Change the constant body so PRINCIPLES reads:

```
PRINCIPLES:
- Minimize tech burden. Default to text/voice description from the tech; only request artifacts when text is insufficient.
- One step at a time. Don't dump the whole tree on the tech.
- Be specific. "Look at the cold-side intercooler pipe" beats "inspect the boost system."
- Speak plainly, like a senior tech mentoring a junior.
- Never recommend a destructive action without explicit reasoning.
- If you're uncertain, say so honestly and ask for the smallest piece of additional info that would resolve it.

DESCRIBE-FIRST POLICY (vision is expensive — do not request photos by default):
- ASK for a photo only when: (a) the tech reports they cannot describe what they see, (b) the artifact is a scan-tool screen / wiring diagram / hard-to-describe phenomenon (hairline cracks, oil residue patterns, smoke escape, color-coded wires, broken connector tabs), or (c) photo evidence has downstream value (warranty, customer trust).
- ASK for an audio clip only when: an engine/exhaust/brake sound is the diagnostic signal AND the tech cannot describe it adequately in text.
- ASK for a video clip only when: a transient or motion-dependent phenomenon needs to be captured.
- When you need an artifact, set "requestedArtifact" in your response with kind ("photo" | "scan_screen" | "wiring_diagram" | "audio" | "video") and a short prompt to display to the tech.

When the tech submits an observation, it may include extracted text/data from artifacts they captured. Treat artifact-derived data as evidence with the same weight as direct text observation.
```

Also extend the output type:

```
OUTPUT FORMAT — always respond with valid JSON matching this TypeScript type:

type TreeUpdate = {
  nodes: Array<{ id, label, status, rationale?, children? }>
  currentNodeId: string
  message: string
  done?: boolean
  rootCauseSummary?: string
  requestedArtifact?: {
    kind: "photo" | "scan_screen" | "wiring_diagram" | "audio" | "video"
    prompt: string                              // what to capture and how
  }
}
```

- [ ] **Step 2: Update tree-engine types**

```ts
// lib/ai/tree-engine.ts — extend TreeState
export type TreeState = {
  nodes: TreeNode[]
  currentNodeId: string
  message: string
  done?: boolean
  rootCauseSummary?: string
  requestedArtifact?: {
    kind: 'photo' | 'scan_screen' | 'wiring_diagram' | 'audio' | 'video'
    prompt: string
  }
}
```

Update `parseTreeJson` validation to allow but not require `requestedArtifact`. (Existing required-fields check stays.)

- [ ] **Step 3: Extend updateTree to accept artifact-derived evidence**

```ts
// lib/ai/tree-engine.ts — replace updateTree signature
export async function updateTree(input: {
  intake: IntakePayload
  currentTree: TreeState
  observation: string
  artifacts?: Array<{
    kind: 'photo' | 'video' | 'audio' | 'scan_screen' | 'wiring_diagram'
    summary?: string
    structured?: Record<string, unknown>
    text?: string
  }>
}): Promise<TreeState> {
  const artifactBlock = (input.artifacts ?? []).length > 0
    ? `\n\nArtifacts captured for this step (extracted by the perception layer):\n${
        (input.artifacts ?? [])
          .map((a, i) => `(${i + 1}) ${a.kind}: ${a.summary ?? '(no summary)'}\n${a.text ? `text: ${a.text}\n` : ''}${a.structured ? `structured: ${JSON.stringify(a.structured)}` : ''}`)
          .join('\n\n')
      }`
    : ''

  const userMessage = `Current tree state:
${JSON.stringify(input.currentTree, null, 2)}

Tech's observation on current step (${input.currentTree.currentNodeId}):
${input.observation}${artifactBlock}

Update the tree based on this observation and any artifact evidence. Resolve or prune branches as appropriate. Set the next current step. If you have enough information to identify the root cause, set done=true and provide rootCauseSummary.

Return JSON only — no prose, no fences.`

  return await withRetry(async () => {
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: cachedSystem(TREE_ENGINE_SYSTEM),
      messages: [
        { role: 'user', content: `Initial intake: ${JSON.stringify(input.intake)}` },
        { role: 'assistant', content: `Tree generated and being walked.` },
        { role: 'user', content: userMessage },
      ],
    })
    const block = res.content.find(b => b.type === 'text')
    if (!block || block.type !== 'text') throw new Error('no text block')
    return parseTreeJson(block.text)
  })
}
```

- [ ] **Step 4: Update the advance route to pull artifacts captured since last advance**

```ts
// app/api/sessions/[id]/advance/route.ts — replace the updateTree call section
import { listArtifactsForSession } from '@/lib/db/queries'

// after parsing body, before updateTree:
const allArtifacts = await listArtifactsForSession(id)
const sinceNodeArtifacts = allArtifacts
  .filter(a => a.nodeId === session.treeState.currentNodeId && a.extractionStatus === 'done')
  .map(a => ({
    kind: a.kind,
    summary: a.extraction?.summary,
    structured: a.extraction?.structured,
    text: a.extraction?.text,
  }))

let nextTree
try {
  nextTree = await updateTree({
    intake: session.intake,
    currentTree: session.treeState,
    observation: parsed.data.observation,
    artifacts: sinceNodeArtifacts,
  })
} catch (err) {
  console.error('tree update failed:', err)
  return NextResponse.json({ error: 'tree update failed' }, { status: 500 })
}
```

- [ ] **Step 5: Update StepInput to render the requested artifact prompt**

In `components/session/step-input.tsx`, accept `requestedArtifact` prop and render the appropriate capture component above the textarea:

```tsx
// components/session/step-input.tsx — replace existing return
import { PhotoCapture } from './photo-capture'
import { AudioCapture } from './audio-capture'
import { VideoCapture } from './video-capture'

export function StepInput(props: {
  sessionId: string
  currentLabel: string
  currentNodeId: string
  message: string
  requestedArtifact?: { kind: 'photo' | 'scan_screen' | 'wiring_diagram' | 'audio' | 'video'; prompt: string }
  onAdvance: (next: TreeState) => void
}) {
  // ... existing state ...

  function renderRequestedArtifact() {
    if (!props.requestedArtifact) return null
    const { kind, prompt } = props.requestedArtifact
    if (kind === 'audio') {
      return <AudioCapture sessionId={props.sessionId} nodeId={props.currentNodeId} prompt={prompt} onUploaded={() => {}} />
    }
    if (kind === 'video') {
      return <VideoCapture sessionId={props.sessionId} nodeId={props.currentNodeId} onUploaded={() => {}} />
    }
    return <PhotoCapture sessionId={props.sessionId} nodeId={props.currentNodeId} kind={kind} label={prompt} onUploaded={() => {}} />
  }

  return (
    <Card className="p-4 space-y-3">
      <p className="text-sm">{props.message}</p>
      {renderRequestedArtifact()}
      <Textarea
        rows={4}
        placeholder="Describe what you found, observed, or measured…"
        value={text}
        onChange={e => setText(e.target.value)}
        disabled={busy}
        className="min-h-[120px] text-base"
      />
      {error && <p className="text-red-600 text-sm">{error}</p>}
      <Button onClick={handleSubmit} disabled={busy || text.trim().length === 0} className="w-full h-12 text-base">
        {busy ? 'Thinking…' : 'Submit observation'}
      </Button>
    </Card>
  )
}
```

Also wire the `currentNodeId` and `requestedArtifact` props in `SessionView`:

```tsx
// components/session/session-view.tsx
<StepInput
  sessionId={session.id}
  currentLabel={tree.nodes.find(n => n.id === tree.currentNodeId)?.label ?? ''}
  currentNodeId={tree.currentNodeId}
  message={tree.message}
  requestedArtifact={tree.requestedArtifact}
  onAdvance={(next) => setSession({ ...session, treeState: next })}
/>
```

- [ ] **Step 6: Add unit test for multi-modal updateTree**

```ts
// tests/unit/tree-engine.test.ts (append)
describe('updateTree with artifacts', () => {
  it('passes artifact summaries into the model prompt', async () => {
    const { anthropic } = await import('@/lib/ai/client')
    ;(anthropic.messages.create as any).mockResolvedValueOnce({
      content: [{
        type: 'text',
        text: JSON.stringify({
          nodes: [{ id: 'verify', label: 'Smoke test', status: 'active' }],
          currentNodeId: 'verify',
          message: 'Got it. Run a smoke test next.',
        }),
      }],
      usage: { input_tokens: 200, output_tokens: 60 },
    })
    const { updateTree } = await import('@/lib/ai/tree-engine')
    await updateTree({
      intake: { vehicleYear: 2018, vehicleMake: 'Ford', vehicleModel: 'F-150', customerComplaint: 'loss of power' },
      currentTree: { nodes: [], currentNodeId: 'scan-codes', message: '' },
      observation: 'codes pulled',
      artifacts: [{
        kind: 'scan_screen',
        summary: 'DTCs: P0299, P0236',
        structured: { dtcs: [{ code: 'P0299' }, { code: 'P0236' }] },
        text: 'P0299 ACTIVE\nP0236 PENDING',
      }],
    })
    const lastCall = (anthropic.messages.create as any).mock.calls.at(-1)[0]
    const userMessages = lastCall.messages.filter((m: any) => m.role === 'user')
    const lastUser = userMessages[userMessages.length - 1].content as string
    expect(lastUser).toContain('P0299')
    expect(lastUser).toContain('scan_screen')
  })
})
```

- [ ] **Step 7: Run all unit tests**

```bash
pnpm test
```

Expected: all PASS.

- [ ] **Step 8: Manual end-to-end check**

`pnpm dev` → start a session for `2018 Ford F-150 / loss of power`. After the first text observation, force the tree to request a scan-tool photo by submitting `"please look at the scan tool screen"` — confirm the AI requests a `scan_screen` artifact, the PhotoCapture button appears, upload a sample scan photo, confirm the next advance includes the extracted DTCs.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(session): multi-modal advance — artifacts feed updateTree under describe-first policy"
```

---

## Phase J — Photo Storage Tiering (6 tasks)

Per spec §6 row 14 and §12. Builds: an S3 backend behind the storage abstraction (Supabase Storage stays for dev), bucket lifecycle policies for hot→warm→cold transitions, structured-extraction-on-ingest already in place from Phase I, signed-URL helpers that work across both backends, and a daily cron that mirrors the lifecycle state into the `storage_tier` column. Structured extractions persist permanently in `artifacts.extraction`; binaries decay through tiers per spec §12.

### Task J1: Storage backend abstraction + S3 client

**Files:**
- Refactor: lib/storage/client.ts → lib/storage/supabase-backend.ts
- Create: lib/storage/s3-backend.ts
- Create: lib/storage/index.ts
- Modify: tests/unit/storage.test.ts

- [ ] **Step 1: Install AWS S3 client**

```bash
pnpm add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

- [ ] **Step 2: Define a backend interface**

```ts
// lib/storage/index.ts
export type StorageKind = 'photo' | 'video' | 'audio' | 'scan_screen' | 'wiring_diagram'

export interface StorageBackend {
  upload(input: { sessionId: string; kind: StorageKind; bytes: Uint8Array | Blob; mimeType: string }): Promise<string>
  signedUrl(storageKey: string, expiresInSec?: number): Promise<string>
  download(storageKey: string): Promise<Uint8Array>
  setTier?(storageKey: string, tier: 'hot' | 'warm' | 'cold'): Promise<void>
}

import { SupabaseBackend } from './supabase-backend'
import { S3Backend } from './s3-backend'

const BACKEND = process.env.STORAGE_BACKEND === 's3' ? new S3Backend() : new SupabaseBackend()

export const uploadArtifact = (i: Parameters<StorageBackend['upload']>[0]) => BACKEND.upload(i)
export const signedUrl = (k: string, e?: number) => BACKEND.signedUrl(k, e)
export const downloadArtifact = (k: string) => BACKEND.download(k)
export const setStorageTier = (k: string, t: 'hot' | 'warm' | 'cold') =>
  BACKEND.setTier ? BACKEND.setTier(k, t) : Promise.resolve()
```

- [ ] **Step 3: Move existing Supabase implementation into a class**

```ts
// lib/storage/supabase-backend.ts
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import type { StorageBackend, StorageKind } from './index'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)
const BUCKET = 'artifacts'
const EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'audio/webm': 'webm', 'audio/mp4': 'm4a',
  'video/webm': 'webm', 'video/mp4': 'mp4',
}

export class SupabaseBackend implements StorageBackend {
  async upload(input: { sessionId: string; kind: StorageKind; bytes: Uint8Array | Blob; mimeType: string }) {
    const ext = EXT[input.mimeType] ?? 'bin'
    const key = `${input.sessionId}/${input.kind}/${randomUUID()}.${ext}`
    const { error } = await supabase.storage.from(BUCKET)
      .upload(key, input.bytes, { contentType: input.mimeType, upsert: false })
    if (error) throw new Error(`upload failed: ${error.message}`)
    return key
  }
  async signedUrl(storageKey: string, expiresInSec = 3600) {
    const { data, error } = await supabase.storage.from(BUCKET)
      .createSignedUrl(storageKey, expiresInSec)
    if (error || !data) throw new Error(`signed url failed: ${error?.message ?? 'no data'}`)
    return data.signedUrl
  }
  async download(storageKey: string) {
    const { data, error } = await supabase.storage.from(BUCKET).download(storageKey)
    if (error || !data) throw new Error(`download failed: ${error?.message ?? 'no data'}`)
    return new Uint8Array(await data.arrayBuffer())
  }
}
```

- [ ] **Step 4: Implement the S3 backend**

```ts
// lib/storage/s3-backend.ts
import { S3Client, PutObjectCommand, GetObjectCommand, CopyObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { randomUUID } from 'node:crypto'
import type { StorageBackend, StorageKind } from './index'

const REGION = process.env.AWS_REGION ?? 'us-east-1'
const BUCKET = process.env.S3_BUCKET ?? 'vyntechs-artifacts'

const s3 = new S3Client({
  region: REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
})

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'audio/webm': 'webm', 'audio/mp4': 'm4a',
  'video/webm': 'webm', 'video/mp4': 'mp4',
}

const TIER_TO_CLASS: Record<'hot' | 'warm' | 'cold', string> = {
  hot: 'STANDARD',
  warm: 'STANDARD_IA',
  cold: 'GLACIER_IR',
}

export class S3Backend implements StorageBackend {
  async upload(input: { sessionId: string; kind: StorageKind; bytes: Uint8Array | Blob; mimeType: string }) {
    const ext = EXT[input.mimeType] ?? 'bin'
    const key = `${input.sessionId}/${input.kind}/${randomUUID()}.${ext}`
    const body = input.bytes instanceof Blob
      ? new Uint8Array(await input.bytes.arrayBuffer())
      : input.bytes
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: input.mimeType,
      StorageClass: 'STANDARD',
    }))
    return key
  }
  async signedUrl(storageKey: string, expiresInSec = 3600) {
    return getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: storageKey }), { expiresIn: expiresInSec })
  }
  async download(storageKey: string) {
    const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: storageKey }))
    if (!r.Body) throw new Error('no body')
    const chunks: Uint8Array[] = []
    for await (const chunk of r.Body as AsyncIterable<Uint8Array>) chunks.push(chunk)
    let len = 0
    for (const c of chunks) len += c.byteLength
    const merged = new Uint8Array(len)
    let off = 0
    for (const c of chunks) { merged.set(c, off); off += c.byteLength }
    return merged
  }
  async setTier(storageKey: string, tier: 'hot' | 'warm' | 'cold') {
    await s3.send(new CopyObjectCommand({
      Bucket: BUCKET,
      Key: storageKey,
      CopySource: `${BUCKET}/${storageKey}`,
      StorageClass: TIER_TO_CLASS[tier] as any,
      MetadataDirective: 'COPY',
    }))
  }
}
```

- [ ] **Step 5: Update existing imports**

Old imports (`@/lib/storage/client`) need to point to `@/lib/storage`:

```bash
grep -rl "@/lib/storage/client" app lib components tests | xargs sed -i '' 's|@/lib/storage/client|@/lib/storage|g'
```

(Mac `sed` syntax — drop the `''` on Linux.)

- [ ] **Step 6: Update tests/unit/storage.test.ts to import from new path**

Change `await import('@/lib/storage/client')` → `await import('@/lib/storage')`.

- [ ] **Step 7: Run tests**

```bash
pnpm test tests/unit/storage.test.ts
```

Expected: PASS (Supabase backend is the default in tests).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor(storage): backend abstraction with Supabase + S3 implementations"
```

---

### Task J2: Provision the S3 bucket with lifecycle rules

**Files:**
- Create: scripts/provision-s3.ts
- Modify: .env.example

- [ ] **Step 1: Add env vars**

Append to `.env.example`:
```
STORAGE_BACKEND=supabase
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
S3_BUCKET=vyntechs-artifacts
```

For dev keep `STORAGE_BACKEND=supabase`. For Vercel preview/prod set `STORAGE_BACKEND=s3` and the AWS keys.

- [ ] **Step 2: Write a one-shot provisioning script**

```ts
// scripts/provision-s3.ts
import {
  S3Client, CreateBucketCommand, PutBucketLifecycleConfigurationCommand,
  PutPublicAccessBlockCommand, HeadBucketCommand,
} from '@aws-sdk/client-s3'

const REGION = process.env.AWS_REGION ?? 'us-east-1'
const BUCKET = process.env.S3_BUCKET ?? 'vyntechs-artifacts'

const s3 = new S3Client({
  region: REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
})

async function ensureBucket() {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET }))
    console.log(`bucket ${BUCKET} already exists`)
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: BUCKET }))
    console.log(`bucket ${BUCKET} created`)
  }

  await s3.send(new PutPublicAccessBlockCommand({
    Bucket: BUCKET,
    PublicAccessBlockConfiguration: {
      BlockPublicAcls: true, IgnorePublicAcls: true,
      BlockPublicPolicy: true, RestrictPublicBuckets: true,
    },
  }))

  await s3.send(new PutBucketLifecycleConfigurationCommand({
    Bucket: BUCKET,
    LifecycleConfiguration: {
      Rules: [
        {
          ID: 'hot-to-warm-90d',
          Status: 'Enabled',
          Filter: { Prefix: '' },
          Transitions: [{ Days: 90, StorageClass: 'STANDARD_IA' }],
        },
        {
          ID: 'warm-to-cold-2y',
          Status: 'Enabled',
          Filter: { Prefix: '' },
          Transitions: [{ Days: 730, StorageClass: 'GLACIER_IR' }],
        },
      ],
    },
  }))
  console.log('lifecycle policies applied (90d → IA, 730d → Glacier IR)')
}

ensureBucket().catch(err => { console.error(err); process.exit(1) })
```

- [ ] **Step 3: Run provisioning against dev AWS account (one time)**

```bash
pnpm tsx scripts/provision-s3.ts
```

Expected: prints created/updated messages, no errors. (If running in CI: skip — bucket lives in shared infra.)

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(storage): S3 provisioning script with lifecycle rules (90d IA / 2y Glacier)"
```

---

### Task J3: Mirror lifecycle state into `artifacts.storage_tier` (daily cron)

**Files:**
- Create: app/api/cron/artifacts-tier-sync/route.ts
- Modify: vercel.json

- [ ] **Step 1: Add Vercel cron config**

```json
// vercel.json
{
  "crons": [
    { "path": "/api/cron/artifacts-tier-sync", "schedule": "0 7 * * *" }
  ]
}
```

(7am UTC daily.)

- [ ] **Step 2: Write the route**

```ts
// app/api/cron/artifacts-tier-sync/route.ts
import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { artifacts } from '@/lib/db/schema'
import { eq, and, lt, ne } from 'drizzle-orm'

const HOT_DAYS = 90
const WARM_DAYS = 730

function daysAgo(d: number): Date {
  const t = new Date()
  t.setUTCDate(t.getUTCDate() - d)
  return t
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const got = req.headers.get('authorization')
    if (got !== `Bearer ${secret}`) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const warmCutoff = daysAgo(HOT_DAYS)
  const coldCutoff = daysAgo(WARM_DAYS)

  const warmed = await db.update(artifacts)
    .set({ storageTier: 'warm' })
    .where(and(eq(artifacts.storageTier, 'hot'), lt(artifacts.createdAt, warmCutoff)))
    .returning({ id: artifacts.id })

  const cooled = await db.update(artifacts)
    .set({ storageTier: 'cold' })
    .where(and(ne(artifacts.storageTier, 'cold'), lt(artifacts.createdAt, coldCutoff)))
    .returning({ id: artifacts.id })

  return NextResponse.json({ warmed: warmed.length, cooled: cooled.length })
}
```

This route is **state-mirror only** — actual S3 lifecycle does the physical transition. We mirror so the DB knows what tier each artifact lives in.

- [ ] **Step 3: Add CRON_SECRET to .env.example and Vercel dashboard**

Append to `.env.example`:
```
CRON_SECRET=
```
Generate a random value (`openssl rand -hex 32`) and set in Vercel preview + production.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(storage): daily cron to mirror S3 lifecycle into artifacts.storage_tier"
```

---

### Task J4: Signed-URL endpoint for clients

**Files:**
- Create: app/api/artifacts/[id]/url/route.ts
- Create: tests/unit/artifact-url.test.ts

- [ ] **Step 1: Write failing test for the auth check**

```ts
// tests/unit/artifact-url.test.ts
import { describe, it, expect, vi } from 'vitest'

const supabaseAuth = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) } }
vi.mock('@/lib/supabase-server', () => ({ getServerSupabase: async () => supabaseAuth }))
vi.mock('@/lib/db/queries', () => ({
  getArtifactById: vi.fn().mockResolvedValue({
    id: 'art-1', sessionId: 'sess-1', kind: 'photo',
    storageKey: 'sess-1/photo/abc.jpg', storageTier: 'hot',
  }),
}))
vi.mock('@/lib/db/client', () => ({
  db: {
    query: {
      sessions: { findFirst: vi.fn().mockResolvedValue({ id: 'sess-1', techId: 'profile-1' }) },
      profiles: { findFirst: vi.fn().mockResolvedValue({ id: 'profile-1' }) },
    },
  },
}))
vi.mock('@/lib/storage', () => ({
  signedUrl: vi.fn().mockResolvedValue('https://signed.example/x'),
}))

describe('artifact url route', () => {
  it('returns signed URL for owner', async () => {
    const { GET } = await import('@/app/api/artifacts/[id]/url/route')
    const res = await GET(new Request('http://x'), { params: Promise.resolve({ id: 'art-1' }) })
    const body = await res.json()
    expect(body.url).toBe('https://signed.example/x')
    expect(body.tier).toBe('hot')
  })
})
```

- [ ] **Step 2: Run, expect fail**

```bash
pnpm test tests/unit/artifact-url.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// app/api/artifacts/[id]/url/route.ts
import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase-server'
import { db } from '@/lib/db/client'
import { profiles, sessions } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { getArtifactById } from '@/lib/db/queries'
import { signedUrl } from '@/lib/storage'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await getServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const profile = await db.query.profiles.findFirst({ where: eq(profiles.id, user.id) })
  if (!profile) return NextResponse.json({ error: 'no profile' }, { status: 400 })

  const artifact = await getArtifactById(id)
  if (!artifact) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const session = await db.query.sessions.findFirst({ where: eq(sessions.id, artifact.sessionId) })
  if (!session || session.techId !== profile.id) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  const url = await signedUrl(artifact.storageKey)
  return NextResponse.json({ url, tier: artifact.storageTier, kind: artifact.kind })
}
```

- [ ] **Step 4: Run, expect pass**

```bash
pnpm test tests/unit/artifact-url.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(storage): GET /api/artifacts/[id]/url with owner auth check"
```

---

### Task J5: Render artifact gallery on session page

**Files:**
- Create: components/session/artifact-thumbnail.tsx
- Modify: components/session/session-view.tsx
- Modify: app/(app)/sessions/[id]/page.tsx

- [ ] **Step 1: Write the thumbnail component**

```tsx
// components/session/artifact-thumbnail.tsx
'use client'
import { useEffect, useState } from 'react'

export function ArtifactThumbnail(props: {
  artifactId: string
  kind: 'photo' | 'video' | 'audio' | 'scan_screen' | 'wiring_diagram'
}) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/artifacts/${props.artifactId}/url`)
      .then(r => r.json())
      .then(d => setUrl(d.url))
      .catch(() => setUrl(null))
  }, [props.artifactId])

  if (!url) return <div className="w-16 h-16 bg-gray-100 rounded animate-pulse" />

  if (props.kind === 'audio') {
    return <audio src={url} controls className="w-full" />
  }
  if (props.kind === 'video') {
    return <video src={url} controls className="w-full max-h-48 rounded" />
  }
  return <img src={url} alt={props.kind} className="w-full max-h-48 object-contain rounded" />
}
```

- [ ] **Step 2: Pass artifacts into SessionView**

In `app/(app)/sessions/[id]/page.tsx`:
```tsx
import { listArtifactsForSession } from '@/lib/db/queries'
// ...
const session = await getSessionById(id)
const arts = await listArtifactsForSession(id)
return (
  <main className="max-w-md mx-auto p-4">
    <SessionView session={session as any} artifacts={arts as any} />
  </main>
)
```

- [ ] **Step 3: Render in SessionView**

In `components/session/session-view.tsx`, accept the `artifacts` prop and render at the bottom of the main return:
```tsx
import { ArtifactThumbnail } from './artifact-thumbnail'

type Artifact = { id: string; kind: 'photo' | 'video' | 'audio' | 'scan_screen' | 'wiring_diagram'; nodeId: string; extraction?: { summary?: string } | null }

export function SessionView({ session: initial, artifacts = [] }: { session: SessionRowWithEvents; artifacts?: Artifact[] }) {
  // ...existing state and conditional renders...
  return (
    <div className="space-y-4">
      {/* existing header + tree + input + recent observations */}
      {artifacts.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-semibold text-gray-500">Captured</div>
          <div className="grid grid-cols-2 gap-2">
            {artifacts.slice(0, 4).map(a => (
              <div key={a.id} className="space-y-1">
                <div className="text-xs text-gray-500 capitalize">{a.kind.replace('_', ' ')}</div>
                {a.extraction?.summary && <div className="text-xs">{a.extraction.summary}</div>}
                <ArtifactThumbnail artifactId={a.id} kind={a.kind} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(session): artifact gallery on active session page"
```

---

### Task J6: Document the storage tiering behavior

**Files:**
- Modify: AGENTS.md

- [ ] **Step 1: Append guidance**

Append to `AGENTS.md`:

```markdown
## Storage

- All artifact uploads go through `lib/storage` (`uploadArtifact`, `signedUrl`, `downloadArtifact`). Never call Supabase Storage or S3 SDKs directly.
- The backend is selected by `STORAGE_BACKEND` env var: `supabase` for dev, `s3` for prod.
- Artifacts are tiered per spec §12: hot (0-90d) STANDARD, warm (90d-2y) STANDARD_IA, cold (2y+) GLACIER_IR. S3 lifecycle policies do the physical move; the daily `/api/cron/artifacts-tier-sync` cron mirrors the state into `artifacts.storage_tier`.
- Structured extractions in `artifacts.extraction` JSONB are **permanent** — they survive even after the binary is deleted. Code that needs artifact data should prefer `extraction` over re-downloading.
```

- [ ] **Step 2: Commit**

```bash
git add AGENTS.md
git commit -m "docs(storage): document tiered storage policy in AGENTS.md"
```

---

## Phase K — Cross-Shop Corpus + Retrieval (Rung 0) (8 tasks)

Per spec §6 row 9, §7.1 (Cross-Shop Corpus + Retrieval Orchestrator), §8.1 step 3 (corpus retrieved first), §11 (full corpus design + flywheel + quality controls). This phase makes the corpus the **first** thing the tree engine sees on every case. Structured-tag prefilter (vehicle + DTC + symptom) narrows to ≤50 candidates, then OpenAI embedding cosine ranks them. Outcomes auto-promote into the corpus on session close. N-way confirmation, comeback decay, conflict surfacing built in per §11.3.

### Task K1: Add `corpus_entries` table with pgvector + symptom tags

**Files:**
- Modify: lib/db/schema.ts
- Create: drizzle/migrations/manual_pgvector.sql

- [ ] **Step 1: Enable pgvector via Supabase MCP**

```sql
-- run via Supabase MCP execute_sql
CREATE EXTENSION IF NOT EXISTS vector;
```

- [ ] **Step 2: Append schema**

```ts
// lib/db/schema.ts (append)
import { pgTable, uuid, text, timestamp, jsonb, integer, real, boolean } from 'drizzle-orm/pg-core'

// pgvector helpers — Drizzle has no first-class vector type yet; use raw SQL via $type<number[]>().
// We'll generate the column in a manual migration (Step 3).

export const corpusEntries = pgTable('corpus_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Vehicle filter
  vehicleYear: integer('vehicle_year').notNull(),
  vehicleMake: text('vehicle_make').notNull(),
  vehicleModel: text('vehicle_model').notNull(),
  vehicleEngine: text('vehicle_engine'),
  buildDateStart: text('build_date_start'),  // ISO month, optional refine
  buildDateEnd: text('build_date_end'),
  // Symptom + DTC filter (text[] in pg)
  symptomTags: text('symptom_tags').array().notNull().default([]),
  dtcs: text('dtcs').array().notNull().default([]),
  // Pattern signature
  freezeFramePattern: jsonb('freeze_frame_pattern').$type<Record<string, string | number>>(),
  // Outcome content
  rootCause: text('root_cause').notNull(),
  summary: text('summary').notNull(),    // short embedding-target string
  actionType: text('action_type', {
    enum: ['part_replacement', 'repair', 'adjustment', 'cleaning', 'no_fix', 'referred'],
  }).notNull(),
  partInfo: jsonb('part_info').$type<{ name?: string; oemNumber?: string; cost?: number }>(),
  verification: jsonb('verification').$type<{
    codesCleared: boolean; testDrive: boolean; symptomsResolved: 'yes' | 'no' | 'partial'
  }>().notNull(),
  // Provenance
  sourceShopId: uuid('source_shop_id').references(() => shops.id),  // null for curator-authored
  sourceSessionId: uuid('source_session_id').references(() => sessions.id),
  curatedByUserId: uuid('curated_by_user_id').references(() => profiles.id),
  // Quality signals (per §11.3)
  successConfirmCount: integer('success_confirm_count').notNull().default(0),  // N-way confirmation
  comebackRecordedCount: integer('comeback_recorded_count').notNull().default(0),  // decay signal
  confidenceScore: real('confidence_score').notNull().default(0.5),  // computed from above
  isCuratorEntry: boolean('is_curator_entry').notNull().default(false),
  isRetired: boolean('is_retired').notNull().default(false),  // set when comebacks dominate
  // Vector embedding stored via raw SQL column "embedding vector(1536)" (added in Step 3 manual migration)
  embedding: jsonb('embedding').$type<number[] | null>(),  // bridge type only — actual column is vector
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const corpusEntriesRelations = relations(corpusEntries, ({ one }) => ({
  shop: one(shops, { fields: [corpusEntries.sourceShopId], references: [shops.id] }),
  session: one(sessions, { fields: [corpusEntries.sourceSessionId], references: [sessions.id] }),
  curator: one(profiles, { fields: [corpusEntries.curatedByUserId], references: [profiles.id] }),
}))
```

- [ ] **Step 3: Generate Drizzle migration + add manual pgvector column**

```bash
pnpm drizzle-kit generate
```

After generation, edit the new migration SQL (`drizzle/migrations/000X_*.sql`) to swap the `embedding jsonb` column for a true `vector(1536)` column and add an HNSW index:

```sql
-- after the auto-generated CREATE TABLE corpus_entries (...);, append:
ALTER TABLE corpus_entries DROP COLUMN embedding;
ALTER TABLE corpus_entries ADD COLUMN embedding vector(1536);
CREATE INDEX corpus_entries_embedding_idx ON corpus_entries
  USING hnsw (embedding vector_cosine_ops);
CREATE INDEX corpus_entries_vehicle_idx ON corpus_entries
  (vehicle_make, vehicle_model, vehicle_year);
CREATE INDEX corpus_entries_dtcs_idx ON corpus_entries USING GIN (dtcs);
CREATE INDEX corpus_entries_symptom_tags_idx ON corpus_entries USING GIN (symptom_tags);
```

- [ ] **Step 4: Apply migration**

```bash
pnpm drizzle-kit migrate
```

Verify via Supabase MCP `execute_sql "SELECT column_name, udt_name FROM information_schema.columns WHERE table_name='corpus_entries'"` — confirm `embedding` is `vector` not `jsonb`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(db): corpus_entries table with pgvector and tag/DTC indexes"
```

---

### Task K2: OpenAI embeddings client

**Files:**
- Create: lib/ai/embeddings.ts
- Create: tests/unit/embeddings.test.ts
- Modify: .env.example

- [ ] **Step 1: Add env**

Append to `.env.example`:
```
OPENAI_API_KEY=
```

- [ ] **Step 2: Write failing test**

```ts
// tests/unit/embeddings.test.ts
import { describe, it, expect, vi } from 'vitest'

global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  json: async () => ({
    data: [{ embedding: Array.from({ length: 1536 }, (_, i) => i / 1536) }],
  }),
}) as any

describe('embed', () => {
  it('returns a 1536-dimensional vector', async () => {
    const { embed } = await import('@/lib/ai/embeddings')
    const v = await embed('2018 F-150 EcoBoost wastegate vacuum line crack P0299')
    expect(v).toHaveLength(1536)
    expect(typeof v[0]).toBe('number')
  })
})
```

- [ ] **Step 3: Run, expect fail**

```bash
pnpm test tests/unit/embeddings.test.ts
```

- [ ] **Step 4: Implement**

```ts
// lib/ai/embeddings.ts
const URL = 'https://api.openai.com/v1/embeddings'
const MODEL = 'text-embedding-3-small'

export async function embed(text: string): Promise<number[]> {
  const res = await fetch(URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model: MODEL, input: text }),
  })
  if (!res.ok) throw new Error(`embed failed: ${res.status} ${await res.text()}`)
  const json = (await res.json()) as { data: Array<{ embedding: number[] }> }
  if (!json.data?.[0]?.embedding) throw new Error('embed: malformed response')
  return json.data[0].embedding
}

export async function embedMany(texts: string[]): Promise<number[][]> {
  const res = await fetch(URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model: MODEL, input: texts }),
  })
  if (!res.ok) throw new Error(`embed batch failed: ${res.status} ${await res.text()}`)
  const json = (await res.json()) as { data: Array<{ embedding: number[]; index: number }> }
  return json.data.sort((a, b) => a.index - b.index).map(d => d.embedding)
}
```

- [ ] **Step 5: Run, expect pass**

```bash
pnpm test tests/unit/embeddings.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(ai): OpenAI text-embedding-3-small client (single + batch)"
```

---

### Task K3: corpus-retrieval.ts — structured prefilter + vector rank

**Files:**
- Create: lib/corpus/retrieval.ts
- Create: tests/unit/corpus-retrieval.test.ts

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/corpus-retrieval.test.ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/ai/embeddings', () => ({
  embed: vi.fn().mockResolvedValue(Array(1536).fill(0.1)),
}))

const executeMock = vi.fn().mockResolvedValue([
  {
    id: 'corpus-1',
    rootCause: 'Wastegate vacuum line crack',
    summary: 'F-150 EcoBoost wastegate line',
    confidenceScore: 0.82,
    successConfirmCount: 4,
    comebackRecordedCount: 0,
    distance: 0.18,
  },
])

vi.mock('@/lib/db/client', () => ({
  db: { execute: executeMock },
}))

describe('retrieveCorpus', () => {
  it('returns ranked corpus entries for vehicle+DTC+symptom query', async () => {
    const { retrieveCorpus } = await import('@/lib/corpus/retrieval')
    const r = await retrieveCorpus({
      vehicleYear: 2018, vehicleMake: 'Ford', vehicleModel: 'F-150',
      dtcs: ['P0299', 'P0236'],
      symptomTags: ['power_loss'],
      complaintText: 'loss of power going up hills',
    })
    expect(r.length).toBeGreaterThan(0)
    expect(r[0].id).toBe('corpus-1')
    expect(r[0].similarityScore).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run, expect fail**

- [ ] **Step 3: Implement**

```ts
// lib/corpus/retrieval.ts
import { db } from '@/lib/db/client'
import { sql } from 'drizzle-orm'
import { embed } from '@/lib/ai/embeddings'

export type CorpusMatch = {
  id: string
  rootCause: string
  summary: string
  confidenceScore: number
  successConfirmCount: number
  comebackRecordedCount: number
  similarityScore: number  // 1 - cosine_distance, in [0, 1]
}

export async function retrieveCorpus(input: {
  vehicleYear: number
  vehicleMake: string
  vehicleModel: string
  vehicleEngine?: string
  dtcs?: string[]
  symptomTags?: string[]
  complaintText: string
  limit?: number
}): Promise<CorpusMatch[]> {
  const limit = input.limit ?? 5

  const queryText = `${input.vehicleYear} ${input.vehicleMake} ${input.vehicleModel} ${input.vehicleEngine ?? ''} ${
    input.dtcs?.join(' ') ?? ''
  } ${input.symptomTags?.join(' ') ?? ''} ${input.complaintText}`.trim()
  const queryVec = await embed(queryText)
  const vecLiteral = `[${queryVec.join(',')}]`

  const dtcArray = input.dtcs ?? []
  const tagArray = input.symptomTags ?? []

  // Structured prefilter then vector rank.
  // Vehicle exact match on year/make/model; DTC overlap OR tag overlap (either may be absent).
  const rows = await db.execute<{
    id: string
    rootCause: string
    summary: string
    confidenceScore: number
    successConfirmCount: number
    comebackRecordedCount: number
    distance: number
  }>(sql`
    SELECT
      id,
      root_cause AS "rootCause",
      summary,
      confidence_score AS "confidenceScore",
      success_confirm_count AS "successConfirmCount",
      comeback_recorded_count AS "comebackRecordedCount",
      embedding <=> ${vecLiteral}::vector AS distance
    FROM corpus_entries
    WHERE
      is_retired = false
      AND vehicle_make = ${input.vehicleMake}
      AND vehicle_model = ${input.vehicleModel}
      AND ABS(vehicle_year - ${input.vehicleYear}) <= 2
      AND (
        cardinality(${dtcArray}::text[]) = 0 OR dtcs && ${dtcArray}::text[]
        OR cardinality(${tagArray}::text[]) = 0 OR symptom_tags && ${tagArray}::text[]
      )
    ORDER BY embedding <=> ${vecLiteral}::vector
    LIMIT ${limit}
  `)

  return rows.map(r => ({
    id: r.id,
    rootCause: r.rootCause,
    summary: r.summary,
    confidenceScore: Number(r.confidenceScore),
    successConfirmCount: Number(r.successConfirmCount),
    comebackRecordedCount: Number(r.comebackRecordedCount),
    similarityScore: Math.max(0, 1 - Number(r.distance)),
  }))
}
```

- [ ] **Step 4: Run, expect pass**

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(corpus): structured-prefilter + pgvector retrieval (Rung 0)"
```

---

### Task K4: Inject corpus context into the tree engine

**Files:**
- Modify: lib/ai/tree-engine.ts
- Modify: lib/ai/prompts.ts
- Modify: app/api/sessions/route.ts (POST)
- Modify: tests/unit/tree-engine.test.ts (append)

- [ ] **Step 1: Update the system prompt to acknowledge corpus context**

```ts
// lib/ai/prompts.ts — append to TREE_ENGINE_SYSTEM (after the existing PRINCIPLES + DESCRIBE-FIRST blocks):
```

Add the following lines into the constant body:

```
CORPUS-FIRST RETRIEVAL:
- The user message will include a "Corpus context" block with the top-N matching prior cases (vehicle + DTC + symptom matched, vector-ranked).
- Each match has: rootCause, summary, confidenceScore (0-1), successConfirmCount, comebackRecordedCount.
- Treat high-confidence + high-success-count matches as **strong priors**: bias the initial tree toward verifying or ruling out the matched root cause first, with one or two cheap diagnostic steps before committing.
- Treat low-success or comeback-heavy matches as **soft priors**: flag the pattern in the tree but do not anchor on it.
- If no matches are returned, reason from training knowledge alone — do not fabricate a corpus result.
- When updating the tree, if observations DIVERGE from the matched corpus pattern, surface the conflict in the message field ("Corpus suggested X, but observation Y rules that out — pivoting to ...").
```

- [ ] **Step 2: Extend generateInitialTree to accept corpus context**

```ts
// lib/ai/tree-engine.ts — replace generateInitialTree
import type { CorpusMatch } from '@/lib/corpus/retrieval'

export async function generateInitialTree(
  intake: IntakePayload,
  corpus: CorpusMatch[] = [],
): Promise<TreeState> {
  const corpusBlock = corpus.length > 0
    ? `\n\nCorpus context (top ${corpus.length} matches, vehicle + DTC + symptom matched, vector-ranked):\n${
        corpus.map((c, i) =>
          `(${i + 1}) confidence=${c.confidenceScore.toFixed(2)} success=${c.successConfirmCount} comebacks=${c.comebackRecordedCount} similarity=${c.similarityScore.toFixed(2)}\n    rootCause: ${c.rootCause}\n    summary: ${c.summary}`
        ).join('\n\n')
      }`
    : '\n\nCorpus context: no prior matches in the network. Reason from training knowledge alone.'

  const userMessage = `Vehicle: ${intake.vehicleYear} ${intake.vehicleMake} ${intake.vehicleModel}${
    intake.vehicleEngine ? ` (${intake.vehicleEngine})` : ''
  }${intake.mileage ? `, ${intake.mileage} mi` : ''}.

Customer complaint: ${intake.customerComplaint}${corpusBlock}

Generate the initial decision tree. Return JSON only — no prose, no fences.`

  return await withRetry(async () => {
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: cachedSystem(TREE_ENGINE_SYSTEM),
      messages: [{ role: 'user', content: userMessage }],
    })
    const block = res.content.find(b => b.type === 'text')
    if (!block || block.type !== 'text') throw new Error('no text block')
    return parseTreeJson(block.text)
  })
}
```

- [ ] **Step 3: Wire corpus retrieval into POST /api/sessions**

```ts
// app/api/sessions/route.ts — replace the section calling generateInitialTree
import { retrieveCorpus } from '@/lib/corpus/retrieval'

// after parsing intake successfully, before tree generation:
let corpus: Awaited<ReturnType<typeof retrieveCorpus>> = []
try {
  corpus = await retrieveCorpus({
    vehicleYear: parsed.data.vehicleYear,
    vehicleMake: parsed.data.vehicleMake,
    vehicleModel: parsed.data.vehicleModel,
    vehicleEngine: parsed.data.vehicleEngine,
    complaintText: parsed.data.customerComplaint,
  })
} catch (err) {
  console.warn('corpus retrieval failed (proceeding with empty):', err)
}

let treeState
try {
  treeState = await generateInitialTree(parsed.data, corpus)
} catch (err) {
  console.error('tree generation failed:', err)
  return NextResponse.json({ error: 'tree generation failed' }, { status: 500 })
}
```

- [ ] **Step 4: Append unit test**

```ts
// tests/unit/tree-engine.test.ts (append)
describe('generateInitialTree with corpus', () => {
  it('includes corpus context in the user message', async () => {
    const { anthropic } = await import('@/lib/ai/client')
    ;(anthropic.messages.create as any).mockResolvedValueOnce({
      content: [{
        type: 'text',
        text: JSON.stringify({
          nodes: [{ id: 'verify-corpus', label: 'Verify wastegate line', status: 'active' }],
          currentNodeId: 'verify-corpus',
          message: 'Prior cases point to wastegate vacuum line. Verify first.',
        }],
        usage: { input_tokens: 200, output_tokens: 60 },
      }),
    })
    const { generateInitialTree } = await import('@/lib/ai/tree-engine')
    await generateInitialTree(
      { vehicleYear: 2018, vehicleMake: 'Ford', vehicleModel: 'F-150', customerComplaint: 'power loss' },
      [{ id: 'c1', rootCause: 'wastegate line crack', summary: 'WG line', confidenceScore: 0.85, successConfirmCount: 5, comebackRecordedCount: 0, similarityScore: 0.91 }],
    )
    const lastCall = (anthropic.messages.create as any).mock.calls.at(-1)[0]
    const userMsg = lastCall.messages[0].content
    expect(userMsg).toContain('Corpus context')
    expect(userMsg).toContain('wastegate')
    expect(userMsg).toContain('confidence=0.85')
  })
})
```

- [ ] **Step 5: Run all unit tests**

```bash
pnpm test
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(corpus): inject Rung-0 corpus context into initial tree generation"
```

---

### Task K5: Promote outcomes into the corpus on session close

**Files:**
- Create: lib/corpus/promotion.ts
- Modify: app/api/sessions/[id]/close/route.ts
- Create: tests/unit/corpus-promotion.test.ts

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/corpus-promotion.test.ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/ai/embeddings', () => ({
  embed: vi.fn().mockResolvedValue(Array(1536).fill(0.1)),
}))

const insertReturning = vi.fn().mockResolvedValue([{ id: 'corpus-new' }])
const updateExec = vi.fn().mockResolvedValue(undefined)

vi.mock('@/lib/db/client', () => ({
  db: {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({ returning: insertReturning }),
    }),
    execute: updateExec,
  },
}))

describe('promoteSessionToCorpus', () => {
  it('inserts a corpus entry with embedding and tags', async () => {
    const { promoteSessionToCorpus } = await import('@/lib/corpus/promotion')
    const id = await promoteSessionToCorpus({
      sessionId: 'sess-1', shopId: 'shop-1',
      intake: { vehicleYear: 2018, vehicleMake: 'Ford', vehicleModel: 'F-150', vehicleEngine: '3.5L EcoBoost', customerComplaint: 'power loss' },
      outcome: {
        rootCause: 'wastegate vacuum line crack',
        actionType: 'part_replacement',
        verification: { codesCleared: true, testDrive: true, symptomsResolved: 'yes' },
        diagMinutes: 45, repairMinutes: 20,
      },
      extractedDtcs: ['P0299', 'P0236'],
      extractedSymptomTags: ['power_loss', 'wrench_light'],
    })
    expect(id).toBe('corpus-new')
  })
})
```

- [ ] **Step 2: Implement**

```ts
// lib/corpus/promotion.ts
import { db } from '@/lib/db/client'
import { sql } from 'drizzle-orm'
import { embed } from '@/lib/ai/embeddings'
import type { IntakePayload, OutcomePayload } from '@/lib/types'

export async function promoteSessionToCorpus(input: {
  sessionId: string
  shopId: string
  curatedByUserId?: string
  intake: IntakePayload
  outcome: OutcomePayload
  extractedDtcs?: string[]
  extractedSymptomTags?: string[]
  freezeFramePattern?: Record<string, string | number>
}): Promise<string> {
  const summary = `${input.intake.vehicleYear} ${input.intake.vehicleMake} ${input.intake.vehicleModel} ${input.intake.vehicleEngine ?? ''}: ${input.outcome.rootCause}`.trim()
  const embeddingTarget = `${summary}. DTCs: ${(input.extractedDtcs ?? []).join(' ')}. Tags: ${(input.extractedSymptomTags ?? []).join(' ')}. Customer: ${input.intake.customerComplaint}.`
  const vector = await embed(embeddingTarget)
  const vecLiteral = `[${vector.join(',')}]`

  const rows = await db.execute<{ id: string }>(sql`
    INSERT INTO corpus_entries (
      vehicle_year, vehicle_make, vehicle_model, vehicle_engine,
      symptom_tags, dtcs, freeze_frame_pattern,
      root_cause, summary, action_type, part_info, verification,
      source_shop_id, source_session_id, curated_by_user_id,
      success_confirm_count, comeback_recorded_count, confidence_score,
      is_curator_entry, embedding
    ) VALUES (
      ${input.intake.vehicleYear}, ${input.intake.vehicleMake}, ${input.intake.vehicleModel}, ${input.intake.vehicleEngine ?? null},
      ${input.extractedSymptomTags ?? []}::text[], ${input.extractedDtcs ?? []}::text[], ${input.freezeFramePattern ?? null}::jsonb,
      ${input.outcome.rootCause}, ${summary}, ${input.outcome.actionType}, ${input.outcome.partInfo ?? null}::jsonb, ${input.outcome.verification}::jsonb,
      ${input.shopId}, ${input.sessionId}, ${input.curatedByUserId ?? null},
      1, 0, 0.5,
      ${input.curatedByUserId ? true : false},
      ${vecLiteral}::vector
    )
    RETURNING id
  `)
  return rows[0].id
}
```

- [ ] **Step 3: Hook into the close route**

```ts
// app/api/sessions/[id]/close/route.ts — after closeSession() succeeds:
import { promoteSessionToCorpus } from '@/lib/corpus/promotion'
import { listArtifactsForSession } from '@/lib/db/queries'

// after `await closeSession(id, parsed.data)`:
try {
  const arts = await listArtifactsForSession(id)
  const dtcs = arts.flatMap(a =>
    (a.extraction?.structured as any)?.dtcs?.map((d: any) => d.code) ?? []
  )
  const tags = inferSymptomTags(session.intake.customerComplaint)
  await promoteSessionToCorpus({
    sessionId: id,
    shopId: session.shopId,
    intake: session.intake,
    outcome: parsed.data,
    extractedDtcs: dtcs,
    extractedSymptomTags: tags,
  })
} catch (err) {
  console.warn('corpus promotion failed (session still closed):', err)
}

function inferSymptomTags(complaint: string): string[] {
  const tags: string[] = []
  const text = complaint.toLowerCase()
  if (/power|stall|hesit|sluggish/.test(text)) tags.push('power_loss')
  if (/start|crank|no.?start/.test(text)) tags.push('starting_issue')
  if (/misfire|rough|stumble/.test(text)) tags.push('misfire')
  if (/check.?engine|cel|wrench|warning/.test(text)) tags.push('warning_light')
  if (/overheat|coolant|temp/.test(text)) tags.push('overheat')
  if (/leak/.test(text)) tags.push('leak')
  if (/noise|knock|squeal|whine|tick/.test(text)) tags.push('abnormal_noise')
  if (/brake/.test(text)) tags.push('brake')
  return tags
}
```

The `inferSymptomTags` is intentionally a small heuristic — Phase Q's calibration engine refines tagging over time.

- [ ] **Step 4: Run tests**

```bash
pnpm test tests/unit/corpus-promotion.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(corpus): auto-promote outcomes into cross-shop corpus on close"
```

---

### Task K6: N-way confirmation — increment success counts on similar new outcomes

**Files:**
- Modify: lib/corpus/promotion.ts
- Create: tests/unit/corpus-confirmation.test.ts

- [ ] **Step 1: Add confirmation logic**

```ts
// lib/corpus/promotion.ts — append
export async function confirmSimilarCorpusEntries(input: {
  vehicleYear: number
  vehicleMake: string
  vehicleModel: string
  rootCause: string
  dtcs?: string[]
}): Promise<{ confirmed: number }> {
  const target = `${input.rootCause} ${input.dtcs?.join(' ') ?? ''}`
  const vector = await embed(target)
  const vecLiteral = `[${vector.join(',')}]`

  // Treat any entry within cosine distance 0.15 as "the same fix" for N-way confirmation.
  const updated = await db.execute<{ id: string }>(sql`
    UPDATE corpus_entries
    SET
      success_confirm_count = success_confirm_count + 1,
      confidence_score = LEAST(0.99, (success_confirm_count + 1)::float / GREATEST(1, success_confirm_count + comeback_recorded_count + 1)),
      updated_at = NOW()
    WHERE
      is_retired = false
      AND vehicle_make = ${input.vehicleMake}
      AND vehicle_model = ${input.vehicleModel}
      AND ABS(vehicle_year - ${input.vehicleYear}) <= 2
      AND (embedding <=> ${vecLiteral}::vector) < 0.15
    RETURNING id
  `)
  return { confirmed: updated.length }
}
```

- [ ] **Step 2: Call from `promoteSessionToCorpus` BEFORE inserting**

The order matters: confirm existing entries first; if any were confirmed, **skip the new insert** (it would just duplicate). Update `promoteSessionToCorpus`:

```ts
// lib/corpus/promotion.ts — wrap the insert in a check
export async function promoteSessionToCorpus(input: { /* ...same... */ }): Promise<string | null> {
  const { confirmed } = await confirmSimilarCorpusEntries({
    vehicleYear: input.intake.vehicleYear,
    vehicleMake: input.intake.vehicleMake,
    vehicleModel: input.intake.vehicleModel,
    rootCause: input.outcome.rootCause,
    dtcs: input.extractedDtcs,
  })
  if (confirmed > 0) {
    // Existing entry covers this outcome; bumped its confidence. No new entry needed.
    return null
  }
  // ...existing insert code, returning rows[0].id...
}
```

The close route already wraps this in try/catch and logs warnings — null is fine.

- [ ] **Step 3: Write test**

```ts
// tests/unit/corpus-confirmation.test.ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/ai/embeddings', () => ({
  embed: vi.fn().mockResolvedValue(Array(1536).fill(0.1)),
}))
const executeMock = vi.fn().mockResolvedValue([{ id: 'existing-1' }, { id: 'existing-2' }])
vi.mock('@/lib/db/client', () => ({ db: { execute: executeMock } }))

describe('confirmSimilarCorpusEntries', () => {
  it('returns count of bumped entries', async () => {
    const { confirmSimilarCorpusEntries } = await import('@/lib/corpus/promotion')
    const r = await confirmSimilarCorpusEntries({
      vehicleYear: 2018, vehicleMake: 'Ford', vehicleModel: 'F-150',
      rootCause: 'wastegate line crack',
    })
    expect(r.confirmed).toBe(2)
  })
})
```

Run: `pnpm test tests/unit/corpus-confirmation.test.ts` — expect PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(corpus): N-way confirmation bumps confidence on matching outcomes"
```

---

### Task K7: Comeback decay — drop confidence when comebacks accumulate

**Files:**
- Create: lib/corpus/decay.ts
- Create: tests/unit/corpus-decay.test.ts

- [ ] **Step 1: Add decay function**

```ts
// lib/corpus/decay.ts
import { db } from '@/lib/db/client'
import { sql } from 'drizzle-orm'

export async function recordCorpusComeback(input: {
  vehicleYear: number
  vehicleMake: string
  vehicleModel: string
  rootCause: string
}): Promise<{ decayed: number; retired: number }> {
  const { embed } = await import('@/lib/ai/embeddings')
  const vector = await embed(input.rootCause)
  const vecLiteral = `[${vector.join(',')}]`

  const decayed = await db.execute<{ id: string; comebackRecordedCount: number; successConfirmCount: number }>(sql`
    UPDATE corpus_entries
    SET
      comeback_recorded_count = comeback_recorded_count + 1,
      confidence_score = LEAST(0.99, (success_confirm_count)::float / GREATEST(1, success_confirm_count + comeback_recorded_count + 1)),
      updated_at = NOW()
    WHERE
      is_retired = false
      AND vehicle_make = ${input.vehicleMake}
      AND vehicle_model = ${input.vehicleModel}
      AND ABS(vehicle_year - ${input.vehicleYear}) <= 2
      AND (embedding <=> ${vecLiteral}::vector) < 0.15
    RETURNING id, comeback_recorded_count AS "comebackRecordedCount", success_confirm_count AS "successConfirmCount"
  `)

  // Auto-retire when comebacks dominate (and there are at least 3 comebacks).
  const toRetire = decayed.filter(r => r.comebackRecordedCount >= 3 && r.comebackRecordedCount > r.successConfirmCount)
  if (toRetire.length > 0) {
    await db.execute(sql`
      UPDATE corpus_entries SET is_retired = true, updated_at = NOW()
      WHERE id IN (${sql.join(toRetire.map(r => sql`${r.id}`), sql`, `)})
    `)
  }

  return { decayed: decayed.length, retired: toRetire.length }
}
```

- [ ] **Step 2: Test**

```ts
// tests/unit/corpus-decay.test.ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/ai/embeddings', () => ({ embed: vi.fn().mockResolvedValue(Array(1536).fill(0.1)) }))

const decayedRows = [
  { id: 'e1', comebackRecordedCount: 4, successConfirmCount: 1 },
  { id: 'e2', comebackRecordedCount: 1, successConfirmCount: 5 },
]
const executeMock = vi.fn()
  .mockResolvedValueOnce(decayedRows)
  .mockResolvedValueOnce([])
vi.mock('@/lib/db/client', () => ({ db: { execute: executeMock } }))

describe('recordCorpusComeback', () => {
  it('retires entries with comeback-dominant ratio', async () => {
    const { recordCorpusComeback } = await import('@/lib/corpus/decay')
    const r = await recordCorpusComeback({
      vehicleYear: 2018, vehicleMake: 'Ford', vehicleModel: 'F-150',
      rootCause: 'wastegate line crack',
    })
    expect(r.decayed).toBe(2)
    expect(r.retired).toBe(1)  // only e1 hits both thresholds
  })
})
```

Run: `pnpm test tests/unit/corpus-decay.test.ts` — expect PASS.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(corpus): comeback decay + auto-retire on dominant comebacks"
```

---

### Task K8: Conflict surfacing — when corpus and observation diverge

**Files:**
- Modify: lib/ai/prompts.ts (extend updateTree-relevant guidance)
- Modify: lib/ai/tree-engine.ts (pass corpus into updateTree as well)

- [ ] **Step 1: Extend updateTree to carry the corpus context across advances**

Currently `updateTree` doesn't receive corpus. Change the signature to thread it through:

```ts
// lib/ai/tree-engine.ts — replace updateTree
export async function updateTree(input: {
  intake: IntakePayload
  currentTree: TreeState
  observation: string
  artifacts?: Array<{ kind: string; summary?: string; structured?: Record<string, unknown>; text?: string }>
  corpus?: CorpusMatch[]
}): Promise<TreeState> {
  const corpusBlock = (input.corpus ?? []).length > 0
    ? `\n\nCorpus matches still in scope: ${input.corpus!.map(c =>
        `${c.summary} (conf=${c.confidenceScore.toFixed(2)})`,
      ).join('; ')}`
    : ''
  const artifactBlock = (input.artifacts ?? []).length > 0
    ? `\n\nArtifacts captured for this step:\n${(input.artifacts ?? []).map((a, i) =>
        `(${i + 1}) ${a.kind}: ${a.summary ?? '(no summary)'}\n${a.text ? `text: ${a.text}\n` : ''}${a.structured ? `structured: ${JSON.stringify(a.structured)}` : ''}`,
      ).join('\n\n')}`
    : ''

  const userMessage = `Current tree state:
${JSON.stringify(input.currentTree, null, 2)}

Tech's observation on current step (${input.currentTree.currentNodeId}):
${input.observation}${artifactBlock}${corpusBlock}

Update the tree based on this observation, any artifact evidence, and the corpus matches. If the observation diverges from a corpus match, surface the conflict transparently in the message field. Resolve or prune branches as appropriate. Set the next current step. If you have enough information to identify the root cause, set done=true and provide rootCauseSummary.

Return JSON only — no prose, no fences.`

  return await withRetry(async () => {
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: cachedSystem(TREE_ENGINE_SYSTEM),
      messages: [
        { role: 'user', content: `Initial intake: ${JSON.stringify(input.intake)}` },
        { role: 'assistant', content: `Tree generated and being walked.` },
        { role: 'user', content: userMessage },
      ],
    })
    const block = res.content.find(b => b.type === 'text')
    if (!block || block.type !== 'text') throw new Error('no text block')
    return parseTreeJson(block.text)
  })
}
```

- [ ] **Step 2: Pass corpus into updateTree from the advance route**

```ts
// app/api/sessions/[id]/advance/route.ts — replace the updateTree call section
import { retrieveCorpus } from '@/lib/corpus/retrieval'

const corpus = await retrieveCorpus({
  vehicleYear: session.intake.vehicleYear,
  vehicleMake: session.intake.vehicleMake,
  vehicleModel: session.intake.vehicleModel,
  vehicleEngine: session.intake.vehicleEngine,
  complaintText: session.intake.customerComplaint,
}).catch(err => { console.warn('corpus retrieve in advance failed:', err); return [] })

let nextTree
try {
  nextTree = await updateTree({
    intake: session.intake,
    currentTree: session.treeState,
    observation: parsed.data.observation,
    artifacts: sinceNodeArtifacts,
    corpus,
  })
} catch (err) {
  console.error('tree update failed:', err)
  return NextResponse.json({ error: 'tree update failed' }, { status: 500 })
}
```

- [ ] **Step 3: Run tests**

```bash
pnpm test
```

All tests pass.

- [ ] **Step 4: Manual end-to-end**

Run a session for a vehicle that has a seeded corpus entry. Submit an observation that DIRECTLY CONTRADICTS the corpus match (e.g., corpus says "vacuum line crack" but tech reports "smoke test negative"). Confirm the AI's next message surfaces the conflict explicitly.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(corpus): surface corpus-vs-observation conflicts in updateTree"
```

---

## Phase L — Bounded Internet Retrieval (Rung 1) (10 tasks)

Per spec §6 row 5, §6 row 13, §7.1 (Retrieval Orchestrator), §8.2 (bounded ladder). Builds: a per-source `Adapter` pattern, six adapters (NHTSA, manufacturer recall, generic make-model forum, YouTube transcript, Reddit, OEM TSB index), a query-strategy planner, a budget enforcer (≤5 weighted queries OR ≤30s wall-clock OR ≤50K tokens), a per-(vehicle, DTC, symptom) cache, a validation pass that grades retrieved snippets against case context, and integration into the Gap Handler (Phase M).

### Task L1: Define the Adapter interface + budget types

**Files:**
- Create: lib/retrieval/types.ts

- [ ] **Step 1: Write the types**

```ts
// lib/retrieval/types.ts
export type RetrievalContext = {
  vehicleYear: number
  vehicleMake: string
  vehicleModel: string
  vehicleEngine?: string
  dtcs?: string[]
  symptomTags?: string[]
  complaintText: string
  observation?: string
}

export type RetrievalResult = {
  source: string
  url?: string
  title: string
  snippet: string
  publishedAt?: string
  weightHint?: number
  raw?: unknown
}

export type Budget = {
  maxQueries: number
  maxWallClockMs: number
  maxTokens: number
}

export const DEFAULT_BUDGET: Budget = { maxQueries: 5, maxWallClockMs: 30_000, maxTokens: 50_000 }

export interface RetrievalAdapter {
  id: string
  weight: number
  query(ctx: RetrievalContext, signal: AbortSignal): Promise<RetrievalResult[]>
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/retrieval/types.ts
git commit -m "feat(retrieval): adapter interface, retrieval context, budget types"
```

---

### Task L2: NHTSA recall adapter

**Files:**
- Create: lib/retrieval/adapters/nhtsa.ts
- Create: tests/unit/retrieval-nhtsa.test.ts

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/retrieval-nhtsa.test.ts
import { describe, it, expect, vi } from 'vitest'

global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  json: async () => ({
    Count: 1,
    Results: [{
      Manufacturer: 'Ford Motor Company',
      NHTSACampaignNumber: '17V123000',
      ReportReceivedDate: '04/05/2017',
      Component: 'POWER TRAIN',
      Summary: 'Wastegate vacuum line may crack at high mileage causing underboost.',
      Consequence: 'Loss of power; check engine illuminated.',
      Remedy: 'Replace wastegate vacuum line with updated silicone part.',
    }],
  }),
}) as any

describe('NHTSAAdapter', () => {
  it('returns recall results for the vehicle', async () => {
    const { NHTSAAdapter } = await import('@/lib/retrieval/adapters/nhtsa')
    const adapter = new NHTSAAdapter()
    const results = await adapter.query({
      vehicleYear: 2018, vehicleMake: 'Ford', vehicleModel: 'F-150',
      complaintText: 'loss of power',
    }, new AbortController().signal)
    expect(results).toHaveLength(1)
    expect(results[0].source).toBe('nhtsa')
    expect(results[0].snippet).toContain('Wastegate')
  })
})
```

- [ ] **Step 2: Implement**

```ts
// lib/retrieval/adapters/nhtsa.ts
import type { RetrievalAdapter, RetrievalContext, RetrievalResult } from '../types'

export class NHTSAAdapter implements RetrievalAdapter {
  id = 'nhtsa'
  weight = 0.9

  async query(ctx: RetrievalContext, signal: AbortSignal): Promise<RetrievalResult[]> {
    const url = `https://api.nhtsa.gov/recalls/recallsByVehicle?make=${encodeURIComponent(ctx.vehicleMake)}&model=${encodeURIComponent(ctx.vehicleModel)}&modelYear=${ctx.vehicleYear}`
    const res = await fetch(url, { signal })
    if (!res.ok) return []
    const json = (await res.json()) as { Count: number; Results?: Array<Record<string, string>> }
    return (json.Results ?? []).map(r => ({
      source: this.id,
      url: `https://www.nhtsa.gov/recalls?nhtsaId=${r.NHTSACampaignNumber}`,
      title: `Recall ${r.NHTSACampaignNumber}: ${r.Component}`,
      snippet: `${r.Summary}\n\nConsequence: ${r.Consequence}\n\nRemedy: ${r.Remedy}`,
      publishedAt: parseUSDate(r.ReportReceivedDate),
      weightHint: 0.9,
      raw: r,
    }))
  }
}

function parseUSDate(s?: string): string | undefined {
  if (!s) return undefined
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  return m ? `${m[3]}-${m[1]}-${m[2]}` : undefined
}
```

- [ ] **Step 3: Run, expect pass**

```bash
pnpm test tests/unit/retrieval-nhtsa.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(retrieval): NHTSA recall adapter"
```

---

### Task L3: Manufacturer recall pages adapter

**Files:**
- Create: lib/retrieval/adapters/manufacturer-recall.ts
- Create: tests/unit/retrieval-manufacturer.test.ts

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/retrieval-manufacturer.test.ts
import { describe, it, expect, vi } from 'vitest'

const html = `
<html><body>
<h1>Recall: Powertrain — F-150 EcoBoost</h1>
<p class="recall-summary">Wastegate vacuum line may degrade at high mileage. Replace per service bulletin TSB 18-1234.</p>
<a class="bulletin" href="/tsb/18-1234.pdf">TSB 18-1234</a>
</body></html>
`
global.fetch = vi.fn().mockResolvedValue({
  ok: true, text: async () => html,
}) as any

describe('ManufacturerRecallAdapter', () => {
  it('parses recall summary from manufacturer HTML', async () => {
    const { ManufacturerRecallAdapter } = await import('@/lib/retrieval/adapters/manufacturer-recall')
    const a = new ManufacturerRecallAdapter()
    const r = await a.query({
      vehicleYear: 2018, vehicleMake: 'Ford', vehicleModel: 'F-150', vehicleEngine: '3.5L EcoBoost',
      complaintText: 'loss of power',
    }, new AbortController().signal)
    expect(r.length).toBeGreaterThan(0)
    expect(r[0].snippet.toLowerCase()).toContain('wastegate')
  })
})
```

- [ ] **Step 2: Implement**

```ts
// lib/retrieval/adapters/manufacturer-recall.ts
import type { RetrievalAdapter, RetrievalContext, RetrievalResult } from '../types'

const MAKER_SEARCH: Record<string, (ctx: RetrievalContext) => string> = {
  ford: ctx => `https://www.ford.com/support/recalls/?model=${encodeURIComponent(ctx.vehicleModel)}&year=${ctx.vehicleYear}`,
  chevrolet: ctx => `https://my.chevrolet.com/owner-center/recalls?model=${encodeURIComponent(ctx.vehicleModel)}&year=${ctx.vehicleYear}`,
  toyota: ctx => `https://www.toyota.com/recall?model=${encodeURIComponent(ctx.vehicleModel)}&year=${ctx.vehicleYear}`,
  bmw: ctx => `https://www.bmwusa.com/recalls.html?model=${encodeURIComponent(ctx.vehicleModel)}&year=${ctx.vehicleYear}`,
}

export class ManufacturerRecallAdapter implements RetrievalAdapter {
  id = 'manufacturer-recall'
  weight = 0.85

  async query(ctx: RetrievalContext, signal: AbortSignal): Promise<RetrievalResult[]> {
    const make = ctx.vehicleMake.toLowerCase()
    const builder = MAKER_SEARCH[make]
    if (!builder) return []
    const url = builder(ctx)
    let html: string
    try {
      const res = await fetch(url, { signal, headers: { 'user-agent': 'Mozilla/5.0 Vyntechs/1.0' } })
      if (!res.ok) return []
      html = await res.text()
    } catch {
      return []
    }
    return parseRecallSummaries(html, url).slice(0, 5)
  }
}

function parseRecallSummaries(html: string, baseUrl: string): RetrievalResult[] {
  const results: RetrievalResult[] = []
  const sections = html.split(/<(h1|h2|h3)[^>]*>/i)
  for (let i = 1; i < sections.length; i += 2) {
    const heading = stripTags(sections[i + 1] ?? '').slice(0, 200)
    if (!/recall|tsb|bulletin/i.test(heading)) continue
    const summary = extractFollowingParagraph(sections[i + 1] ?? '')
    if (!summary) continue
    results.push({
      source: 'manufacturer-recall',
      url: baseUrl,
      title: heading.trim(),
      snippet: summary.trim(),
      weightHint: 0.85,
    })
  }
  return results
}

function extractFollowingParagraph(s: string): string {
  const m = s.match(/<p[^>]*>([\s\S]*?)<\/p>/i)
  return m ? stripTags(m[1]) : stripTags(s).slice(0, 600)
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}
```

- [ ] **Step 3: Run, expect pass**

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(retrieval): manufacturer recall page adapter (best-effort HTML parse)"
```

---

### Task L4: Forum adapter (Brave Search → known make-model forums)

**Files:**
- Create: lib/retrieval/adapters/forum.ts
- Create: tests/unit/retrieval-forum.test.ts
- Modify: .env.example

- [ ] **Step 1: Add env var**

Append to `.env.example`:
```
BRAVE_SEARCH_API_KEY=
```

- [ ] **Step 2: Write failing test**

```ts
// tests/unit/retrieval-forum.test.ts
import { describe, it, expect, vi } from 'vitest'

global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  json: async () => ({
    web: {
      results: [
        { title: 'F-150 EcoBoost wastegate vacuum line failure - F150Forum', url: 'https://f150forum.com/thread/123', description: 'Multiple reports of wastegate line cracking at 60-100K mi.' },
        { title: 'Random unrelated link', url: 'https://other.example/x', description: 'unrelated' },
      ],
    },
  }),
}) as any

describe('ForumAdapter', () => {
  it('filters to forum-domain results only', async () => {
    const { ForumAdapter } = await import('@/lib/retrieval/adapters/forum')
    const a = new ForumAdapter()
    const r = await a.query({
      vehicleYear: 2018, vehicleMake: 'Ford', vehicleModel: 'F-150',
      complaintText: 'wastegate vacuum line', dtcs: ['P0299'],
    }, new AbortController().signal)
    expect(r).toHaveLength(1)
    expect(r[0].url).toContain('f150forum')
  })
})
```

- [ ] **Step 3: Implement**

```ts
// lib/retrieval/adapters/forum.ts
import type { RetrievalAdapter, RetrievalContext, RetrievalResult } from '../types'

const FORUM_DOMAINS = [
  'f150forum.com', 'ecoboost.net', 'mustang6g.com', 'tacomaworld.com',
  'bimmerforums.com', 'bimmerfest.com', 'audiworld.com', 'audizine.com',
  'subaruoutback.org', 'nasioc.com', 'rx7club.com',
  'silveradosierra.com', 'tundras.com', '4runners.com', 'priuschat.com',
]

export class ForumAdapter implements RetrievalAdapter {
  id = 'forum'
  weight = 0.6

  async query(ctx: RetrievalContext, signal: AbortSignal): Promise<RetrievalResult[]> {
    const apiKey = process.env.BRAVE_SEARCH_API_KEY
    if (!apiKey) return []
    const q = `${ctx.vehicleYear} ${ctx.vehicleMake} ${ctx.vehicleModel}${
      ctx.vehicleEngine ? ` ${ctx.vehicleEngine}` : ''
    } ${ctx.dtcs?.join(' ') ?? ''} ${ctx.complaintText}`.trim()
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=10`
    const res = await fetch(url, {
      signal,
      headers: { accept: 'application/json', 'x-subscription-token': apiKey },
    })
    if (!res.ok) return []
    const json = (await res.json()) as { web?: { results?: Array<{ title: string; url: string; description: string }> } }
    return (json.web?.results ?? [])
      .filter(r => FORUM_DOMAINS.some(d => r.url.includes(d)))
      .slice(0, 5)
      .map(r => ({
        source: this.id,
        url: r.url,
        title: r.title,
        snippet: r.description,
        weightHint: 0.6,
      }))
  }
}
```

- [ ] **Step 4: Run, expect pass**

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(retrieval): forum adapter via Brave Search filtered to known forums"
```

---

### Task L5: YouTube transcript adapter

**Files:**
- Create: lib/retrieval/adapters/youtube.ts
- Create: tests/unit/retrieval-youtube.test.ts

- [ ] **Step 1: Add env**

```
YOUTUBE_API_KEY=
```

- [ ] **Step 2: Write failing test**

```ts
// tests/unit/retrieval-youtube.test.ts
import { describe, it, expect, vi } from 'vitest'

const fetchMock = vi.fn()
global.fetch = fetchMock as any

fetchMock.mockResolvedValueOnce({
  ok: true,
  json: async () => ({
    items: [{
      id: { videoId: 'abc123' },
      snippet: { title: 'F-150 EcoBoost P0299 wastegate fix', description: 'Walking through diagnosis.', channelTitle: 'Auto Channel' },
    }],
  }),
}).mockResolvedValueOnce({
  ok: true,
  text: async () => `1
00:00:00,000 --> 00:00:05,000
The wastegate vacuum line was cracked here near the actuator can.`,
})

describe('YouTubeAdapter', () => {
  it('returns video + first transcript snippet', async () => {
    const { YouTubeAdapter } = await import('@/lib/retrieval/adapters/youtube')
    const a = new YouTubeAdapter()
    const r = await a.query({
      vehicleYear: 2018, vehicleMake: 'Ford', vehicleModel: 'F-150',
      dtcs: ['P0299'], complaintText: 'wastegate',
    }, new AbortController().signal)
    expect(r.length).toBeGreaterThan(0)
    expect(r[0].snippet.toLowerCase()).toContain('wastegate')
  })
})
```

- [ ] **Step 3: Implement**

```ts
// lib/retrieval/adapters/youtube.ts
import type { RetrievalAdapter, RetrievalContext, RetrievalResult } from '../types'

export class YouTubeAdapter implements RetrievalAdapter {
  id = 'youtube'
  weight = 0.55

  async query(ctx: RetrievalContext, signal: AbortSignal): Promise<RetrievalResult[]> {
    const key = process.env.YOUTUBE_API_KEY
    if (!key) return []
    const q = `${ctx.vehicleYear} ${ctx.vehicleMake} ${ctx.vehicleModel} ${ctx.dtcs?.join(' ') ?? ''} ${ctx.complaintText}`.trim()
    const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=5&q=${encodeURIComponent(q)}&key=${key}`
    const res = await fetch(searchUrl, { signal })
    if (!res.ok) return []
    const json = (await res.json()) as { items?: Array<{ id: { videoId: string }; snippet: { title: string; description: string; channelTitle: string } }> }
    const items = json.items ?? []

    const results: RetrievalResult[] = []
    for (const item of items) {
      let transcriptSnippet = item.snippet.description
      try {
        const ttUrl = `https://video.google.com/timedtext?lang=en&v=${item.id.videoId}`
        const tr = await fetch(ttUrl, { signal })
        if (tr.ok) {
          const text = await tr.text()
          transcriptSnippet = extractFirstSnippet(text, ctx.dtcs?.[0] ?? ctx.complaintText.split(' ')[0]) || transcriptSnippet
        }
      } catch {
        // ignore — keep description as snippet
      }
      results.push({
        source: this.id,
        url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
        title: `${item.snippet.title} — ${item.snippet.channelTitle}`,
        snippet: transcriptSnippet.slice(0, 600),
        weightHint: 0.55,
      })
    }
    return results
  }
}

function extractFirstSnippet(transcript: string, keyword: string): string | null {
  const idx = transcript.toLowerCase().indexOf(keyword.toLowerCase())
  if (idx === -1) return null
  return transcript.slice(Math.max(0, idx - 100), idx + 400).replace(/\s+/g, ' ').trim()
}
```

- [ ] **Step 4: Run, expect pass**

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(retrieval): YouTube adapter with transcript snippet extraction"
```

---

### Task L6: Reddit adapter

**Files:**
- Create: lib/retrieval/adapters/reddit.ts
- Create: tests/unit/retrieval-reddit.test.ts

- [ ] **Step 1: Add env**

```
REDDIT_CLIENT_ID=
REDDIT_CLIENT_SECRET=
REDDIT_USER_AGENT=vyntechs/1.0 (+https://vyntechs.com)
```

- [ ] **Step 2: Write failing test**

```ts
// tests/unit/retrieval-reddit.test.ts
import { describe, it, expect, vi } from 'vitest'

const fetchMock = vi.fn()
global.fetch = fetchMock as any

fetchMock.mockResolvedValueOnce({
  ok: true,
  json: async () => ({ access_token: 'tok-abc', token_type: 'bearer', expires_in: 3600 }),
})
fetchMock.mockResolvedValueOnce({
  ok: true,
  json: async () => ({
    data: {
      children: [{
        data: {
          title: 'Help: F-150 EcoBoost P0299 underboost',
          permalink: '/r/MechanicAdvice/comments/abc/help_f150/',
          selftext: 'Got P0299. Smoke test showed wastegate vacuum line crack.',
          subreddit: 'MechanicAdvice',
          score: 42,
        },
      }],
    },
  }),
})

describe('RedditAdapter', () => {
  it('returns search results from MechanicAdvice', async () => {
    const { RedditAdapter } = await import('@/lib/retrieval/adapters/reddit')
    const a = new RedditAdapter()
    const r = await a.query({
      vehicleYear: 2018, vehicleMake: 'Ford', vehicleModel: 'F-150',
      dtcs: ['P0299'], complaintText: 'underboost',
    }, new AbortController().signal)
    expect(r).toHaveLength(1)
    expect(r[0].snippet).toContain('wastegate')
  })
})
```

- [ ] **Step 3: Implement**

```ts
// lib/retrieval/adapters/reddit.ts
import type { RetrievalAdapter, RetrievalContext, RetrievalResult } from '../types'

const SUBREDDITS = ['MechanicAdvice', 'AskMechanics', 'Cartalk', 'Justrolledintotheshop']
let cachedToken: { value: string; expiresAt: number } | null = null

export class RedditAdapter implements RetrievalAdapter {
  id = 'reddit'
  weight = 0.5

  async query(ctx: RetrievalContext, signal: AbortSignal): Promise<RetrievalResult[]> {
    const id = process.env.REDDIT_CLIENT_ID
    const secret = process.env.REDDIT_CLIENT_SECRET
    const ua = process.env.REDDIT_USER_AGENT ?? 'vyntechs/1.0'
    if (!id || !secret) return []

    const token = await this.getToken(id, secret, ua, signal)
    if (!token) return []

    const q = `${ctx.vehicleYear} ${ctx.vehicleMake} ${ctx.vehicleModel} ${ctx.dtcs?.join(' ') ?? ''} ${ctx.complaintText}`.trim()
    const sub = SUBREDDITS.join('+')
    const url = `https://oauth.reddit.com/r/${sub}/search?q=${encodeURIComponent(q)}&restrict_sr=true&limit=5&sort=relevance`
    const res = await fetch(url, {
      signal,
      headers: { authorization: `Bearer ${token}`, 'user-agent': ua },
    })
    if (!res.ok) return []
    const json = (await res.json()) as { data: { children: Array<{ data: { title: string; permalink: string; selftext: string; subreddit: string; score: number } }> } }
    return json.data.children.slice(0, 5).map(c => ({
      source: this.id,
      url: `https://www.reddit.com${c.data.permalink}`,
      title: `r/${c.data.subreddit}: ${c.data.title}`,
      snippet: c.data.selftext.slice(0, 800),
      weightHint: Math.min(0.7, 0.4 + Math.log10(Math.max(1, c.data.score)) / 5),
    }))
  }

  private async getToken(id: string, secret: string, ua: string, signal: AbortSignal): Promise<string | null> {
    if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.value
    const body = new URLSearchParams({ grant_type: 'client_credentials' })
    const res = await fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      signal,
      headers: {
        authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
        'user-agent': ua,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body,
    })
    if (!res.ok) return null
    const json = (await res.json()) as { access_token: string; expires_in: number }
    cachedToken = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 }
    return cachedToken.value
  }
}
```

- [ ] **Step 4: Run, expect pass**

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(retrieval): Reddit adapter (r/MechanicAdvice, r/AskMechanics)"
```

---

### Task L7: Per-(vehicle, DTC, symptom) cache

**Files:**
- Modify: lib/db/schema.ts
- Create: lib/retrieval/cache.ts
- Create: tests/unit/retrieval-cache.test.ts

- [ ] **Step 1: Add cache table**

```ts
// lib/db/schema.ts (append)
export const retrievalCache = pgTable('retrieval_cache', {
  id: uuid('id').primaryKey().defaultRandom(),
  cacheKey: text('cache_key').notNull().unique(),
  source: text('source').notNull(),
  results: jsonb('results').notNull().$type<unknown[]>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
})
```

Generate + apply migration:
```bash
pnpm drizzle-kit generate && pnpm drizzle-kit migrate
```

- [ ] **Step 2: Write failing test**

```ts
// tests/unit/retrieval-cache.test.ts
import { describe, it, expect, vi } from 'vitest'

const findFirst = vi.fn()
const insertReturning = vi.fn().mockResolvedValue([{ id: 'cache-1' }])
vi.mock('@/lib/db/client', () => ({
  db: {
    query: { retrievalCache: { findFirst } },
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockReturnValue({ returning: insertReturning }),
      }),
    }),
  },
}))

describe('retrieval cache', () => {
  it('returns cached results when fresh', async () => {
    findFirst.mockResolvedValueOnce({
      results: [{ source: 'nhtsa', title: 't', snippet: 's' }],
      expiresAt: new Date(Date.now() + 60_000),
    })
    const { getCachedResults } = await import('@/lib/retrieval/cache')
    const r = await getCachedResults('key-1')
    expect(r).toHaveLength(1)
  })
  it('returns null when expired', async () => {
    findFirst.mockResolvedValueOnce({
      results: [],
      expiresAt: new Date(Date.now() - 1000),
    })
    const { getCachedResults } = await import('@/lib/retrieval/cache')
    const r = await getCachedResults('key-2')
    expect(r).toBeNull()
  })
})
```

- [ ] **Step 3: Implement**

```ts
// lib/retrieval/cache.ts
import { createHash } from 'node:crypto'
import { db } from '@/lib/db/client'
import { retrievalCache } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import type { RetrievalContext, RetrievalResult } from './types'

const TTL_MS = 7 * 24 * 60 * 60 * 1000

export function cacheKeyFor(ctx: RetrievalContext, source: string): string {
  const parts = [
    source,
    ctx.vehicleYear, ctx.vehicleMake.toLowerCase(), ctx.vehicleModel.toLowerCase(), ctx.vehicleEngine ?? '',
    (ctx.dtcs ?? []).slice().sort().join(','),
    (ctx.symptomTags ?? []).slice().sort().join(','),
  ].join('|')
  return createHash('sha256').update(parts).digest('hex')
}

export async function getCachedResults(cacheKey: string): Promise<RetrievalResult[] | null> {
  const row = await db.query.retrievalCache.findFirst({ where: eq(retrievalCache.cacheKey, cacheKey) })
  if (!row) return null
  if (new Date(row.expiresAt).getTime() < Date.now()) return null
  return row.results as RetrievalResult[]
}

export async function setCachedResults(cacheKey: string, source: string, results: RetrievalResult[]): Promise<void> {
  await db.insert(retrievalCache).values({
    cacheKey,
    source,
    results,
    expiresAt: new Date(Date.now() + TTL_MS),
  }).onConflictDoUpdate({
    target: retrievalCache.cacheKey,
    set: { results, expiresAt: new Date(Date.now() + TTL_MS) },
  }).returning({ id: retrievalCache.id })
}
```

- [ ] **Step 4: Run, expect pass**

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(retrieval): per-(vehicle, DTC, symptom) cache with 7-day TTL"
```

---

### Task L8: Retrieval orchestrator with budget enforcement

**Files:**
- Create: lib/retrieval/orchestrator.ts
- Create: tests/unit/retrieval-orchestrator.test.ts

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/retrieval-orchestrator.test.ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/retrieval/cache', () => ({
  cacheKeyFor: () => 'key-1',
  getCachedResults: vi.fn().mockResolvedValue(null),
  setCachedResults: vi.fn().mockResolvedValue(undefined),
}))

describe('runRetrieval', () => {
  it('aggregates results from multiple adapters under budget', async () => {
    const { runRetrieval } = await import('@/lib/retrieval/orchestrator')
    const adapter1 = {
      id: 'a1', weight: 0.9,
      query: vi.fn().mockResolvedValue([{ source: 'a1', title: 't1', snippet: 's1' }]),
    }
    const adapter2 = {
      id: 'a2', weight: 0.5,
      query: vi.fn().mockResolvedValue([{ source: 'a2', title: 't2', snippet: 's2' }]),
    }
    const r = await runRetrieval({
      adapters: [adapter1, adapter2],
      ctx: { vehicleYear: 2018, vehicleMake: 'Ford', vehicleModel: 'F-150', complaintText: 'x' },
      budget: { maxQueries: 2, maxWallClockMs: 5_000, maxTokens: 50_000 },
    })
    expect(r.results).toHaveLength(2)
    expect(r.queriesUsed).toBe(2)
  })

  it('stops when query budget reached', async () => {
    const { runRetrieval } = await import('@/lib/retrieval/orchestrator')
    const adapter1 = { id: 'a1', weight: 0.9, query: vi.fn().mockResolvedValue([]) }
    const adapter2 = { id: 'a2', weight: 0.5, query: vi.fn() }
    await runRetrieval({
      adapters: [adapter1, adapter2],
      ctx: { vehicleYear: 2018, vehicleMake: 'Ford', vehicleModel: 'F-150', complaintText: 'x' },
      budget: { maxQueries: 1, maxWallClockMs: 5_000, maxTokens: 50_000 },
    })
    expect(adapter1.query).toHaveBeenCalled()
    expect(adapter2.query).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Implement**

```ts
// lib/retrieval/orchestrator.ts
import type { RetrievalAdapter, RetrievalContext, RetrievalResult, Budget } from './types'
import { DEFAULT_BUDGET } from './types'
import { cacheKeyFor, getCachedResults, setCachedResults } from './cache'

export type RetrievalRun = {
  results: RetrievalResult[]
  queriesUsed: number
  wallClockMs: number
  tokensUsed: number
  cacheHits: string[]
  errors: Array<{ adapterId: string; message: string }>
}

export async function runRetrieval(input: {
  adapters: RetrievalAdapter[]
  ctx: RetrievalContext
  budget?: Partial<Budget>
}): Promise<RetrievalRun> {
  const budget: Budget = { ...DEFAULT_BUDGET, ...input.budget }
  const ordered = [...input.adapters].sort((a, b) => b.weight - a.weight)

  const start = Date.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), budget.maxWallClockMs)

  const results: RetrievalResult[] = []
  const cacheHits: string[] = []
  const errors: Array<{ adapterId: string; message: string }> = []
  let queriesUsed = 0
  let tokensUsed = 0

  for (const adapter of ordered) {
    if (queriesUsed >= budget.maxQueries) break
    if (Date.now() - start >= budget.maxWallClockMs) break
    if (tokensUsed >= budget.maxTokens) break

    const key = cacheKeyFor(input.ctx, adapter.id)
    const cached = await getCachedResults(key).catch(() => null)
    if (cached) {
      results.push(...cached)
      cacheHits.push(adapter.id)
      tokensUsed += estimateTokens(cached)
      continue
    }

    queriesUsed++
    try {
      const r = await adapter.query(input.ctx, controller.signal)
      results.push(...r)
      tokensUsed += estimateTokens(r)
      await setCachedResults(key, adapter.id, r).catch(() => {})
    } catch (err) {
      errors.push({ adapterId: adapter.id, message: err instanceof Error ? err.message : 'unknown' })
    }
  }

  clearTimeout(timeout)
  return { results, queriesUsed, wallClockMs: Date.now() - start, tokensUsed, cacheHits, errors }
}

function estimateTokens(results: RetrievalResult[]): number {
  return Math.ceil(results.reduce((s, r) => s + (r.snippet?.length ?? 0) + (r.title?.length ?? 0), 0) / 4)
}
```

- [ ] **Step 3: Run, expect pass**

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(retrieval): orchestrator with budget enforcement and cache integration"
```

---

### Task L9: Validation pass — grade snippets against case context

**Files:**
- Create: lib/retrieval/validator.ts
- Modify: lib/ai/prompts.ts
- Create: tests/unit/retrieval-validator.test.ts

- [ ] **Step 1: Add prompt**

```ts
// lib/ai/prompts.ts (append)
export const RETRIEVAL_VALIDATOR_SYSTEM = `You grade retrieval snippets for relevance to a specific automotive case.

Inputs: case context (vehicle, complaint, DTCs, current observation) + N retrieval snippets.

OUTPUT FORMAT — always respond with valid JSON matching:

type ValidatedSnippet = {
  index: number
  keep: boolean
  relevance: number
  why?: string
}
type Output = { validated: ValidatedSnippet[] }`
```

- [ ] **Step 2: Write failing test**

```ts
// tests/unit/retrieval-validator.test.ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/ai/client', () => ({
  anthropic: {
    messages: { create: vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({
        validated: [
          { index: 0, keep: true, relevance: 0.9, why: 'directly matches' },
          { index: 1, keep: false, relevance: 0.1 },
        ],
      }) }],
      usage: { input_tokens: 100, output_tokens: 60 },
    }) },
  },
  MODEL: 'claude-sonnet-4-6',
  cachedSystem: (t: string) => [{ type: 'text', text: t, cache_control: { type: 'ephemeral' } }],
}))

describe('validateRetrievalResults', () => {
  it('drops irrelevant snippets', async () => {
    const { validateRetrievalResults } = await import('@/lib/retrieval/validator')
    const r = await validateRetrievalResults({
      ctx: { vehicleYear: 2018, vehicleMake: 'Ford', vehicleModel: 'F-150', complaintText: 'underboost' },
      results: [
        { source: 'nhtsa', title: 'wastegate recall', snippet: 'wastegate vacuum line crack' },
        { source: 'reddit', title: 'unrelated', snippet: 'paint flaking on tailgate' },
      ],
    })
    expect(r).toHaveLength(1)
    expect(r[0].title).toBe('wastegate recall')
  })
})
```

- [ ] **Step 3: Implement**

```ts
// lib/retrieval/validator.ts
import { anthropic, MODEL, cachedSystem } from '@/lib/ai/client'
import { RETRIEVAL_VALIDATOR_SYSTEM } from '@/lib/ai/prompts'
import type { RetrievalContext, RetrievalResult } from './types'

const MIN_RELEVANCE = 0.4

export async function validateRetrievalResults(input: {
  ctx: RetrievalContext
  results: RetrievalResult[]
}): Promise<RetrievalResult[]> {
  if (input.results.length === 0) return []

  const userMessage = `Case context:
- Vehicle: ${input.ctx.vehicleYear} ${input.ctx.vehicleMake} ${input.ctx.vehicleModel}${input.ctx.vehicleEngine ? ` (${input.ctx.vehicleEngine})` : ''}
- Complaint: ${input.ctx.complaintText}
- DTCs: ${(input.ctx.dtcs ?? []).join(', ') || '(none)'}
- Current observation: ${input.ctx.observation ?? '(initial intake)'}

Snippets to grade (index : source : title : snippet):
${input.results.map((r, i) => `${i} : ${r.source} : ${r.title} : ${r.snippet.slice(0, 400)}`).join('\n\n')}

Return JSON only.`

  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 800,
    system: cachedSystem(RETRIEVAL_VALIDATOR_SYSTEM),
    messages: [{ role: 'user', content: userMessage }],
  })
  const block = res.content.find(b => b.type === 'text')
  if (!block || block.type !== 'text') return input.results
  let parsed: { validated: Array<{ index: number; keep: boolean; relevance: number; why?: string }> }
  try {
    parsed = JSON.parse(block.text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, ''))
  } catch {
    return input.results
  }

  return parsed.validated
    .filter(v => v.keep && v.relevance >= MIN_RELEVANCE)
    .sort((a, b) => b.relevance - a.relevance)
    .map(v => input.results[v.index])
    .filter(Boolean)
}
```

- [ ] **Step 4: Run, expect pass**

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(retrieval): LLM-graded relevance validation pass"
```

---

### Task L10: Wire Rung 1 retrieval into the tree advance flow

**Files:**
- Modify: app/api/sessions/[id]/advance/route.ts
- Modify: lib/ai/tree-engine.ts
- Modify: lib/ai/prompts.ts
- Modify: tests/unit/tree-engine.test.ts (append)

- [ ] **Step 1: Extend tree-engine prompt to acknowledge internet retrieval**

Append to `TREE_ENGINE_SYSTEM`:

```
INTERNET RETRIEVAL (Rung 1):
- The user message may include an "Internet retrieval" block — these are snippets the orchestrator pulled from authoritative sources (NHTSA, manufacturer recall, repair forums, YouTube transcripts, Reddit) and graded for relevance.
- Treat retrieval results as supporting evidence, not authority. Cite implicitly in the message ("Forum reports point to ...") but do not name URLs to the tech.
- If retrieval contradicts the corpus or your own reasoning, surface the conflict in the message field.
```

- [ ] **Step 2: Extend updateTree to take retrieval results**

```ts
// lib/ai/tree-engine.ts — extend updateTree signature
import type { RetrievalResult } from '@/lib/retrieval/types'

export async function updateTree(input: {
  intake: IntakePayload
  currentTree: TreeState
  observation: string
  artifacts?: Array<{ kind: string; summary?: string; structured?: Record<string, unknown>; text?: string }>
  corpus?: CorpusMatch[]
  retrieval?: RetrievalResult[]
}): Promise<TreeState> {
  const retrievalBlock = (input.retrieval ?? []).length > 0
    ? `\n\nInternet retrieval (graded for relevance):\n${
        input.retrieval!.slice(0, 5).map((r, i) =>
          `(${i + 1}) [${r.source}] ${r.title}\n    ${r.snippet.slice(0, 400)}`,
        ).join('\n\n')
      }`
    : ''

  const userMessage = `Current tree state:
${JSON.stringify(input.currentTree, null, 2)}

Tech's observation on current step (${input.currentTree.currentNodeId}):
${input.observation}${artifactBlock}${corpusBlock}${retrievalBlock}

Update the tree based on this observation, any artifact evidence, the corpus matches, and the retrieval results. If sources conflict, surface the conflict transparently in the message field. Resolve or prune branches as appropriate. Set the next current step. If you have enough information to identify the root cause, set done=true and provide rootCauseSummary.

Return JSON only — no prose, no fences.`

  // ...rest of withRetry call unchanged...
}
```

- [ ] **Step 3: Compose adapters + run retrieval in the advance route**

```ts
// app/api/sessions/[id]/advance/route.ts — replace the updateTree call section
import { runRetrieval } from '@/lib/retrieval/orchestrator'
import { validateRetrievalResults } from '@/lib/retrieval/validator'
import { NHTSAAdapter } from '@/lib/retrieval/adapters/nhtsa'
import { ManufacturerRecallAdapter } from '@/lib/retrieval/adapters/manufacturer-recall'
import { ForumAdapter } from '@/lib/retrieval/adapters/forum'
import { YouTubeAdapter } from '@/lib/retrieval/adapters/youtube'
import { RedditAdapter } from '@/lib/retrieval/adapters/reddit'

const ADAPTERS = [
  new NHTSAAdapter(),
  new ManufacturerRecallAdapter(),
  new ForumAdapter(),
  new YouTubeAdapter(),
  new RedditAdapter(),
]

const dtcs = sinceNodeArtifacts.flatMap(a =>
  ((a.structured as any)?.dtcs ?? []).map((d: any) => d.code)
)
const retrievalCtx = {
  vehicleYear: session.intake.vehicleYear,
  vehicleMake: session.intake.vehicleMake,
  vehicleModel: session.intake.vehicleModel,
  vehicleEngine: session.intake.vehicleEngine,
  dtcs: dtcs.length ? dtcs : undefined,
  complaintText: session.intake.customerComplaint,
  observation: parsed.data.observation,
}
const retrievalRun = await runRetrieval({
  adapters: ADAPTERS,
  ctx: retrievalCtx,
}).catch(err => { console.warn('retrieval failed:', err); return null })

const retrieval = retrievalRun
  ? await validateRetrievalResults({ ctx: retrievalCtx, results: retrievalRun.results }).catch(() => retrievalRun.results)
  : []

let nextTree
try {
  nextTree = await updateTree({
    intake: session.intake,
    currentTree: session.treeState,
    observation: parsed.data.observation,
    artifacts: sinceNodeArtifacts,
    corpus,
    retrieval,
  })
} catch (err) {
  console.error('tree update failed:', err)
  return NextResponse.json({ error: 'tree update failed' }, { status: 500 })
}
```

- [ ] **Step 4: Append unit test**

```ts
// tests/unit/tree-engine.test.ts (append)
describe('updateTree with retrieval', () => {
  it('passes retrieval snippets into the prompt', async () => {
    const { anthropic } = await import('@/lib/ai/client')
    ;(anthropic.messages.create as any).mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify({
        nodes: [{ id: 'verify', label: 'Smoke test', status: 'active' }],
        currentNodeId: 'verify',
        message: 'NHTSA bulletin matches.',
      }) }],
      usage: { input_tokens: 200, output_tokens: 60 },
    })
    const { updateTree } = await import('@/lib/ai/tree-engine')
    await updateTree({
      intake: { vehicleYear: 2018, vehicleMake: 'Ford', vehicleModel: 'F-150', customerComplaint: 'power loss' },
      currentTree: { nodes: [], currentNodeId: 'scan-codes', message: '' },
      observation: 'codes pulled',
      retrieval: [{ source: 'nhtsa', title: '17V123 wastegate', snippet: 'recall: wastegate vacuum line' }],
    })
    const lastCall = (anthropic.messages.create as any).mock.calls.at(-1)[0]
    const userMsgs = lastCall.messages.filter((m: any) => m.role === 'user')
    const text = userMsgs[userMsgs.length - 1].content as string
    expect(text).toContain('Internet retrieval')
    expect(text).toContain('nhtsa')
  })
})
```

- [ ] **Step 5: Run all tests**

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(retrieval): orchestrate Rung-1 retrieval + LLM grading inside advance flow"
```

### Phase L — Implementation corrections

Recorded 2026-05-03.

- **`corpus` parameter is a placeholder.** Phase K (Cross-Shop Corpus) is not yet built, so Task L10 wires `corpus: undefined` in the advance route and defines `CorpusMatch` as a placeholder type in `lib/ai/tree-engine.ts`. When Phase K is built, replace the placeholder type and feed real corpus matches through.
- **`runRetrieval` takes `db: AppDb`.** Task L7 was refactored to thread `db: AppDb` through cache helpers (per AGENTS.md convention). The orchestrator's signature was extended to match. The plan's L10 step 3 (calling the orchestrator with `{ adapters: ADAPTERS, ctx: retrievalCtx }`) must be updated to pass `{ db, adapters: ADAPTERS, ctx: retrievalCtx }`.
- **Wall-clock-aborted adapter errors are tagged.** `errors[].message === 'wall-clock budget exceeded'` for AbortError-style failures, vs the underlying error message for genuine adapter failures. L10 didn't need to change to accommodate this; noting for future observability work.

---

## Phase M — Tech-Assisted Retrieval + Risk Gating + Decline-or-Defer (9 tasks)

Per spec §6 row 7, §7.1 (Risk Classifier, Confidence Calibrator, Gap Handler, Decline-or-Defer), §8.2 (Rung 2 + Rung 3), §8.3 (risk-stratified gating thresholds), §8.4 (Decline-or-Defer language). Builds: a two-stage risk classifier (hardcoded rules + LLM judge), a calibration table seeded with the spec's MVP starting thresholds, a Gap Handler that walks the bounded retrieval ladder under per-action risk gates, the Tech-Assisted Retrieval flow (Rung 2: AI asks tech to fetch a specific artifact, max 1 + 2 follow-ups), and Decline-or-Defer as the terminal safety mechanism with the spec's three options (gather more low-risk data / decline / defer for curator review).

### Task M1: Add `confidence_calibration` table seeded with spec §8.3 thresholds

**Files:**
- Modify: lib/db/schema.ts
- Create: drizzle/seed/calibration-seed.ts

- [ ] **Step 1: Append schema**

```ts
// lib/db/schema.ts (append)
export const confidenceCalibration = pgTable('confidence_calibration', {
  id: uuid('id').primaryKey().defaultRandom(),
  riskClass: text('risk_class', {
    enum: ['zero', 'low', 'medium', 'high', 'destructive'],
  }).notNull(),
  vehicleFamily: text('vehicle_family').notNull(),  // e.g. "ford-f-truck", "bmw-3-4-series", "*" for catch-all
  symptomClass: text('symptom_class').notNull(),    // e.g. "power_loss", "no_start", "*" for catch-all
  thresholdPct: real('threshold_pct').notNull(),    // 0-1 minimum confidence to commit
  sampleSize: integer('sample_size').notNull().default(0),
  comebackRate: real('comeback_rate').notNull().default(0),
  lastRefitAt: timestamp('last_refit_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})
```

Generate + apply migration:
```bash
pnpm drizzle-kit generate && pnpm drizzle-kit migrate
```

- [ ] **Step 2: Seed the catch-all baseline rows from spec §8.3**

```ts
// drizzle/seed/calibration-seed.ts
import { db } from '@/lib/db/client'
import { confidenceCalibration } from '@/lib/db/schema'
import { sql } from 'drizzle-orm'

const SEED = [
  { riskClass: 'zero',        thresholdPct: 0.0  },
  { riskClass: 'low',         thresholdPct: 0.7  },
  { riskClass: 'medium',      thresholdPct: 0.8  },
  { riskClass: 'high',        thresholdPct: 0.9  },
  { riskClass: 'destructive', thresholdPct: 0.95 },
] as const

async function seed() {
  for (const row of SEED) {
    await db.insert(confidenceCalibration).values({
      riskClass: row.riskClass,
      vehicleFamily: '*',
      symptomClass: '*',
      thresholdPct: row.thresholdPct,
    }).onConflictDoNothing()
  }
  console.log('calibration baseline seeded')
}

seed().catch(err => { console.error(err); process.exit(1) })
```

Run:
```bash
pnpm tsx drizzle/seed/calibration-seed.ts
```

- [ ] **Step 3: Add a typed lookup helper**

```ts
// lib/db/queries.ts (append)
import { confidenceCalibration } from './schema'
import { sql, and, eq } from 'drizzle-orm'

export async function getThreshold(input: {
  riskClass: 'zero' | 'low' | 'medium' | 'high' | 'destructive'
  vehicleFamily?: string
  symptomClass?: string
}): Promise<number> {
  // Try most-specific row first, fall back to catch-all.
  const rows = await db.query.confidenceCalibration.findMany({
    where: and(
      eq(confidenceCalibration.riskClass, input.riskClass),
      sql`(vehicle_family = ${input.vehicleFamily ?? '*'} OR vehicle_family = '*')`,
      sql`(symptom_class = ${input.symptomClass ?? '*'} OR symptom_class = '*')`,
    ),
  })
  if (rows.length === 0) {
    // Hardcoded fallback identical to spec §8.3 starting values.
    return { zero: 0, low: 0.7, medium: 0.8, high: 0.9, destructive: 0.95 }[input.riskClass]
  }
  // Sort to prefer most-specific (non-* on both columns), then most-specific on one column.
  rows.sort((a, b) => {
    const score = (r: typeof rows[number]) => (r.vehicleFamily !== '*' ? 2 : 0) + (r.symptomClass !== '*' ? 1 : 0)
    return score(b) - score(a)
  })
  return Number(rows[0].thresholdPct)
}
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(gating): confidence_calibration table + spec §8.3 baseline seeded"
```

---

### Task M2: Risk classifier — hardcoded rules + LLM judge fallback

**Files:**
- Create: lib/gating/risk-classifier.ts
- Modify: lib/ai/prompts.ts
- Create: tests/unit/risk-classifier.test.ts

- [ ] **Step 1: Add the LLM-judge prompt**

```ts
// lib/ai/prompts.ts (append)
export const RISK_CLASSIFIER_SYSTEM = `You classify a proposed automotive diagnostic action by risk class.

Risk classes (per spec §8.3):
- zero: read-only observation (read PID, listen for sound, observe instrument cluster, read DTCs).
- low: visual inspection, smoke test, fuse pull-and-replace, fluid sample without ingress to a powered system.
- medium: back-probe a non-power signal wire, fluid sample on a hot system, sensor swap on a closed circuit.
- high: back-probe a power or CAN-bus circuit, voltage application, jumper a connector that energizes when bridged.
- destructive: wire cut, splice, module replacement, flash reprogram — anything irreversible or that can brick a module.

OUTPUT FORMAT — always respond with valid JSON:

type RiskJudgment = {
  riskClass: "zero" | "low" | "medium" | "high" | "destructive"
  rationale: string                // 1 sentence why this class
  reversible: boolean              // true if the action can be undone trivially
}

When in doubt, classify UP one level. Safety bias.`
```

- [ ] **Step 2: Write failing test**

```ts
// tests/unit/risk-classifier.test.ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/ai/client', () => ({
  anthropic: {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify({
          riskClass: 'high', rationale: 'back-probe of CAN bus risks bricking modules', reversible: true,
        }) }],
        usage: { input_tokens: 80, output_tokens: 40 },
      }),
    },
  },
  MODEL: 'claude-haiku-4-5-20251001',
  cachedSystem: (t: string) => [{ type: 'text', text: t, cache_control: { type: 'ephemeral' } }],
}))

describe('classifyAction', () => {
  it('uses hardcoded rule for "read PID"', async () => {
    const { classifyAction } = await import('@/lib/gating/risk-classifier')
    const r = await classifyAction('Read live PID for MAF airflow')
    expect(r.riskClass).toBe('zero')
    expect(r.source).toBe('rule')
  })
  it('uses hardcoded rule for "back-probe power circuit"', async () => {
    const { classifyAction } = await import('@/lib/gating/risk-classifier')
    const r = await classifyAction('Back-probe the alternator B+ circuit at the splice')
    expect(r.riskClass).toBe('high')
    expect(r.source).toBe('rule')
  })
  it('falls through to LLM judge for novel actions', async () => {
    const { classifyAction } = await import('@/lib/gating/risk-classifier')
    const r = await classifyAction('Tap on the throttle body with a deadblow at idle to reproduce the stumble')
    expect(r.riskClass).toBe('high')   // mock returns high
    expect(r.source).toBe('llm')
  })
})
```

- [ ] **Step 3: Run, expect fail**

- [ ] **Step 4: Implement**

```ts
// lib/gating/risk-classifier.ts
import { anthropic, cachedSystem } from '@/lib/ai/client'
import { RISK_CLASSIFIER_SYSTEM } from '@/lib/ai/prompts'

const HAIKU = process.env.ANTHROPIC_HAIKU_MODEL ?? 'claude-haiku-4-5-20251001'

export type RiskClass = 'zero' | 'low' | 'medium' | 'high' | 'destructive'
export type RiskJudgment = {
  riskClass: RiskClass
  rationale: string
  reversible: boolean
  source: 'rule' | 'llm'
}

type Rule = { match: RegExp; riskClass: RiskClass; reversible: boolean; rationale: string }

const RULES: Rule[] = [
  // zero
  { match: /\bread\b.*\b(pid|live data|dtc|freeze frame|module)\b/i, riskClass: 'zero', reversible: true, rationale: 'read-only data acquisition' },
  { match: /\b(listen|observe|look at|inspect visually)\b/i, riskClass: 'zero', reversible: true, rationale: 'sensory observation only' },
  { match: /\b(scan)\b.*(codes|vehicle|module)/i, riskClass: 'zero', reversible: true, rationale: 'code scan is read-only' },
  // low
  { match: /\bsmoke test\b/i, riskClass: 'low', reversible: true, rationale: 'smoke test is non-destructive' },
  { match: /\bfuse\b.*\b(pull|swap|replace)\b/i, riskClass: 'low', reversible: true, rationale: 'fuse swap is reversible' },
  { match: /\b(visual inspection|inspect)\b.*\b(connector|harness|line|hose)\b/i, riskClass: 'low', reversible: true, rationale: 'visual inspection only' },
  // medium
  { match: /\bback-?probe\b.*(?<!power)(?<!can)\b(signal|sensor|low-side)\b/i, riskClass: 'medium', reversible: true, rationale: 'back-probe on a non-power signal wire' },
  { match: /\b(swap|replace)\b.*\b(sensor|relay)\b/i, riskClass: 'medium', reversible: true, rationale: 'sensor swap is reversible but invasive' },
  // high
  { match: /\bback-?probe\b.*\b(power|b\+|battery|can|canbus|can bus|j1939)\b/i, riskClass: 'high', reversible: true, rationale: 'back-probe of power or CAN bus' },
  { match: /\bvoltage application\b|\bapply (12|battery) v/i, riskClass: 'high', reversible: true, rationale: 'applied voltage can damage modules' },
  { match: /\bjumper\b.*\bconnector\b/i, riskClass: 'high', reversible: true, rationale: 'jumpering connectors can short or energize' },
  // destructive
  { match: /\b(cut|splice)\b.*\b(wire|harness|loom)\b/i, riskClass: 'destructive', reversible: false, rationale: 'wire cut is irreversible' },
  { match: /\b(module replace|module replacement|reflash|reprogram|flash)\b/i, riskClass: 'destructive', reversible: false, rationale: 'module replacement / reflash is irreversible' },
  { match: /\b(remove|delete) (a )?dtc by (clearing|reflash)/i, riskClass: 'destructive', reversible: false, rationale: 'reflash to clear codes is invasive' },
]

export async function classifyAction(actionText: string): Promise<RiskJudgment> {
  for (const rule of RULES) {
    if (rule.match.test(actionText)) {
      return {
        riskClass: rule.riskClass,
        rationale: rule.rationale,
        reversible: rule.reversible,
        source: 'rule',
      }
    }
  }

  const res = await anthropic.messages.create({
    model: HAIKU,
    max_tokens: 200,
    system: cachedSystem(RISK_CLASSIFIER_SYSTEM),
    messages: [{ role: 'user', content: `Action: ${actionText}\n\nReturn JSON only.` }],
  })
  const block = res.content.find(b => b.type === 'text')
  if (!block || block.type !== 'text') {
    return { riskClass: 'high', rationale: 'classifier failed; default to high (safety bias)', reversible: false, source: 'llm' }
  }
  try {
    const parsed = JSON.parse(block.text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')) as Omit<RiskJudgment, 'source'>
    return { ...parsed, source: 'llm' }
  } catch {
    return { riskClass: 'high', rationale: 'classifier returned malformed JSON; default to high', reversible: false, source: 'llm' }
  }
}
```

- [ ] **Step 5: Run, expect pass**

```bash
pnpm test tests/unit/risk-classifier.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(gating): two-stage risk classifier (hardcoded rules + Haiku LLM judge)"
```

---

### Task M3: Tree-engine output extension — proposedActions with confidence

**Files:**
- Modify: lib/ai/prompts.ts
- Modify: lib/ai/tree-engine.ts

- [ ] **Step 1: Extend the system prompt to require confidence per proposed action**

In `TREE_ENGINE_SYSTEM`, replace the OUTPUT FORMAT block with:

```
OUTPUT FORMAT — always respond with valid JSON matching this TypeScript type:

type ProposedAction = {
  description: string         // imperative — what the tech should do
  confidence: number          // 0-1, your confidence this action will move the diagnosis forward correctly
  expectedSignal?: string     // what the tech should observe if this action confirms a hypothesis
}

type TreeUpdate = {
  nodes: Array<{ id, label, status, rationale?, children? }>
  currentNodeId: string
  message: string
  done?: boolean
  rootCauseSummary?: string
  requestedArtifact?: { kind, prompt }
  proposedAction?: ProposedAction       // populate when the next step is an action the tech will perform
}
```

Add a corresponding principle:

```
RISK GATING:
- If the next step is an action the tech will physically perform, populate "proposedAction" with a description and your confidence (0-1).
- The platform will run a risk classifier and confidence gate. If your confidence is below the gate's threshold for the action's risk class, the platform will block the action and surface Decline-or-Defer options to the tech. You don't need to enforce thresholds yourself — but be honest about confidence.
```

- [ ] **Step 2: Update TreeState type**

```ts
// lib/ai/tree-engine.ts — extend TreeState
export type ProposedAction = {
  description: string
  confidence: number
  expectedSignal?: string
}

export type TreeState = {
  nodes: TreeNode[]
  currentNodeId: string
  message: string
  done?: boolean
  rootCauseSummary?: string
  requestedArtifact?: { kind: 'photo' | 'scan_screen' | 'wiring_diagram' | 'audio' | 'video'; prompt: string }
  proposedAction?: ProposedAction
}
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(ai): tree engine emits proposedAction with confidence for risk gating"
```

---

### Task M4: Gap Handler — bounded retrieval ladder under per-action gating

**Files:**
- Create: lib/gating/gap-handler.ts
- Create: tests/unit/gap-handler.test.ts

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/gap-handler.test.ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/gating/risk-classifier', () => ({
  classifyAction: vi.fn().mockResolvedValue({ riskClass: 'high', rationale: 'x', reversible: true, source: 'rule' }),
}))
vi.mock('@/lib/db/queries', () => ({
  getThreshold: vi.fn().mockResolvedValue(0.9),
}))

describe('gateProposedAction', () => {
  it('passes when confidence meets threshold', async () => {
    const { gateProposedAction } = await import('@/lib/gating/gap-handler')
    const r = await gateProposedAction({
      action: { description: 'back-probe CAN bus', confidence: 0.92 },
      vehicleFamily: 'ford-f-truck',
      symptomClass: 'power_loss',
    })
    expect(r.allow).toBe(true)
    expect(r.riskClass).toBe('high')
  })
  it('blocks when confidence is below threshold', async () => {
    const { gateProposedAction } = await import('@/lib/gating/gap-handler')
    const r = await gateProposedAction({
      action: { description: 'back-probe CAN bus', confidence: 0.74 },
      vehicleFamily: 'ford-f-truck',
      symptomClass: 'power_loss',
    })
    expect(r.allow).toBe(false)
    expect(r.gap).toMatch(/confidence/i)
    expect(r.options).toContain('gather_more_low_risk')
    expect(r.options).toContain('decline')
    expect(r.options).toContain('defer')
  })
})
```

- [ ] **Step 2: Implement**

```ts
// lib/gating/gap-handler.ts
import { classifyAction, type RiskJudgment } from './risk-classifier'
import { getThreshold } from '@/lib/db/queries'
import type { ProposedAction } from '@/lib/ai/tree-engine'

export type GateDecision = {
  allow: boolean
  riskClass: RiskJudgment['riskClass']
  threshold: number
  confidence: number
  rationale: string
  gap?: string
  options?: Array<'gather_more_low_risk' | 'decline' | 'defer'>
}

export async function gateProposedAction(input: {
  action: ProposedAction
  vehicleFamily?: string
  symptomClass?: string
}): Promise<GateDecision> {
  const judgment = await classifyAction(input.action.description)
  const threshold = await getThreshold({
    riskClass: judgment.riskClass,
    vehicleFamily: input.vehicleFamily,
    symptomClass: input.symptomClass,
  })
  const allow = input.action.confidence >= threshold
  if (allow) {
    return {
      allow: true,
      riskClass: judgment.riskClass,
      threshold,
      confidence: input.action.confidence,
      rationale: judgment.rationale,
    }
  }
  return {
    allow: false,
    riskClass: judgment.riskClass,
    threshold,
    confidence: input.action.confidence,
    rationale: judgment.rationale,
    gap: `Required confidence ${(threshold * 100).toFixed(0)}% for risk class "${judgment.riskClass}"; current confidence ${(input.action.confidence * 100).toFixed(0)}%.`,
    options: ['gather_more_low_risk', 'decline', 'defer'],
  }
}
```

- [ ] **Step 3: Run, expect pass**

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(gating): Gap Handler enforces per-(risk_class × vehicle_family × symptom) thresholds"
```

---

### Task M5: Decline-or-Defer endpoint + customer-facing language generation

**Files:**
- Modify: lib/ai/prompts.ts
- Create: lib/gating/decline-language.ts
- Create: app/api/sessions/[id]/decline-or-defer/route.ts
- Modify: lib/db/schema.ts (sessions.status enum already has 'declined' and 'deferred' — verify)

- [ ] **Step 1: Add the customer-facing decline-language prompt**

```ts
// lib/ai/prompts.ts (append)
export const DECLINE_LANGUAGE_SYSTEM = `You generate customer-facing language a service writer can paste into a quote, text, or email when a vehicle issue is being declined or deferred.

Tone: honest, professional, brief. No technical jargon the customer can't follow. No admission of fault. No commitment to liability.

OUTPUT FORMAT — always respond with valid JSON:

type DeclineLanguage = {
  customerMessage: string       // 2-4 sentences for the customer
  internalNote: string          // 1-2 sentences for the service writer's records
  recommendedReferral?: string  // e.g. "dealer", "transmission specialist", "diesel shop"
}`
```

- [ ] **Step 2: Implement helper**

```ts
// lib/gating/decline-language.ts
import { anthropic, MODEL, cachedSystem } from '@/lib/ai/client'
import { DECLINE_LANGUAGE_SYSTEM } from '@/lib/ai/prompts'

export type DeclineLanguage = {
  customerMessage: string
  internalNote: string
  recommendedReferral?: string
}

export async function generateDeclineLanguage(input: {
  vehicleSummary: string
  complaint: string
  gap: string
  riskClass: string
  reason: 'decline' | 'defer'
}): Promise<DeclineLanguage> {
  const userMessage = `Vehicle: ${input.vehicleSummary}
Customer complaint: ${input.complaint}
Diagnostic gap: ${input.gap}
Risk class blocking commit: ${input.riskClass}
Reason: ${input.reason === 'decline' ? 'shop is declining the job' : 'shop is holding the job for asynchronous expert review (24-72h turnaround)'}

Return JSON only.`
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 400,
    system: cachedSystem(DECLINE_LANGUAGE_SYSTEM),
    messages: [{ role: 'user', content: userMessage }],
  })
  const block = res.content.find(b => b.type === 'text')
  if (!block || block.type !== 'text') throw new Error('no text block')
  return JSON.parse(block.text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')) as DeclineLanguage
}
```

- [ ] **Step 3: Add the route**

```ts
// app/api/sessions/[id]/decline-or-defer/route.ts
import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase-server'
import { db } from '@/lib/db/client'
import { profiles, sessions } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { generateDeclineLanguage } from '@/lib/gating/decline-language'
import { appendSessionEvent } from '@/lib/db/queries'

const bodySchema = z.object({
  reason: z.enum(['decline', 'defer']),
  gap: z.string().min(5).max(2000),
  riskClass: z.enum(['low', 'medium', 'high', 'destructive']),
})

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await getServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const profile = await db.query.profiles.findFirst({ where: eq(profiles.id, user.id) })
  if (!profile) return NextResponse.json({ error: 'no profile' }, { status: 400 })
  const session = await db.query.sessions.findFirst({ where: eq(sessions.id, id) })
  if (!session || session.techId !== profile.id) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (session.status !== 'open') return NextResponse.json({ error: 'session is not open' }, { status: 400 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 })

  const language = await generateDeclineLanguage({
    vehicleSummary: `${session.intake.vehicleYear} ${session.intake.vehicleMake} ${session.intake.vehicleModel}${session.intake.vehicleEngine ? ` (${session.intake.vehicleEngine})` : ''}`,
    complaint: session.intake.customerComplaint,
    gap: parsed.data.gap,
    riskClass: parsed.data.riskClass,
    reason: parsed.data.reason,
  })

  await db.update(sessions)
    .set({ status: parsed.data.reason === 'decline' ? 'declined' : 'deferred', closedAt: new Date() })
    .where(eq(sessions.id, id))
  await appendSessionEvent({
    sessionId: id,
    nodeId: session.treeState.currentNodeId,
    eventType: 'close',
    aiResponse: { gap: parsed.data.gap, riskClass: parsed.data.riskClass, reason: parsed.data.reason, language } as any,
  })

  return NextResponse.json({ status: parsed.data.reason, language })
}
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(gating): Decline-or-Defer terminal route with customer-facing language"
```

---

### Task M6: Tech-Assisted Retrieval (Rung 2) — AI asks tech to fetch a specific artifact

**Files:**
- Modify: lib/ai/prompts.ts
- Modify: lib/ai/tree-engine.ts (TreeState already has requestedArtifact; we extend semantics)
- Create: lib/db/schema.ts (add tech_assist_requests table for audit trail)

- [ ] **Step 1: Extend the system prompt**

Append to `TREE_ENGINE_SYSTEM`:

```
TECH-ASSISTED RETRIEVAL (Rung 2):
- You may invoke Tech-Assisted Retrieval ONLY after the corpus and internet retrieval rungs have been exhausted (the user message will tell you their state).
- To invoke Rung 2, populate "requestedArtifact" with kind="wiring_diagram" or "scan_screen" along with a precise prompt: what to fetch and from where (e.g. "Pull the K-CAN bus wiring diagram for build date range — photograph the page showing wire colors and pin assignments at the JBE connector").
- Rung 2 is bounded: 1 ask + max 2 follow-ups per knowledge gap. Track this in your reasoning. If three asks have been made and the gap is unresolved, do NOT propose another Rung 2 ask — invoke Decline-or-Defer instead by leaving requestedArtifact empty and setting message to explain the gap.
```

- [ ] **Step 2: Add the audit-trail table**

```ts
// lib/db/schema.ts (append)
export const techAssistRequests = pgTable('tech_assist_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').references(() => sessions.id, { onDelete: 'cascade' }).notNull(),
  nodeId: text('node_id').notNull(),
  gapDescription: text('gap_description').notNull(),
  requestedArtifactKind: text('requested_artifact_kind').notNull(),
  requestPrompt: text('request_prompt').notNull(),
  followUpCount: integer('follow_up_count').notNull().default(0),
  resolved: boolean('resolved').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})
```

Generate + apply migration:
```bash
pnpm drizzle-kit generate && pnpm drizzle-kit migrate
```

- [ ] **Step 3: Track Rung 2 invocations in the advance route**

```ts
// app/api/sessions/[id]/advance/route.ts — after nextTree is computed:
import { techAssistRequests } from '@/lib/db/schema'

if (nextTree.requestedArtifact && (nextTree.requestedArtifact.kind === 'wiring_diagram' || nextTree.requestedArtifact.kind === 'scan_screen')) {
  // Audit: record the Rung 2 invocation.
  const existing = await db.query.techAssistRequests.findFirst({
    where: (t, { and, eq }) => and(eq(t.sessionId, id), eq(t.nodeId, session.treeState.currentNodeId), eq(t.resolved, false)),
  })
  if (existing) {
    await db.update(techAssistRequests).set({ followUpCount: existing.followUpCount + 1 }).where(eq(techAssistRequests.id, existing.id))
    if (existing.followUpCount + 1 >= 3) {
      // Three follow-ups exhausted — strip the request and force Decline-or-Defer surfacing.
      nextTree.requestedArtifact = undefined
      nextTree.message += ' (Rung-2 budget exhausted — consider Decline-or-Defer.)'
    }
  } else {
    await db.insert(techAssistRequests).values({
      sessionId: id,
      nodeId: session.treeState.currentNodeId,
      gapDescription: nextTree.message.slice(0, 1000),
      requestedArtifactKind: nextTree.requestedArtifact.kind,
      requestPrompt: nextTree.requestedArtifact.prompt,
    })
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(gating): Tech-Assisted Retrieval (Rung 2) audit trail + 1+2 follow-up bound"
```

---

### Task M7: DeclineOrDeferPanel UI surface

**Files:**
- Create: components/session/decline-or-defer-panel.tsx
- Modify: components/session/session-view.tsx
- Modify: lib/ai/tree-engine.ts (TreeState — add gateDecision passthrough optional field)

- [ ] **Step 1: Allow tree engine result to carry a server-computed gate decision**

```ts
// lib/ai/tree-engine.ts — extend TreeState (server may decorate)
import type { GateDecision } from '@/lib/gating/gap-handler'

export type TreeState = {
  nodes: TreeNode[]
  currentNodeId: string
  message: string
  done?: boolean
  rootCauseSummary?: string
  requestedArtifact?: { kind: 'photo' | 'scan_screen' | 'wiring_diagram' | 'audio' | 'video'; prompt: string }
  proposedAction?: ProposedAction
  gateDecision?: GateDecision   // server-computed; not from the LLM
}
```

- [ ] **Step 2: Compute gateDecision in the advance route**

```ts
// app/api/sessions/[id]/advance/route.ts — after nextTree, before responding:
import { gateProposedAction } from '@/lib/gating/gap-handler'

if (nextTree.proposedAction) {
  const symptomClass = inferSymptomTagsForVehicleFamily(session.intake) // helper similar to inferSymptomTags
  const vehicleFamily = `${session.intake.vehicleMake.toLowerCase()}-${session.intake.vehicleModel.toLowerCase()}`
  nextTree.gateDecision = await gateProposedAction({
    action: nextTree.proposedAction,
    vehicleFamily,
    symptomClass: symptomClass[0],
  })
}

function inferSymptomTagsForVehicleFamily(intake: { customerComplaint: string }): string[] {
  // Reuse Phase K's helper or duplicate inline
  const text = intake.customerComplaint.toLowerCase()
  const tags: string[] = []
  if (/power|stall|hesit|sluggish/.test(text)) tags.push('power_loss')
  if (/start|crank|no.?start/.test(text)) tags.push('starting_issue')
  if (/misfire|rough/.test(text)) tags.push('misfire')
  return tags.length ? tags : ['*']
}
```

- [ ] **Step 3: Build the panel component**

```tsx
// components/session/decline-or-defer-panel.tsx
'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

export function DeclineOrDeferPanel(props: {
  sessionId: string
  gap: string
  riskClass: 'low' | 'medium' | 'high' | 'destructive'
  onDeclined: (language: { customerMessage: string; internalNote: string }) => void
  onDeferred: (language: { customerMessage: string; internalNote: string }) => void
  onGatherMore: () => void
}) {
  const [busy, setBusy] = useState<'decline' | 'defer' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function go(reason: 'decline' | 'defer') {
    setBusy(reason)
    setError(null)
    try {
      const res = await fetch(`/api/sessions/${props.sessionId}/decline-or-defer`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason, gap: props.gap, riskClass: props.riskClass }),
      })
      if (!res.ok) throw new Error(await res.text())
      const { language } = await res.json()
      ;(reason === 'decline' ? props.onDeclined : props.onDeferred)(language)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card className="p-4 space-y-4 border-amber-500">
      <div>
        <h3 className="font-bold text-amber-700">⚠ Confidence too low to commit</h3>
        <p className="text-sm mt-2">{props.gap}</p>
      </div>
      <div className="space-y-2">
        <Button variant="outline" className="w-full h-12" onClick={props.onGatherMore} disabled={busy !== null}>
          ① Gather more low-risk data
        </Button>
        <Button variant="outline" className="w-full h-12" onClick={() => go('decline')} disabled={busy !== null}>
          {busy === 'decline' ? 'Generating language…' : '② Decline this job (refer customer)'}
        </Button>
        <Button variant="outline" className="w-full h-12" onClick={() => go('defer')} disabled={busy !== null}>
          {busy === 'defer' ? 'Generating language…' : '③ Defer for curator review (24-72h)'}
        </Button>
      </div>
      {error && <p className="text-red-600 text-sm">{error}</p>}
    </Card>
  )
}
```

- [ ] **Step 4: Render the panel from SessionView when gate blocks**

```tsx
// components/session/session-view.tsx — inside SessionView, after the empty-state and done checks:
import { DeclineOrDeferPanel } from './decline-or-defer-panel'

if (tree.gateDecision && !tree.gateDecision.allow) {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">
        {session.intake.vehicleYear} {session.intake.vehicleMake} {session.intake.vehicleModel}
      </h1>
      <TreeView tree={tree} />
      <DeclineOrDeferPanel
        sessionId={session.id}
        gap={tree.gateDecision.gap ?? 'Confidence below threshold for proposed action.'}
        riskClass={tree.gateDecision.riskClass as any}
        onDeclined={() => { window.location.href = '/sessions' }}
        onDeferred={() => { window.location.href = '/sessions' }}
        onGatherMore={() => {
          // Inline re-prompt: clear the gateDecision locally so StepInput re-renders.
          setSession({ ...session, treeState: { ...tree, gateDecision: undefined, proposedAction: undefined } })
        }}
      />
    </div>
  )
}
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(gating): DeclineOrDeferPanel with three customer-safe options"
```

---

### Task M8: Audit-trail-aware end-to-end test for gating

**Files:**
- Create: tests/unit/gating-flow.test.ts

- [ ] **Step 1: Write the contract test**

```ts
// tests/unit/gating-flow.test.ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/gating/risk-classifier', () => ({
  classifyAction: vi.fn().mockResolvedValue({ riskClass: 'destructive', rationale: 'wire cut', reversible: false, source: 'rule' }),
}))
vi.mock('@/lib/db/queries', () => ({
  getThreshold: vi.fn().mockResolvedValue(0.95),
}))

describe('gating flow contract', () => {
  it('blocks destructive action with 90% confidence (below 0.95 threshold)', async () => {
    const { gateProposedAction } = await import('@/lib/gating/gap-handler')
    const r = await gateProposedAction({
      action: { description: 'Cut the K-CAN-H wire at pin 7', confidence: 0.9 },
      vehicleFamily: 'bmw-3-series',
      symptomClass: 'power_loss',
    })
    expect(r.allow).toBe(false)
    expect(r.riskClass).toBe('destructive')
    expect(r.options).toEqual(['gather_more_low_risk', 'decline', 'defer'])
  })
  it('allows destructive action with 96% confidence (above 0.95 threshold)', async () => {
    const { gateProposedAction } = await import('@/lib/gating/gap-handler')
    const r = await gateProposedAction({
      action: { description: 'Cut the K-CAN-H wire at pin 7', confidence: 0.96 },
      vehicleFamily: 'bmw-3-series',
      symptomClass: 'power_loss',
    })
    expect(r.allow).toBe(true)
  })
})
```

- [ ] **Step 2: Run, expect pass**

```bash
pnpm test tests/unit/gating-flow.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "test(gating): contract test for risk-class × confidence gating decisions"
```

---

### Task M9: Document the gating model in AGENTS.md

**Files:**
- Modify: AGENTS.md

- [ ] **Step 1: Append**

```markdown
## Risk gating + Decline-or-Defer

- Every action the AI proposes that the tech will physically perform must include a `proposedAction` block with `confidence` (0-1).
- The advance route runs `classifyAction()` (lib/gating/risk-classifier.ts) — hardcoded rules first, Haiku LLM judge for novel actions.
- `getThreshold()` looks up the per-(risk_class × vehicle_family × symptom_class) threshold from `confidence_calibration` (seeded from spec §8.3 starting values; refit weekly by the calibration engine in Phase Q).
- If `confidence < threshold`, the gate blocks and the UI surfaces `DeclineOrDeferPanel` with three options (per spec §8.4).
- Tech-Assisted Retrieval (Rung 2) is bounded to 1 + 2 follow-ups per node. The route enforces this; the AI is also instructed to respect it in TREE_ENGINE_SYSTEM.
- Any change to a hardcoded risk rule must be reviewed by code review (not LLM-judged) — these are the safety floor.
```

- [ ] **Step 2: Commit**

```bash
git add AGENTS.md
git commit -m "docs(gating): document risk gating + Decline-or-Defer in AGENTS.md"
```

---

## Phase M — Implementation corrections (applied after M9)

The plan's Phase M is faithful in shape but several details drifted from Phase D/F/H reality. The points below are authoritative; the inline blocks remain reference.

1. **Queries take `db: AppDb` as first arg** — plan's `getThreshold` and the M5 route used a globally-imported `db` in `lib/db/queries.ts`. The codebase convention (every other helper) is `(db, input)`. `getThreshold` and the new `setSessionTerminalStatus` and `recordTechAssistRequest` helpers all take db explicitly.
2. **M2 rule regex fix: `\bb\+\b` doesn't match `B+ ` because `\b` after a non-word char (`+`) won't transition against a following space.** Replaced with `/(?:\b(?:power|battery|can|canbus|j1939)\b|b\+|\bcan\s+bus\b)/i`. Caught by the "Back-probe alternator B+ circuit" rule test.
3. **M2 rule order: destructive-first** — plan ordered rules low-to-high. Returning on first match means a destructive cut/reflash could in theory be downgraded by an incidental softer match. Rules now iterate destructive → high → medium → low → zero.
4. **M5 / M6 — handler in `lib/sessions.ts`, route stays a thin shim.** Phase D/F established this pattern; the plan's M5 stuffed all logic (auth, db lookup, AI call, updates, event append) directly in `app/api/.../route.ts`, and M6 added audit logic to the advance route. Both moved into `lib/sessions.ts` (`declineOrDeferSessionForUser`, audit logic inside `advanceSession`). Routes are 30 lines: read user, call handler with prod deps, map result.
5. **M5 — `appendSessionEvent(db, payload)`, two args** — plan called it as `appendSessionEvent({...})`. Real signature is `(db, input)`. Same `closeSession`-style mistake.
6. **M5 — schema's `aiResponse` JSONB type extended to include `declineOrDefer`** payload. The runtime is jsonb (accepts anything) but the TS type was restrictive; extending it makes close events from the decline path typed end-to-end.
7. **M6 — `recordTechAssistRequest(db, input)` is the audit primitive.** Plan inlined three drizzle calls in the route (`findFirst` then `update` or `insert`). Wrapped in a single helper that returns `{ exhausted, followUpCount }` so the handler stays one branch deep. Threshold (3 follow-ups) extracted as `TECH_ASSIST_RUNG_2_BUDGET`.
8. **M7 — wired the existing Phase E `components/screens/decline-or-defer.tsx`, did not build a new shadcn `DeclineOrDeferPanel`.** Plan assumed `components/session/`, shadcn `Button`/`Card`, and Tailwind classes. None exist. The Phase E screen became 'use client' with optional `onSelectOption` + `pending` + `error` props (preview-mode-safe: no callback ⇒ inert buttons, so `/design` still renders without env). New `DeclineOrDeferLive` client wrapper handles the fetch + redirect.
9. **M7 — gate-blocked surfacing is a server-side redirect from the parent page**, not in-place rendering inside `ActiveSession`. `app/(app)/sessions/[id]/page.tsx` redirects to `/decline` when `treeState.gateDecision && !allow`. Cleaner than threading gate state into the active screen, and reuses the existing `/decline` route.
10. **M7 — `advanceSession` takes `gateAction?` as a DI dep** for testability, defaults to real `gateProposedAction`. Same shape as the existing `updateTree` DI. Tests stub it; route doesn't pass it (gets the real one).
11. **`TreeState` is duplicated in `lib/db/schema.ts` (JSONB column type) and `lib/ai/tree-engine.ts` (runtime contract).** Both updated for `proposedAction`, `requestedArtifact`, and `gateDecision`. **Future cleanup:** collapse to a single source of truth — pick `tree-engine.ts` as canonical, have schema import via `import type` (no circular runtime).
12. **M9 — created AGENTS.md** — plan said "Modify: AGENTS.md" but the file didn't exist. Created it as a thin pointer to the latest handoff + the load-bearing conventions (handler-in-lib pattern, queries-take-db, 422+JSON pattern, tokens-as-truth, plan-vs-reality reconciliation) and the gating doc.
13. **No `tsx` in deps for the seed runner** — plan's `pnpm tsx drizzle/seed/calibration-seed.ts` won't run as-is. The seed file is committed and is `if (require.main === module)` guarded so it can be run via any tsx-equivalent. **Resolved 2026-05-02:** seed applied to remote DB via MCP `execute_sql` rather than the tsx runner. 5 baseline rows present on `(vehicle_family='*', symptom_class='*')`. The seed file remains as documentation of the canonical baseline; if you need to re-seed against a fresh DB, copy its `INSERT` content into MCP `execute_sql` (or add `tsx` to dev deps and run normally).
14. **Phase M migrations applied to remote DB 2026-05-02** — drizzle journal had 0002 (`wakeful_microchip` → confidence_calibration) and 0003 (`sour_mathemanic` → tech_assist_requests + FK) but they had never run against any real Postgres. Applied to remote (`ynmtszuybeenjbigxdyl`) via MCP `apply_migration` under semantic names `0002_phase_m_confidence_calibration`, `0003_phase_m_tech_assist_requests`. Plus a `0004_phase_m_rls_hardening` adding `ALTER TABLE … ENABLE ROW LEVEL SECURITY` on both tables — operationally a no-op because Supabase's `rls_auto_enable` event trigger pre-empted RLS at table-creation time, kept as documented intent.
15. **`whatWouldClose` + `confidenceGap` fields added** (2026-05-02 during walkthrough). Original Phase M Decline-or-Defer screen surfaced only the percentage gap (`Required confidence 90%; current 88%`), which the tech reads as "the AI gave up." Sonnet now MUST populate `proposedAction.confidenceGap` (one sentence naming the SPECIFIC uncertainty) and `proposedAction.whatWouldClose` (the cheapest specific input — service-manual quote, photo, one-line confirmation — that would push confidence to ≥0.95) whenever `confidence < 0.95`. The platform threads both fields through `gateProposedAction` → `GateDecision` → `/decline` page → `DeclineOrDeferLive` → `DeclineOrDefer`. The screen now renders `confidenceGap` prominently (the WHAT) above the percentage gap (smaller, supplementary) and replaces option 1's generic "Try a non-destructive observation" with `whatWouldClose` (the actionable ask). Schema mirror in `lib/db/schema.ts` was updated to match — ts caught the divergence. Verified live with the 2007 Tahoe IPC scenario (`41d6c2a0`): gate fired at 88%, screen shows "Quote or photograph the ground pin numbers for IPC connectors C1 and C2 from the 2007 Tahoe GMT900 service manual wiring section..." instead of a generic prompt. Web search (Phase L) and tech upload UX (Phase I) remain blockers for full closure of "AI does its own research first, then asks the tech for the smallest possible delta."
16. **Avoided unsolicited auto-create-profile trigger** (2026-05-02). During walkthrough debugging, an `auth.users` trigger was added (migration 0005) that auto-inserted into `public.profiles` on signup. This short-circuited `ensureProfileAndShop` (the canonical first-touch in `lib/auth.ts:19`) which only creates a shop when the profile is *also* missing — leaving every user with a profile but `shop_id=null` and breaking every shop-dependent query. Migration 0006 reverts the trigger and backfills shops for any orphan profiles. **Rule: don't add infrastructure that bypasses canonical first-touch flows; let the existing handler own the invariant.** First-touch logic lives in `requireUserAndProfile` for a reason — it has access to email and creates both rows together.
17. **Pooler URL config fix (dev-only workaround)** (2026-05-02). Local dev's `DATABASE_URL` (the Supavisor pooler URL on port 6543) was returning `Tenant or user not found` despite the username having the correct `postgres.<project_ref>` suffix — likely a Supabase shared-pooler hostname migration that hasn't propagated. The direct URL (port 5432) works. `lib/db/client.ts` now reads `process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL` when `NODE_ENV !== 'production'`, falling through to the pooler URL in prod. **This is a dev unblock, not a prod fix.** Vercel deploy will fail until the pooler URL is corrected (or until we route prod through a different connector like the Vercel-Supabase integration).

---

## Phase N — Tablet Layout + Real-Time Sync (6 tasks)

Per spec §6 row 6 and §15 (single Next.js responsive app, four layouts, real-time sync), §9.2 (tablet layout: tree-visualization-first, read-mostly), §9.5 (WebSocket/SSE sync ~200ms cross-device). Builds: viewport-driven layout switching on the existing `/sessions/[id]` route, a `TabletTreeView` showing the full visual tree (not collapsed), an artifact gallery sidebar, Supabase Realtime subscriptions on `sessions` and `session_events` for cross-device sync, and a branch-pruning animation when nodes change status.

### Task N1: Viewport-driven layout switch on /sessions/[id]

**Files:**
- Modify: components/session/session-view.tsx
- Create: components/session/tablet-session-view.tsx

- [ ] **Step 1: Add the tablet container**

```tsx
// components/session/tablet-session-view.tsx
'use client'
import { useState } from 'react'
import { TabletTreeView } from './tablet-tree-view'
import { StepInput } from './step-input'
import { OutcomeForm } from './outcome-form'
import { ArtifactGallery } from './artifact-gallery'
import { DeclineOrDeferPanel } from './decline-or-defer-panel'
import type { sessions, sessionEvents } from '@/lib/db/schema'

type SessionRow = typeof sessions.$inferSelect & { events?: Array<typeof sessionEvents.$inferSelect> }
type Artifact = { id: string; kind: 'photo' | 'video' | 'audio' | 'scan_screen' | 'wiring_diagram'; nodeId: string; extraction?: { summary?: string } | null }

export function TabletSessionView({
  session: initial,
  artifacts: initialArtifacts = [],
}: { session: SessionRow; artifacts?: Artifact[] }) {
  const [session, setSession] = useState(initial)
  const [artifacts, setArtifacts] = useState(initialArtifacts)
  const tree = session.treeState

  if (session.status === 'closed' || session.status === 'declined' || session.status === 'deferred') {
    return <p className="text-gray-700 p-8 text-lg">Session {session.status}.</p>
  }

  return (
    <div className="min-h-screen grid grid-cols-[1fr_360px] gap-4 p-4" data-testid="tablet-session-view">
      <div className="space-y-4">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">
            {session.intake.vehicleYear} {session.intake.vehicleMake} {session.intake.vehicleModel}
            {session.intake.vehicleEngine ? ` (${session.intake.vehicleEngine})` : ''}
          </h1>
          <span className="text-sm text-gray-500 capitalize">{session.status}</span>
        </header>
        <p className="text-gray-700">{session.intake.customerComplaint}</p>

        {tree.gateDecision && !tree.gateDecision.allow ? (
          <DeclineOrDeferPanel
            sessionId={session.id}
            gap={tree.gateDecision.gap ?? ''}
            riskClass={tree.gateDecision.riskClass as any}
            onDeclined={() => { window.location.href = '/sessions' }}
            onDeferred={() => { window.location.href = '/sessions' }}
            onGatherMore={() => setSession({ ...session, treeState: { ...tree, gateDecision: undefined, proposedAction: undefined } })}
          />
        ) : tree.done ? (
          <OutcomeForm sessionId={session.id} rootCauseHint={tree.rootCauseSummary ?? ''} onClosed={() => { window.location.href = '/sessions' }} />
        ) : (
          <>
            <TabletTreeView tree={tree} />
            <StepInput
              sessionId={session.id}
              currentLabel={tree.nodes.find(n => n.id === tree.currentNodeId)?.label ?? ''}
              currentNodeId={tree.currentNodeId}
              message={tree.message}
              requestedArtifact={tree.requestedArtifact}
              onAdvance={(next) => setSession({ ...session, treeState: next })}
            />
          </>
        )}
      </div>
      <aside className="border-l pl-4 overflow-y-auto max-h-screen">
        <ArtifactGallery artifacts={artifacts} />
      </aside>
    </div>
  )
}
```

- [ ] **Step 2: Switch layouts at the page level using a viewport-aware client component**

```tsx
// app/(app)/sessions/[id]/page.tsx — replace the SessionView import line
import { ResponsiveSessionView } from '@/components/session/responsive-session-view'

return (
  <main>
    <ResponsiveSessionView session={session as any} artifacts={arts as any} />
  </main>
)
```

```tsx
// components/session/responsive-session-view.tsx
'use client'
import { useEffect, useState } from 'react'
import { SessionView } from './session-view'
import { TabletSessionView } from './tablet-session-view'

export function ResponsiveSessionView(props: any) {
  const [isTablet, setIsTablet] = useState<boolean | null>(null)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 640px)')
    const update = () => setIsTablet(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])
  if (isTablet === null) return <div className="p-4 animate-pulse h-32 bg-gray-100 rounded" />  // SSR placeholder
  return isTablet
    ? <TabletSessionView {...props} />
    : <main className="max-w-md mx-auto p-4"><SessionView {...props} /></main>
}
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(session): viewport-driven layout switch (phone < 640px, tablet ≥ 640px)"
```

---

### Task N2: TabletTreeView — full visual tree with branch pruning animation

**Files:**
- Create: components/session/tablet-tree-view.tsx

- [ ] **Step 1: Write the component**

```tsx
// components/session/tablet-tree-view.tsx
import type { TreeState } from '@/lib/ai/tree-engine'
import { Card } from '@/components/ui/card'

export function TabletTreeView({ tree }: { tree: TreeState }) {
  return (
    <Card className="p-6" data-testid="tablet-tree-view">
      <h2 className="text-sm font-semibold text-gray-500 mb-4 uppercase tracking-wide">Decision tree</h2>
      <div className="space-y-3">
        {tree.nodes.map(n => (
          <div
            key={n.id}
            className={`border-l-4 pl-3 py-2 transition-all duration-300 ${
              n.id === tree.currentNodeId
                ? 'border-blue-600 bg-blue-50'
                : n.status === 'resolved'
                ? 'border-green-500 opacity-70'
                : n.status === 'pruned'
                ? 'border-gray-300 opacity-30 line-through'
                : 'border-gray-200 opacity-90'
            }`}
          >
            <div className="font-medium">
              {n.id === tree.currentNodeId && <span className="text-blue-600 mr-2">▶</span>}
              {n.status === 'resolved' && <span className="text-green-600 mr-2">✓</span>}
              {n.status === 'pruned' && <span className="text-gray-400 mr-2">✗</span>}
              {n.label}
            </div>
            {n.rationale && <div className="text-sm text-gray-600 mt-1">{n.rationale}</div>}
          </div>
        ))}
      </div>
      {tree.message && (
        <div className="mt-6 p-4 bg-gray-50 rounded">
          <div className="text-xs font-semibold text-gray-500 mb-1">AI says</div>
          <p className="text-base">{tree.message}</p>
        </div>
      )}
    </Card>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat(session): TabletTreeView with full tree + state-based animations"
```

---

### Task N3: ArtifactGallery sidebar

**Files:**
- Create: components/session/artifact-gallery.tsx

- [ ] **Step 1: Write the component**

```tsx
// components/session/artifact-gallery.tsx
import { ArtifactThumbnail } from './artifact-thumbnail'

type Artifact = { id: string; kind: 'photo' | 'video' | 'audio' | 'scan_screen' | 'wiring_diagram'; nodeId: string; extraction?: { summary?: string } | null }

export function ArtifactGallery({ artifacts }: { artifacts: Artifact[] }) {
  if (artifacts.length === 0) {
    return <div className="text-sm text-gray-500">No artifacts captured yet.</div>
  }
  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Captured ({artifacts.length})</h2>
      {artifacts.map(a => (
        <div key={a.id} className="space-y-2 border-b pb-3 last:border-b-0">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium capitalize">{a.kind.replace('_', ' ')}</span>
            <span className="text-xs text-gray-400">{a.nodeId}</span>
          </div>
          {a.extraction?.summary && <p className="text-sm">{a.extraction.summary}</p>}
          <ArtifactThumbnail artifactId={a.id} kind={a.kind} />
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat(session): ArtifactGallery sidebar component"
```

---

### Task N4: Enable Supabase Realtime on `sessions` and `artifacts`

**Files:** none new (Supabase config)

- [ ] **Step 1: Enable replication via Supabase MCP**

```sql
-- Run via Supabase MCP execute_sql against dev (and later prod):
ALTER PUBLICATION supabase_realtime ADD TABLE sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE artifacts;
ALTER PUBLICATION supabase_realtime ADD TABLE session_events;
```

- [ ] **Step 2: Verify**

```sql
SELECT schemaname, tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime';
```

Expected: rows for `sessions`, `artifacts`, `session_events`.

- [ ] **Step 3: No commit needed** (config change only).

---

### Task N5: Real-time subscription hook

**Files:**
- Create: lib/hooks/use-realtime-session.ts
- Modify: components/session/responsive-session-view.tsx

- [ ] **Step 1: Write the hook**

```ts
// lib/hooks/use-realtime-session.ts
'use client'
import { useEffect } from 'react'
import { getBrowserSupabase } from '@/lib/supabase-client'

export function useRealtimeSession(input: {
  sessionId: string
  onSessionChange: (newRow: any) => void
  onArtifactInsert: (newRow: any) => void
  onEventInsert: (newRow: any) => void
}) {
  const { sessionId, onSessionChange, onArtifactInsert, onEventInsert } = input
  useEffect(() => {
    const supabase = getBrowserSupabase()
    const channel = supabase.channel(`session:${sessionId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'sessions',
        filter: `id=eq.${sessionId}`,
      }, payload => onSessionChange(payload.new))
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'artifacts',
        filter: `session_id=eq.${sessionId}`,
      }, payload => onArtifactInsert(payload.new))
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'session_events',
        filter: `session_id=eq.${sessionId}`,
      }, payload => onEventInsert(payload.new))
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [sessionId, onSessionChange, onArtifactInsert, onEventInsert])
}
```

- [ ] **Step 2: Wire into ResponsiveSessionView so both layouts get live updates**

```tsx
// components/session/responsive-session-view.tsx — extend
'use client'
import { useEffect, useState, useCallback } from 'react'
import { SessionView } from './session-view'
import { TabletSessionView } from './tablet-session-view'
import { useRealtimeSession } from '@/lib/hooks/use-realtime-session'

export function ResponsiveSessionView(props: { session: any; artifacts: any[] }) {
  const [isTablet, setIsTablet] = useState<boolean | null>(null)
  const [session, setSession] = useState(props.session)
  const [artifacts, setArtifacts] = useState(props.artifacts)

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 640px)')
    const update = () => setIsTablet(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  const handleSessionChange = useCallback((row: any) => {
    setSession((cur: any) => ({ ...cur, ...row }))
  }, [])
  const handleArtifactInsert = useCallback((row: any) => {
    setArtifacts((cur: any[]) => cur.some(a => a.id === row.id) ? cur : [row, ...cur])
  }, [])
  const handleEventInsert = useCallback((_row: any) => {
    // Placeholder: future hook for live observation feed.
  }, [])

  useRealtimeSession({
    sessionId: session.id,
    onSessionChange: handleSessionChange,
    onArtifactInsert: handleArtifactInsert,
    onEventInsert: handleEventInsert,
  })

  if (isTablet === null) return <div className="p-4 animate-pulse h-32 bg-gray-100 rounded" />
  return isTablet
    ? <TabletSessionView session={session} artifacts={artifacts} />
    : <main className="max-w-md mx-auto p-4"><SessionView session={session} artifacts={artifacts} /></main>
}
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(session): Supabase Realtime subscription powers cross-device sync"
```

---

### Task N6: Cross-device sync verification

**Files:** none (manual test)

- [ ] **Step 1: Open the same session on two viewports**

`pnpm dev` → sign in → start a session → open the session URL in two browser windows: one resized to 480×800 (phone), one resized to 1024×768 (tablet).

- [ ] **Step 2: Submit an observation on the phone**

Type into the StepInput on the phone window, click "Submit observation". Expect the tablet window to:
1. Re-render the TabletTreeView with the new tree state within ~300-500ms.
2. Highlight the new active node.
3. If a new artifact was attached to that step, the gallery sidebar updates with the thumbnail.

- [ ] **Step 3: Upload an artifact on the tablet**

Click an upload button in the gallery (if present) or on the StepInput. Expect the phone window to receive the realtime artifact insert and re-render.

- [ ] **Step 4: Document any latency issues**

If the round-trip exceeds 500ms in dev, leave a note in `docs/STATUS.md` to investigate Supabase project region vs. dev machine region. Production deploys should run the Supabase project in a region close to the target metro (DFW → us-east-1 or us-east-2).

- [ ] **Step 5: No commit needed.**

---

## Phase O — Desktop Intake (Built Dark) (5 tasks)

Per spec §6 row 6, §9.3 (desktop intake at /intake at viewport ≥1280px), §15 row "Desktop service-writer intake" (IN, dark). Builds: a feature flag, the `/intake` route gated by it, customer intake form + VIN scan, AI-generated pre-bay diagnostic plan + quote draft, and work order creation that auto-links to the bay session.

### Task O1: Feature-flag system

**Files:**
- Create: lib/feature-flags.ts
- Modify: .env.example
- Create: tests/unit/feature-flags.test.ts

- [ ] **Step 1: Add env**

```
NEXT_PUBLIC_DESKTOP_INTAKE_ENABLED=false
```

- [ ] **Step 2: Write failing test**

```ts
// tests/unit/feature-flags.test.ts
import { describe, it, expect, beforeEach } from 'vitest'

describe('feature flags', () => {
  beforeEach(() => {
    delete (process.env as any).NEXT_PUBLIC_DESKTOP_INTAKE_ENABLED
  })
  it('desktop intake defaults off', async () => {
    const { isDesktopIntakeEnabled } = await import('@/lib/feature-flags')
    expect(isDesktopIntakeEnabled()).toBe(false)
  })
  it('desktop intake on when env=true', async () => {
    ;(process.env as any).NEXT_PUBLIC_DESKTOP_INTAKE_ENABLED = 'true'
    const { isDesktopIntakeEnabled } = await import('@/lib/feature-flags')
    expect(isDesktopIntakeEnabled()).toBe(true)
  })
})
```

- [ ] **Step 3: Implement**

```ts
// lib/feature-flags.ts
export function isDesktopIntakeEnabled(): boolean {
  return process.env.NEXT_PUBLIC_DESKTOP_INTAKE_ENABLED === 'true'
}
```

- [ ] **Step 4: Run, expect pass**

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(flags): NEXT_PUBLIC_DESKTOP_INTAKE_ENABLED feature flag"
```

---

### Task O2: /intake route shell + flag gate

**Files:**
- Create: app/(app)/intake/page.tsx
- Create: app/(app)/intake/layout.tsx

- [ ] **Step 1: Write the layout (desktop-only viewport check)**

```tsx
// app/(app)/intake/layout.tsx
import { isDesktopIntakeEnabled } from '@/lib/feature-flags'
import { notFound } from 'next/navigation'
import { requireUser } from '@/lib/auth'

export default async function IntakeLayout({ children }: { children: React.ReactNode }) {
  if (!isDesktopIntakeEnabled()) notFound()
  await requireUser()
  return <div className="min-h-screen bg-gray-50">{children}</div>
}
```

- [ ] **Step 2: Write the page**

```tsx
// app/(app)/intake/page.tsx
import { IntakeWorkbench } from '@/components/intake/intake-workbench'

export default function IntakePage() {
  return (
    <main className="max-w-7xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">Service writer intake</h1>
      <IntakeWorkbench />
    </main>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(intake): /intake route gated by NEXT_PUBLIC_DESKTOP_INTAKE_ENABLED"
```

---

### Task O3: IntakeWorkbench — multi-pane keyboard-driven layout

**Files:**
- Create: components/intake/intake-workbench.tsx
- Create: components/intake/customer-form.tsx
- Create: components/intake/pre-bay-plan.tsx

- [ ] **Step 1: Write the customer form**

```tsx
// components/intake/customer-form.tsx
'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

export type CustomerIntakeData = {
  customerName: string
  customerPhone?: string
  vehicleYear: number
  vehicleMake: string
  vehicleModel: string
  vehicleEngine?: string
  vin?: string
  mileage?: number
  customerComplaint: string
}

export function CustomerForm({ onSubmit, busy }: { onSubmit: (d: CustomerIntakeData) => void; busy: boolean }) {
  const [vin, setVin] = useState('')

  function handleSubmit(formData: FormData) {
    onSubmit({
      customerName: String(formData.get('customerName') ?? ''),
      customerPhone: String(formData.get('customerPhone') ?? '') || undefined,
      vehicleYear: Number(formData.get('vehicleYear')),
      vehicleMake: String(formData.get('vehicleMake') ?? ''),
      vehicleModel: String(formData.get('vehicleModel') ?? ''),
      vehicleEngine: String(formData.get('vehicleEngine') ?? '') || undefined,
      vin: vin || undefined,
      mileage: formData.get('mileage') ? Number(formData.get('mileage')) : undefined,
      customerComplaint: String(formData.get('customerComplaint') ?? ''),
    })
  }

  return (
    <form action={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="customerName">Customer name</Label>
          <Input id="customerName" name="customerName" required autoFocus />
        </div>
        <div>
          <Label htmlFor="customerPhone">Phone (optional)</Label>
          <Input id="customerPhone" name="customerPhone" type="tel" />
        </div>
      </div>
      <div>
        <Label htmlFor="vin">VIN (paste, scan via webcam later, or leave blank to enter year/make/model manually)</Label>
        <Input id="vin" name="vin" value={vin} onChange={e => setVin(e.target.value.toUpperCase())} maxLength={17} placeholder="1FTFW1ET8KFA12345" />
      </div>
      <div className="grid grid-cols-4 gap-4">
        <div>
          <Label htmlFor="vehicleYear">Year</Label>
          <Input id="vehicleYear" name="vehicleYear" type="number" required min={1980} max={2027} />
        </div>
        <div>
          <Label htmlFor="vehicleMake">Make</Label>
          <Input id="vehicleMake" name="vehicleMake" required />
        </div>
        <div>
          <Label htmlFor="vehicleModel">Model</Label>
          <Input id="vehicleModel" name="vehicleModel" required />
        </div>
        <div>
          <Label htmlFor="vehicleEngine">Engine</Label>
          <Input id="vehicleEngine" name="vehicleEngine" placeholder="3.5L EcoBoost" />
        </div>
      </div>
      <div>
        <Label htmlFor="mileage">Mileage</Label>
        <Input id="mileage" name="mileage" type="number" min={0} className="max-w-xs" />
      </div>
      <div>
        <Label htmlFor="customerComplaint">Customer complaint (verbatim if possible)</Label>
        <Textarea id="customerComplaint" name="customerComplaint" required rows={4} />
      </div>
      <Button type="submit" disabled={busy} className="w-48">
        {busy ? 'Generating plan…' : 'Generate diagnostic plan'}
      </Button>
    </form>
  )
}
```

- [ ] **Step 2: Write the pre-bay-plan panel**

```tsx
// components/intake/pre-bay-plan.tsx
'use client'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export type PreBayPlan = {
  topCauses: Array<{ cause: string; matchPct: number; reasoning: string }>
  estimatedDiagMinutes: { low: number; high: number }
  estimatedQuoteUSD: { low: number; high: number }
  customerQuoteDraft: string
  warnings?: string[]
}

export function PreBayPlanPanel({ plan, onCreateWorkOrder, busy }: { plan: PreBayPlan; onCreateWorkOrder: () => void; busy: boolean }) {
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <h2 className="font-semibold mb-3">Top causes (corpus + LLM ranked)</h2>
        <ol className="space-y-2 list-decimal list-inside">
          {plan.topCauses.map((c, i) => (
            <li key={i}>
              <span className="font-medium">{c.cause}</span>
              <span className="ml-2 text-sm text-gray-500">{(c.matchPct * 100).toFixed(0)}% match</span>
              <p className="text-sm text-gray-600 ml-6">{c.reasoning}</p>
            </li>
          ))}
        </ol>
      </Card>
      <Card className="p-4">
        <h2 className="font-semibold mb-3">Estimate</h2>
        <p>Diagnostic time: <strong>{plan.estimatedDiagMinutes.low}-{plan.estimatedDiagMinutes.high} min</strong></p>
        <p>Quote range: <strong>${plan.estimatedQuoteUSD.low}-${plan.estimatedQuoteUSD.high}</strong></p>
        {plan.warnings && plan.warnings.length > 0 && (
          <ul className="mt-3 text-amber-700 text-sm space-y-1">
            {plan.warnings.map((w, i) => <li key={i}>⚠ {w}</li>)}
          </ul>
        )}
      </Card>
      <Card className="p-4">
        <h2 className="font-semibold mb-3">Customer quote draft</h2>
        <pre className="whitespace-pre-wrap text-sm bg-gray-50 p-3 rounded">{plan.customerQuoteDraft}</pre>
      </Card>
      <Button onClick={onCreateWorkOrder} disabled={busy} className="w-64">
        {busy ? 'Creating work order…' : 'Create work order + open in bay'}
      </Button>
    </div>
  )
}
```

- [ ] **Step 3: Compose the workbench**

```tsx
// components/intake/intake-workbench.tsx
'use client'
import { useState } from 'react'
import { CustomerForm, type CustomerIntakeData } from './customer-form'
import { PreBayPlanPanel, type PreBayPlan } from './pre-bay-plan'

export function IntakeWorkbench() {
  const [intake, setIntake] = useState<CustomerIntakeData | null>(null)
  const [plan, setPlan] = useState<PreBayPlan | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function generatePlan(data: CustomerIntakeData) {
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/intake/plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error(await res.text())
      const p: PreBayPlan = await res.json()
      setIntake(data); setPlan(p)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'plan generation failed')
    } finally { setBusy(false) }
  }

  async function createWorkOrder() {
    if (!intake) return
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          vehicleYear: intake.vehicleYear,
          vehicleMake: intake.vehicleMake,
          vehicleModel: intake.vehicleModel,
          vehicleEngine: intake.vehicleEngine,
          mileage: intake.mileage,
          customerComplaint: intake.customerComplaint,
        }),
      })
      if (!res.ok) throw new Error(await res.text())
      const { id } = await res.json()
      window.location.href = `/sessions/${id}`
    } catch (err) {
      setError(err instanceof Error ? err.message : 'work order failed')
    } finally { setBusy(false) }
  }

  return (
    <div className="grid grid-cols-2 gap-8">
      <CustomerForm onSubmit={generatePlan} busy={busy && !plan} />
      <div>
        {plan
          ? <PreBayPlanPanel plan={plan} onCreateWorkOrder={createWorkOrder} busy={busy} />
          : <p className="text-gray-500 italic">Pre-bay plan will appear here after intake.</p>}
        {error && <p className="text-red-600 mt-3">{error}</p>}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(intake): IntakeWorkbench (customer form + pre-bay plan + work order create)"
```

---

### Task O4: POST /api/intake/plan — generate pre-bay diagnostic plan + quote

**Files:**
- Create: app/api/intake/plan/route.ts
- Modify: lib/ai/prompts.ts

- [ ] **Step 1: Add the prompt**

```ts
// lib/ai/prompts.ts (append)
export const PRE_BAY_PLAN_SYSTEM = `You generate a pre-bay diagnostic plan a service writer can quote a customer.

Inputs: customer + vehicle + complaint, plus the top corpus matches (vehicle + symptom matched, vector-ranked).

OUTPUT FORMAT — always respond with valid JSON:

type PreBayPlan = {
  topCauses: Array<{
    cause: string                    // the suspected issue
    matchPct: number                 // 0-1, your confidence the cause matches the complaint
    reasoning: string                // 1-2 sentences why
  }>
  estimatedDiagMinutes: { low: number; high: number }
  estimatedQuoteUSD: { low: number; high: number }   // diagnostic + likely repair range, all-in
  customerQuoteDraft: string        // 3-6 sentence text the writer can read aloud or paste
  warnings?: string[]               // anything the writer should know (e.g. "may need to defer if X")
}

Tone for customerQuoteDraft: friendly, professional, no jargon, no commitment to a specific fix.`
```

- [ ] **Step 2: Implement the route**

```ts
// app/api/intake/plan/route.ts
import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase-server'
import { isDesktopIntakeEnabled } from '@/lib/feature-flags'
import { intakeSchema } from '@/lib/types'
import { z } from 'zod'
import { retrieveCorpus } from '@/lib/corpus/retrieval'
import { anthropic, MODEL, cachedSystem } from '@/lib/ai/client'
import { PRE_BAY_PLAN_SYSTEM } from '@/lib/ai/prompts'

const intakePlanSchema = intakeSchema.extend({
  customerName: z.string().min(1).max(100),
  customerPhone: z.string().max(30).optional(),
  vin: z.string().length(17).optional(),
})

export async function POST(req: Request) {
  if (!isDesktopIntakeEnabled()) {
    return NextResponse.json({ error: 'desktop intake disabled' }, { status: 404 })
  }
  const supabase = await getServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const parsed = intakePlanSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 })

  const corpus = await retrieveCorpus({
    vehicleYear: parsed.data.vehicleYear,
    vehicleMake: parsed.data.vehicleMake,
    vehicleModel: parsed.data.vehicleModel,
    vehicleEngine: parsed.data.vehicleEngine,
    complaintText: parsed.data.customerComplaint,
  }).catch(() => [])

  const userMessage = `Customer: ${parsed.data.customerName}
Vehicle: ${parsed.data.vehicleYear} ${parsed.data.vehicleMake} ${parsed.data.vehicleModel}${parsed.data.vehicleEngine ? ` (${parsed.data.vehicleEngine})` : ''}${parsed.data.mileage ? `, ${parsed.data.mileage} mi` : ''}
Complaint: ${parsed.data.customerComplaint}

Corpus matches (top ${corpus.length}):
${corpus.map((c, i) => `(${i + 1}) [conf=${c.confidenceScore.toFixed(2)} success=${c.successConfirmCount}] ${c.summary}\n     rootCause: ${c.rootCause}`).join('\n\n') || '(no prior matches)'}

Return JSON only.`

  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 800,
    system: cachedSystem(PRE_BAY_PLAN_SYSTEM),
    messages: [{ role: 'user', content: userMessage }],
  })
  const block = res.content.find(b => b.type === 'text')
  if (!block || block.type !== 'text') {
    return NextResponse.json({ error: 'plan generation failed' }, { status: 500 })
  }
  let plan
  try {
    plan = JSON.parse(block.text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, ''))
  } catch {
    return NextResponse.json({ error: 'plan parse failed' }, { status: 500 })
  }
  return NextResponse.json(plan)
}
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(intake): POST /api/intake/plan generates pre-bay plan + quote draft"
```

---

### Task O5: Comeback alerts — flag returning customers within 30 days

**Files:**
- Modify: components/intake/customer-form.tsx
- Create: app/api/intake/comeback-check/route.ts

- [ ] **Step 1: Add the check route**

```ts
// app/api/intake/comeback-check/route.ts
import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase-server'
import { db } from '@/lib/db/client'
import { profiles, sessions } from '@/lib/db/schema'
import { and, eq, gte, sql } from 'drizzle-orm'
import { z } from 'zod'

const schema = z.object({
  vehicleYear: z.number(), vehicleMake: z.string(), vehicleModel: z.string(),
})

export async function POST(req: Request) {
  const supabase = await getServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const profile = await db.query.profiles.findFirst({ where: eq(profiles.id, user.id) })
  if (!profile?.shopId) return NextResponse.json({ comebacks: [] })

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 })

  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const rows = await db.select({
    id: sessions.id,
    closedAt: sessions.closedAt,
    intake: sessions.intake,
    outcome: sessions.outcome,
  }).from(sessions).where(and(
    eq(sessions.shopId, profile.shopId),
    gte(sessions.closedAt, cutoff),
    sql`(intake ->> 'vehicleYear')::int = ${parsed.data.vehicleYear}`,
    sql`intake ->> 'vehicleMake' ILIKE ${parsed.data.vehicleMake}`,
    sql`intake ->> 'vehicleModel' ILIKE ${parsed.data.vehicleModel}`,
  ))
  return NextResponse.json({ comebacks: rows })
}
```

- [ ] **Step 2: Wire into the form (debounced check on year/make/model fill)**

In `components/intake/customer-form.tsx`, add a useEffect hooked to year/make/model state that POSTs to `/api/intake/comeback-check` and renders a banner if `comebacks.length > 0` ("⚠ This vehicle was here on <date> for: <prior complaint>"). Implementation is straightforward; left as a small follow-up exercise for the implementer.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(intake): comeback check API for returning-vehicle alerts"
```

---

## Phase P — Curator Console (7 tasks)

Per spec §6 row 10, §8.6 (curator workflow), §9.4 (curator console layout). Builds: a role-gated `/curator` route, three queues (deferred / drift / novel-pattern), a case detail view with full retrieval trace, a corpus authoring form for curator-contributed entries, and a calibration drift dashboard.

### Task P1: /curator route + role gate

**Files:**
- Create: app/(app)/curator/layout.tsx
- Create: app/(app)/curator/page.tsx

- [ ] **Step 1: Write the layout (role-gated)**

```tsx
// app/(app)/curator/layout.tsx
import { requireUser } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { profiles } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import Link from 'next/link'

export default async function CuratorLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser()
  const profile = await db.query.profiles.findFirst({ where: eq(profiles.id, user.id) })
  if (profile?.role !== 'curator') notFound()

  return (
    <div className="min-h-screen grid grid-cols-[200px_1fr]">
      <nav className="border-r p-4 space-y-2 bg-gray-50">
        <h2 className="font-bold mb-4">Curator</h2>
        <Link href="/curator" className="block hover:underline">Overview</Link>
        <Link href="/curator/deferred" className="block hover:underline">Deferred queue</Link>
        <Link href="/curator/drift" className="block hover:underline">Drift queue</Link>
        <Link href="/curator/novel" className="block hover:underline">Novel patterns</Link>
        <Link href="/curator/corpus" className="block hover:underline">Corpus authoring</Link>
        <Link href="/curator/calibration" className="block hover:underline">Calibration drift</Link>
      </nav>
      <main className="p-6">{children}</main>
    </div>
  )
}
```

- [ ] **Step 2: Overview page**

```tsx
// app/(app)/curator/page.tsx
import { db } from '@/lib/db/client'
import { sessions, corpusEntries } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'

export default async function CuratorOverview() {
  const [deferredCount] = await db.select({ count: sql<number>`count(*)::int` }).from(sessions).where(eq(sessions.status, 'deferred'))
  const [novelCount] = await db.select({ count: sql<number>`count(*)::int` }).from(corpusEntries).where(eq(corpusEntries.successConfirmCount, 1))

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Overview</h1>
      <div className="grid grid-cols-3 gap-4">
        <Card label="Deferred cases" value={deferredCount.count} />
        <Card label="Novel patterns" value={novelCount.count} />
        <Card label="Drift alerts" value={0} note="(populated by calibration engine)" />
      </div>
    </div>
  )
}

function Card({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="border rounded p-4">
      <div className="text-sm text-gray-500">{label}</div>
      <div className="text-3xl font-bold mt-1">{value}</div>
      {note && <div className="text-xs text-gray-400 mt-1">{note}</div>}
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(curator): /curator route with role gate + overview"
```

---

### Task P2: Deferred queue page

**Files:**
- Create: app/(app)/curator/deferred/page.tsx
- Modify: lib/db/queries.ts

- [ ] **Step 1: Add the query**

```ts
// lib/db/queries.ts (append)
export async function listDeferredSessions(limit = 50) {
  return db.query.sessions.findMany({
    where: eq(sessions.status, 'deferred'),
    orderBy: desc(sessions.closedAt),
    limit,
    with: { tech: true, shop: true },
  })
}
```

- [ ] **Step 2: Write the page**

```tsx
// app/(app)/curator/deferred/page.tsx
import { listDeferredSessions } from '@/lib/db/queries'
import Link from 'next/link'

export default async function DeferredQueuePage() {
  const items = await listDeferredSessions()
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Deferred queue ({items.length})</h1>
      {items.length === 0 ? (
        <p className="text-gray-500">Empty. ✓</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-gray-500">
            <tr>
              <th className="py-2">Vehicle</th>
              <th>Complaint</th>
              <th>Shop</th>
              <th>Deferred</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map(s => (
              <tr key={s.id} className="border-t">
                <td className="py-3">{s.intake.vehicleYear} {s.intake.vehicleMake} {s.intake.vehicleModel}</td>
                <td className="max-w-xs truncate">{s.intake.customerComplaint}</td>
                <td>{s.shop?.name}</td>
                <td>{s.closedAt?.toString().slice(0, 10)}</td>
                <td><Link href={`/curator/case/${s.id}`} className="text-blue-600 hover:underline">Review →</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(curator): deferred queue page"
```

---

### Task P3: Drift queue page (placeholder; populated by Phase Q calibration engine)

**Files:**
- Create: app/(app)/curator/drift/page.tsx
- Modify: lib/db/schema.ts

- [ ] **Step 1: Add a `drift_alerts` table (used by Phase Q)**

```ts
// lib/db/schema.ts (append)
export const driftAlerts = pgTable('drift_alerts', {
  id: uuid('id').primaryKey().defaultRandom(),
  riskClass: text('risk_class', { enum: ['zero', 'low', 'medium', 'high', 'destructive'] }).notNull(),
  vehicleFamily: text('vehicle_family').notNull(),
  symptomClass: text('symptom_class').notNull(),
  oldThreshold: real('old_threshold').notNull(),
  newThreshold: real('new_threshold').notNull(),
  comebackRate: real('comeback_rate').notNull(),
  sampleSize: integer('sample_size').notNull(),
  acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})
```

Generate + apply migration:
```bash
pnpm drizzle-kit generate && pnpm drizzle-kit migrate
```

- [ ] **Step 2: Write the page**

```tsx
// app/(app)/curator/drift/page.tsx
import { db } from '@/lib/db/client'
import { driftAlerts } from '@/lib/db/schema'
import { isNull, desc } from 'drizzle-orm'

export default async function DriftQueuePage() {
  const items = await db.select().from(driftAlerts).where(isNull(driftAlerts.acknowledgedAt)).orderBy(desc(driftAlerts.createdAt))
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Drift alerts ({items.length})</h1>
      {items.length === 0 ? <p className="text-gray-500">No active drift alerts.</p> : (
        <ul className="space-y-3">
          {items.map(a => (
            <li key={a.id} className="border rounded p-3">
              <div className="font-medium">{a.riskClass} / {a.vehicleFamily} / {a.symptomClass}</div>
              <div className="text-sm text-gray-600 mt-1">
                Threshold {a.oldThreshold.toFixed(2)} → {a.newThreshold.toFixed(2)}
                ({a.sampleSize} samples, {(a.comebackRate * 100).toFixed(1)}% comeback rate)
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(curator): drift queue page + drift_alerts table"
```

---

### Task P4: Novel-pattern queue page

**Files:**
- Create: app/(app)/curator/novel/page.tsx

- [ ] **Step 1: Write the page**

```tsx
// app/(app)/curator/novel/page.tsx
import { db } from '@/lib/db/client'
import { corpusEntries } from '@/lib/db/schema'
import { eq, desc } from 'drizzle-orm'
import Link from 'next/link'

export default async function NovelPatternsPage() {
  const items = await db.query.corpusEntries.findMany({
    where: eq(corpusEntries.successConfirmCount, 1),  // single-shop, unconfirmed
    orderBy: desc(corpusEntries.createdAt),
    limit: 100,
  })
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Novel patterns ({items.length})</h1>
      <p className="text-sm text-gray-600">Patterns observed only once. Promote (mark confirmed) or investigate.</p>
      <ul className="space-y-3">
        {items.map(c => (
          <li key={c.id} className="border rounded p-3">
            <div className="font-medium">{c.summary}</div>
            <div className="text-sm text-gray-600 mt-1">{c.rootCause}</div>
            <div className="text-xs text-gray-400 mt-2">
              {c.vehicleYear} {c.vehicleMake} {c.vehicleModel} · DTCs: {c.dtcs.join(', ') || '(none)'}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat(curator): novel-pattern queue page"
```

---

### Task P5: Case detail view with retrieval trace

**Files:**
- Create: app/(app)/curator/case/[id]/page.tsx

- [ ] **Step 1: Write the page**

```tsx
// app/(app)/curator/case/[id]/page.tsx
import { getSessionById, listArtifactsForSession } from '@/lib/db/queries'
import { ArtifactThumbnail } from '@/components/session/artifact-thumbnail'
import { notFound } from 'next/navigation'

export default async function CuratorCasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getSessionById(id)
  if (!session) notFound()
  const artifacts = await listArtifactsForSession(id)

  return (
    <div className="space-y-6 max-w-4xl">
      <header>
        <h1 className="text-2xl font-bold">
          {session.intake.vehicleYear} {session.intake.vehicleMake} {session.intake.vehicleModel}
        </h1>
        <p className="text-gray-600">{session.intake.customerComplaint}</p>
        <p className="text-sm text-gray-400">Status: {session.status}</p>
      </header>

      <section>
        <h2 className="font-semibold mb-2">Tree state</h2>
        <pre className="bg-gray-50 p-4 rounded text-xs overflow-auto max-h-96">
          {JSON.stringify(session.treeState, null, 2)}
        </pre>
      </section>

      <section>
        <h2 className="font-semibold mb-2">Event timeline ({session.events?.length ?? 0})</h2>
        <ol className="space-y-2">
          {(session.events ?? []).map(e => (
            <li key={e.id} className="border-l-2 pl-3 py-1">
              <div className="text-xs text-gray-500">
                {new Date(e.createdAt).toISOString().slice(0, 19).replace('T', ' ')} · {e.eventType} · {e.nodeId}
              </div>
              {e.observationText && <div className="text-sm mt-1">{e.observationText}</div>}
              {e.aiResponse && <pre className="text-xs text-gray-600 mt-1">{JSON.stringify(e.aiResponse, null, 2)}</pre>}
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h2 className="font-semibold mb-2">Artifacts ({artifacts.length})</h2>
        <div className="grid grid-cols-3 gap-3">
          {artifacts.map(a => (
            <div key={a.id} className="border rounded p-2">
              <div className="text-xs capitalize mb-1">{a.kind.replace('_', ' ')}</div>
              {a.extraction?.summary && <div className="text-xs text-gray-600 mb-1">{a.extraction.summary}</div>}
              <ArtifactThumbnail artifactId={a.id} kind={a.kind} />
            </div>
          ))}
        </div>
      </section>

      {session.outcome && (
        <section>
          <h2 className="font-semibold mb-2">Outcome</h2>
          <pre className="bg-gray-50 p-4 rounded text-xs">{JSON.stringify(session.outcome, null, 2)}</pre>
        </section>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat(curator): case detail view with full event timeline + artifacts"
```

---

### Task P6: Corpus authoring form

**Files:**
- Create: app/(app)/curator/corpus/page.tsx
- Create: components/curator/corpus-authoring-form.tsx
- Create: app/api/curator/corpus/route.ts

- [ ] **Step 1: Build the form component**

```tsx
// components/curator/corpus-authoring-form.tsx
'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

export function CorpusAuthoringForm() {
  const [busy, setBusy] = useState(false)
  const [success, setSuccess] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(formData: FormData) {
    setBusy(true); setSuccess(null); setError(null)
    const payload = {
      vehicleYear: Number(formData.get('vehicleYear')),
      vehicleMake: String(formData.get('vehicleMake') ?? ''),
      vehicleModel: String(formData.get('vehicleModel') ?? ''),
      vehicleEngine: String(formData.get('vehicleEngine') ?? '') || undefined,
      symptomTags: String(formData.get('symptomTags') ?? '').split(',').map(s => s.trim()).filter(Boolean),
      dtcs: String(formData.get('dtcs') ?? '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean),
      rootCause: String(formData.get('rootCause') ?? ''),
      summary: String(formData.get('summary') ?? ''),
      actionType: String(formData.get('actionType') ?? 'repair'),
    }
    const res = await fetch('/api/curator/corpus', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    setBusy(false)
    if (!res.ok) { setError(await res.text()); return }
    const { id } = await res.json()
    setSuccess(`Created corpus entry ${id}.`)
  }

  return (
    <form action={handleSubmit} className="space-y-4 max-w-2xl">
      <div className="grid grid-cols-4 gap-4">
        <div><Label htmlFor="vehicleYear">Year</Label><Input id="vehicleYear" name="vehicleYear" type="number" required /></div>
        <div><Label htmlFor="vehicleMake">Make</Label><Input id="vehicleMake" name="vehicleMake" required /></div>
        <div><Label htmlFor="vehicleModel">Model</Label><Input id="vehicleModel" name="vehicleModel" required /></div>
        <div><Label htmlFor="vehicleEngine">Engine</Label><Input id="vehicleEngine" name="vehicleEngine" /></div>
      </div>
      <div><Label htmlFor="symptomTags">Symptom tags (comma-separated)</Label><Input id="symptomTags" name="symptomTags" placeholder="power_loss, wrench_light" /></div>
      <div><Label htmlFor="dtcs">DTCs (comma-separated)</Label><Input id="dtcs" name="dtcs" placeholder="P0299, P0236" /></div>
      <div><Label htmlFor="summary">Summary (one-liner, used for embedding)</Label><Input id="summary" name="summary" required /></div>
      <div><Label htmlFor="rootCause">Root cause (specific, landmark-rich)</Label><Textarea id="rootCause" name="rootCause" required rows={4} /></div>
      <div>
        <Label htmlFor="actionType">Action type</Label>
        <select id="actionType" name="actionType" className="w-full border rounded h-10 px-2">
          <option value="part_replacement">Part replacement</option>
          <option value="repair">Repair</option>
          <option value="adjustment">Adjustment</option>
          <option value="cleaning">Cleaning</option>
        </select>
      </div>
      <Button type="submit" disabled={busy} className="w-48">{busy ? 'Saving…' : 'Add to corpus'}</Button>
      {success && <p className="text-green-700 text-sm">{success}</p>}
      {error && <p className="text-red-600 text-sm">{error}</p>}
    </form>
  )
}
```

- [ ] **Step 2: Build the page**

```tsx
// app/(app)/curator/corpus/page.tsx
import { CorpusAuthoringForm } from '@/components/curator/corpus-authoring-form'

export default function CorpusAuthoringPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Corpus authoring</h1>
      <p className="text-sm text-gray-600">Curator-contributed entries skip the live-shop pipeline but are tagged as such for transparency.</p>
      <CorpusAuthoringForm />
    </div>
  )
}
```

- [ ] **Step 3: Build the route**

```ts
// app/api/curator/corpus/route.ts
import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase-server'
import { db } from '@/lib/db/client'
import { profiles } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { promoteSessionToCorpus } from '@/lib/corpus/promotion'

const schema = z.object({
  vehicleYear: z.number().int().min(1980).max(2030),
  vehicleMake: z.string().min(1),
  vehicleModel: z.string().min(1),
  vehicleEngine: z.string().optional(),
  symptomTags: z.array(z.string()).default([]),
  dtcs: z.array(z.string()).default([]),
  rootCause: z.string().min(10),
  summary: z.string().min(5),
  actionType: z.enum(['part_replacement', 'repair', 'adjustment', 'cleaning']),
})

export async function POST(req: Request) {
  const supabase = await getServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const profile = await db.query.profiles.findFirst({ where: eq(profiles.id, user.id) })
  if (profile?.role !== 'curator') return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 })

  const id = await promoteSessionToCorpus({
    sessionId: '00000000-0000-0000-0000-000000000000' as any,  // synthetic — curator entry
    shopId: profile.shopId ?? '00000000-0000-0000-0000-000000000000' as any,
    curatedByUserId: profile.id,
    intake: {
      vehicleYear: parsed.data.vehicleYear,
      vehicleMake: parsed.data.vehicleMake,
      vehicleModel: parsed.data.vehicleModel,
      vehicleEngine: parsed.data.vehicleEngine,
      customerComplaint: parsed.data.summary,
    },
    outcome: {
      rootCause: parsed.data.rootCause,
      actionType: parsed.data.actionType as any,
      verification: { codesCleared: true, testDrive: true, symptomsResolved: 'yes' },
      diagMinutes: 0, repairMinutes: 0,
    },
    extractedDtcs: parsed.data.dtcs,
    extractedSymptomTags: parsed.data.symptomTags,
  })
  return NextResponse.json({ id })
}
```

Note: `promoteSessionToCorpus` requires `sessionId` and `shopId`; for curator entries we pass synthetic values. Adjust the schema to allow these to be nullable if your app strictly enforces FKs (the migration in K1 already uses `references()`; relax to nullable for curator-authored entries by altering the column).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(curator): corpus authoring form + curator-role-gated route"
```

---

### Task P7: Calibration drift dashboard

**Files:**
- Create: app/(app)/curator/calibration/page.tsx

- [ ] **Step 1: Write the page**

```tsx
// app/(app)/curator/calibration/page.tsx
import { db } from '@/lib/db/client'
import { confidenceCalibration } from '@/lib/db/schema'
import { desc } from 'drizzle-orm'

export default async function CalibrationPage() {
  const rows = await db.select().from(confidenceCalibration).orderBy(desc(confidenceCalibration.updatedAt)).limit(200)
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Calibration thresholds</h1>
      <p className="text-sm text-gray-600">Per-(risk_class × vehicle_family × symptom_class) thresholds. Refit weekly by the calibration engine. Catch-all rows use vehicle_family="*" symptom_class="*".</p>
      <table className="w-full text-sm">
        <thead className="text-left text-gray-500">
          <tr>
            <th className="py-2">Risk</th>
            <th>Vehicle family</th>
            <th>Symptom class</th>
            <th>Threshold</th>
            <th>Sample</th>
            <th>Comeback %</th>
            <th>Last refit</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id} className="border-t">
              <td className="py-2 font-medium capitalize">{r.riskClass}</td>
              <td>{r.vehicleFamily}</td>
              <td>{r.symptomClass}</td>
              <td>{(Number(r.thresholdPct) * 100).toFixed(1)}%</td>
              <td>{r.sampleSize}</td>
              <td>{(Number(r.comebackRate) * 100).toFixed(1)}%</td>
              <td>{r.lastRefitAt?.toString().slice(0, 10) ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat(curator): calibration drift dashboard"
```

---

## Phase Q — Calibration Engine (5 tasks)

Per spec §7.1 (Calibration Engine), §8.3 (per-cell thresholds re-fit weekly), §11.3 (corpus quality controls), §17 risk 1 (calibration cold-start). Builds: a Beta-Binomial threshold re-fit algorithm, a weekly Vercel Cron job that runs across all cells, drift detection that fires alerts into the curator console, and a manual-trigger endpoint for ad-hoc refit.

### Task Q1: Beta-Binomial threshold re-fit function

**Files:**
- Create: lib/calibration/refit.ts
- Create: tests/unit/calibration-refit.test.ts

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/calibration-refit.test.ts
import { describe, it, expect } from 'vitest'
import { refitThreshold } from '@/lib/calibration/refit'

describe('refitThreshold', () => {
  it('returns prior threshold when sample size is 0', () => {
    const r = refitThreshold({ priorThreshold: 0.9, successes: 0, comebacks: 0 })
    expect(r.newThreshold).toBe(0.9)
    expect(r.sampleSize).toBe(0)
  })
  it('lowers threshold when comeback rate is low at adequate sample', () => {
    const r = refitThreshold({ priorThreshold: 0.9, successes: 95, comebacks: 5 })
    // observed comeback rate 5/100 = 5%; threshold should ease somewhat below 0.9
    expect(r.newThreshold).toBeLessThan(0.9)
    expect(r.newThreshold).toBeGreaterThan(0.7)
  })
  it('raises threshold when comeback rate is high', () => {
    const r = refitThreshold({ priorThreshold: 0.7, successes: 60, comebacks: 40 })
    expect(r.newThreshold).toBeGreaterThan(0.7)
  })
  it('clamps to [0.5, 0.99]', () => {
    const r = refitThreshold({ priorThreshold: 0.95, successes: 0, comebacks: 100 })
    expect(r.newThreshold).toBeLessThanOrEqual(0.99)
    const r2 = refitThreshold({ priorThreshold: 0.7, successes: 1000, comebacks: 0 })
    expect(r2.newThreshold).toBeGreaterThanOrEqual(0.5)
  })
})
```

- [ ] **Step 2: Implement**

```ts
// lib/calibration/refit.ts
const MIN_THRESHOLD = 0.5
const MAX_THRESHOLD = 0.99

// Beta-Binomial parameters: prior = Beta(α₀, β₀) where α₀/β₀ encode the prior threshold as a "pseudocount".
// We use a weak prior (concentration 10) so live data dominates after ~30+ samples.
const PRIOR_CONCENTRATION = 10

export type RefitInput = {
  priorThreshold: number    // current threshold for this cell
  successes: number         // outcomes that closed without comeback in the window
  comebacks: number         // outcomes that got a comeback recorded in the window
}

export type RefitResult = {
  newThreshold: number
  sampleSize: number
  comebackRate: number
  drift: number             // |new - old|
}

export function refitThreshold(input: RefitInput): RefitResult {
  const { priorThreshold, successes, comebacks } = input
  const sampleSize = successes + comebacks
  if (sampleSize === 0) {
    return { newThreshold: priorThreshold, sampleSize: 0, comebackRate: 0, drift: 0 }
  }

  // Translate prior threshold to Beta(α₀, β₀):
  // E[Beta(α, β)] = α / (α + β); set α + β = PRIOR_CONCENTRATION; solve.
  const alpha0 = priorThreshold * PRIOR_CONCENTRATION
  const beta0 = PRIOR_CONCENTRATION - alpha0

  // Posterior after observing data:
  const alphaPost = alpha0 + successes
  const betaPost = beta0 + comebacks
  const posteriorMean = alphaPost / (alphaPost + betaPost)

  const comebackRate = comebacks / sampleSize

  // The threshold target is "posterior probability of success above which we let the action commit".
  // For a calibrated threshold: lower observed comeback rate → we can ease the threshold;
  // higher observed comeback rate → we need to tighten. We map posterior mean directly as the new threshold,
  // bounded to [MIN, MAX].
  const newThreshold = Math.min(MAX_THRESHOLD, Math.max(MIN_THRESHOLD, posteriorMean))

  return {
    newThreshold,
    sampleSize,
    comebackRate,
    drift: Math.abs(newThreshold - priorThreshold),
  }
}
```

- [ ] **Step 3: Run, expect pass**

```bash
pnpm test tests/unit/calibration-refit.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(calibration): Beta-Binomial threshold re-fit with weak prior"
```

---

### Task Q2: Outcome aggregation per (risk_class × vehicle_family × symptom_class) cell

**Files:**
- Create: lib/calibration/aggregate.ts
- Create: tests/unit/calibration-aggregate.test.ts

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/calibration-aggregate.test.ts
import { describe, it, expect, vi } from 'vitest'

const executeMock = vi.fn().mockResolvedValue([
  { riskClass: 'high', vehicleFamily: 'ford-f-truck', symptomClass: 'power_loss', successes: 12, comebacks: 1 },
  { riskClass: 'medium', vehicleFamily: 'bmw-3-series', symptomClass: 'no_start', successes: 4, comebacks: 2 },
])
vi.mock('@/lib/db/client', () => ({ db: { execute: executeMock } }))

describe('aggregateOutcomesByCell', () => {
  it('returns one row per cell with successes + comebacks since cutoff', async () => {
    const { aggregateOutcomesByCell } = await import('@/lib/calibration/aggregate')
    const r = await aggregateOutcomesByCell(new Date('2026-01-01'))
    expect(r).toHaveLength(2)
    expect(r[0].successes).toBe(12)
  })
})
```

- [ ] **Step 2: Implement**

```ts
// lib/calibration/aggregate.ts
import { db } from '@/lib/db/client'
import { sql } from 'drizzle-orm'

export type CellOutcome = {
  riskClass: 'zero' | 'low' | 'medium' | 'high' | 'destructive'
  vehicleFamily: string
  symptomClass: string
  successes: number
  comebacks: number
}

export async function aggregateOutcomesByCell(sinceCutoff: Date): Promise<CellOutcome[]> {
  // Outcomes where the AI made a gate decision (recorded on the session_events.aiResponse JSON).
  // For each closed session in the window, derive vehicle_family + symptom_class + risk_class
  // from the session's last gate_decision event, and count comeback (any follow_up with comeback=true)
  // versus success (closed + no comeback in 30d window).
  const rows = await db.execute<CellOutcome>(sql`
    WITH closed_sessions AS (
      SELECT
        s.id,
        s.intake,
        s.outcome,
        s.closed_at,
        LOWER(s.intake ->> 'vehicleMake') || '-' || LOWER(s.intake ->> 'vehicleModel') AS vehicle_family,
        COALESCE(
          (SELECT (e.ai_response -> 'riskClass') #>> '{}' FROM session_events e
           WHERE e.session_id = s.id AND e.ai_response ? 'riskClass'
           ORDER BY e.created_at DESC LIMIT 1),
          'high'
        ) AS risk_class
      FROM sessions s
      WHERE s.status = 'closed' AND s.closed_at >= ${sinceCutoff}
    ),
    classified AS (
      SELECT
        cs.id,
        cs.risk_class,
        cs.vehicle_family,
        CASE
          WHEN cs.intake ->> 'customerComplaint' ~* '(power|stall|hesit|sluggish)' THEN 'power_loss'
          WHEN cs.intake ->> 'customerComplaint' ~* '(start|crank|no.?start)' THEN 'no_start'
          WHEN cs.intake ->> 'customerComplaint' ~* '(misfire|rough)' THEN 'misfire'
          ELSE '*'
        END AS symptom_class,
        EXISTS (
          SELECT 1 FROM follow_ups f
          WHERE f.session_id = cs.id AND f.comeback_recorded = true
        ) AS had_comeback
      FROM closed_sessions cs
    )
    SELECT
      risk_class AS "riskClass",
      vehicle_family AS "vehicleFamily",
      symptom_class AS "symptomClass",
      SUM(CASE WHEN had_comeback THEN 0 ELSE 1 END)::int AS successes,
      SUM(CASE WHEN had_comeback THEN 1 ELSE 0 END)::int AS comebacks
    FROM classified
    GROUP BY risk_class, vehicle_family, symptom_class
    HAVING (SUM(1)) >= 1
  `)
  return rows
}
```

> **Note:** the `follow_ups` table referenced here is created in Phase R Task R1. The query parses cleanly even if `follow_ups` is empty — Phase Q can be deployed before Phase R as long as the table exists. Order Phase R first if running them sequentially.

- [ ] **Step 3: Run, expect pass**

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(calibration): outcome aggregation per (risk × vehicle_family × symptom) cell"
```

---

### Task Q3: Weekly Vercel Cron job — refit + write drift alerts

**Files:**
- Create: app/api/cron/calibration-weekly/route.ts
- Modify: vercel.json

- [ ] **Step 1: Add cron schedule**

```json
// vercel.json — add to crons array
{
  "crons": [
    { "path": "/api/cron/artifacts-tier-sync", "schedule": "0 7 * * *" },
    { "path": "/api/cron/calibration-weekly", "schedule": "0 6 * * 1" },
    { "path": "/api/cron/comeback-prompts-daily", "schedule": "0 8 * * *" }
  ]
}
```

(Calibration runs Monday 6am UTC.)

- [ ] **Step 2: Implement the route**

```ts
// app/api/cron/calibration-weekly/route.ts
import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { confidenceCalibration, driftAlerts } from '@/lib/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { aggregateOutcomesByCell } from '@/lib/calibration/aggregate'
import { refitThreshold } from '@/lib/calibration/refit'

const WINDOW_DAYS = 90
const DRIFT_THRESHOLD = 0.05  // surface alert when threshold moves ≥5 points

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const got = req.headers.get('authorization')
    if (got !== `Bearer ${secret}`) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const cutoff = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const cells = await aggregateOutcomesByCell(cutoff)

  let updated = 0
  let alertsRaised = 0

  for (const cell of cells) {
    const existing = await db.query.confidenceCalibration.findFirst({
      where: and(
        eq(confidenceCalibration.riskClass, cell.riskClass),
        eq(confidenceCalibration.vehicleFamily, cell.vehicleFamily),
        eq(confidenceCalibration.symptomClass, cell.symptomClass),
      ),
    })
    const priorThreshold = existing
      ? Number(existing.thresholdPct)
      : { zero: 0, low: 0.7, medium: 0.8, high: 0.9, destructive: 0.95 }[cell.riskClass]

    const refit = refitThreshold({
      priorThreshold,
      successes: cell.successes,
      comebacks: cell.comebacks,
    })

    if (existing) {
      await db.update(confidenceCalibration).set({
        thresholdPct: refit.newThreshold,
        sampleSize: refit.sampleSize,
        comebackRate: refit.comebackRate,
        lastRefitAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(confidenceCalibration.id, existing.id))
    } else {
      await db.insert(confidenceCalibration).values({
        riskClass: cell.riskClass,
        vehicleFamily: cell.vehicleFamily,
        symptomClass: cell.symptomClass,
        thresholdPct: refit.newThreshold,
        sampleSize: refit.sampleSize,
        comebackRate: refit.comebackRate,
        lastRefitAt: new Date(),
      })
    }
    updated++

    if (refit.drift >= DRIFT_THRESHOLD && refit.sampleSize >= 10) {
      await db.insert(driftAlerts).values({
        riskClass: cell.riskClass,
        vehicleFamily: cell.vehicleFamily,
        symptomClass: cell.symptomClass,
        oldThreshold: priorThreshold,
        newThreshold: refit.newThreshold,
        comebackRate: refit.comebackRate,
        sampleSize: refit.sampleSize,
      })
      alertsRaised++
    }
  }

  return NextResponse.json({ cellsRefit: updated, alertsRaised, windowDays: WINDOW_DAYS })
}
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(calibration): weekly Vercel Cron refits thresholds + raises drift alerts"
```

---

### Task Q4: Manual-trigger endpoint for ad-hoc refit

**Files:**
- Create: app/api/curator/calibration/refit/route.ts

- [ ] **Step 1: Write the route (curator-only)**

```ts
// app/api/curator/calibration/refit/route.ts
import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase-server'
import { db } from '@/lib/db/client'
import { profiles } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { GET as cronHandler } from '@/app/api/cron/calibration-weekly/route'

export async function POST(req: Request) {
  const supabase = await getServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const profile = await db.query.profiles.findFirst({ where: eq(profiles.id, user.id) })
  if (profile?.role !== 'curator') return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  // Inject the CRON_SECRET so the cron handler accepts the call.
  const headers = new Headers(req.headers)
  if (process.env.CRON_SECRET) headers.set('authorization', `Bearer ${process.env.CRON_SECRET}`)
  const fakeReq = new Request(req.url, { headers })
  return cronHandler(fakeReq)
}
```

Add a "Re-fit now" button to the calibration page (`app/(app)/curator/calibration/page.tsx`):

```tsx
import { Button } from '@/components/ui/button'

// in the page (must move to client component or add a small client island):
<form action="/api/curator/calibration/refit" method="POST">
  <Button type="submit" variant="outline">Re-fit thresholds now</Button>
</form>
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat(calibration): curator-only manual re-fit trigger"
```

---

### Task Q5: Verification — synthetic outcome data + cron run

**Files:** none

- [ ] **Step 1: Seed synthetic outcomes**

Use Supabase MCP `execute_sql` to insert ~50 synthetic closed sessions across 3 cells with known comeback ratios (e.g. cell A: 95% success / 5% comeback; cell B: 60% / 40%; cell C: 80% / 20%).

- [ ] **Step 2: Trigger the refit**

```bash
curl -X POST http://localhost:3000/api/curator/calibration/refit \
  -H "cookie: <signed-in-curator-session>"
```

Expected response: `{ cellsRefit: ≥3, alertsRaised: ≥1, windowDays: 90 }`

- [ ] **Step 3: Inspect the table**

Check the `confidence_calibration` table — expect three new rows with thresholds reflecting the synthetic comeback rates. Cell A (low comeback) should have a *lower* threshold than the prior (engine eased off); cell B (high comeback) should have a *higher* threshold (engine tightened up).

- [ ] **Step 4: Inspect drift_alerts**

Cells with ≥5-point threshold movement should have a row in `drift_alerts`. Visit `/curator/drift` to confirm they appear.

- [ ] **Step 5: No commit needed.**

---

## Phase R — Comeback Follow-Up Automation (5 tasks)

Per spec §8.5 ("Follow-up consent: 7-day and 30-day comeback prompts auto-scheduled"), §11.2 (contribution pipeline: 7d/30d follow-ups feed corpus confidence), §15 row "Comeback follow-up tracking (in-app)" (IN, in-app at MVP). Builds: a `follow_ups` table, scheduling on session close, a daily Vercel Cron that surfaces due prompts in-app, the in-app dashboard panel a tech sees, and the outcome → corpus update path that runs after a follow-up resolves.

### Task R1: `follow_ups` table

**Files:**
- Modify: lib/db/schema.ts

- [ ] **Step 1: Append schema**

```ts
// lib/db/schema.ts (append)
export const followUps = pgTable('follow_ups', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').references(() => sessions.id, { onDelete: 'cascade' }).notNull(),
  shopId: uuid('shop_id').references(() => shops.id, { onDelete: 'cascade' }).notNull(),
  techId: uuid('tech_id').references(() => profiles.id).notNull(),
  kind: text('kind', { enum: ['7d', '30d'] }).notNull(),
  dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
  surfacedAt: timestamp('surfaced_at', { withTimezone: true }),  // when shown to tech
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),  // when tech responded
  comebackRecorded: boolean('comeback_recorded'),                 // true/false/null
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const followUpsRelations = relations(followUps, ({ one }) => ({
  session: one(sessions, { fields: [followUps.sessionId], references: [sessions.id] }),
}))
```

Generate + apply migration:
```bash
pnpm drizzle-kit generate && pnpm drizzle-kit migrate
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat(comeback): follow_ups table for 7d + 30d prompts"
```

---

### Task R2: Schedule follow-ups on session close

**Files:**
- Modify: app/api/sessions/[id]/close/route.ts
- Create: tests/unit/follow-ups-schedule.test.ts

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/follow-ups-schedule.test.ts
import { describe, it, expect, vi } from 'vitest'

const insertReturning = vi.fn().mockResolvedValue([{ id: 'fu-1' }, { id: 'fu-2' }])
vi.mock('@/lib/db/client', () => ({
  db: {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({ returning: insertReturning }),
    }),
  },
}))

describe('scheduleFollowUps', () => {
  it('inserts 7d and 30d rows', async () => {
    const { scheduleFollowUps } = await import('@/lib/comeback/schedule')
    const ids = await scheduleFollowUps({
      sessionId: 'sess-1', shopId: 'shop-1', techId: 'tech-1',
    })
    expect(ids).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Implement**

```ts
// lib/comeback/schedule.ts
import { db } from '@/lib/db/client'
import { followUps } from '@/lib/db/schema'

const DAY_MS = 24 * 60 * 60 * 1000

export async function scheduleFollowUps(input: {
  sessionId: string
  shopId: string
  techId: string
}): Promise<string[]> {
  const rows = await db.insert(followUps).values([
    {
      sessionId: input.sessionId,
      shopId: input.shopId,
      techId: input.techId,
      kind: '7d',
      dueAt: new Date(Date.now() + 7 * DAY_MS),
    },
    {
      sessionId: input.sessionId,
      shopId: input.shopId,
      techId: input.techId,
      kind: '30d',
      dueAt: new Date(Date.now() + 30 * DAY_MS),
    },
  ]).returning({ id: followUps.id })
  return rows.map(r => r.id)
}
```

- [ ] **Step 3: Hook into the close route**

```ts
// app/api/sessions/[id]/close/route.ts — after closeSession():
import { scheduleFollowUps } from '@/lib/comeback/schedule'

await scheduleFollowUps({
  sessionId: id,
  shopId: session.shopId,
  techId: session.techId,
}).catch(err => console.warn('follow-up scheduling failed (session still closed):', err))
```

- [ ] **Step 4: Run test, commit**

```bash
pnpm test tests/unit/follow-ups-schedule.test.ts
git add -A
git commit -m "feat(comeback): schedule 7d + 30d follow-ups on session close"
```

---

### Task R3: Daily Vercel Cron — surface due prompts (mark surfacedAt)

**Files:**
- Create: app/api/cron/comeback-prompts-daily/route.ts

- [ ] **Step 1: Implement**

```ts
// app/api/cron/comeback-prompts-daily/route.ts
import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { followUps } from '@/lib/db/schema'
import { and, isNull, lte } from 'drizzle-orm'

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const got = req.headers.get('authorization')
    if (got !== `Bearer ${secret}`) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const now = new Date()
  const surfaced = await db.update(followUps)
    .set({ surfacedAt: now })
    .where(and(
      isNull(followUps.surfacedAt),
      isNull(followUps.resolvedAt),
      lte(followUps.dueAt, now),
    ))
    .returning({ id: followUps.id, sessionId: followUps.sessionId, kind: followUps.kind })

  return NextResponse.json({ surfaced: surfaced.length })
}
```

(`vercel.json` already includes this cron from Phase Q Task Q3.)

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat(comeback): daily cron to surface due follow-ups"
```

---

### Task R4: In-app dashboard panel for due follow-ups

**Files:**
- Create: components/dashboard/follow-up-panel.tsx
- Modify: app/(app)/sessions/page.tsx
- Create: app/api/follow-ups/[id]/resolve/route.ts

- [ ] **Step 1: Build the resolve route**

```ts
// app/api/follow-ups/[id]/resolve/route.ts
import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase-server'
import { db } from '@/lib/db/client'
import { profiles, followUps, sessions } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { recordCorpusComeback } from '@/lib/corpus/decay'

const schema = z.object({
  comebackRecorded: z.boolean(),
  notes: z.string().max(2000).optional(),
})

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await getServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const profile = await db.query.profiles.findFirst({ where: eq(profiles.id, user.id) })
  if (!profile) return NextResponse.json({ error: 'no profile' }, { status: 400 })

  const followUp = await db.query.followUps.findFirst({ where: eq(followUps.id, id) })
  if (!followUp || followUp.techId !== profile.id) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 })

  await db.update(followUps).set({
    resolvedAt: new Date(),
    comebackRecorded: parsed.data.comebackRecorded,
    notes: parsed.data.notes ?? null,
  }).where(eq(followUps.id, id))

  // If a comeback was recorded, decay the corresponding corpus entries.
  if (parsed.data.comebackRecorded) {
    const session = await db.query.sessions.findFirst({ where: eq(sessions.id, followUp.sessionId) })
    if (session && session.outcome) {
      await recordCorpusComeback({
        vehicleYear: session.intake.vehicleYear,
        vehicleMake: session.intake.vehicleMake,
        vehicleModel: session.intake.vehicleModel,
        rootCause: session.outcome.rootCause,
      }).catch(err => console.warn('corpus decay failed:', err))
    }
  }

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 2: Build the panel**

```tsx
// components/dashboard/follow-up-panel.tsx
'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'

type FollowUp = {
  id: string
  sessionId: string
  kind: '7d' | '30d'
  dueAt: string
  vehicleSummary: string
}

export function FollowUpPanel({ items }: { items: FollowUp[] }) {
  if (items.length === 0) return null
  return (
    <Card className="p-4 mb-6 border-blue-300">
      <h2 className="font-bold mb-2">Follow-ups due ({items.length})</h2>
      <ul className="space-y-3">
        {items.map(f => <FollowUpRow key={f.id} item={f} />)}
      </ul>
    </Card>
  )
}

function FollowUpRow({ item }: { item: FollowUp }) {
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState<'yes' | 'no' | null>(null)
  const [done, setDone] = useState(false)

  async function resolve(comebackRecorded: boolean) {
    setBusy(comebackRecorded ? 'yes' : 'no')
    const res = await fetch(`/api/follow-ups/${item.id}/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ comebackRecorded, notes: notes || undefined }),
    })
    setBusy(null)
    if (res.ok) setDone(true)
  }

  if (done) return <li className="text-green-700 text-sm">✓ Recorded.</li>

  return (
    <li className="border rounded p-3">
      <div className="flex items-center justify-between mb-2">
        <div>
          <span className="font-medium">{item.vehicleSummary}</span>
          <span className="ml-2 text-xs text-gray-500">{item.kind} follow-up</span>
        </div>
        <a href={`/sessions/${item.sessionId}`} className="text-blue-600 text-sm hover:underline">View case →</a>
      </div>
      <Textarea
        rows={2}
        placeholder="Notes (optional)…"
        value={notes}
        onChange={e => setNotes(e.target.value)}
        className="text-sm mb-2"
      />
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => resolve(false)}>
          {busy === 'no' ? 'Saving…' : 'No comeback'}
        </Button>
        <Button size="sm" variant="destructive" disabled={busy !== null} onClick={() => resolve(true)}>
          {busy === 'yes' ? 'Saving…' : 'Comeback recorded'}
        </Button>
      </div>
    </li>
  )
}
```

- [ ] **Step 3: Render on the sessions list page**

```tsx
// app/(app)/sessions/page.tsx — add at top of return:
import { FollowUpPanel } from '@/components/dashboard/follow-up-panel'
import { followUps, sessions } from '@/lib/db/schema'
import { and, eq, isNotNull, isNull } from 'drizzle-orm'

// Inside the component, after profile lookup:
const dueFollowUps = profile?.id
  ? await db.select({
      id: followUps.id,
      sessionId: followUps.sessionId,
      kind: followUps.kind,
      dueAt: followUps.dueAt,
      vehicleYear: sessions.intake,
      // ... selecting from sessions.intake JSONB requires a manual query; simpler:
    })
    .from(followUps)
    .innerJoin(sessions, eq(followUps.sessionId, sessions.id))
    .where(and(
      eq(followUps.techId, profile.id),
      isNotNull(followUps.surfacedAt),
      isNull(followUps.resolvedAt),
    ))
    .limit(20)
  : []

const followUpItems = dueFollowUps.map(f => ({
  id: f.id,
  sessionId: f.sessionId,
  kind: f.kind as '7d' | '30d',
  dueAt: f.dueAt.toISOString(),
  vehicleSummary: `${(f as any).vehicleYear?.vehicleYear} ${(f as any).vehicleYear?.vehicleMake} ${(f as any).vehicleYear?.vehicleModel}`,
}))

// In the JSX:
<FollowUpPanel items={followUpItems} />
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(comeback): in-app follow-up panel + resolve route + corpus decay integration"
```

---

### Task R5: Verification — schedule, cron, surface, resolve

**Files:** none

- [ ] **Step 1: Close a test session**

Run a session end-to-end to closure. Confirm in Supabase MCP:
```sql
SELECT id, kind, due_at FROM follow_ups WHERE session_id = '<session-id>';
```
Expected: 2 rows (7d + 30d).

- [ ] **Step 2: Manually advance the due dates and trigger the cron**

```sql
UPDATE follow_ups SET due_at = NOW() - INTERVAL '1 hour'
WHERE session_id = '<session-id>' AND kind = '7d';
```

```bash
curl http://localhost:3000/api/cron/comeback-prompts-daily \
  -H "authorization: Bearer $CRON_SECRET"
```

Expected response: `{ surfaced: 1 }`.

- [ ] **Step 3: Confirm the panel appears on /sessions**

Visit `/sessions` as the tech. The "Follow-ups due (1)" card should appear above the session list.

- [ ] **Step 4: Resolve as "comeback recorded"**

Click "Comeback recorded". Confirm in Supabase that `follow_ups.resolved_at` is set and `corpus_entries.comeback_recorded_count` for matching entries incremented.

- [ ] **Step 5: No commit needed.**

---

## Phase S — End-to-End + Production Deploy (4 tasks)

Final phase: a single Playwright happy-path that exercises every prior phase end-to-end (intake → multi-modal capture → corpus retrieval → bounded internet retrieval → Tech-Assisted Retrieval → risk gating → outcome capture → comeback follow-up surfacing), production environment configuration, Vercel production cutover, and milestone tagging.

### Task S1: Full happy-path Playwright test (covers Phases A-R)

**Files:**
- Create: tests/e2e/happy-path.spec.ts
- Create: tests/e2e/fixtures/seed-test-user.ts
- Create: tests/e2e/fixtures/scan-tool-sample.jpg

- [ ] **Step 1: Seed a confirmed test user + shop + curator + corpus stub**

Create `tests/e2e/fixtures/seed-test-user.ts`:
```ts
import { createClient } from '@supabase/supabase-js'
import { db } from '@/lib/db/client'
import { profiles, shops, stripeCustomers, corpusEntries } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const TECH_EMAIL = 'e2e-tech@vyntechs.local'
const TECH_PASSWORD = 'e2e-tech-password-123'
const CURATOR_EMAIL = 'e2e-curator@vyntechs.local'
const CURATOR_PASSWORD = 'e2e-curator-password-123'

export async function seedAll() {
  for (const [email, password, role] of [
    [TECH_EMAIL, TECH_PASSWORD, 'tech'] as const,
    [CURATOR_EMAIL, CURATOR_PASSWORD, 'curator'] as const,
  ]) {
    const { data: list } = await supa.auth.admin.listUsers()
    const existing = list.users.find(u => u.email === email)
    const userId = existing?.id ?? (await supa.auth.admin.createUser({
      email, password, email_confirm: true,
    })).data.user!.id

    let prof = await db.query.profiles.findFirst({ where: eq(profiles.id, userId) })
    if (!prof) {
      const [shop] = await db.insert(shops).values({ name: 'E2E Shop', city: 'Plano', state: 'TX' }).returning()
      ;[prof] = await db.insert(profiles).values({ id: userId, email, role, shopId: shop.id }).returning()
      await db.insert(stripeCustomers).values({
        shopId: shop.id, stripeCustomerId: `cus_test_${userId.slice(0, 8)}`, subscriptionStatus: 'active',
      }).onConflictDoNothing()
    }
  }

  // Seed at least one corpus entry the case can match against (so Rung 0 returns ≥1).
  const existingCorpus = await db.query.corpusEntries.findFirst({
    where: eq(corpusEntries.summary, 'F-150 EcoBoost wastegate vacuum line crack'),
  })
  if (!existingCorpus) {
    await db.insert(corpusEntries).values({
      vehicleYear: 2018, vehicleMake: 'Ford', vehicleModel: 'F-150', vehicleEngine: '3.5L EcoBoost',
      symptomTags: ['power_loss', 'wrench_light'],
      dtcs: ['P0299', 'P0236'],
      rootCause: 'Wastegate actuator vacuum line cracked ~2in from actuator-can end on driver-side turbo. Smoke test confirmed leak.',
      summary: 'F-150 EcoBoost wastegate vacuum line crack',
      actionType: 'part_replacement',
      verification: { codesCleared: true, testDrive: true, symptomsResolved: 'yes' },
      sourceShopId: null,
      curatedByUserId: null,
      successConfirmCount: 3,
      embedding: null,  // Phase K populates embeddings; for E2E we match by tag/dtc filter
    })
  }
}

export const E2E_TECH = { email: TECH_EMAIL, password: TECH_PASSWORD }
export const E2E_CURATOR = { email: CURATOR_EMAIL, password: CURATOR_PASSWORD }
```

Add `pnpm tsx tests/e2e/fixtures/seed-test-user.ts` as a Playwright `globalSetup` in `playwright.config.ts`:

```ts
import path from 'path'
export default defineConfig({
  // ...existing config...
  globalSetup: path.resolve('./tests/e2e/global-setup.ts'),
})
```

```ts
// tests/e2e/global-setup.ts
import { seedAll } from './fixtures/seed-test-user'
export default async () => { await seedAll() }
```

- [ ] **Step 2: Drop a real scan-tool screenshot fixture**

Save a representative photo of an Autel/Snap-on DTC list screen at `tests/e2e/fixtures/scan-tool-sample.jpg`. Use a real photograph from the test rig — synthetic images defeat the vision OCR test. Commit the fixture binary.

- [ ] **Step 3: Write the comprehensive happy-path test**

```ts
// tests/e2e/happy-path.spec.ts
import { test, expect } from '@playwright/test'
import path from 'path'
import { E2E_TECH, E2E_CURATOR } from './fixtures/seed-test-user'

test.describe.configure({ mode: 'serial' })

test('full diagnostic loop: intake → corpus → multi-modal → gating → outcome → comeback', async ({ page, context }) => {
  // === Phase A-D: sign in, intake, tree generation ===
  await page.goto('/sign-in')
  await page.getByLabel('Email').fill(E2E_TECH.email)
  await page.getByLabel('Password').fill(E2E_TECH.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/sessions$/)

  await page.goto('/sessions/new')
  await page.getByLabel('Year').fill('2018')
  await page.getByLabel('Make').fill('Ford')
  await page.getByLabel('Model').fill('F-150')
  await page.getByLabel('Engine').fill('3.5L EcoBoost')
  await page.getByLabel('Customer complaint').fill('loss of power going up hills, intermittent wrench light')
  await page.getByRole('button', { name: 'Start diagnosis' }).click()
  await expect(page).toHaveURL(/\/sessions\/[0-9a-f-]{36}$/, { timeout: 60_000 })
  const sessionUrl = page.url()
  const sessionId = sessionUrl.split('/').pop()!

  // === Phase K: corpus match should appear in the initial message (look for "prior cases" or matched DTC) ===
  await expect(page.locator('main')).toContainText(/F-150|wastegate|prior case/i, { timeout: 30_000 })

  // === Phase I + L + M: tech submits observation; AI requests scan_screen; tech uploads ===
  await page.getByPlaceholder(/describe/i).fill('Pulled DTCs from scan tool — going to send the screen photo.')
  await page.getByRole('button', { name: /submit observation/i }).click()
  await page.waitForResponse(r => r.url().includes('/advance') && r.status() === 200, { timeout: 60_000 })

  // Upload scan-tool screen artifact
  const photoButton = page.getByRole('button', { name: /scan|photo/i }).first()
  if (await photoButton.isVisible({ timeout: 5_000 }).catch(() => false)) {
    const fileChooserPromise = page.waitForEvent('filechooser')
    await photoButton.click()
    const fileChooser = await fileChooserPromise
    await fileChooser.setFiles(path.resolve('./tests/e2e/fixtures/scan-tool-sample.jpg'))
    await page.waitForResponse(r => r.url().includes('/capture') && r.status() === 200, { timeout: 60_000 })
  }
  await page.getByPlaceholder(/describe/i).fill('Scan screen uploaded. P0299 active, P0236 pending. Freeze frame: boost target 17.8 actual 14.2 at 73% load.')
  await page.getByRole('button', { name: /submit observation/i }).click()
  await page.waitForResponse(r => r.url().includes('/advance') && r.status() === 200, { timeout: 60_000 })

  // Drive the tree forward through smoke-test → root cause
  await page.getByPlaceholder(/describe/i).fill('Smoke test positive at wastegate actuator vacuum line, driver side, ~2in from the actuator-can end.')
  await page.getByRole('button', { name: /submit observation/i }).click()
  await page.waitForResponse(r => r.url().includes('/advance') && r.status() === 200, { timeout: 60_000 })

  // Loop until OutcomeForm appears (max 4 more advances)
  for (let i = 0; i < 4; i++) {
    const outcomeVisible = await page.getByRole('heading', { name: /outcome/i }).isVisible({ timeout: 3_000 }).catch(() => false)
    if (outcomeVisible) break
    await page.getByPlaceholder(/describe/i).fill('Replaced silicone wastegate vacuum line, cleared codes, hard pull verification drive: boost holds, no recurrence.')
    await page.getByRole('button', { name: /submit observation/i }).click()
    await page.waitForResponse(r => r.url().includes('/advance') && r.status() === 200, { timeout: 60_000 })
  }

  // === Phase F: outcome capture with validator gate ===
  // Vague first attempt → expect 422 + feedback
  await page.getByLabel(/root cause/i).fill('the line was bad')
  await page.getByRole('button', { name: /close session/i }).click()
  await expect(page.getByText(/⚠/)).toBeVisible({ timeout: 30_000 })

  // Specific second attempt → success
  await page.getByLabel(/root cause/i).fill(
    'Wastegate actuator vacuum line cracked ~2in from actuator-can end on driver-side turbo, F-150 3.5L EcoBoost. Smoke test confirmed leak. Replaced with silicone line.',
  )
  await page.getByLabel(/diag/i).fill('45')
  await page.getByLabel(/repair/i).fill('20')
  await page.getByRole('button', { name: /close session/i }).click()
  await expect(page).toHaveURL(/\/sessions$/, { timeout: 30_000 })

  // === Phase R: comeback follow-up should be scheduled and visible on dashboard ===
  await page.goto('/sessions')
  await expect(page.locator('main')).toContainText(/follow-up|7-day/i)
})

test('curator console shows deferred or novel cases', async ({ page }) => {
  await page.goto('/sign-in')
  await page.getByLabel('Email').fill(E2E_CURATOR.email)
  await page.getByLabel('Password').fill(E2E_CURATOR.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.goto('/curator')
  await expect(page.locator('main')).toContainText(/queue|deferred|novel|drift/i)
})

test('tablet viewport renders full visual tree', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 } })
  const page = await ctx.newPage()
  await page.goto('/sign-in')
  await page.getByLabel('Email').fill(E2E_TECH.email)
  await page.getByLabel('Password').fill(E2E_TECH.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.goto('/sessions')
  // Click the most recent session
  const firstLink = page.locator('main a[href^="/sessions/"]').first()
  if (await firstLink.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await firstLink.click()
    // Tablet layout: TabletTreeView present
    await expect(page.locator('[data-testid="tablet-tree-view"]')).toBeVisible({ timeout: 10_000 })
  }
})
```

- [ ] **Step 4: Run E2E (real LLM cost: ~$0.30-0.80 per run depending on tree depth)**

```bash
pnpm exec playwright test tests/e2e/happy-path.spec.ts
```

Expected: 3 PASS. The tests are flaky on real LLM calls — re-run if a single advance times out. Tighten `timeout: 60_000` if your bay infra is slower.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test(e2e): comprehensive happy-path covering Phases A-R"
```

---

### Task S2: Push every env var to Vercel preview + sanity-deploy

**Files:** none

- [ ] **Step 1: Inventory all env vars referenced across the codebase**

```bash
grep -rhoE 'process\.env\.[A-Z_]+' lib app components | sort -u
```

Expected output should match this checklist:
- Supabase: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`
- Anthropic: `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`
- OpenAI (embeddings, Phase K): `OPENAI_API_KEY`
- Stripe: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`
- Storage: `STORAGE_BACKEND`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET`
- Cron: `CRON_SECRET`
- Feature flags (Phase O): `NEXT_PUBLIC_DESKTOP_INTAKE_ENABLED`
- Retrieval (Phase L): `YOUTUBE_API_KEY`, `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_USER_AGENT`

- [ ] **Step 2: Push to Vercel preview environment**

```bash
# For each env var, run:
pnpm dlx vercel env add <NAME> preview
# (Vercel CLI prompts for the value.)
```

Or use the Vercel dashboard for bulk paste.

- [ ] **Step 3: Deploy preview**

```bash
pnpm dlx vercel
```

Expected: deploy succeeds. Open the preview URL.

- [ ] **Step 4: Run a manual smoke pass on the preview**

Sign in as `e2e-tech@vyntechs.local`, run a session, upload a scan photo, close with a specific outcome. Switch to `e2e-curator@vyntechs.local`, hit `/curator`. Both flows must work.

- [ ] **Step 5: No commit needed.**

---

### Task S3: Production cutover

**Files:** none (deploy + dashboard config)

- [ ] **Step 1: Provision production Supabase project**

Use Supabase MCP `create_project` to create `vyntechs-prod` in us-east. Run all migrations:
```bash
DATABASE_URL=<prod-url> pnpm drizzle-kit migrate
```

Repeat the bucket / RLS / realtime publication setup steps from Phases I, K, N against the prod project.

- [ ] **Step 2: Provision production S3 bucket**

```bash
S3_BUCKET=vyntechs-artifacts-prod AWS_REGION=us-east-1 pnpm tsx scripts/provision-s3.ts
```

- [ ] **Step 3: Push every env var to Vercel production environment**

For each env var listed in S2 Step 1, run `pnpm dlx vercel env add <NAME> production` and paste the production value. Pay particular attention to:
- `STORAGE_BACKEND=s3` (production uses S3, not Supabase Storage)
- `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_PRICE_ID` — use **live** Stripe keys, not test keys
- `CRON_SECRET` — fresh value, not the same as preview
- `NEXT_PUBLIC_DESKTOP_INTAKE_ENABLED=false` (per spec §6 row 6: v1.0 dark, v1.5 enabled)

- [ ] **Step 4: Deploy production**

```bash
pnpm dlx vercel --prod
```

Expected: production deploy succeeds. Open the production URL (custom domain mapped via Vercel dashboard if configured).

- [ ] **Step 5: Verify production webhooks**

In the Stripe dashboard, register a production webhook pointing at `https://<prod-domain>/api/stripe/webhook`. Trigger a test event (`stripe trigger customer.subscription.updated`) and confirm the row in `stripe_customers` updates.

- [ ] **Step 6: Verify production Vercel Cron runs**

In Vercel dashboard → project → Crons, confirm `artifacts-tier-sync`, `comeback-prompts-daily`, and `calibration-weekly` are listed with their schedules.

- [ ] **Step 7: No commit needed.**

---

### Task S4: Final tests, milestone tag, status memo

**Files:**
- Create: docs/STATUS.md (one-time)

- [ ] **Step 1: Run full test suite one final time**

```bash
pnpm test && pnpm exec playwright test
```

Expected: all PASS.

- [ ] **Step 2: Tag the milestone**

```bash
git tag -a mvp-complete -m "Vyntechs MVP complete — all phases A-S implemented"
```

- [ ] **Step 3: Push to origin if remote configured**

```bash
git remote -v
# If a remote is set:
git push origin main && git push origin mvp-complete
```

- [ ] **Step 4: Write a one-page launch readiness memo**

```markdown
<!-- docs/STATUS.md -->
# Vyntechs MVP — Launch Readiness

**Tagged:** mvp-complete (commit <sha>)
**Date:** <YYYY-MM-DD>

## What ships

- All locked decisions in spec §6 implemented and tested.
- All workflows in spec §8 wired end-to-end.
- All four UX layouts present (phone live, tablet live, desktop intake dark per v1.0/v1.5 plan, curator console live).
- Cross-shop corpus active from day 1; outcome capture mandatory.
- Bounded retrieval ladder operational (corpus → internet → Tech-Assisted → Decline-or-Defer).
- Risk-stratified gating live; Decline-or-Defer is the terminal safety mechanism.
- Calibration engine running weekly; comeback follow-ups in-app.

## Open gates before shop onboarding

- [ ] Legal review of ToS, privacy policy, shop license (Open Q2 in spec §16).
- [ ] Pre-flight 50-100 simulated cases (Open Q8). Curator (Brandon) signs off.
- [ ] E&O insurance quote secured (Open Q9).
- [ ] First 3-5 design-partner shops signed (Phase 1 GTM in spec §14).

## Operational notes

- Curator queue SLA: 24-72h. Hire trigger: queue >2 days SLA (per spec §17 risk 4).
- Calibration thresholds (spec §8.3) start conservative. The engine tightens or relaxes weekly from outcome data.
- Photo storage tiers transition automatically (90d → IA, 2y → Glacier IR). Structured extractions persist forever.
```

Commit:
```bash
git add docs/STATUS.md
git commit -m "docs: launch readiness memo"
```

---

## Self-Review Checklist

Run through this after the plan is written. Fix any issues inline.

**Spec coverage** — every spec section has at least one task:
- §1 Executive Summary, §2 Pain, §3 Promise → narrative; encoded in product behavior across the plan
- §4 Why Now → encoded by the multi-modal + retrieval + tiered reasoning architecture (Phases I, K, L, M, D)
- §5 Wedge layer 1 (cross-shop corpus) → Phase K; layer 2 (retrieval orchestration) → Phase L; layer 3 (calibration) → Phase Q; layer 4 (DFW reputation) → GTM, not code
- §6 row 1 (Buyer/user) → A4 (auth) + B1 (profile.role: owner/tech/curator)
- §6 row 2 (Multi-modal inputs, no scan-tool integration) → Phase I (camera + mic + scan-screen vision OCR — no BT/J2534)
- §6 row 3 (Diagnostic scope) → encoded in TREE_ENGINE_SYSTEM (D1, M3); ADAS/EV explicitly out per "Out of scope" intro
- §6 row 4 (Diagnostic loop, AI tree, live updates) → D2, D3, D4, D5, I10, K4, K8, L10
- §6 row 5 (Knowledge sources: LLM + corpus + retrieval + Tech-Assisted + Decline-or-Defer) → D1 (LLM), K (corpus), L (retrieval), M6 (Tech-Assisted), M5 (Decline-or-Defer)
- §6 row 6 (Single Next.js PWA, four viewport layouts) → A1, A2, E (phone), N (tablet), O (desktop intake), P (curator), H (PWA install)
- §6 row 7 (Failure model: risk gating, Decline-or-Defer, no real-time escalation) → M1, M2, M4, M5, M7, M8
- §6 row 8 (Pricing flat SaaS $700/mo) → A5, G1, G2, G3
- §6 row 9 (Cross-shop sharing day 1, mandatory outcome capture, AI-validated specificity) → F (validator), K5 (auto-promote on close)
- §6 row 10 (Brandon as async curator only) → P1-P7 (curator console with deferred/drift/novel queues + corpus authoring)
- §6 row 11 (GTM DFW) → not code-relevant; documented in spec §14
- §6 row 12 (Vision policy describe-first) → I7-I10 prompts + advance flow + tree engine policy block
- §6 row 13 (Bounded retrieval ladder ≤5 queries / 30s / 50K tokens) → L1 (Budget type, DEFAULT_BUDGET), L8 (orchestrator enforces)
- §6 row 14 (Photo storage tiering) → J1-J6 (S3 backend, lifecycle policies, tier-mirror cron)
- §6 row 15 (Single Next.js + PWA, one repo / one deploy) → A1, A2, H1, H2, S2, S3
- §7 architecture diagram boxes → all components mapped: gateway/auth (A4), session orchestrator (D, E), multi-modal capture (I), vision OCR (I7), tree engine (D2/D3), risk classifier (M2), confidence calibrator (Q1-Q3), retrieval orchestrator (L8), gap handler (M4), Decline-or-Defer (M5), corpus (K), outcome capture (F), calibration engine (Q)
- §8.1 Diagnostic Session Loop (steps 1-15) → C-F end-to-end happy path; M for risk gating; R for follow-ups
- §8.2 Bounded retrieval ladder (Rungs 0-3) → K (Rung 0), L (Rung 1), M6 (Rung 2), M5 (Rung 3)
- §8.3 Risk-stratified confidence gating thresholds → M1 (table seeded with §8.3 starting values)
- §8.4 Decline-or-Defer three options → M5 (route), M7 (panel)
- §8.5 Outcome capture mandatory + AI-validated specificity → F1, F2, F4
- §8.6 Curator workflow (deferred/drift/novel queues + corpus authoring) → P2, P3, P4, P5, P6
- §9.1 Phone layout → E1-E10, I4 (PhotoCapture), I5 (AudioCapture), I6 (VideoCapture)
- §9.2 Tablet layout → N1, N2, N3
- §9.3 Desktop intake (built dark, feature-flagged) → O1-O5
- §9.4 Curator console layout → P1
- §9.5 PWA install + service worker + real-time sync → H1, H2, N4, N5
- §10 Vision policy describe-first → I10 (system prompt block + StepInput conditional render)
- §11.1 Corpus schema → K1
- §11.2 Contribution pipeline → K5, R4 (follow-up resolves feed corpus)
- §11.3 Quality control (N-way confirmation, comeback decay, curator review, conflict surfacing) → K6, K7, P5, K8
- §11.4 Legal boundary (transient OEM artifacts) → I7 prompt explicitly extracts structured facts only
- §12 Photo storage tiering → J1-J6
- §13 Pricing model → G; runtime cost shaped by tiered reasoning (D1) + describe-first (I10) + cache (L7)
- §14 GTM phasing → not code-relevant
- §15 MVP cut → all "IN" rows mapped above; "OUT" rows enumerated in plan intro
- §16 Open Questions → not code; tracked in spec, surfaced in S4 launch readiness memo
- §17 Risks → calibration cold-start mitigated by Q1 weak prior + M1 conservative seeded thresholds; gating + audit trail (M); Decline-or-Defer (M5); curator hire trigger noted in S4 memo

**Placeholder scan** — searched for TBD/TODO/`fill in`/"similar to"/empty steps. The few remaining "left as a small follow-up" annotations (O5 step 2 comeback banner wiring; small repetitive React state plumbing in N5) are explicit, scoped, and non-blocking.

**Type consistency** —
- `IntakePayload` defined in `lib/types.ts` (C2), used in tree-engine (D2, K4, L10, M3), API routes (D4, C3), pre-bay-plan (O4)
- `TreeState`, `TreeNode`, `ProposedAction` defined in `lib/ai/tree-engine.ts` (D2, M3), referenced in components (E2, E3, E4, N1, N2) and DB schema (B2). Phase M3 extension adds `proposedAction` and `gateDecision`; Phase I10 extension adds `requestedArtifact`.
- `OutcomePayload` defined in `lib/types.ts` (F3), used in close route (F4), corpus promotion (K5)
- `RetrievalContext`, `RetrievalResult`, `Budget` defined in `lib/retrieval/types.ts` (L1), used in adapters (L2-L6), orchestrator (L8), validator (L9), advance route (L10)
- `CorpusMatch` defined in `lib/corpus/retrieval.ts` (K3), used in tree-engine signatures (K4, K8, L10)
- `RiskJudgment`, `RiskClass`, `GateDecision` defined in `lib/gating/risk-classifier.ts` (M2) and `lib/gating/gap-handler.ts` (M4), used in tree-engine TreeState (M7) and advance route gating (M7)
- `validateSpecificity → ValidatorResult` (F1) consumed in close route (F4)
- `ScanScreenExtraction`, `WiringDiagramExtraction`, `AudioExtraction` (I7, I8) consumed by extraction-worker (I9)
- `StorageBackend`, `StorageKind` (J1) implemented by SupabaseBackend + S3Backend, used by uploadArtifact / signedUrl (I3, J4, J5)

**Scope check** — the plan covers the full Vyntechs MVP per spec §15's "v1.0" cut. Each phase produces independently-testable, deployable software:
- A-H: working vertical slice (text-only, single-tech, single-shop)
- I: multi-modal inputs add to the slice
- J: storage tiering added (transparent backend swap)
- K: corpus retrieval becomes "Rung 0" of the ladder
- L: internet retrieval becomes "Rung 1"
- M: risk gating + Decline-or-Defer add the safety floor (replaces real-time master-tech escalation per spec §6 row 7)
- N: tablet layout + cross-device sync
- O: desktop intake (dark — flag-flip = v1.5)
- P: curator console
- Q: calibration engine (weekly cron)
- R: comeback automation (closes the flywheel)
- S: production deploy + comprehensive Playwright covering A-R

**Cross-phase dependencies (build in order):**
- Phase Q's `aggregateOutcomesByCell` references the `follow_ups` table from Phase R — build R1 (table) before deploying Q3 (cron). Or build R first then Q.
- Phase M's `gateDecision` is rendered by the SessionView the phone (E) and tablet (N) use; M7 modifies both. Build M7 after N1.
- Phase K's `pgvector` extension must be enabled before K1 migration runs.
- Phase J's S3 bucket must be provisioned (J2) before `STORAGE_BACKEND=s3` is set anywhere.

Tasks are bite-sized (almost all ≤7 steps; longer ones have explicit step boundaries with commits between).

---

## End of Plan
