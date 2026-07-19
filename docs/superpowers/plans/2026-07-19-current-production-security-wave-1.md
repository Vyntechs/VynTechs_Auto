# Current-Production Security Wave 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close all seven high-severity current-production findings without adding a page, prompt, approval step, or diagnostic-engine behavior.

**Architecture:** Upgrade Next.js beyond every validated affected range, then make sensitive Server Components enforce account state at the data-returning boundary instead of trusting middleware alone. A sessions-segment layout centralizes release, entitlement, deactivation, and paywall enforcement for every diagnostic page; the legacy sessions index receives a technician-scoped, bounded SQL query so ordinary users never fetch another technician's complaints.

**Tech Stack:** Next.js 16 App Router, React 19 Server Components, TypeScript, Vitest, Drizzle ORM, PGlite, pnpm.

## Global Constraints

- Work only in `/Users/brandonnichols/.codex/worktrees/vyntechs-ai-pii-penetration-audit` on `security/ai-pii-penetration-audit-2026-07-19`.
- The reviewed baseline is `origin/main` revision `5b9fb0505a1f505eb8de8b0129b607e3d618ce4e`; fetch and stop if the base changes before merge rather than silently rebasing security evidence.
- Diagnostics stay globally disabled in production. Do not change prompts, retrieval, topology, risk/gating semantics, diagnostic tables, or release-policy truth.
- Do not inspect or mutate production, Supabase, Stripe, AI providers, customer data, credentials, or external services in this wave.
- Use synthetic identities and complaints only; no PII in tests, logs, commits, or reports.
- Middleware remains defense in depth, never the sole deactivation, paywall, entitlement, role, object, or release-policy control.
- Denied Server Components must make zero sensitive data queries before redirecting.
- Preserve existing mobile and desktop workflows; this wave adds no UI surface and requires no browser permission, confirmation, or repeated sign-in.
- Keep route handlers' existing independent authorization checks unchanged.
- Required completion gate: focused security tests, full `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm build`, `pnpm audit --prod --json`, clean diff review, and exact remediation-to-finding mapping.

---

### Task 1: Patch and mechanically guard the Next.js security floor

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `tests/unit/security-dependency-floor.test.ts`

**Interfaces:**
- Consumes: the repository's `package.json` and pnpm v10 lockfile.
- Produces: a CI-executed Vitest contract rejecting any manifest or resolved Next.js version below `16.2.6`; the installed target is `16.2.10`.

- [ ] **Step 1: Write the failing dependency-floor test**

```ts
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const FLOOR = [16, 2, 6] as const

function versionTuple(value: string): [number, number, number] {
  const match = value.match(/(\d+)\.(\d+)\.(\d+)/)
  if (!match) throw new Error(`No semantic version in ${value}`)
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function atLeastFloor(value: string): boolean {
  const actual = versionTuple(value)
  return actual.some((part, index) => part !== FLOOR[index])
    ? actual.find((part, index) => part !== FLOOR[index])! >
        FLOOR[actual.findIndex((part, index) => part !== FLOOR[index])]
    : true
}

describe('Next.js security floor', () => {
  it('keeps the manifest and every resolved lockfile entry at or above 16.2.6', () => {
    const root = process.cwd()
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
    expect(atLeastFloor(pkg.dependencies.next)).toBe(true)

    const lock = readFileSync(resolve(root, 'pnpm-lock.yaml'), 'utf8')
    const resolved = [...lock.matchAll(/(?:^|\s)next@(\d+\.\d+\.\d+)/gm)].map(
      (match) => match[1],
    )
    expect(resolved.length).toBeGreaterThan(0)
    expect(resolved.every(atLeastFloor)).toBe(true)
  })
})
```

- [ ] **Step 2: Run the focused test and prove the vulnerable lock fails**

Run: `pnpm vitest run tests/unit/security-dependency-floor.test.ts`

Expected: FAIL because the manifest and lock resolve Next.js `16.2.4`.

- [ ] **Step 3: Upgrade the manifest and lockfile together**

Run: `pnpm up next@16.2.10`

Expected changes:

```json
"next": "^16.2.10"
```

The lockfile must contain no `next@16.2.4`, `next@16.2.5`, or other resolution below `16.2.6`.

- [ ] **Step 4: Prove the floor and framework build**

Run:

```sh
pnpm vitest run tests/unit/security-dependency-floor.test.ts
pnpm list next --depth 0
pnpm exec tsc --noEmit
pnpm build
```

Expected: the test, typecheck, and build pass; `pnpm list` reports `next 16.2.10`.

- [ ] **Step 5: Commit the isolated dependency fix**

