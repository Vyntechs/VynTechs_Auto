# ShopOS Authenticated Golden Shop Day Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the complete four-role Golden Shop Day through normal hosted authentication in real phone and desktop browsers, repair only browser-observed continuity/accessibility/lost-work defects, and leave a repeatable synthetic release gate.

**Architecture:** Keep one fixed production QA shop and four Supabase users whose random credentials live only in macOS Keychain. A local test orchestrator securely loads existing Vercel environment values, provisions the exact QA contract idempotently, runs one Playwright journey at 390×844 and one at 1440×900, then removes and recounts only run-scoped operational rows. Product changes are permitted only after the browser produces a reproducible defect on Today or the mounted repair order.

**Tech Stack:** Next.js 16, React 19, TypeScript 6, Supabase Auth, postgres.js, Playwright 1.59, `@axe-core/playwright` 4.12.1, Vitest 4, macOS Keychain, Vercel.

## Global Constraints

- Add no real customer data, operational page, schema/migration, diagnostic or media entrance, auth bypass, provider call, email delivery, or external purchase.
- The QA shop ID and four role contracts are fixed and non-secret; passwords, service-role keys, database URLs, tokens, cookies, traces, and storage states are never committed or printed.
- The QA shop is comped only to bypass billing, has diagnostics explicitly false, has no Stripe customer, and never sends a quote or message.
- Browser output contains only synthetic fixture data and stays under ignored Playwright output paths.
- Every data mutation is restricted to the fixed QA shop; cleanup failure or unexpected dependencies fail the release gate.
- Database-heavy Vitest runs use at most two workers. Browser device projects run serially.
- Product repairs begin with a failing regression and stay inside Today, the mounted repair order, or their existing handlers.

---

### Task 1: Build the secret-safe QA contract and orchestrator

**Files:**
- Create: `scripts/shop-os-golden-browser.mjs`
- Create: `tests/unit/shop-os-golden-browser-tooling.test.mjs`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces: CLI commands `provision`, `test`, and `verify-clean`.
- Produces: fixed `QA_SHOP_ID`, `QA_SHOP_NAME`, role/profile IDs, `.invalid` emails, Keychain service names, `loadVercelEnv()`, `ensureQaTenant()`, `readQaCredentials()`, and `verifyQaClean()`.
- Consumes: Vercel CLI login plus the existing `DATABASE_URL` pulled into a mode-0600 temporary file and removed in `finally`; signup uses the project’s public URL and publishable key only.

- [ ] **Step 1: Add the official browser accessibility dependency**

Run:

```bash
pnpm add -D @axe-core/playwright@4.12.1
```

Expected: only `package.json` and `pnpm-lock.yaml` dependency metadata changes.

- [ ] **Step 2: Write RED tooling tests**

Create tests that import the script's pure exports and prove:

```js
expect(QA_SHOP_ID).toMatch(/^[0-9a-f-]{36}$/)
expect(Object.values(QA_USERS).map((user) => user.role)).toEqual([
  'owner', 'advisor', 'tech', 'parts',
])
expect(Object.values(QA_USERS).every((user) => user.email.endsWith('.invalid'))).toBe(true)
expect(parseEnvFile('DATABASE_URL="postgres://example"\n').DATABASE_URL)
  .toBe('postgres://example')
expect(redactError(new Error('password=secret'))).not.toContain('secret')
expect(cleanupSql(QA_SHOP_ID)).toContain('where shop_id = $1')
expect(cleanupSql(QA_SHOP_ID)).not.toContain('delete from public.profiles')
```

Also prove the cleanup manifest names only ticket-scoped tables and requires zero remaining tickets, customers, vehicles, job lines, part requests, quote events/versions, and payments before returning success.

- [ ] **Step 3: Prove RED**

Run:

```bash
pnpm vitest run tests/unit/shop-os-golden-browser-tooling.test.mjs --maxWorkers=1 --reporter=verbose
```

Expected: FAIL because the orchestrator exports do not exist.

- [ ] **Step 4: Implement the orchestrator**

Implement a pure-data contract plus three commands:

```text
provision
  -> pull production env to mkdtemp()/mode 0600
  -> create or rotate exact four admin-confirmed auth users
  -> upsert exact shop/profiles/diagnostics-false state in one transaction
  -> remove any Stripe customer for the fixed QA shop
  -> write each generated password to its dedicated Keychain item
  -> verify role/tier/membership/comp/entitlement counts

test --base-url <url>
  -> read four passwords from Keychain without printing
  -> export only role credential variables to Playwright child process
  -> generate a cryptographic run marker
  -> run playwright.golden.config.ts serially
  -> call verify-clean even when Playwright fails

verify-clean
  -> acquire a QA-shop advisory lock
  -> report only table counts
  -> fail unless every operational count is zero
```

Use `execFileSync()`/`spawnSync()` argument arrays; never shell-interpolate a credential. Export only exit status and redacted table/count receipts.

- [ ] **Step 5: Add package commands and prove tooling**

