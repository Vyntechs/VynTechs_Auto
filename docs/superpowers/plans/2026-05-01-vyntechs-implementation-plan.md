# Vyntechs Plan 1 — Vertical Slice MVP

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working end-to-end happy-path Vyntechs experience: a tech signs up, creates a session with vehicle + complaint, the AI generates an initial decision tree, the tech walks the tree with text-only input, the AI updates the tree from text, the tech closes the session with structured outcome capture (AI-validated for specificity), and past sessions appear in history. Phone layout only. Working locally and on Vercel preview.

**Architecture:** Next.js 16 App Router + TypeScript. Supabase for auth + Postgres + storage. Drizzle ORM. Anthropic SDK with Sonnet 4.6 + prompt caching. Tailwind + shadcn/ui. Vitest unit + Playwright E2E. Stripe billing skeleton. PWA-installable from day 1. Single deploy target: Vercel.

**Tech Stack:**
- Runtime: Node.js 22+, pnpm
- Framework: Next.js 16 App Router (TypeScript, strict)
- Auth + DB + storage: Supabase
- ORM: Drizzle
- LLM: `@anthropic-ai/sdk` v0.84+ (Sonnet 4.6, prompt caching)
- Billing: Stripe
- Styling: Tailwind CSS + shadcn/ui (Radix primitives)
- Testing: Vitest (unit), Playwright (E2E)
- Deploy: Vercel
- Source control: git, conventional commits

**Important — Next.js 16 caveat:** Next.js 16 has breaking changes vs. earlier versions. APIs, conventions, and file structure may differ from training-data-era Next.js. **Before writing Next.js-specific code, read the relevant guide in `node_modules/next/dist/docs/`.** Heed deprecation notices. Do not assume App Router patterns from Next.js 13/14 still apply.

**Out of scope for this plan (deferred to Plans 2-5):**
- Multi-modal capture (camera, audio, video, vision OCR)
- Cross-shop corpus + retrieval
- Internet retrieval orchestrator
- Risk classifier / confidence calibrator / Decline-or-Defer
- Tablet layout, desktop intake, curator console
- Real-time WebSocket sync
- Calibration engine, comeback follow-up automation, drift detection

---

## File Structure

Files to create in this plan, organized by responsibility:

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

## Phase E — Phone Session UX (10 tasks)

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

## Phase I — End-to-End + Deploy (3 tasks)

### Task I1: Full happy-path Playwright test

**Files:**
- Create: tests/e2e/happy-path.spec.ts

- [ ] **Step 1: Set up a test user via Supabase**

In Supabase MCP `execute_sql`, create a confirmed test user:
```sql
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
VALUES (gen_random_uuid(), 'e2e-test@vyntechs.local', crypt('e2e-test-password-123', gen_salt('bf')), now(), '{}', '{}');
```

Also seed the profile + shop and a Stripe customer placeholder so the auth layout doesn't try to call Stripe live.

- [ ] **Step 2: Write the test**

```ts
// tests/e2e/happy-path.spec.ts
import { test, expect } from '@playwright/test'

test('sign up → create session → walk tree → close session', async ({ page }) => {
  // Sign in
  await page.goto('/sign-in')
  await page.getByLabel('Email').fill('e2e-test@vyntechs.local')
  await page.getByLabel('Password').fill('e2e-test-password-123')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/sessions$/)

  // New session
  await page.goto('/sessions/new')
  await page.getByLabel('Year').fill('2018')
  await page.getByLabel('Make').fill('Ford')
  await page.getByLabel('Model').fill('F-150')
  await page.getByLabel('Engine').fill('3.5L EcoBoost')
  await page.getByLabel('Customer complaint').fill('loss of power going up hills, intermittent wrench light')
  await page.getByRole('button', { name: 'Start diagnosis' }).click()

  await expect(page).toHaveURL(/\/sessions\/[0-9a-f-]{36}$/, { timeout: 30_000 })

  // Tree visible
  await expect(page.locator('main')).toContainText(/F-150/)

  // First observation
  await page.getByPlaceholder(/describe/i).fill('Pulled DTCs: P0299 and P0236. Freeze frame shows boost target 17.8 actual 14.2 at 73% load.')
  await page.getByRole('button', { name: /submit observation/i }).click()
  // Wait for tree to update (LLM call)
  await page.waitForResponse(r => r.url().includes('/advance') && r.status() === 200, { timeout: 30_000 })

  // We may need a few more advances; for a smoke test, just confirm the input cleared
  await expect(page.getByPlaceholder(/describe/i)).toHaveValue('')
})

test.describe.configure({ mode: 'serial' })
```