```sh
git add package.json pnpm-lock.yaml tests/unit/security-dependency-floor.test.ts
git commit -m "security: patch Next.js advisory floor"
```

---

### Task 2: Prove and enforce account state on team and shop settings reads

**Files:**
- Modify: `app/(app)/settings/team/page.tsx`
- Modify: `app/(app)/settings/shop/page.tsx`
- Modify: `tests/unit/shop-os-canned-job-settings.test.tsx`
- Create: `tests/unit/settings-team-page-security.test.tsx`

**Interfaces:**
- Consumes: `checkAccess(db, userId): Promise<AccessResult>` from `lib/auth-access.ts`.
- Produces: route-local redirect decisions before the first roster, shop, rate, canned-job, or supplier query.

- [ ] **Step 1: Add failing shop-settings denial tests**

Extend the hoisted mocks in `tests/unit/shop-os-canned-job-settings.test.tsx` with `access: vi.fn()`, mock `@/lib/auth-access`, and default it to `{ kind: 'allow', entitlements: { diagnostics: false } }`. Add:

```tsx
it.each([
  [{ kind: 'deactivated' }, '/deactivated'],
  [{ kind: 'paywall', reason: 'unpaid' }, '/subscribe'],
] as const)('redirects denied owners before reading shop data', async (result, destination) => {
  auth.mockResolvedValue({
    user: { id: 'user-1', email: 'owner@test.dev' },
    profile: { id: 'profile-1', role: 'owner', shopId: 'shop-1' },
  })
  access.mockResolvedValue(result)

  await expect(SettingsShopPage()).rejects.toThrow(`redirect:${destination}`)
  expect(getShop).not.toHaveBeenCalled()
  expect(list).not.toHaveBeenCalled()
  expect(listVendors).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Add the failing team-settings page contract**

Create `tests/unit/settings-team-page-security.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { auth, access, redirect, select } = vi.hoisted(() => ({
  auth: vi.fn(),
  access: vi.fn(),
  redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`) }),
  select: vi.fn(),
}))

vi.mock('next/navigation', () => ({ redirect, notFound: vi.fn() }))
vi.mock('@/lib/db/client', () => ({ db: { select } }))
vi.mock('@/lib/supabase-server', () => ({ getServerSupabase: vi.fn(async () => ({})) }))
vi.mock('@/lib/auth', () => ({
  requireUserAndProfile: auth,
  isFounder: () => false,
}))
vi.mock('@/lib/auth-access', () => ({ checkAccess: access }))

import SettingsTeamPage from '@/app/(app)/settings/team/page'

describe('settings team page security', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    auth.mockResolvedValue({
      user: { id: 'user-1', email: 'owner@test.dev' },
      profile: { id: 'profile-1', role: 'owner', shopId: 'shop-1' },
    })
  })

  it.each([
    [{ kind: 'deactivated' }, '/deactivated'],
    [{ kind: 'paywall', reason: 'past_due' }, '/subscribe'],
  ] as const)('redirects before the roster query', async (result, destination) => {
    access.mockResolvedValue(result)
    await expect(SettingsTeamPage()).rejects.toThrow(`redirect:${destination}`)
    expect(select).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run both focused files and prove the missing guards fail**

Run:

```sh
pnpm vitest run tests/unit/shop-os-canned-job-settings.test.tsx tests/unit/settings-team-page-security.test.tsx
```

Expected: FAIL because neither page calls `checkAccess` before its sensitive query.

- [ ] **Step 4: Add the same route-local guard before role and data checks**

In both page modules import `checkAccess` and insert immediately after authentication:

```tsx
const access = await checkAccess(db, ctx.user.id)
if (access.kind === 'deactivated') redirect('/deactivated')
if (access.kind === 'paywall') redirect('/subscribe')
```

- [ ] **Step 5: Run the page tests and adjacent settings tests**

Run:

```sh
pnpm vitest run tests/unit/shop-os-canned-job-settings.test.tsx tests/unit/settings-team-page-security.test.tsx tests/unit/team-section.test.tsx tests/unit/shop-os-vendor-account-routes.test.ts
```

Expected: PASS, including active-owner behavior and zero sensitive queries for denied owners.

- [ ] **Step 6: Commit the settings boundary**

```sh
git add 'app/(app)/settings/team/page.tsx' 'app/(app)/settings/shop/page.tsx' tests/unit/shop-os-canned-job-settings.test.tsx tests/unit/settings-team-page-security.test.tsx
git commit -m "security: gate sensitive settings reads locally"
```

---

### Task 3: Add one diagnostics-page guard for every sessions child page

**Files:**
- Create: `app/(app)/sessions/layout.tsx`
- Create: `tests/unit/sessions-layout-security.test.tsx`

**Interfaces:**
- Consumes: authenticated context, `checkAccess`, `isDiagnosticsReleaseEnabled`, and `AccessResult.entitlements.diagnostics`.
- Produces: a segment-level guard that executes before `/sessions`, `/sessions/new`, `/sessions/[id]`, `/decline`, and `/outcome` render their child data.

- [ ] **Step 1: Write the failing sessions-layout policy test**

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { auth, access, release, redirect } = vi.hoisted(() => ({
  auth: vi.fn(),
  access: vi.fn(),
  release: vi.fn(),
  redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`) }),
}))