Add:

```json
"qa:golden:provision": "node scripts/shop-os-golden-browser.mjs provision",
"test:e2e:golden": "node scripts/shop-os-golden-browser.mjs test --base-url https://vyntechs.dev",
"qa:golden:clean": "node scripts/shop-os-golden-browser.mjs verify-clean"
```

Run:

```bash
pnpm vitest run tests/unit/shop-os-golden-browser-tooling.test.mjs --maxWorkers=1 --reporter=verbose
pnpm exec tsc --noEmit --pretty false
git diff --check
```

Expected: tooling tests and TypeScript pass; no secret value or generated auth state appears in `git status`.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml scripts/shop-os-golden-browser.mjs tests/unit/shop-os-golden-browser-tooling.test.mjs
git commit -m "test: add Golden browser QA control"
```

---

### Task 2: Build the authenticated phone/desktop journey

**Files:**
- Create: `playwright.golden.config.ts`
- Create: `tests/e2e/golden-shop-day.spec.ts`
- Create: `tests/e2e/golden-browser-receipts.ts`
- Test: `tests/unit/shop-os-golden-browser-tooling.test.mjs`

**Interfaces:**
- Consumes: `GOLDEN_QA_RUN_ID`, `GOLDEN_QA_BASE_URL`, and four role-specific email/password environment pairs from Task 1.
- Produces: two serial projects named `golden-phone` and `golden-desktop`, plus `assertLivingSurface(page, expected)` and `assertNoA11yBlockers(page)` helpers.

- [ ] **Step 1: Add the two-device config**

Configure exactly:

```ts
projects: [
  { name: 'golden-phone', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  { name: 'golden-desktop', use: { viewport: { width: 1440, height: 900 } } },
]
```

Set `workers: 1`, `fullyParallel: false`, `retries: 0`, `trace: 'retain-on-failure'`, screenshot/video only on failure, and no local `webServer`. Refuse a base URL outside `vyntechs.dev` unless `GOLDEN_QA_ALLOW_LOCALHOST=1` is explicit.

- [ ] **Step 2: Write the browser receipt helpers**

`assertLivingSurface()` must prove meaningful body content, no Next.js error overlay, no horizontal document overflow, one visible expected primary action, explicitly forbidden action labels absent, and no diagnostic/media label. `assertNoA11yBlockers()` runs `AxeBuilder` with WCAG 2 A/AA tags and fails on serious or critical violations. Add a keyboard helper that tabs to the primary action and proves its bounding rectangle intersects the viewport.

- [ ] **Step 3: Write the complete journey**

For each project, create four isolated contexts and sign in through `/sign-in`. Drive this sequence using roles/labels and visible text:

```text
ADVISOR creates tagged Counter repair order without preassignment
OWNER and ADVISOR find it in Today
ADVISOR assigns TECH from the mounted ticket
TECH finds owned work and records manual findings
ADVISOR builds one labor line, prepares V1, and records in-person approval
TECH opens approved work, types a draft, proves the leave guard, reloads committed truth,
  clocks on, saves notes, and requests a text-only part
PARTS finds Parts needed, opens the mounted ticket, and resolves the request
TECH resumes and completes work
OWNER records the exact synthetic balance and closes
ALL roles reload and see terminal read-only truth with forbidden controls absent
```

The phone and desktop runs use distinct marker suffixes. Each test calls cleanup in `finally`, then asserts the run marker count is zero.

- [ ] **Step 4: Prove collection and authentication failure behavior**

Run without credentials:

```bash
GOLDEN_QA_BASE_URL=https://vyntechs.dev pnpm exec playwright test --config playwright.golden.config.ts --list
```

Expected: exactly two tests collect without starting a dev server. Running either test without credentials fails before navigation with the missing environment variable name and no secret value.

- [ ] **Step 5: Commit**

```bash
git add playwright.golden.config.ts tests/e2e/golden-shop-day.spec.ts tests/e2e/golden-browser-receipts.ts
git commit -m "test: drive authenticated Golden Shop Day"
```

---

### Task 3: Provision the isolated canary and run current production

**Files:**
- Modify evidence only: `docs/superpowers/plans/2026-07-20-shop-os-authenticated-golden-day.md`

**Interfaces:**
- Consumes: Tasks 1–2 plus current `https://vyntechs.dev`.
- Produces: one provisioning receipt and two browser result receipts with no secrets or customer data.

- [ ] **Step 1: Run the adversarial preflight**

Before provisioning, verify the fixed shop/users do not exist under a different contract, Keychain output is never printed, Vercel temp files are mode 0600 and removed, diagnostics resolves false, billing bypass is isolated to `is_comp`, and cleanup SQL cannot omit `shop_id = $1`.

- [ ] **Step 2: Provision and verify**

Run:

```bash
pnpm qa:golden:provision
pnpm qa:golden:clean
```

Expected: exactly one QA shop, four active profiles with intended roles/tiers, four confirmed auth users, diagnostics false, zero Stripe customer, zero operational rows, and no secret output.

- [ ] **Step 3: Run phone and desktop against current production**

Run:

```bash
pnpm test:e2e:golden
```

Expected: either two complete passes with clean teardown, or a checkpoint-specific failure packet containing viewport, role, route, screenshot/trace path, console summary, accessibility violations, and the first contradictory behavior.

- [ ] **Step 4: Record findings before repair**

Append a compact receipt under this task naming each observed defect, its reproduction checkpoint, severity, affected existing surface, and regression-test target. Do not modify product code until the complete phone/desktop finding set is captured and consolidated.

---

### Task 4: Repair only consolidated browser findings

**Allowed product files:**
- `components/screens/today-home.tsx`
- `components/screens/today-jobs-board.tsx`
- `components/screens/ticket-detail.tsx`
- `components/screens/manual-quote-builder.tsx`
- `components/screens/simple-work-workspace.tsx`
- `components/screens/ring-out-section.tsx`
- Their existing CSS modules and focused unit/component tests
- Existing route/domain handler only when the browser receipt proves the failure is server-side

**Interfaces:**
- Consumes: the complete Task 3 finding set.
- Produces: one consolidated repair wave; no speculative change.

- [ ] **Step 1: Write one RED regression per blocking finding**

Each test must reproduce the browser-observed state, not merely assert a class name. Examples of valid targets are preserved draft text after a local transition, visible focused primary action at 390×844, bounded long content, correct role control absence, and locally reconciled server truth after mutation.

- [ ] **Step 2: Prove all regressions RED together**

Run only the affected focused files with at most two workers. Record the exact failure names before changing product code.

- [ ] **Step 3: Apply one minimal repair wave**

Fix only the consolidated blockers using existing mounted surfaces and handlers. Add no route, page, diagnostic/media path, new state store, broad refactor, or unrelated polish.

- [ ] **Step 4: Focused re-review and browser re-run**

Run the focused regressions, then `pnpm test:e2e:golden` against the branch's Vercel preview. Any new Critical or Important defect not caused by the repair is an architecture stop and requires one re-plan.

- [ ] **Step 5: Commit**

Stage only the evidence-backed product and regression files and commit:

```bash
git commit -m "fix: polish authenticated Golden Shop Day"
```

If Task 3 produces no product defect, skip this task and record `No repair wave required` rather than creating an empty change.

---

### Task 5: Converge, publish, and prove the exact production revision

**Files:**
- Modify: `docs/strategy/2026-07-10-shop-os-spec-and-phased-plan.md`
- Modify: `docs/strategy/SHOP_OS_DRIVER_STATE.md`
- Modify: `docs/superpowers/plans/2026-07-20-shop-os-authenticated-golden-day.md`

**Interfaces:**
- Consumes: clean Task 1–4 receipts.
- Produces: completed Row 55 and exact production proof.

- [ ] **Step 1: Run focused convergence and cleanup proof**

Run the tooling unit test, existing hermetic Golden test, affected role/auth/Today/ticket/work/parts/quote/ring-out tests, both browser projects, and `pnpm qa:golden:clean`.

- [ ] **Step 2: Run consolidated static/security/runtime review**

Review credential non-disclosure, fixed-shop scoping, cleanup ownership, cross-shop isolation, auth/cookie handling, role/capability expansion, diagnostic/media refusal, trace/screenshot privacy, selector quality, viewport fidelity, accessibility results, lost-work behavior, and test tautology. Batch blockers into one repair wave and one focused re-review.

- [ ] **Step 3: Run repository gates**

Run eight sequential Vitest shards with two workers, then:

```bash
pnpm exec tsc --noEmit --pretty false
pnpm exec next build --webpack
git diff --check
```

Expected: zero failures, 64/64 pages, and no schema, migration, page, diagnostic/media, provider, credential, or real-data path.

- [ ] **Step 4: Publish through protected PR**

Update Row 55 and `SHOP_OS_DRIVER_STATE.md` with exact counts and evidence, run the publication-safety diff guard, push, open a PR, wait for GitGuardian and Vercel, review the exact PR diff, and merge only when green.

- [ ] **Step 5: Verify exact production and close**

After the merge commit deploys, run the authenticated Golden journey against `https://vyntechs.dev` again, prove zero run-scoped rows, verify production health/sign-in/protected-route boundaries, and update the durable Row 55 receipt through a documentation-only protected PR if needed.

**Done when:** The same isolated QA shop completes one fully authenticated Golden Shop Day at 390×844 and 1440×900 against the exact production revision, every required browser receipt passes, all run-scoped rows are gone, and every observed defect is either repaired with regression proof or explicitly absent.

**Verified by:** Idempotent QA provisioning; secret/cleanup tooling tests; two real authenticated browser journeys; Axe/keyboard/overflow/console/reload/draft receipts; hermetic Golden gate; focused and full tests; TypeScript; production build; diff/reviewer gates; GitGuardian/Vercel; exact-revision production rerun; zero-row cleanup proof.