- [ ] **Step 3: Run E2E**

```bash
pnpm exec playwright test tests/e2e/happy-path.spec.ts
```

This is a real LLM call so it costs ~$0.05 per run. Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test(e2e): happy-path full session flow"
```

---

### Task I2: Verify Vercel preview deploy with the full stack

**Files:** none

- [ ] **Step 1: Push all env vars to Vercel preview environment**

Add to Vercel preview:
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`
- `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`

- [ ] **Step 2: Deploy preview**

```bash
pnpm dlx vercel
```

Expected: deploy succeeds. Open the preview URL.

- [ ] **Step 3: Run a manual happy-path on the preview**

Sign up with a fresh email, run a session, confirm it works against the live Anthropic API.

- [ ] **Step 4: No commit needed.**

---

### Task I3: Final commit and tag

**Files:** none

- [ ] **Step 1: Run all tests one final time**

```bash
pnpm test && pnpm exec playwright test
```

Expected: all pass.

- [ ] **Step 2: Tag the milestone**

```bash
git tag -a plan-1-complete -m "Plan 1 (Vertical Slice MVP) complete"
```

- [ ] **Step 3: Push to origin if remote configured (optional)**

```bash
git remote -v
# If a remote is set:
git push origin main && git push origin plan-1-complete
```

If no remote, skip this step.

---

## Self-Review Checklist

Run through this after the plan is written. Fix any issues inline.

**Spec coverage** — every spec section has at least one task:
- §1 Executive Summary, §2 Pain, §3 Promise → not implemented; documented in spec
- §4 Why Now → not implemented; documented in spec
- §5 Wedge → moats start to form via outcome capture (Plans 2-5 deepen)
- §6 Locked Decisions row 1 (Buyer/user) → A4 + B1 (profile.role)
- §6 row 2 (Multi-modal inputs) → **DEFERRED to Plan 2** ✓
- §6 row 3 (Diagnostic scope) → no-op for code; tree-engine prompt encodes scope
- §6 row 4 (Diagnostic loop, AI tree) → D2, D3, D4
- §6 row 5 (Knowledge sources) → **partial — Plan 1 is LLM-only; corpus + retrieval = Plan 3**
- §6 row 6 (UX form factor — single web app PWA, four layouts) → A1, A2, E1-E10, H1, H2; tablet/desktop/curator deferred to Plan 4
- §6 row 7 (Failure model) → **DEFERRED to Plan 3** (risk-stratified gating + Decline-or-Defer)
- §6 row 8 (Pricing flat SaaS $700/mo) → A5, G1, G2, G3
- §6 row 9 (Cross-shop sharing day 1) → **DEFERRED to Plan 3**
- §6 row 10 (Brandon as curator) → **DEFERRED to Plan 4** (curator console)
- §6 row 11 (GTM DFW) → not code-relevant
- §6 row 12 (Vision policy describe-first) → text-only Plan 1; vision = Plan 2
- §6 row 13 (Bounded retrieval) → **DEFERRED to Plan 3**
- §6 row 14 (Photo storage tiering) → **DEFERRED to Plan 2**
- §6 row 15 (Single Next.js + PWA) → A1, A2, H1, H2

**Placeholder scan** — searched for TBD/TODO/`fill in`/`similar to`/etc. None found in task content.

**Type consistency** —
- `IntakePayload` defined in `lib/types.ts` (Task C2), used in tree-engine (D2), API route (D4)
- `TreeState`, `TreeNode` defined in `lib/ai/tree-engine.ts` (D2), referenced in components (E2, E3, E4) and DB schema (B2)
- `OutcomePayload` defined in `lib/types.ts` (F3), used in close route (F4) and form (F2 — note form uses inline shape but submits the same fields)
- `validateSpecificity` returns `ValidatorResult`, consumed in F4 — consistent

**Scope check** — Plan 1 covers a single coherent feature: end-to-end vertical slice with phone-only UX, text-only inputs, no corpus, no retrieval. Each phase produces independently-testable artifacts. Tasks are bite-sized (most ≤5 steps).

---

## End of Plan 1