vi.mock('next/navigation', () => ({ redirect }))
vi.mock('@/lib/db/client', () => ({ db: {} }))
vi.mock('@/lib/supabase-server', () => ({ getServerSupabase: vi.fn(async () => ({})) }))
vi.mock('@/lib/auth', () => ({ requireUserAndProfile: auth }))
vi.mock('@/lib/auth-access', () => ({ checkAccess: access }))
vi.mock('@/lib/release-policy', () => ({ isDiagnosticsReleaseEnabled: release }))

import SessionsLayout from '@/app/(app)/sessions/layout'

describe('sessions segment security', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    auth.mockResolvedValue({ user: { id: 'user-1' }, profile: { id: 'tech-1' } })
    access.mockResolvedValue({ kind: 'allow', entitlements: { diagnostics: true } })
    release.mockReturnValue(true)
  })

  it.each([
    [{ kind: 'deactivated' }, '/deactivated'],
    [{ kind: 'paywall', reason: 'canceled' }, '/subscribe'],
  ] as const)('enforces account state without middleware', async (result, destination) => {
    access.mockResolvedValue(result)
    await expect(SessionsLayout({ children: <span>secret</span> })).rejects.toThrow(
      `redirect:${destination}`,
    )
  })

  it.each([
    [false, true],
    [true, false],
  ])('keeps diagnostics unreachable when release=%s entitlement=%s', async (enabled, entitled) => {
    release.mockReturnValue(enabled)
    access.mockResolvedValue({ kind: 'allow', entitlements: { diagnostics: entitled } })
    await expect(SessionsLayout({ children: <span>secret</span> })).rejects.toThrow(
      'redirect:/today',
    )
  })

  it('preserves the authorized development path', async () => {
    await expect(SessionsLayout({ children: <span>allowed</span> })).resolves.toEqual(
      <span>allowed</span>,
    )
  })
})
```

- [ ] **Step 2: Run the test and prove the guard does not exist**

Run: `pnpm vitest run tests/unit/sessions-layout-security.test.tsx`

Expected: FAIL because `app/(app)/sessions/layout.tsx` does not exist.

- [ ] **Step 3: Implement the segment guard**

```tsx
import { redirect } from 'next/navigation'
import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import { requireUserAndProfile } from '@/lib/auth'
import { checkAccess } from '@/lib/auth-access'
import { isDiagnosticsReleaseEnabled } from '@/lib/release-policy'

export default async function SessionsLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireUserAndProfile({ supabase: await getServerSupabase(), db })
  if (!ctx) redirect('/sign-in')

  const access = await checkAccess(db, ctx.user.id)
  if (access.kind === 'deactivated') redirect('/deactivated')
  if (access.kind === 'paywall') redirect('/subscribe')
  if (!isDiagnosticsReleaseEnabled() || !access.entitlements.diagnostics) redirect('/today')

  return children
}
```

- [ ] **Step 4: Prove all account/release branches and existing release contracts**

Run:

```sh
pnpm vitest run tests/unit/sessions-layout-security.test.tsx tests/unit/release-policy.test.ts tests/unit/auth-access.test.ts
```

Expected: PASS. Production release policy remains forced off.

- [ ] **Step 5: Commit the sessions boundary**

```sh
git add 'app/(app)/sessions/layout.tsx' tests/unit/sessions-layout-security.test.tsx
git commit -m "security: gate diagnostic pages at their segment"
```

---

### Task 4: Restrict the legacy sessions index to the signed-in technician

**Files:**
- Modify: `lib/db/queries.ts`
- Modify: `app/(app)/sessions/page.tsx`
- Modify: `tests/unit/queries.test.ts`
- Create: `tests/unit/sessions-index-security.test.tsx`

**Interfaces:**
- Produces: `listSessionsForTech(db: AppDb, shopId: string, techId: string): Promise<Session[]>`.
- Consumes: trusted `ctx.profile.shopId` and `ctx.profile.id`; returns at most 50 newest matching rows.

- [ ] **Step 1: Add a failing database boundary test**

Add `listSessionsForTech` to the `@/lib/db/queries` import and `sessions` to the schema import in `tests/unit/queries.test.ts`. Add:

```ts
it('returns only the requested technician newest-first and caps the transfer at 50', async () => {
  const shopA = await createShop(db, { name: 'Shop A' })
  const shopB = await createShop(db, { name: 'Shop B' })
  const techA = await createProfile(db, { userId: crypto.randomUUID(), shopId: shopA.id })
  const peer = await createProfile(db, { userId: crypto.randomUUID(), shopId: shopA.id })
  const outsider = await createProfile(db, { userId: crypto.randomUUID(), shopId: shopB.id })

  for (let index = 0; index < 51; index += 1) {
    const owned = await createSession(db, {
      shopId: shopA.id,
      techId: techA.id,
      intake: {
        vehicleYear: 2024,
        vehicleMake: 'Ford',
        vehicleModel: 'F-350',
        customerComplaint: `owned synthetic concern ${index}`,
      },
      treeState: { nodes: [], currentNodeId: 'root', message: 'go' },
    })
    await db
      .update(sessions)
      .set({ createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)) })
      .where(eq(sessions.id, owned.id))
  }

  for (const [tech, complaint] of [
    [peer, 'peer private concern'],
    [outsider, 'other shop private concern'],
  ] as const) {
    await createSession(db, {
      shopId: tech.shopId!,
      techId: tech.id,
      intake: {
        vehicleYear: 2023,
        vehicleMake: 'Toyota',
        vehicleModel: 'Tundra',
        customerComplaint: complaint,
      },
      treeState: { nodes: [], currentNodeId: 'root', message: 'go' },
    })
  }

  const items = await listSessionsForTech(db, shopA.id, techA.id)
  expect(items).toHaveLength(50)
  expect(items.every((item) => item.shopId === shopA.id && item.techId === techA.id)).toBe(true)
  expect(items[0].intake.customerComplaint).toBe('owned synthetic concern 50')
  expect(items.at(-1)?.intake.customerComplaint).toBe('owned synthetic concern 1')
  expect(items.map((item) => item.intake.customerComplaint)).not.toContain('peer private concern')
})
```

- [ ] **Step 2: Add a failing page-wiring test**

Create `tests/unit/sessions-index-security.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { auth, listForTech } = vi.hoisted(() => ({
  auth: vi.fn(),
  listForTech: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`) }),
}))
vi.mock('@/lib/db/client', () => ({ db: {} }))
vi.mock('@/lib/supabase-server', () => ({ getServerSupabase: vi.fn(async () => ({})) }))
vi.mock('@/lib/auth', () => ({ requireUserAndProfile: auth }))
vi.mock('@/lib/db/queries', () => ({ listSessionsForTech: listForTech }))

import SessionsPage from '@/app/(app)/sessions/page'

describe('sessions index object boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    auth.mockResolvedValue({
      user: { id: 'user-1', email: 'tech@synthetic.invalid' },
      profile: {
        id: 'tech-1',
        shopId: 'shop-1',
        fullName: 'Synthetic Tech',
      },
    })
    listForTech.mockResolvedValue([])
  })

  it('queries only the authenticated technician scope', async () => {
    await SessionsPage()
    expect(listForTech).toHaveBeenCalledWith({}, 'shop-1', 'tech-1')
  })
})
```

The test intentionally exposes no `listSessionsForShop` mock, so the pre-fix page import/call fails closed.

- [ ] **Step 3: Run both tests and prove the helper/wiring are absent**

Run:

```sh
pnpm vitest run tests/unit/queries.test.ts tests/unit/sessions-index-security.test.tsx
```

Expected: FAIL because `listSessionsForTech` is not exported and the page still calls `listSessionsForShop`.

- [ ] **Step 4: Implement the bounded SQL helper**

```ts
export async function listSessionsForTech(
  db: AppDb,
  shopId: string,
  techId: string,
): Promise<Session[]> {
  return db
    .select()
    .from(sessions)
    .where(and(eq(sessions.shopId, shopId), eq(sessions.techId, techId)))
    .orderBy(desc(sessions.createdAt))
    .limit(50)
}
```

Replace the sessions-page import and call:

```tsx
const items = ctx.profile.shopId
  ? await listSessionsForTech(db, ctx.profile.shopId, ctx.profile.id)
  : []
```

- [ ] **Step 5: Run query, page, and same-shop isolation tests**

Run:

```sh
pnpm vitest run tests/unit/queries.test.ts tests/unit/sessions-index-security.test.tsx tests/unit/sessions.test.ts
```

Expected: PASS; the SQL query returns only the authenticated technician's newest 50 sessions.

- [ ] **Step 6: Commit the object boundary**

```sh
git add lib/db/queries.ts 'app/(app)/sessions/page.tsx' tests/unit/queries.test.ts tests/unit/sessions-index-security.test.tsx
git commit -m "security: scope session listings to their technician"
```

---

### Task 5: Run the Wave-1 release gate and record exact closure

**Files:**
- Modify: `docs/strategy/2026-07-10-shop-os-spec-and-phased-plan.md`
- Create: `docs/security/2026-07-19-current-production-security-wave-1-closure.md`

**Interfaces:**
- Consumes: Tasks 1–4 commits and the sealed reports for `CAND-S052-001`, `CAND-S052-002`, `CAND-S052-003`, `CAND-S054-001`, `CAND-S055-001`, `CAND-S056-001`, and `CAND-S056-002`.
- Produces: a finding-to-fix/test receipt and a new security row in the active ShopOS status table.

- [ ] **Step 1: Run the focused security set**

```sh
pnpm vitest run \
  tests/unit/security-dependency-floor.test.ts \
  tests/unit/shop-os-canned-job-settings.test.tsx \
  tests/unit/settings-team-page-security.test.tsx \
  tests/unit/sessions-layout-security.test.tsx \
  tests/unit/sessions-index-security.test.tsx \
  tests/unit/queries.test.ts \
  tests/unit/auth-access.test.ts \
  tests/unit/release-policy.test.ts
```

Expected: all pass with no real PII, external calls, or production state.

- [ ] **Step 2: Run the complete repository gate**

```sh
pnpm test
pnpm exec tsc --noEmit
pnpm build
pnpm audit --prod --json > /tmp/vyntechs-wave1-audit.json
```

Expected: tests, typecheck, and build exit zero. Review the audit JSON; the three validated Next.js high advisories must be absent. Any unrelated advisory remains explicitly classified rather than hidden.

- [ ] **Step 3: Write the closure receipt**

The closure document must map each of the seven candidate IDs to:

```markdown
| Finding | Durable control | Regression proof | User friction | Residual risk |
|---|---|---|---|---|
```

Every row must name exact paths and test names. `User friction` must be `none` unless fresh verification proves otherwise.

- [ ] **Step 4: Add the active-plan row in the shipping branch**

Append Row 50:

```markdown
| 50 | X | Current-production security gate: framework, route-local access, and diagnostic object isolation | P/I/R | 47,49 | in_progress | [Wave-1 execution packet](../superpowers/plans/2026-07-19-current-production-security-wave-1.md); seven high findings; no production mutation or diagnostic enablement |
```

Change it to `complete` only in the PR that contains the passing closure receipt and merge reference.

- [ ] **Step 5: Review the diff for scope and secrets**

```sh
git diff --check origin/main...HEAD
git diff --stat origin/main...HEAD
git status --short
rg -n "(sk_live_|sk_test_|service_role|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|@.*\.(com|net|org))" \
  docs/security tests/unit package.json pnpm-lock.yaml \
  --glob '!*.snap'
```

Expected: no whitespace errors, no unrelated source changes, no real credentials or personal email addresses, and diagnostics still forced off in production.

- [ ] **Step 6: Commit the proof packet**

```sh
git add docs/strategy/2026-07-10-shop-os-spec-and-phased-plan.md docs/security/2026-07-19-current-production-security-wave-1-closure.md
git commit -m "docs: record current-production security wave 1"
```

---

## Self-Review Receipt

- **Spec coverage:** All seven high findings map to a task: three dependency advisories to Task 1; settings disclosures to Task 2; sessions release/account bypasses to Task 3; same-shop cross-technician enumeration to Task 4; independent closure evidence to Task 5.
- **Scope control:** No diagnostics behavior, production database, external provider, payment, media, UI, or customer-data change is included.
- **Type consistency:** `checkAccess`, `AccessResult.entitlements.diagnostics`, `isDiagnosticsReleaseEnabled`, `listSessionsForTech`, `AppDb`, and `Session` match existing repository interfaces.
- **Placeholder scan:** No TBD/TODO/future implementation placeholders remain. Every code-changing task provides exact code and commands.
- **Rollback:** Revert each task commit independently. If Task 1 is reverted, do not deploy; if Tasks 2–4 are reverted, keep middleware containment and diagnostics globally off while restoring the relevant fix.
