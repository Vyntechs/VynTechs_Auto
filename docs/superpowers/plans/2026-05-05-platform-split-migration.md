# Platform Split Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the existing single Next.js app at `/Volumes/Creativity/dev/projects/vyntechs` into a Turborepo monorepo with two deployable products (`apps/diagnostic` for the existing AI tool; `apps/shop` as a placeholder for the future shop management product) and a shared identity layer (`packages/db`, `packages/auth`, `packages/ui`, `packages/billing`, `packages/config`, `packages/types`), with Stripe Entitlements + per-profile overrides as the toggle.

**Architecture:** Phased, rollback-safe migration. Each stage is independently revertable. Production deployment continuity at `vyntechs.dev` is the highest constraint — the diagnostic app must behave byte-equivalently before, during, and after the split. Shop management features are NOT built; only the deployable shell on `shop.vyntechs.dev`.

**Tech Stack:** Turborepo, pnpm workspaces, Next.js 16, Drizzle ORM, Supabase Postgres, Stripe Entitlements API, Vercel deployment.

**Reference spec:** `docs/superpowers/specs/2026-05-05-platform-split-design.md`

**Estimated effort:** 8-12 focused hours, expected to span 2-3 sessions with explicit stop points between stages.

---

## Phase map

| Stage | What it does | Risk | Stop after? |
|---|---|---|---|
| **0** | Capture baseline; tag rollback line; snapshot envs | None | Optional |
| **1** | Reshape repo into `apps/diagnostic/` + workspace skeleton; no logic changes | Low — purely structural | **YES** — validate, sleep on it |
| **2a-f** | Extract 6 shared packages from `apps/diagnostic` into `packages/*` | Low-Medium per package | After 2c (`packages/db` is the riskiest extraction) |
| **3** | Add `shop_entitlements` + `profile_entitlements` tables; `hasEntitlement` helper; Stripe webhook | Medium — DB schema additive but middleware change is real | **YES** — validate prod-traffic shaped scenarios |
| **4** | Scaffold `apps/shop` placeholder; configure middleware to require `shop_mgmt_access` | Low — empty app | Optional |
| **5** | CI migration job, second Vercel project, lint rule, env scoping, AGENTS.md update | Low | Optional |
| **6** | Production cutover: turn off `/intake/*` flag, verify both apps in prod, remove old flag | High — ships to prod | **TERMINAL** — migration complete |

**Rule:** never start a stage without the previous stage's verification gate green. Each stage is independently revertable via `git revert <stage-N-commit>`.

---

## Target file structure (end state after Stage 6)

```
vyntechs/
├── apps/
│   ├── diagnostic/                        ← all current app code lives here
│   │   ├── app/
│   │   ├── components/
│   │   ├── lib/                           ← only diagnostic-specific lib code
│   │   ├── public/
│   │   ├── tests/
│   │   ├── middleware.ts
│   │   ├── next.config.js
│   │   ├── tsconfig.json                  ← extends @repo/config/tsconfig
│   │   ├── tailwind.config.ts
│   │   ├── vitest.config.ts
│   │   ├── vercel.json
│   │   └── package.json                   (name: "diagnostic")
│   └── shop/                              ← placeholder shell only
│       ├── app/
│       │   ├── layout.tsx
│       │   ├── page.tsx                   ("Shop Management — Coming Soon" auth-gated)
│       │   └── unauthorized/page.tsx
│       ├── middleware.ts                  (requires shop_mgmt_access entitlement)
│       ├── next.config.js
│       ├── tsconfig.json                  ← extends @repo/config/tsconfig
│       ├── tailwind.config.ts
│       └── package.json                   (name: "shop")
├── packages/
│   ├── config/                            (tsconfig, eslint, tailwind, prettier presets)
│   ├── types/                             (shared domain types)
│   ├── db/                                (Drizzle schema, client, migrations, RLS)
│   ├── auth/                              (Supabase helpers, middleware utilities, hasEntitlement)
│   ├── billing/                           (Stripe client, entitlements webhook handler)
│   └── ui/                                (shared shadcn primitives)
├── docs/
├── supabase/
├── .claude/
├── ARCHITECTURE.md                        (created in Stage 5)
├── docs/decisions/                        (ADRs created in Stage 5)
├── pnpm-workspace.yaml                    (created in Stage 1)
├── turbo.json                             (created in Stage 1)
├── tsconfig.base.json                     (created in Stage 1)
├── package.json                           (workspace root, minimal)
└── pnpm-lock.yaml
```

---

# Stage 0 — Pre-migration baseline

**Goal:** Capture a snapshot of the current state so any regression can be detected. Tag a rollback line. No code changes.

**Risk:** None.

**Owner:** This stage runs from the existing main worktree at `/Volumes/Creativity/dev/projects/vyntechs`, on branch `main`.

### Task 0.1: Verify clean working tree on main

**Files:** None changed.

- [ ] **Step 1: Confirm clean tree on main**

```bash
cd /Volumes/Creativity/dev/projects/vyntechs
git status
```

Expected: `On branch main` and `nothing to commit, working tree clean`. If anything is uncommitted, stop and resolve before proceeding.

- [ ] **Step 2: Confirm main is up to date with origin**

```bash
git fetch origin
git status
```

Expected: `Your branch is up to date with 'origin/main'.` If ahead/behind, resolve before proceeding.

### Task 0.2: Capture baseline test/typecheck/build results

**Files:**
- Create: `docs/superpowers/sessions/2026-05-05-baseline-pre-monorepo.md`

- [ ] **Step 1: Run full baseline**

```bash
pnpm test 2>&1 | tail -10
pnpm exec tsc --noEmit 2>&1 | tail -5
pnpm build 2>&1 | tail -20
```

Expected:
- `pnpm test`: 378 passing, 0 failing (or whatever current count is — capture exact number)
- `pnpm exec tsc --noEmit`: no output (clean)
- `pnpm build`: completes with `✓ Compiled successfully` and route table

- [ ] **Step 2: Write baseline doc capturing exact numbers**

Create `docs/superpowers/sessions/2026-05-05-baseline-pre-monorepo.md`:

```markdown
# Pre-monorepo baseline (2026-05-05)

Captured before Stage 1 of the platform split migration. Reference for regression testing throughout migration stages.

## Test suite
- Total: <N> passing
- Test files: <M>
- Run command: `pnpm test`

## Typecheck
- `pnpm exec tsc --noEmit`: clean (0 errors)

## Build
- `pnpm build`: clean
- Route count: <N>
- Bundle size summary: <paste from build output>

## Production
- Branch: main
- HEAD commit: <git rev-parse HEAD output>
- Production URL: vyntechs.dev
- Production deployment: <vercel deploy URL from `vercel ls` of most recent Ready Production>

## Tag
- `pre-monorepo-baseline` tagged at HEAD

## Notes
This is the rollback line. If any stage of the migration fails irrecoverably,
`git reset --hard pre-monorepo-baseline` returns the repo to this exact state.
```

Replace `<N>`, `<M>`, etc. with actual values.

- [ ] **Step 3: Commit the baseline doc**

```bash
git add docs/superpowers/sessions/2026-05-05-baseline-pre-monorepo.md
git commit -m "docs(baseline): capture pre-monorepo baseline before platform split

Reference snapshot for the migration described in
docs/superpowers/plans/2026-05-05-platform-split-migration.md.
Used as a regression check throughout the 6-stage migration.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push origin main
```

### Task 0.3: Capture key route response samples

**Files:** None committed (samples kept locally).

- [ ] **Step 1: Capture anonymous route responses**

```bash
mkdir -p /tmp/vyntechs-baseline
curl -sI https://vyntechs.dev/ > /tmp/vyntechs-baseline/root.headers
curl -sI https://vyntechs.dev/sign-in > /tmp/vyntechs-baseline/sign-in.headers
curl -sI https://vyntechs.dev/today > /tmp/vyntechs-baseline/today.headers
curl -sI https://vyntechs.dev/api/health > /tmp/vyntechs-baseline/api-health.headers
curl -sS https://vyntechs.dev/api/health > /tmp/vyntechs-baseline/api-health.body
curl -sI https://vyntechs.dev/favicon.ico > /tmp/vyntechs-baseline/favicon.headers
curl -sI https://vyntechs.dev/icon.svg > /tmp/vyntechs-baseline/icon-svg.headers
```

Expected: each `*.headers` file contains an HTTP response status line and headers. `api-health.body` contains JSON with `nodeEnv`, `databaseUrlHost`, `pingOk`, etc. Used after each stage to confirm zero regression.

### Task 0.4: Snapshot Vercel env vars (production + preview)

**Files:** None committed (snapshots kept on local disk only — env values are secrets).

- [ ] **Step 1: Pull both env scopes**

```bash
mkdir -p /tmp/vyntechs-baseline/env
cd /Volumes/Creativity/dev/projects/vyntechs/.claude/worktrees/rc-plan-tree
vercel env pull /tmp/vyntechs-baseline/env/production.env --environment=production --yes
vercel env pull /tmp/vyntechs-baseline/env/preview.env --environment=preview --yes
```

Expected: two `.env` files saved. Used as reference if any env var goes missing during the Vercel project reconfiguration in Stage 5.

- [ ] **Step 2: Note env counts (no values)**

```bash
echo "Production env count: $(grep -c '^[A-Z]' /tmp/vyntechs-baseline/env/production.env)"
echo "Preview env count: $(grep -c '^[A-Z]' /tmp/vyntechs-baseline/env/preview.env)"
```

Expected: matches `vercel env ls` count from earlier session — about 14-16 entries each.

### Task 0.5: Tag the rollback line

**Files:** None changed.

- [ ] **Step 1: Tag main as rollback line**

```bash
cd /Volumes/Creativity/dev/projects/vyntechs
git tag -a pre-monorepo-baseline -m "Pre-platform-split baseline. Rollback line for the monorepo migration."
git push origin pre-monorepo-baseline
```

Expected: `* [new tag] pre-monorepo-baseline -> pre-monorepo-baseline` in the push output.

- [ ] **Step 2: Verify tag is reachable**

```bash
git rev-parse pre-monorepo-baseline
git log --oneline pre-monorepo-baseline -1
```

Expected: shows current main HEAD's commit SHA.

---

**Stage 0 verification gate:**
- [ ] Baseline doc committed and pushed.
- [ ] Sample route responses captured at `/tmp/vyntechs-baseline/*.headers`.
- [ ] Env files pulled at `/tmp/vyntechs-baseline/env/*.env`.
- [ ] Tag `pre-monorepo-baseline` exists locally and on origin.
- [ ] `git status`: clean.

**Rollback for Stage 0:** there is nothing to roll back; only documentation was added.

---

# Stage 1 — Reshape repo (no logic changes)

**Goal:** Move the entire current app into `apps/diagnostic/` and add Turborepo + pnpm workspace skeleton at the root. **No source code is modified beyond import path updates required by the move.** The diagnostic app must run and test exactly the same after this stage.

**Risk:** Low (purely structural). The most likely break-points are: (a) lockfile changes during `pnpm install`, (b) `next.config.js` referencing paths that no longer exist, (c) testing tools resolving paths from a new working directory.

**Owner:** Run from a worktree off `pre-monorepo-baseline`.

### Task 1.1: Create the migration worktree

**Files:** Worktree directory created.

- [ ] **Step 1: Create worktree off the baseline tag**

```bash
cd /Volumes/Creativity/dev/projects/vyntechs
git worktree add .claude/worktrees/monorepo-stage-1 -b stage-1-reshape pre-monorepo-baseline
cd .claude/worktrees/monorepo-stage-1
```

Expected: new worktree at `.claude/worktrees/monorepo-stage-1`, on a new branch `stage-1-reshape` pointing at `pre-monorepo-baseline`.

- [ ] **Step 2: Confirm clean working tree in worktree**

```bash
git status
```

Expected: `nothing to commit, working tree clean`.

### Task 1.2: Add Turborepo + pnpm workspace skeleton at root (before moving anything)

**Files:**
- Create: `pnpm-workspace.yaml`
- Create: `turbo.json`
- Create: `tsconfig.base.json`
- Create: `.gitignore.monorepo` (additions to be merged)

- [ ] **Step 1: Add Turborepo as a dev dependency at root**

```bash
pnpm add -D -w turbo
```

Expected: `turbo` added to root `package.json` as devDependency. Lockfile updates.

If `pnpm` complains about `-w` flag because the workspace doesn't exist yet, do this manually: edit root `package.json`'s `devDependencies` to add `"turbo": "^2.5.0"` and run `pnpm install` after Step 2.

- [ ] **Step 2: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [ ] **Step 3: Create `turbo.json`**

```json
{
  "$schema": "https://turborepo.com/schema.json",
  "globalDependencies": ["**/.env.*local", "tsconfig.base.json"],
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": [".next/**", "!.next/cache/**", "dist/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "test": {
      "dependsOn": ["^build"],
      "outputs": []
    },
    "typecheck": {
      "dependsOn": ["^build"],
      "outputs": []
    },
    "lint": {
      "outputs": []
    }
  }
}
```

- [ ] **Step 4: Create `tsconfig.base.json`**

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "display": "Base",
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "allowSyntheticDefaultImports": true,
    "forceConsistentCasingInFileNames": true,
    "incremental": true,
    "verbatimModuleSyntax": false
  },
  "exclude": ["node_modules"]
}
```

- [ ] **Step 5: Convert root `package.json` to workspace root**

Read the current `package.json`. Replace its contents with:

```json
{
  "name": "vyntechs",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev",
    "test": "turbo run test",
    "typecheck": "turbo run typecheck",
    "lint": "turbo run lint",
    "diagnostic": "pnpm --filter diagnostic"
  },
  "devDependencies": {
    "turbo": "^2.5.0",
    "typescript": "^6.0.3"
  },
  "packageManager": "pnpm@9.15.0",
  "engines": {
    "node": ">=22"
  }
}
```

The original dependencies, devDependencies, and scripts will be preserved on `apps/diagnostic/package.json` after Task 1.3.

- [ ] **Step 6: Commit the skeleton**

```bash
git add pnpm-workspace.yaml turbo.json tsconfig.base.json package.json pnpm-lock.yaml
git commit -m "chore(monorepo): add Turborepo + pnpm workspace skeleton at root

Stage 1.2 of the platform split migration. Adds workspace config
files at the root before moving any source code. The current app
code remains at the root and continues to work; the workspace
just doesn't have any packages registered yet.

Refs docs/superpowers/plans/2026-05-05-platform-split-migration.md"
```

### Task 1.3: Move the current app into `apps/diagnostic/`

**Files:**
- Move: nearly everything at root → `apps/diagnostic/`

- [ ] **Step 1: Create the apps directory and the diagnostic subfolder**

```bash
mkdir -p apps/diagnostic
```

- [ ] **Step 2: Move source directories**

```bash
git mv app apps/diagnostic/app
git mv components apps/diagnostic/components
git mv lib apps/diagnostic/lib
git mv public apps/diagnostic/public
git mv tests apps/diagnostic/tests
git mv supabase apps/diagnostic/supabase
git mv drizzle apps/diagnostic/drizzle
```

- [ ] **Step 3: Move config files**

```bash
git mv next.config.js apps/diagnostic/next.config.js
git mv tsconfig.json apps/diagnostic/tsconfig.json
git mv tailwind.config.ts apps/diagnostic/tailwind.config.ts 2>/dev/null || echo "tailwind.config.ts not present, skipping"
git mv vitest.config.ts apps/diagnostic/vitest.config.ts
git mv vercel.json apps/diagnostic/vercel.json
git mv playwright.config.ts apps/diagnostic/playwright.config.ts
git mv drizzle.config.ts apps/diagnostic/drizzle.config.ts
git mv middleware.ts apps/diagnostic/middleware.ts 2>/dev/null || echo "middleware.ts at root, may need to move from app/ instead"
```

- [ ] **Step 4: Verify what's left at root**

```bash
ls -la | grep -vE "(node_modules|\.git|\.next|\.claude|\.worktrees|\.surgeon)"
```

Expected: only `apps/`, `docs/`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `AGENTS.md`, `README.md`, `.env.example`, `.gitignore`, `skills-lock.json`, and dot-files. The original app source is now under `apps/diagnostic/`.

### Task 1.4: Create `apps/diagnostic/package.json` from the original

**Files:**
- Create: `apps/diagnostic/package.json`

- [ ] **Step 1: Get the original package.json from the baseline tag**

```bash
git show pre-monorepo-baseline:package.json > /tmp/original-package.json
cat /tmp/original-package.json
```

- [ ] **Step 2: Write the apps/diagnostic/package.json**

Create `apps/diagnostic/package.json`. Take the original's `dependencies`, `devDependencies`, and the original `scripts` (dev, build, start, test, etc.), and update the `name` field to `"diagnostic"`. Example structure (replace dependency versions with EXACT values from the original):

```json
{
  "name": "diagnostic",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "typecheck": "tsc --noEmit",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate"
  },
  "dependencies": {
    "<copy from original>": "<copy from original>"
  },
  "devDependencies": {
    "<copy from original>": "<copy from original>"
  }
}
```

Important: the `typecheck` script is added (used by Turborepo's `turbo run typecheck`).

- [ ] **Step 3: Update apps/diagnostic/tsconfig.json to extend the base**

Read `apps/diagnostic/tsconfig.json`. Replace its contents with:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "preserve",
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules", ".next", "dist"]
}
```

(If the original tsconfig had additional `paths` entries or compiler options not in the base, preserve them in this app-level config.)

### Task 1.5: Reinstall dependencies under workspace and verify

**Files:** `pnpm-lock.yaml` regenerates.

- [ ] **Step 1: Clean install at root**

```bash
cd /Volumes/Creativity/dev/projects/vyntechs/.claude/worktrees/monorepo-stage-1
rm -rf node_modules apps/diagnostic/node_modules
pnpm install
```

Expected: pnpm installs successfully. Workspaces detected. No errors. `node_modules/` exists at root and is symlinked appropriately into `apps/diagnostic/node_modules/`.

If it fails: most common cause is `engines` mismatch or peerDep conflict. Read the error, resolve, and retry.

- [ ] **Step 2: Run tests**

```bash
pnpm --filter diagnostic test 2>&1 | tail -10
```

Expected: same passing count as the baseline (e.g., `Tests  378 passed`). If anything fails, the cause is import path resolution — check that `apps/diagnostic/tsconfig.json` paths are correct.

- [ ] **Step 3: Run typecheck**

```bash
pnpm --filter diagnostic typecheck 2>&1 | tail -5
```

Expected: clean (no output).

- [ ] **Step 4: Run build**

```bash
pnpm --filter diagnostic build 2>&1 | tail -20
```

Expected: `✓ Compiled successfully` plus the route table. Same routes as baseline.

- [ ] **Step 5: Smoke-test dev server**

```bash
pnpm --filter diagnostic dev &
DEV_PID=$!
sleep 8
curl -sI http://localhost:3000/sign-in | head -3
kill $DEV_PID
```

Expected: `HTTP/1.1 200 OK` (or `307` if there's a base-path redirect — match what baseline returned).

- [ ] **Step 6: Commit Stage 1**

```bash
git add -A
git commit -m "chore(monorepo): move diagnostic app to apps/diagnostic/, no logic changes

Stage 1.3-1.5 of the platform split migration. The entire current app
moves verbatim into apps/diagnostic/ as a workspace package. Source
code is unchanged. Tests pass at the same count as pre-migration
baseline (<N>/<N>). Build clean. Typecheck clean.

Refs docs/superpowers/plans/2026-05-05-platform-split-migration.md"
```

### Task 1.6: Push and deploy to staging-rc for verification

**Files:** None new.

- [ ] **Step 1: Push the stage-1 branch**

```bash
git push -u origin stage-1-reshape
```

- [ ] **Step 2: Reconfigure Vercel project root directory for the stage-1 branch**

This requires temporarily pointing the existing `vyntechs-dev` Vercel project at `apps/diagnostic` for the preview deployment of this branch only. **Do NOT change production root directory yet** — production stays on main with root `./` until Stage 6.

```bash
# The simplest way is via the Vercel dashboard:
# Settings → Git → Root Directory → set to "apps/diagnostic" only for branch "stage-1-reshape"
# OR via vercel.json overrides (Vercel allows per-deployment root via build settings)
```

Alternative if dashboard reconfiguration is too risky: deploy this branch to a one-off Vercel project (`vyntechs-monorepo-test`) instead of the production project. Document which approach was used in the stage-1 commit message.

- [ ] **Step 3: Wait for build and capture deploy URL**

```bash
sleep 60
vercel ls 2>&1 | head -5
```

Expected: a new Preview build for the `stage-1-reshape` branch, Ready in ~40-50s.

- [ ] **Step 4: Alias the new build to staging-rc**

```bash
vercel alias set <new-deploy-url> staging-rc.vercel.app
```

- [ ] **Step 5: Run the regression check against staging-rc**

```bash
curl -sI https://staging-rc.vercel.app/sign-in | head -3
diff <(curl -sI https://staging-rc.vercel.app/sign-in | head -3) /tmp/vyntechs-baseline/sign-in.headers
```

Expected: identical (or only differs in cache headers / vercel-id). Status code, content-type must match.

Repeat for `/today`, `/api/health`, `/favicon.ico`, `/icon.svg` — all must match baseline.

- [ ] **Step 6: Authed smoke test (Brandon eyeballs)**

Brandon signs into `staging-rc.vercel.app` and confirms:
- `/today` shows the same content as baseline (In Progress card, etc.)
- `/sessions/new` form renders and works (file an empty session, abort)
- `/sessions/<existing-session-id>` opens an active diagnostic session

If anything visibly differs from baseline, **stop and roll back to `pre-monorepo-baseline`.**

---

**Stage 1 verification gate:**
- [ ] `pnpm --filter diagnostic test` passes at baseline count.
- [ ] `pnpm --filter diagnostic typecheck` clean.
- [ ] `pnpm --filter diagnostic build` clean.
- [ ] Anonymous route headers on staging-rc match baseline samples.
- [ ] Authed smoke test on staging-rc confirms diagnostic app behaves identically.
- [ ] No PR merged to main yet — main still on `pre-monorepo-baseline`.

**STOP POINT.** This is the recommended end-of-session-1 checkpoint. Sleep on it before starting Stage 2.

**Rollback for Stage 1:**
```bash
git checkout main
git worktree remove .claude/worktrees/monorepo-stage-1 --force
git branch -D stage-1-reshape
git push origin :stage-1-reshape
# Re-alias staging-rc back to pre-migration deployment
vercel alias set <baseline-deploy-url> staging-rc.vercel.app
```

---

# Stage 2 — Extract shared packages

**Goal:** Pull six shared concerns out of `apps/diagnostic` into named packages. Done one package at a time, smallest dependency first. Each sub-stage is independently revertable.

**Risk:** Low-Medium per package. The riskiest is `packages/db` (Stage 2c) because everything depends on it.

**Owner:** Continue from `stage-1-reshape` worktree, branching new feature branches per sub-stage.

### Stage 2a — `packages/config`

**Files:**
- Create: `packages/config/package.json`
- Create: `packages/config/tsconfig.json`
- Create: `packages/config/eslint.preset.js`
- Create: `packages/config/tailwind.preset.ts`
- Create: `packages/config/prettier.config.js`
- Modify: `apps/diagnostic/tsconfig.json` (extend `@repo/config/tsconfig.json` instead of base)
- Modify: `apps/diagnostic/tailwind.config.ts` (consume preset)

- [ ] **Step 1: Create new branch off stage-1-reshape**

```bash
git checkout -b stage-2a-packages-config
```

- [ ] **Step 2: Create `packages/config/package.json`**

```json
{
  "name": "@repo/config",
  "version": "0.0.0",
  "private": true,
  "main": "./index.js",
  "exports": {
    "./tsconfig.json": "./tsconfig.json",
    "./eslint": "./eslint.preset.js",
    "./tailwind": "./tailwind.preset.ts",
    "./prettier": "./prettier.config.js"
  }
}
```

- [ ] **Step 3: Create `packages/config/tsconfig.json` (the app-level config)**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "preserve",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "noEmit": true
  }
}
```

- [ ] **Step 4: Create `packages/config/tailwind.preset.ts`**

Move the current `apps/diagnostic/tailwind.config.ts` content here, exporting it as a preset:

```ts
import type { Config } from 'tailwindcss'

const preset = {
  // ... copy current tailwind config content (theme, plugins, presets, etc.)
} satisfies Omit<Config, 'content'>

export default preset
```

Note: `content` is intentionally NOT in the preset because each app must declare its own content paths.

- [ ] **Step 5: Create `packages/config/eslint.preset.js`**

If `eslint.config.js` exists at root or in apps/diagnostic, copy its content here. If no eslint config existed (the original `package.json` had `--no-eslint` in the create-next-app command), create a minimal one:

```js
export default [
  // shared eslint rules
  {
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['../../apps/*'],
            message: 'Apps may not import from other apps. Move shared code to packages/.'
          }
        ]
      }]
    }
  }
]
```

This is where the cross-app-import lint rule lives (Decision 7 from the spec).

- [ ] **Step 6: Create `packages/config/prettier.config.js`**

```js
export default {
  semi: false,
  singleQuote: true,
  trailingComma: 'all',
  printWidth: 100,
}
```

(Match existing project conventions; consult `package.json` or any existing `.prettierrc*` files.)

- [ ] **Step 7: Update `apps/diagnostic/tsconfig.json` to consume the preset**

Replace contents with:

```json
{
  "extends": "@repo/config/tsconfig.json",
  "compilerOptions": {
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules", ".next", "dist"]
}
```

- [ ] **Step 8: Update `apps/diagnostic/tailwind.config.ts` to consume the preset**

Replace contents with:

```ts
import type { Config } from 'tailwindcss'
import preset from '@repo/config/tailwind'

export default {
  presets: [preset],
  content: [
    './app/**/*.{ts,tsx,mdx}',
    './components/**/*.{ts,tsx,mdx}',
    './lib/**/*.{ts,tsx}',
    // Shared UI package gets added in Stage 2f
  ],
} satisfies Config
```

- [ ] **Step 9: Add `@repo/config` to apps/diagnostic dependencies**

Edit `apps/diagnostic/package.json` to add under `devDependencies`:

```json
"@repo/config": "workspace:*"
```

- [ ] **Step 10: Reinstall and run all checks**

```bash
cd /Volumes/Creativity/dev/projects/vyntechs/.claude/worktrees/monorepo-stage-1
pnpm install
pnpm --filter diagnostic typecheck
pnpm --filter diagnostic test
pnpm --filter diagnostic build
```

Expected: all clean, all tests still passing at baseline count.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat(monorepo): extract packages/config (tsconfig + tailwind + eslint + prettier presets)

Stage 2a of the platform split migration. Shared compiler/lint/format
config presets live in @repo/config and are consumed by apps/diagnostic.
Includes the no-cross-app-import lint rule (spec Decision 7).
Tests still <N>/<N>; typecheck + build clean.

Refs docs/superpowers/plans/2026-05-05-platform-split-migration.md"
```

- [ ] **Step 12: Push, deploy, regression-check on staging-rc**

```bash
git push -u origin stage-2a-packages-config
# Wait for Vercel build (preview environment)
sleep 60
vercel ls | head -3
# Re-alias staging-rc to the new build, then run header diff against /tmp/vyntechs-baseline/
```

Expected: identical headers to baseline.

### Stage 2b — `packages/types`

**Files:**
- Create: `packages/types/package.json`
- Create: `packages/types/src/index.ts` (re-exports)
- Create: `packages/types/src/shop.ts` (Shop, ShopId types)
- Create: `packages/types/src/profile.ts` (Profile, ProfileId types)
- Create: `packages/types/src/customer.ts`
- Create: `packages/types/src/vehicle.ts`
- Create: `packages/types/src/entitlement.ts` (FeatureKey, EntitlementStatus)
- Modify: `apps/diagnostic` files that import these types from `lib/db/schema`

- [ ] **Step 1: Branch off stage-2a**

```bash
git checkout stage-2a-packages-config
git pull origin stage-2a-packages-config
git checkout -b stage-2b-packages-types
```

- [ ] **Step 2: Create the package**

```bash
mkdir -p packages/types/src
```

`packages/types/package.json`:

```json
{
  "name": "@repo/types",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "devDependencies": {
    "@repo/config": "workspace:*",
    "typescript": "^6.0.3"
  }
}
```

`packages/types/tsconfig.json`:

```json
{
  "extends": "@repo/config/tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create the type files**

`packages/types/src/shop.ts`:

```ts
export type ShopId = string  // uuid

export type Shop = {
  id: ShopId
  name: string
  ownerProfileId: string
  createdAt: Date
}
```

(For each, copy the existing inferred type definitions from `apps/diagnostic/lib/db/schema.ts` — match what Drizzle infers exactly. Use `InferSelectModel` from drizzle-orm if needed.)

`packages/types/src/profile.ts`:

```ts
export type ProfileId = string  // uuid
export type ProfileRole = 'tech' | 'owner' | 'curator'

export type Profile = {
  id: ProfileId
  userId: string
  shopId: string | null
  fullName: string | null
  role: ProfileRole
  createdAt: Date
}
```

`packages/types/src/customer.ts`:

```ts
export type CustomerId = string

export type Customer = {
  id: CustomerId
  shopId: string
  name: string
  phone: string | null
  email: string | null
  createdAt: Date
}
```

`packages/types/src/vehicle.ts`:

```ts
export type VehicleId = string

export type Vehicle = {
  id: VehicleId
  customerId: string
  vin: string | null
  year: number
  make: string
  model: string
  engine: string | null
  mileage: number | null
  createdAt: Date
}
```

`packages/types/src/entitlement.ts`:

```ts
export type FeatureKey = 'diagnostic_access' | 'shop_mgmt_access'

export type EntitlementStatus = 'active' | 'past_due' | 'canceled' | 'trialing' | 'revoked'
```

`packages/types/src/index.ts`:

```ts
export * from './shop'
export * from './profile'
export * from './customer'
export * from './vehicle'
export * from './entitlement'
```

- [ ] **Step 4: Add @repo/types to apps/diagnostic deps**

Edit `apps/diagnostic/package.json`:

```json
"dependencies": {
  ...
  "@repo/types": "workspace:*"
}
```

- [ ] **Step 5: Update apps/diagnostic next.config.js for transpilePackages**

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  // ... existing config
  transpilePackages: ['@repo/config', '@repo/types'],
}
export default nextConfig
```

- [ ] **Step 6: Replace import of types in apps/diagnostic**

Search and replace `import type { Shop, Profile, ... } from '@/lib/db/schema'` → `import type { Shop, Profile, ... } from '@repo/types'` where the import is for the public type only (not Drizzle table schema). Drizzle table schemas (the `pgTable(...)` exports) stay in `apps/diagnostic/lib/db/schema.ts` until Stage 2c.

```bash
# Audit affected files
grep -rE "from '@/lib/db/schema'" apps/diagnostic/ | head -20
```

For each affected file, manually decide whether to keep importing from the schema (when accessing the Drizzle table) or switch to `@repo/types` (when accessing just the inferred type).

- [ ] **Step 7: Reinstall, test, typecheck, build**

```bash
pnpm install
pnpm --filter diagnostic typecheck
pnpm --filter diagnostic test
pnpm --filter diagnostic build
```

- [ ] **Step 8: Commit and verify on staging-rc**

```bash
git add -A
git commit -m "feat(monorepo): extract packages/types (shared domain types)

Stage 2b of the platform split migration. Shop / Profile / Customer /
Vehicle / Entitlement types live in @repo/types. Diagnostic app's
type imports updated to consume from the package. Schema (Drizzle
table definitions) stays in apps/diagnostic until Stage 2c.

Refs docs/superpowers/plans/2026-05-05-platform-split-migration.md"

git push -u origin stage-2b-packages-types
# Deploy + verify on staging-rc per Stage 1 pattern
```

### Stage 2c — `packages/db` (the riskiest extraction)

**Files:**
- Create: `packages/db/package.json`
- Create: `packages/db/src/client.ts` (Drizzle client factory)
- Create: `packages/db/src/schema/*.ts` (one file per table or domain group)
- Create: `packages/db/migrations/` (move from apps/diagnostic/drizzle/migrations)
- Create: `packages/db/drizzle.config.ts`
- Create: `packages/db/src/queries/*.ts` (move from apps/diagnostic/lib/db/queries)
- Modify: `apps/diagnostic` imports

- [ ] **Step 1: Branch off stage-2b**

```bash
git checkout stage-2b-packages-types
git pull origin stage-2b-packages-types
git checkout -b stage-2c-packages-db
```

- [ ] **Step 2: Create the package skeleton**

```bash
mkdir -p packages/db/src/schema packages/db/src/queries packages/db/migrations
```

`packages/db/package.json`:

```json
{
  "name": "@repo/db",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./schema": "./src/schema/index.ts",
    "./queries": "./src/queries/index.ts",
    "./client": "./src/client.ts"
  },
  "scripts": {
    "generate": "drizzle-kit generate",
    "migrate": "drizzle-kit migrate"
  },
  "dependencies": {
    "@repo/types": "workspace:*",
    "drizzle-orm": "<copy from original>",
    "postgres": "<copy from original>"
  },
  "devDependencies": {
    "@repo/config": "workspace:*",
    "drizzle-kit": "<copy from original>",
    "@types/pg": "<copy from original if exists>"
  }
}
```

`packages/db/tsconfig.json`:

```json
{
  "extends": "@repo/config/tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Move Drizzle schema files**

```bash
git mv apps/diagnostic/lib/db/schema.ts packages/db/src/schema/index.ts
# Or if schema is split across multiple files:
# git mv apps/diagnostic/lib/db/schema/* packages/db/src/schema/
```

Update internal references inside `packages/db/src/schema/index.ts` if any imports were relative paths (they should now resolve relative to the package).

- [ ] **Step 4: Move the Drizzle client**

```bash
git mv apps/diagnostic/lib/db/client.ts packages/db/src/client.ts
```

Update `client.ts` to read DATABASE_URL from `process.env`. The factory function:

```ts
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

export function createDb(databaseUrl: string) {
  const client = postgres(databaseUrl, { max: 1 })
  return drizzle(client, { schema })
}

// Default singleton for the diagnostic app (or any app) using process.env
let _db: ReturnType<typeof createDb> | null = null
export function getDb() {
  if (!_db) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL not set')
    _db = createDb(url)
  }
  return _db
}

export { schema }
export type AppDb = ReturnType<typeof createDb>
```

- [ ] **Step 5: Move queries**

```bash
git mv apps/diagnostic/lib/db/queries.ts packages/db/src/queries/index.ts 2>/dev/null || \
git mv apps/diagnostic/lib/db/queries packages/db/src/queries
```

Update the queries to import from `../schema` if needed.

- [ ] **Step 6: Move migrations folder**

```bash
git mv apps/diagnostic/drizzle/migrations packages/db/migrations
git mv apps/diagnostic/drizzle/meta packages/db/migrations/meta 2>/dev/null
git rm -rf apps/diagnostic/drizzle 2>/dev/null
```

- [ ] **Step 7: Move and update drizzle.config.ts**

```bash
git mv apps/diagnostic/drizzle.config.ts packages/db/drizzle.config.ts
```

Update `packages/db/drizzle.config.ts`:

```ts
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL ?? '',
  },
})
```

- [ ] **Step 8: Create `packages/db/src/index.ts`**

```ts
export * from './schema'
export * from './queries'
export * from './client'
```

- [ ] **Step 9: Hoist `drizzle-orm` to root**

Edit root `package.json`. Add `drizzle-orm` as a dependency at the root level (and remove from apps/diagnostic/package.json). This satisfies the Decision 5 constraint: drizzle-orm installed exactly once, hoisted via pnpm.

Add to root package.json:

```json
"dependencies": {
  "drizzle-orm": "<exact version>"
}
```

Remove the duplicate from `apps/diagnostic/package.json`.

- [ ] **Step 10: Update `apps/diagnostic/package.json`**

Add:

```json
"dependencies": {
  ...
  "@repo/db": "workspace:*"
}
```

- [ ] **Step 11: Update apps/diagnostic next.config.js**

```js
transpilePackages: ['@repo/config', '@repo/types', '@repo/db'],
```

- [ ] **Step 12: Search and replace imports in apps/diagnostic**

```bash
# Schema imports:
grep -rE "from '@/lib/db'|from '@/lib/db/schema'|from '@/lib/db/client'|from '@/lib/db/queries'" apps/diagnostic/ | head -30
```

Migrate imports per pattern:
- `import { db } from '@/lib/db/client'` → `import { getDb } from '@repo/db/client'` (and call `getDb()` to get the instance)
- `import { sessions } from '@/lib/db/schema'` → `import { sessions } from '@repo/db/schema'`
- `import { getActiveSessions } from '@/lib/db/queries'` → `import { getActiveSessions } from '@repo/db/queries'`

This is the riskiest manual operation in the migration. Take it slowly.

- [ ] **Step 13: Reinstall and run all checks**

```bash
pnpm install
pnpm --filter diagnostic typecheck
pnpm --filter diagnostic test 2>&1 | tail -10
pnpm --filter diagnostic build 2>&1 | tail -20
```

Expected: tests still pass at baseline count. Typecheck clean. Build clean.

If `instanceof` errors appear at runtime: drizzle-orm is installed twice. Re-check Step 9 (root hoist + apps/diagnostic removal).

- [ ] **Step 14: Commit and verify on staging-rc**

```bash
git add -A
git commit -m "feat(monorepo): extract packages/db (Drizzle schema + client + queries + migrations)

Stage 2c of the platform split migration. The most consequential
extraction: schema, client factory, queries, and migration files all
move to @repo/db. drizzle-orm is hoisted to the workspace root to
prevent dual-install instanceof failures. Diagnostic app's database
imports updated. Migrations directory moves intact (no SQL changes).

Tests still <N>/<N>; typecheck + build clean.

Refs docs/superpowers/plans/2026-05-05-platform-split-migration.md"

git push -u origin stage-2c-packages-db
# Deploy + verify on staging-rc per Stage 1 pattern
```

**STOP POINT.** This is the recommended end-of-session-2 checkpoint. The riskiest extraction is done. Sleep on it before continuing.

### Stage 2d — `packages/auth`

**Files:**
- Create: `packages/auth/package.json`
- Create: `packages/auth/src/server.ts` (Supabase server client factory)
- Create: `packages/auth/src/middleware.ts` (auth middleware utility)
- Create: `packages/auth/src/session.ts` (session shape + helpers)
- Create: `packages/auth/src/index.ts`
- Modify: `apps/diagnostic` imports

- [ ] **Step 1: Branch off stage-2c**

```bash
git checkout stage-2c-packages-db
git pull origin stage-2c-packages-db
git checkout -b stage-2d-packages-auth
```

- [ ] **Step 2: Create package skeleton**

```bash
mkdir -p packages/auth/src
```

`packages/auth/package.json`:

```json
{
  "name": "@repo/auth",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./server": "./src/server.ts",
    "./middleware": "./src/middleware.ts"
  },
  "dependencies": {
    "@repo/db": "workspace:*",
    "@repo/types": "workspace:*",
    "@supabase/ssr": "<copy from apps/diagnostic>",
    "@supabase/supabase-js": "<copy from apps/diagnostic>"
  },
  "devDependencies": {
    "@repo/config": "workspace:*",
    "next": "<copy from apps/diagnostic>"
  },
  "peerDependencies": {
    "next": "<copy from apps/diagnostic>"
  }
}
```

- [ ] **Step 3: Move Supabase server client**

```bash
git mv apps/diagnostic/lib/supabase-server.ts packages/auth/src/server.ts
git mv apps/diagnostic/lib/auth.ts packages/auth/src/session.ts 2>/dev/null
git mv apps/diagnostic/lib/auth-redirects.ts packages/auth/src/redirects.ts 2>/dev/null
```

Update internal imports in those files to use `@repo/db` for any database calls.

- [ ] **Step 4: Move auth middleware utility (if separate from middleware.ts)**

If `apps/diagnostic/middleware.ts` contains a Supabase auth refresh pattern, leave the file in place but extract the reusable parts into `packages/auth/src/middleware.ts`:

```ts
import { createServerClient } from '@supabase/ssr'
import { type NextRequest, NextResponse } from 'next/server'

export async function refreshSession(req: NextRequest) {
  let res = NextResponse.next({ request: req })
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value))
          res = NextResponse.next({ request: req })
          cookiesToSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options))
        },
      },
    },
  )
  await supabase.auth.getUser()
  return { res, supabase }
}
```

- [ ] **Step 5: Create `packages/auth/src/index.ts`**

```ts
export * from './server'
export * from './session'
export * from './middleware'
export * from './redirects'
```

- [ ] **Step 6: Update apps/diagnostic deps and imports**

```json
"@repo/auth": "workspace:*"
```

```js
transpilePackages: ['@repo/config', '@repo/types', '@repo/db', '@repo/auth'],
```

Replace imports in apps/diagnostic:
- `import { getServerSupabase } from '@/lib/supabase-server'` → `import { getServerSupabase } from '@repo/auth/server'`

- [ ] **Step 7: Run all checks**

```bash
pnpm install
pnpm --filter diagnostic typecheck
pnpm --filter diagnostic test
pnpm --filter diagnostic build
```

- [ ] **Step 8: Commit + deploy + verify**

```bash
git add -A
git commit -m "feat(monorepo): extract packages/auth (Supabase helpers + middleware utilities)

Stage 2d of the platform split migration. Supabase server-client factory,
session helpers, and auth-middleware utilities live in @repo/auth.
Diagnostic app's auth imports updated.

Refs docs/superpowers/plans/2026-05-05-platform-split-migration.md"

git push -u origin stage-2d-packages-auth
```

### Stage 2e — `packages/billing`

**Files:**
- Create: `packages/billing/package.json`
- Create: `packages/billing/src/stripe.ts` (Stripe client)
- Create: `packages/billing/src/webhooks/`  (subscription event handlers — full impl in Stage 3)
- Create: `packages/billing/src/index.ts`
- Modify: `apps/diagnostic` imports

- [ ] **Step 1: Branch off stage-2d**

```bash
git checkout stage-2d-packages-auth
git pull origin stage-2d-packages-auth
git checkout -b stage-2e-packages-billing
```

- [ ] **Step 2: Create package skeleton**

```bash
mkdir -p packages/billing/src/webhooks
```

`packages/billing/package.json`:

```json
{
  "name": "@repo/billing",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./stripe": "./src/stripe.ts",
    "./webhooks": "./src/webhooks/index.ts"
  },
  "dependencies": {
    "@repo/db": "workspace:*",
    "@repo/types": "workspace:*",
    "stripe": "<copy from apps/diagnostic>"
  },
  "devDependencies": {
    "@repo/config": "workspace:*"
  }
}
```

- [ ] **Step 3: Move Stripe-related code**

```bash
git mv apps/diagnostic/lib/stripe packages/billing/src/stripe-internals 2>/dev/null
# OR if there's a single stripe.ts file:
git mv apps/diagnostic/lib/stripe.ts packages/billing/src/stripe.ts 2>/dev/null
```

Audit what's there. The original Stripe scaffold from Phase A5 + Phase G (subscription webhook handling) should move here. Existing webhook handler:

```bash
git mv apps/diagnostic/app/api/stripe packages/billing/src/route-handlers 2>/dev/null
```

Wait — the route handlers stay in apps/diagnostic for now (route paths must live in the app's `app/` directory). What moves to packages/billing is the *logic*; the route handler in apps/diagnostic becomes a thin shim that calls into `@repo/billing`.

- [ ] **Step 4: Refactor stripe-related lib code into the package**

The webhook event-handling logic (mapping Stripe events to DB writes) moves to `packages/billing/src/webhooks/subscription.ts`. The handler signature accepts a `db` instance for testability per AGENTS.md handler-in-lib pattern:

```ts
import type { AppDb } from '@repo/db'
import type Stripe from 'stripe'

export async function handleSubscriptionEvent(db: AppDb, event: Stripe.Event) {
  // ... existing logic moved from apps/diagnostic/app/api/stripe/webhook/route.ts
}
```

- [ ] **Step 5: Update apps/diagnostic to consume the package**

`apps/diagnostic/app/api/stripe/webhook/route.ts` becomes a thin shim:

```ts
import { NextResponse } from 'next/server'
import { handleSubscriptionEvent } from '@repo/billing/webhooks'
import { getDb } from '@repo/db/client'
// ... existing webhook signature verification logic stays here

export async function POST(req: Request) {
  // ... verify signature, parse event
  await handleSubscriptionEvent(getDb(), event)
  return NextResponse.json({ received: true })
}
```

- [ ] **Step 6: Update apps/diagnostic deps and transpilePackages**

```json
"@repo/billing": "workspace:*"
```

```js
transpilePackages: ['@repo/config', '@repo/types', '@repo/db', '@repo/auth', '@repo/billing'],
```

- [ ] **Step 7: Run checks, commit, deploy, verify**

```bash
pnpm install
pnpm --filter diagnostic typecheck
pnpm --filter diagnostic test
pnpm --filter diagnostic build
git add -A
git commit -m "feat(monorepo): extract packages/billing (Stripe client + subscription webhooks)

Stage 2e of the platform split migration. Stripe client + subscription
webhook event-handling logic move to @repo/billing. Webhook route in
apps/diagnostic becomes a thin shim that calls handleSubscriptionEvent.
Logic is now testable without booting Next.js routes.

Refs docs/superpowers/plans/2026-05-05-platform-split-migration.md"

git push -u origin stage-2e-packages-billing
```

### Stage 2f — `packages/ui` (shared shadcn primitives)

**Files:**
- Create: `packages/ui/package.json`
- Create: `packages/ui/src/components/*.tsx` (shadcn primitives used by both apps)
- Create: `packages/ui/src/styles/globals.css` (shared utilities + tokens)
- Modify: `apps/diagnostic` imports

**Important:** only extract components that *both* apps will use. Diagnostic-specific components (the active-session view, the comeback panel, etc.) stay in `apps/diagnostic/components/`.

Likely candidates for `packages/ui`:
- `apps/diagnostic/components/vt/desktop/*` — these are the design-system primitives (Topbar, MainHeader, Btn, VtPill, Field, Input, Textarea) used by Counter 01 (currently part of the diagnostic app, but actually part of what becomes the shop product). Borderline — move only if `apps/shop` will use them.
- shadcn UI primitives (`apps/diagnostic/components/ui/*`) — Button, Input, Card, etc.
- Layout primitives that aren't tied to one product.

Likely to STAY in apps/diagnostic:
- `components/screens/*` — page-specific compositions
- `components/session/*` — diagnostic-specific
- `components/comeback/*` — diagnostic-specific
- `components/intake/*` — was for the (unbuilt) shop product; will move to apps/shop later

- [ ] **Step 1: Branch and create skeleton**

```bash
git checkout stage-2e-packages-billing
git pull origin stage-2e-packages-billing
git checkout -b stage-2f-packages-ui

mkdir -p packages/ui/src/components packages/ui/src/styles
```

`packages/ui/package.json`:

```json
{
  "name": "@repo/ui",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./styles/globals.css": "./src/styles/globals.css"
  },
  "dependencies": {
    "@repo/types": "workspace:*",
    "react": "<copy from apps/diagnostic>",
    "react-dom": "<copy from apps/diagnostic>",
    "lucide-react": "<copy from apps/diagnostic if used>"
  },
  "devDependencies": {
    "@repo/config": "workspace:*",
    "@types/react": "<copy from apps/diagnostic>"
  },
  "peerDependencies": {
    "react": "<copy from apps/diagnostic>",
    "react-dom": "<copy from apps/diagnostic>"
  }
}
```

- [ ] **Step 2: Identify shared components**

```bash
ls apps/diagnostic/components/ui/  # shadcn primitives
ls apps/diagnostic/components/vt/  # design system primitives
```

For each candidate, decide: shared or diagnostic-only? If unsure, leave in diagnostic — moving later is cheap; pulling back is expensive.

- [ ] **Step 3: Move shared components**

For each shared component identified, `git mv` it to `packages/ui/src/components/`. Update internal imports.

- [ ] **Step 4: Update apps/diagnostic imports**

`@/components/ui/button` → `@repo/ui/components/button`, etc.

- [ ] **Step 5: Update tailwind config to scan the shared package**

In `apps/diagnostic/tailwind.config.ts`:

```ts
content: [
  './app/**/*.{ts,tsx,mdx}',
  './components/**/*.{ts,tsx,mdx}',
  './lib/**/*.{ts,tsx}',
  '../../packages/ui/src/**/*.{ts,tsx}',
],
```

(Critical: forgetting this is documented as a top break-point — shared components render unstyled in production.)

- [ ] **Step 6: Update apps/diagnostic transpilePackages**

```js
transpilePackages: ['@repo/config', '@repo/types', '@repo/db', '@repo/auth', '@repo/billing', '@repo/ui'],
```

- [ ] **Step 7: Run checks, commit, deploy, verify**

```bash
pnpm install
pnpm --filter diagnostic typecheck
pnpm --filter diagnostic test
pnpm --filter diagnostic build
# Eyeball staging-rc to confirm shared components render styled correctly
```

```bash
git add -A
git commit -m "feat(monorepo): extract packages/ui (shared shadcn + design primitives)

Stage 2f of the platform split migration. Components used by both
apps/diagnostic and (future) apps/shop move to @repo/ui. Diagnostic-
specific compositions stay in apps/diagnostic/components/. Tailwind
content globs updated to scan the shared package.

Refs docs/superpowers/plans/2026-05-05-platform-split-migration.md"

git push -u origin stage-2f-packages-ui
```

---

**Stage 2 verification gate:**
- [ ] All 6 packages exist and are consumed by `apps/diagnostic`.
- [ ] `pnpm --filter diagnostic test`: passes at baseline count.
- [ ] `pnpm --filter diagnostic typecheck`: clean.
- [ ] `pnpm --filter diagnostic build`: clean.
- [ ] All staging-rc deployments byte-equivalent to baseline (anonymous header diff + authed eyeball).
- [ ] No PR merged to main yet — main still on `pre-monorepo-baseline`.

**Rollback for Stage 2:** revert each sub-stage's commit individually if the issue is local; or `git reset --hard pre-monorepo-baseline` if cumulative.

---

# Stage 3 — Entitlements layer

**Goal:** Add `shop_entitlements` and `profile_entitlements` tables; implement `hasEntitlement` helper with default-allow / opt-out-revoke semantics; wire it into the diagnostic app's middleware; add Stripe webhook handler that syncs `customer.subscription.*` events to `shop_entitlements`. **Pre-grant entitlements to existing test shops so prod traffic continues to work.**

**Risk:** Medium. Real new code (helper + webhook). Real middleware change. Real DB writes via webhook.

**Owner:** Continue from `stage-2f-packages-ui` worktree, branching `stage-3-entitlements`.

### Task 3.1: Add Drizzle migration for `shop_entitlements`

**Files:**
- Create: `packages/db/src/schema/entitlements.ts`
- Modify: `packages/db/src/schema/index.ts` (re-export)
- Create: `packages/db/migrations/<NNNN>_<name>_shop_entitlements.sql` (generated)

- [ ] **Step 1: Branch**

```bash
git checkout stage-2f-packages-ui
git pull origin stage-2f-packages-ui
git checkout -b stage-3-entitlements
```

- [ ] **Step 2: Define the table**

Create `packages/db/src/schema/entitlements.ts`:

```ts
import { pgTable, uuid, text, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core'
import { shops } from './shops'
import { profiles } from './profiles'

export const shopEntitlements = pgTable('shop_entitlements', {
  id: uuid('id').primaryKey().defaultRandom(),
  shopId: uuid('shop_id').notNull().references(() => shops.id, { onDelete: 'cascade' }),
  featureKey: text('feature_key').notNull(),
  status: text('status').notNull(),  // 'active' | 'past_due' | 'canceled' | 'trialing'
  stripeSubscriptionId: text('stripe_subscription_id'),
  grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  uniqueShopFeature: uniqueIndex('shop_entitlements_shop_feature_unique').on(table.shopId, table.featureKey),
  shopFeatureLookup: index('shop_entitlements_lookup').on(table.shopId, table.featureKey),
}))

export const profileEntitlements = pgTable('profile_entitlements', {
  id: uuid('id').primaryKey().defaultRandom(),
  profileId: uuid('profile_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  featureKey: text('feature_key').notNull(),
  status: text('status').notNull(),  // 'active' | 'revoked'
  grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  grantedByProfileId: uuid('granted_by_profile_id').references(() => profiles.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  uniqueProfileFeature: uniqueIndex('profile_entitlements_profile_feature_unique').on(table.profileId, table.featureKey),
  profileFeatureLookup: index('profile_entitlements_lookup').on(table.profileId, table.featureKey),
}))

export type ShopEntitlement = typeof shopEntitlements.$inferSelect
export type ProfileEntitlement = typeof profileEntitlements.$inferSelect
```

- [ ] **Step 3: Re-export from schema index**

Edit `packages/db/src/schema/index.ts`:

```ts
export * from './entitlements'
// ... other existing exports
```

- [ ] **Step 4: Generate migration SQL**

```bash
cd packages/db
pnpm exec drizzle-kit generate
```

Expected: a new file at `packages/db/migrations/<NNNN>_<adjective_noun>.sql`. Review the generated SQL for correctness — should create both tables, indexes, foreign keys.

- [ ] **Step 5: Apply the migration to the live Supabase via MCP**

Per AGENTS.md, migrations are applied via the Supabase MCP `apply_migration` tool, not Drizzle's CLI. Authenticate the Supabase MCP server first if not already authenticated.

```bash
# Use the Supabase MCP apply_migration tool with name 'add_entitlements_tables'
# and the SQL content from the generated file.
```

(In execution: actually call the MCP tool. The migration will create both tables, FKs, and indexes on the live DB.)

- [ ] **Step 6: Add RLS policies via Supabase MCP `execute_sql`**

```sql
-- shop_entitlements: members of shop_id may select; service role only writes.
ALTER TABLE shop_entitlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "shop_entitlements_select_member" ON shop_entitlements
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.user_id = auth.uid()
      AND profiles.shop_id = shop_entitlements.shop_id
    )
  );

-- No insert/update/delete policies — service role bypasses RLS by default.

-- profile_entitlements: same-shop members may select; only owners may write.
ALTER TABLE profile_entitlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profile_entitlements_select_same_shop" ON profile_entitlements
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles AS me
      JOIN profiles AS target ON target.id = profile_entitlements.profile_id
      WHERE me.user_id = auth.uid()
      AND me.shop_id = target.shop_id
    )
  );

CREATE POLICY "profile_entitlements_write_owner_only" ON profile_entitlements
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles AS me
      JOIN profiles AS target ON target.id = profile_entitlements.profile_id
      WHERE me.user_id = auth.uid()
      AND me.shop_id = target.shop_id
      AND me.role = 'owner'
    )
  );
```

Apply via Supabase MCP `execute_sql`.

- [ ] **Step 7: Verify the tables exist**

```bash
psql "$DATABASE_URL_DIRECT" -c "\d shop_entitlements" 
psql "$DATABASE_URL_DIRECT" -c "\d profile_entitlements"
```

Expected: both tables exist with the columns and FKs from Step 2.

### Task 3.2: Implement `hasEntitlement` helper with TDD

**Files:**
- Create: `packages/auth/src/entitlements.ts`
- Create: `packages/auth/src/entitlements.test.ts`
- Modify: `packages/auth/src/index.ts` (re-export)

- [ ] **Step 1: Write the failing tests**

Create `packages/auth/src/entitlements.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { hasEntitlement } from './entitlements'
import { createDb } from '@repo/db/client'
import { shopEntitlements, profileEntitlements, shops, profiles } from '@repo/db/schema'
import { setupPgliteForTests } from '../test-utils/pglite'  // assumes pglite test harness exists per AGENTS.md

describe('hasEntitlement', () => {
  let db: ReturnType<typeof createDb>
  const SHOP_A = '00000000-0000-0000-0000-000000000001'
  const PROFILE_A = '00000000-0000-0000-0000-000000000010'

  beforeEach(async () => {
    db = await setupPgliteForTests()
    await db.insert(shops).values({ id: SHOP_A, name: 'Test Shop', ownerProfileId: PROFILE_A })
    await db.insert(profiles).values({ id: PROFILE_A, userId: 'auth-user-1', shopId: SHOP_A, role: 'tech' })
  })

  it('returns false when shop has no entitlement', async () => {
    const result = await hasEntitlement(db, SHOP_A, PROFILE_A, 'diagnostic_access')
    expect(result).toBe(false)
  })

  it('returns false when shop entitlement is canceled', async () => {
    await db.insert(shopEntitlements).values({
      shopId: SHOP_A, featureKey: 'diagnostic_access', status: 'canceled',
    })
    const result = await hasEntitlement(db, SHOP_A, PROFILE_A, 'diagnostic_access')
    expect(result).toBe(false)
  })

  it('returns true when shop has active entitlement and no profile override', async () => {
    await db.insert(shopEntitlements).values({
      shopId: SHOP_A, featureKey: 'diagnostic_access', status: 'active',
    })
    const result = await hasEntitlement(db, SHOP_A, PROFILE_A, 'diagnostic_access')
    expect(result).toBe(true)
  })

  it('returns true when shop has trialing entitlement and no profile override', async () => {
    await db.insert(shopEntitlements).values({
      shopId: SHOP_A, featureKey: 'diagnostic_access', status: 'trialing',
    })
    const result = await hasEntitlement(db, SHOP_A, PROFILE_A, 'diagnostic_access')
    expect(result).toBe(true)
  })

  it('returns false when profile has explicit revoked override despite active shop', async () => {
    await db.insert(shopEntitlements).values({
      shopId: SHOP_A, featureKey: 'diagnostic_access', status: 'active',
    })
    await db.insert(profileEntitlements).values({
      profileId: PROFILE_A, featureKey: 'diagnostic_access', status: 'revoked',
    })
    const result = await hasEntitlement(db, SHOP_A, PROFILE_A, 'diagnostic_access')
    expect(result).toBe(false)
  })

  it('returns true when profile has explicit active override and active shop', async () => {
    await db.insert(shopEntitlements).values({
      shopId: SHOP_A, featureKey: 'diagnostic_access', status: 'active',
    })
    await db.insert(profileEntitlements).values({
      profileId: PROFILE_A, featureKey: 'diagnostic_access', status: 'active',
    })
    const result = await hasEntitlement(db, SHOP_A, PROFILE_A, 'diagnostic_access')
    expect(result).toBe(true)
  })

  it('returns false for shop_mgmt_access when only diagnostic_access is granted', async () => {
    await db.insert(shopEntitlements).values({
      shopId: SHOP_A, featureKey: 'diagnostic_access', status: 'active',
    })
    const result = await hasEntitlement(db, SHOP_A, PROFILE_A, 'shop_mgmt_access')
    expect(result).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
pnpm --filter @repo/auth test entitlements 2>&1 | tail -20
```

Expected: FAIL with "hasEntitlement is not exported" or similar.

- [ ] **Step 3: Implement the helper**

Create `packages/auth/src/entitlements.ts`:

```ts
import { eq, and } from 'drizzle-orm'
import type { AppDb } from '@repo/db/client'
import { shopEntitlements, profileEntitlements } from '@repo/db/schema'
import type { FeatureKey } from '@repo/types'

const SHOP_ACTIVE_STATUSES = ['active', 'trialing'] as const

/**
 * Default-allow with per-profile opt-out semantics.
 *
 * Rules (spec Decision 6):
 *   - If the shop does not have an active or trialing entitlement → deny.
 *   - If the profile has an explicit 'revoked' row → deny.
 *   - Otherwise → allow.
 *
 * Profile rows opt OUT of access; they do not opt IN. New techs in a shop
 * automatically receive whatever access the shop pays for.
 */
export async function hasEntitlement(
  db: AppDb,
  shopId: string,
  profileId: string,
  featureKey: FeatureKey,
): Promise<boolean> {
  const [shopEnt] = await db
    .select({ status: shopEntitlements.status })
    .from(shopEntitlements)
    .where(and(
      eq(shopEntitlements.shopId, shopId),
      eq(shopEntitlements.featureKey, featureKey),
    ))
    .limit(1)

  const shopHasFloor = shopEnt && SHOP_ACTIVE_STATUSES.includes(shopEnt.status as typeof SHOP_ACTIVE_STATUSES[number])
  if (!shopHasFloor) return false

  const [profileEnt] = await db
    .select({ status: profileEntitlements.status })
    .from(profileEntitlements)
    .where(and(
      eq(profileEntitlements.profileId, profileId),
      eq(profileEntitlements.featureKey, featureKey),
    ))
    .limit(1)

  if (profileEnt && profileEnt.status === 'revoked') return false

  return true
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

```bash
pnpm --filter @repo/auth test entitlements 2>&1 | tail -20
```

Expected: all 7 tests pass.

- [ ] **Step 5: Re-export**

Edit `packages/auth/src/index.ts`:

```ts
export * from './entitlements'
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(auth): hasEntitlement helper with default-allow/opt-out-revoke semantics

Stage 3.2 of the platform split migration. Implements the per-shop +
per-profile entitlement check from spec Decision 6. Shop entitlement
provides the floor (active or trialing required); profile rows can
explicitly opt OUT via status='revoked'. New techs auto-inherit shop
access (default-allow).

Test coverage: 7 cases covering all combinations of shop status (none /
canceled / active / trialing) × profile override (none / active / revoked).

Refs docs/superpowers/plans/2026-05-05-platform-split-migration.md"
```

### Task 3.3: Stripe webhook syncs subscription events → shop_entitlements

**Files:**
- Create or modify: `packages/billing/src/webhooks/subscription.ts`
- Create: `packages/billing/src/webhooks/subscription.test.ts`
- Modify: `apps/diagnostic/app/api/stripe/webhook/route.ts` (already a thin shim from Stage 2e)

- [ ] **Step 1: Define Stripe Features in the Stripe dashboard**

In the Stripe dashboard:
- Go to Products → Features.
- Create feature: lookup_key = `diagnostic_access`, name = "Diagnostic AI Access".
- Create feature: lookup_key = `shop_mgmt_access`, name = "Shop Management Access".
- Attach features to your existing Stripe Products (Basic, Pro, etc.).

(This is a Stripe-side configuration step; no code in this task.)

- [ ] **Step 2: Write the failing test for the webhook handler**

Create `packages/billing/src/webhooks/subscription.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { handleSubscriptionEvent } from './subscription'
import { createDb } from '@repo/db/client'
import { shopEntitlements, customers } from '@repo/db/schema'
import { eq } from 'drizzle-orm'
import { setupPgliteForTests } from '../test-utils/pglite'

const SHOP_A = '00000000-0000-0000-0000-000000000001'
const STRIPE_CUSTOMER_ID = 'cus_test_a'
const STRIPE_SUB_ID = 'sub_test_a'

describe('handleSubscriptionEvent', () => {
  let db: ReturnType<typeof createDb>

  beforeEach(async () => {
    db = await setupPgliteForTests()
    // Seed a customer mapping (Stripe customer ↔ shop)
    await db.insert(customers).values({
      stripeCustomerId: STRIPE_CUSTOMER_ID,
      shopId: SHOP_A,
    })
  })

  it('upserts active diagnostic_access on customer.subscription.created', async () => {
    const event = {
      type: 'customer.subscription.created',
      data: { object: {
        id: STRIPE_SUB_ID,
        customer: STRIPE_CUSTOMER_ID,
        status: 'active',
        items: { data: [{ price: { lookup_key: 'diagnostic_access' } }] },
      }},
    } as any
    await handleSubscriptionEvent(db, event)
    const [ent] = await db.select().from(shopEntitlements).where(eq(shopEntitlements.shopId, SHOP_A))
    expect(ent.featureKey).toBe('diagnostic_access')
    expect(ent.status).toBe('active')
    expect(ent.stripeSubscriptionId).toBe(STRIPE_SUB_ID)
  })

  it('updates status to canceled on customer.subscription.deleted', async () => {
    await db.insert(shopEntitlements).values({
      shopId: SHOP_A, featureKey: 'diagnostic_access', status: 'active', stripeSubscriptionId: STRIPE_SUB_ID,
    })
    const event = {
      type: 'customer.subscription.deleted',
      data: { object: {
        id: STRIPE_SUB_ID,
        customer: STRIPE_CUSTOMER_ID,
        status: 'canceled',
        items: { data: [{ price: { lookup_key: 'diagnostic_access' } }] },
      }},
    } as any
    await handleSubscriptionEvent(db, event)
    const [ent] = await db.select().from(shopEntitlements).where(eq(shopEntitlements.shopId, SHOP_A))
    expect(ent.status).toBe('canceled')
  })

  it('handles past_due status on customer.subscription.updated', async () => {
    await db.insert(shopEntitlements).values({
      shopId: SHOP_A, featureKey: 'diagnostic_access', status: 'active', stripeSubscriptionId: STRIPE_SUB_ID,
    })
    const event = {
      type: 'customer.subscription.updated',
      data: { object: {
        id: STRIPE_SUB_ID,
        customer: STRIPE_CUSTOMER_ID,
        status: 'past_due',
        items: { data: [{ price: { lookup_key: 'diagnostic_access' } }] },
      }},
    } as any
    await handleSubscriptionEvent(db, event)
    const [ent] = await db.select().from(shopEntitlements).where(eq(shopEntitlements.shopId, SHOP_A))
    expect(ent.status).toBe('past_due')
  })

  it('handles subscriptions with multiple items (e.g., diagnostic + shop_mgmt bundle)', async () => {
    const event = {
      type: 'customer.subscription.created',
      data: { object: {
        id: STRIPE_SUB_ID,
        customer: STRIPE_CUSTOMER_ID,
        status: 'active',
        items: { data: [
          { price: { lookup_key: 'diagnostic_access' } },
          { price: { lookup_key: 'shop_mgmt_access' } },
        ] },
      }},
    } as any
    await handleSubscriptionEvent(db, event)
    const ents = await db.select().from(shopEntitlements).where(eq(shopEntitlements.shopId, SHOP_A))
    expect(ents).toHaveLength(2)
    expect(ents.map(e => e.featureKey).sort()).toEqual(['diagnostic_access', 'shop_mgmt_access'])
  })
})
```

- [ ] **Step 3: Run tests, confirm they fail**

```bash
pnpm --filter @repo/billing test subscription 2>&1 | tail -10
```

- [ ] **Step 4: Implement the handler**

Create or update `packages/billing/src/webhooks/subscription.ts`:

```ts
import type Stripe from 'stripe'
import { eq, and } from 'drizzle-orm'
import type { AppDb } from '@repo/db/client'
import { shopEntitlements, customers } from '@repo/db/schema'
import type { FeatureKey } from '@repo/types'

const KNOWN_FEATURE_KEYS: ReadonlySet<string> = new Set([
  'diagnostic_access',
  'shop_mgmt_access',
])

/**
 * Sync a Stripe customer.subscription.* event into shop_entitlements.
 *
 * Each subscription item maps to one feature key (via the price's lookup_key).
 * Status flows directly from the Stripe subscription's status.
 *
 * On 'customer.subscription.deleted', sets status='canceled' rather than deleting
 * the row, so we keep the audit trail of historical access.
 */
export async function handleSubscriptionEvent(
  db: AppDb,
  event: Stripe.Event,
): Promise<void> {
  if (!event.type.startsWith('customer.subscription.')) return

  const subscription = event.data.object as Stripe.Subscription
  const stripeCustomerId = typeof subscription.customer === 'string'
    ? subscription.customer
    : subscription.customer.id

  // Map Stripe customer ID → shop_id
  const [customer] = await db
    .select({ shopId: customers.shopId })
    .from(customers)
    .where(eq(customers.stripeCustomerId, stripeCustomerId))
    .limit(1)
  if (!customer) {
    console.warn(`Stripe webhook: no shop mapped to customer ${stripeCustomerId}`)
    return
  }
  const shopId = customer.shopId

  for (const item of subscription.items.data) {
    const lookupKey = item.price.lookup_key
    if (!lookupKey || !KNOWN_FEATURE_KEYS.has(lookupKey)) continue

    const featureKey = lookupKey as FeatureKey

    // Upsert
    const existing = await db
      .select({ id: shopEntitlements.id })
      .from(shopEntitlements)
      .where(and(
        eq(shopEntitlements.shopId, shopId),
        eq(shopEntitlements.featureKey, featureKey),
      ))
      .limit(1)

    if (existing.length > 0) {
      await db
        .update(shopEntitlements)
        .set({
          status: subscription.status,
          stripeSubscriptionId: subscription.id,
          updatedAt: new Date(),
        })
        .where(eq(shopEntitlements.id, existing[0].id))
    } else {
      await db
        .insert(shopEntitlements)
        .values({
          shopId,
          featureKey,
          status: subscription.status,
          stripeSubscriptionId: subscription.id,
        })
    }
  }
}
```

- [ ] **Step 5: Run tests, confirm pass**

```bash
pnpm --filter @repo/billing test subscription 2>&1 | tail -10
```

Expected: 4 tests passing.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(billing): Stripe webhook syncs subscription events to shop_entitlements

Stage 3.3 of the platform split migration. Maps customer.subscription.*
events to upserts on shop_entitlements, keyed by Stripe price lookup_key.
Bundle subscriptions (multiple items) produce one entitlement row per
feature. Canceled subscriptions update status to 'canceled' rather
than delete (audit trail).

Refs docs/superpowers/plans/2026-05-05-platform-split-migration.md"
```

### Task 3.4: Extract a testable guardRoute helper, then wire it into the diagnostic middleware

**Files:**
- Create: `packages/auth/src/route-guard.ts`
- Create: `packages/auth/src/route-guard.test.ts`
- Modify: `packages/auth/src/index.ts` (re-export)
- Modify: `apps/diagnostic/middleware.ts`
- Create: `apps/diagnostic/app/(app)/upgrade/page.tsx`

This task uses the handler-in-lib pattern (per AGENTS.md): the entitlement+auth decision logic lives in a pure function in `@repo/auth`, fully testable with pglite. The middleware in each app is a thin shim that calls it. Both the diagnostic and shop apps will share `guardRoute` (with different feature keys); writing it as a tested helper here pays off twice.

- [ ] **Step 1: Write the failing tests for guardRoute**

Create `packages/auth/src/route-guard.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { guardRoute } from './route-guard'
import { createDb } from '@repo/db/client'
import { shops, profiles, shopEntitlements } from '@repo/db/schema'
import { setupPgliteForTests } from '../test-utils/pglite'  // pglite harness per AGENTS.md

const SHOP_A = '00000000-0000-0000-0000-000000000001'
const PROFILE_A = '00000000-0000-0000-0000-000000000010'
const USER_A = 'auth-user-1'
const PUBLIC = ['/sign-in', '/sign-up', '/', '/upgrade', '/api/health']

describe('guardRoute', () => {
  let db: ReturnType<typeof createDb>

  beforeEach(async () => {
    db = await setupPgliteForTests()
    await db.insert(shops).values({ id: SHOP_A, name: 'Test Shop', ownerProfileId: PROFILE_A })
    await db.insert(profiles).values({ id: PROFILE_A, userId: USER_A, shopId: SHOP_A, role: 'tech' })
  })

  it('allows public paths without auth', async () => {
    const result = await guardRoute(db, null, '/sign-in', 'diagnostic_access', PUBLIC)
    expect(result).toEqual({ kind: 'allow' })
  })

  it('allows /api/health without auth', async () => {
    const result = await guardRoute(db, null, '/api/health', 'diagnostic_access', PUBLIC)
    expect(result).toEqual({ kind: 'allow' })
  })

  it('redirects unauthenticated user on protected path to /sign-in', async () => {
    const result = await guardRoute(db, null, '/today', 'diagnostic_access', PUBLIC)
    expect(result).toEqual({ kind: 'redirect', to: '/sign-in' })
  })

  it('redirects user without profile to /onboarding', async () => {
    const result = await guardRoute(db, 'user-without-profile', '/today', 'diagnostic_access', PUBLIC)
    expect(result).toEqual({ kind: 'redirect', to: '/onboarding' })
  })

  it('redirects authed user without shop entitlement to /upgrade', async () => {
    // No shop_entitlements row inserted
    const result = await guardRoute(db, USER_A, '/today', 'diagnostic_access', PUBLIC)
    expect(result).toEqual({ kind: 'redirect', to: '/upgrade' })
  })

  it('allows authed user with active shop entitlement', async () => {
    await db.insert(shopEntitlements).values({
      shopId: SHOP_A, featureKey: 'diagnostic_access', status: 'active',
    })
    const result = await guardRoute(db, USER_A, '/today', 'diagnostic_access', PUBLIC)
    expect(result).toEqual({ kind: 'allow' })
  })

  it('allows /upgrade path regardless of entitlement (always public)', async () => {
    const result = await guardRoute(db, USER_A, '/upgrade', 'diagnostic_access', PUBLIC)
    expect(result).toEqual({ kind: 'allow' })
  })
})
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
pnpm --filter @repo/auth test route-guard
```

Expected: FAIL with "guardRoute is not exported".

- [ ] **Step 3: Implement guardRoute**

Create `packages/auth/src/route-guard.ts`:

```ts
import { eq } from 'drizzle-orm'
import type { AppDb } from '@repo/db/client'
import { profiles } from '@repo/db/schema'
import { hasEntitlement } from './entitlements'
import type { FeatureKey } from '@repo/types'

export type GuardResult =
  | { kind: 'allow' }
  | { kind: 'redirect'; to: string }

/**
 * Pure decision function for route authorization. Used by both apps' middlewares
 * via a thin shim that resolves NextRequest into (userId, path) and converts
 * GuardResult into a NextResponse.
 *
 * Public paths are always allowed (no auth check).
 * Unauthenticated users on protected paths → /sign-in.
 * Authenticated users with no profile → /onboarding.
 * Authenticated users without entitlement → /upgrade.
 * Authenticated users with entitlement → allow.
 */
export async function guardRoute(
  db: AppDb,
  userId: string | null,
  path: string,
  featureKey: FeatureKey,
  publicPaths: string[],
): Promise<GuardResult> {
  const isPublic = publicPaths.some(p => path === p || path.startsWith(p + '/'))
  if (isPublic) return { kind: 'allow' }

  if (!userId) return { kind: 'redirect', to: '/sign-in' }

  const [profile] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1)
  if (!profile?.shopId) return { kind: 'redirect', to: '/onboarding' }

  const allowed = await hasEntitlement(db, profile.shopId, profile.id, featureKey)
  if (!allowed) return { kind: 'redirect', to: '/upgrade' }

  return { kind: 'allow' }
}
```

- [ ] **Step 4: Run tests, confirm pass**

```bash
pnpm --filter @repo/auth test route-guard
```

Expected: 7 tests passing.

- [ ] **Step 5: Re-export from package index**

Edit `packages/auth/src/index.ts`:

```ts
export * from './route-guard'
```

- [ ] **Step 6: Wire guardRoute into apps/diagnostic/middleware.ts**

Replace `apps/diagnostic/middleware.ts` contents with:

```ts
import { type NextRequest, NextResponse } from 'next/server'
import { refreshSession, guardRoute } from '@repo/auth'
import { getDb } from '@repo/db/client'

const PUBLIC = ['/sign-in', '/sign-up', '/', '/upgrade', '/api/health']

export async function middleware(req: NextRequest) {
  const { res, supabase } = await refreshSession(req)
  const { data: { user } } = await supabase.auth.getUser()

  const result = await guardRoute(
    getDb(),
    user?.id ?? null,
    req.nextUrl.pathname,
    'diagnostic_access',
    PUBLIC,
  )

  if (result.kind === 'redirect') {
    return NextResponse.redirect(new URL(result.to, req.url))
  }
  return res
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
```

(Preserve any phase-D session-state logic from the existing middleware that needs to stay — guardRoute handles auth + entitlement only; other concerns are passed-through.)

- [ ] **Step 7: Create the `/upgrade` page placeholder**

Create `apps/diagnostic/app/(app)/upgrade/page.tsx`:

```tsx
export default function UpgradePage() {
  return (
    <main className="container mx-auto py-12 max-w-2xl">
      <h1 className="text-2xl font-semibold">Diagnostic access required</h1>
      <p className="mt-4 text-gray-600">
        Your shop does not currently have access to the Vyntechs Diagnostic AI tool.
        Contact your shop owner to enable access, or upgrade your subscription.
      </p>
    </main>
  )
}
```

- [ ] **Step 8: Pre-grant entitlements to existing test shops**

Use Supabase MCP `execute_sql` to prevent prod traffic from being redirected to /upgrade once Stage 3 ships:

```sql
INSERT INTO shop_entitlements (shop_id, feature_key, status, granted_at)
SELECT DISTINCT shop_id, 'diagnostic_access', 'active', now()
FROM profiles
WHERE shop_id IS NOT NULL
ON CONFLICT (shop_id, feature_key) DO NOTHING;
```

- [ ] **Step 9: Run all checks and verify locally**

```bash
pnpm install
pnpm --filter diagnostic typecheck
pnpm --filter @repo/auth test
pnpm --filter diagnostic test
pnpm --filter diagnostic build

# Smoke test locally:
pnpm --filter diagnostic dev &
sleep 8
# Sign in with brandon@vyntechs.com password Benny0812 (per session memory)
# Verify /today still works (entitlement granted via Step 8)
# Verify /upgrade renders without redirect loop
```

- [ ] **Step 10: Commit and verify on staging-rc**

```bash
git add -A
git commit -m "feat(auth): guardRoute helper + wire entitlement check into diagnostic middleware

Stage 3.4 of the platform split migration. Extracted the auth+entitlement
decision into guardRoute, a pure function in @repo/auth/route-guard, with
7 TDD test cases covering public paths / unauth / missing profile /
missing entitlement / allowed paths. Diagnostic middleware now a thin
shim calling guardRoute('diagnostic_access'). /upgrade placeholder created.
Existing test shops pre-granted via direct SQL so prod traffic is unaffected.

The same guardRoute helper is consumed by the apps/shop middleware in
Stage 4 with featureKey='shop_mgmt_access' — one tested implementation,
two product surfaces.

Refs docs/superpowers/plans/2026-05-05-platform-split-migration.md"

git push -u origin stage-3-entitlements
# Deploy to staging-rc, eyeball Brandon's shop continues to work end-to-end.
```

---

**Stage 3 verification gate:**
- [ ] Both `shop_entitlements` and `profile_entitlements` tables exist on live Supabase with RLS policies.
- [ ] `hasEntitlement` helper has 7 passing test cases covering all combinations.
- [ ] Stripe webhook handler has 4 passing tests covering create/update/delete/bundled events.
- [ ] Diagnostic middleware redirects to `/upgrade` on missing entitlement.
- [ ] Existing test shops pre-granted; staging-rc traffic continues to work end-to-end.
- [ ] Tests still passing at baseline + new entitlement test counts.
- [ ] No PR merged to main yet — production unchanged.

**STOP POINT.** This is a recommended end-of-session checkpoint. Sleep on it before starting Stage 4.

**Rollback for Stage 3:** revert the stage-3 commit, drop the new tables via Supabase MCP `execute_sql`:
```sql
DROP TABLE IF EXISTS profile_entitlements;
DROP TABLE IF EXISTS shop_entitlements;
```

---

# Stage 4 — Shop placeholder app

**Goal:** Create `apps/shop/` as a deployable Next.js 16 app with auth + a placeholder page. Configure middleware to require `shop_mgmt_access` entitlement. **No shop management features built.**

**Risk:** Low — empty app.

**Owner:** Continue from `stage-3-entitlements` worktree.

### Task 4.1: Scaffold the shop app

**Files:**
- Create: `apps/shop/` (full Next.js 16 minimal app)

- [ ] **Step 1: Branch**

```bash
git checkout stage-3-entitlements
git pull origin stage-3-entitlements
git checkout -b stage-4-shop-placeholder
```

- [ ] **Step 2: Manually scaffold (not `create-next-app` — we want shared workspace deps)**

```bash
mkdir -p apps/shop/app
```

`apps/shop/package.json`:

```json
{
  "name": "shop",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev --port 3001",
    "build": "next build",
    "start": "next start",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@repo/auth": "workspace:*",
    "@repo/db": "workspace:*",
    "@repo/types": "workspace:*",
    "@repo/ui": "workspace:*",
    "next": "<copy from apps/diagnostic>",
    "react": "<copy from apps/diagnostic>",
    "react-dom": "<copy from apps/diagnostic>"
  },
  "devDependencies": {
    "@repo/config": "workspace:*",
    "typescript": "<copy from apps/diagnostic>",
    "@types/react": "<copy from apps/diagnostic>"
  }
}
```

`apps/shop/tsconfig.json`:

```json
{
  "extends": "@repo/config/tsconfig.json",
  "compilerOptions": {
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules", ".next"]
}
```

`apps/shop/next.config.js`:

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@repo/config', '@repo/types', '@repo/db', '@repo/auth', '@repo/ui'],
}
export default nextConfig
```

`apps/shop/tailwind.config.ts`:

```ts
import type { Config } from 'tailwindcss'
import preset from '@repo/config/tailwind'

export default {
  presets: [preset],
  content: [
    './app/**/*.{ts,tsx,mdx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
} satisfies Config
```

- [ ] **Step 3: Create the placeholder page + layout**

`apps/shop/app/layout.tsx`:

```tsx
import '@repo/ui/styles/globals.css'

export const metadata = { title: 'Vyntechs Shop' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
```

`apps/shop/app/page.tsx`:

```tsx
export default function HomePage() {
  return (
    <main className="container mx-auto py-12 max-w-2xl">
      <h1 className="text-2xl font-semibold">Vyntechs Shop Management</h1>
      <p className="mt-4 text-gray-600">
        Coming soon. Your shop management dashboard will live here.
      </p>
    </main>
  )
}
```

`apps/shop/app/upgrade/page.tsx`:

```tsx
export default function UpgradePage() {
  return (
    <main className="container mx-auto py-12 max-w-2xl">
      <h1 className="text-2xl font-semibold">Shop management access required</h1>
      <p className="mt-4 text-gray-600">
        Your shop does not currently have access to the Shop Management product.
        Contact sales or upgrade your subscription.
      </p>
    </main>
  )
}
```

- [ ] **Step 4: Extract middleware config so it's testable**

Create `apps/shop/middleware-config.ts`:

```ts
import type { FeatureKey } from '@repo/types'

export const FEATURE_KEY: FeatureKey = 'shop_mgmt_access'

export const PUBLIC_PATHS = [
  '/sign-in',
  '/sign-up',
  '/',
  '/upgrade',
] as const
```

- [ ] **Step 5: Write failing tests for the middleware config**

Create `apps/shop/tests/middleware-config.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { FEATURE_KEY, PUBLIC_PATHS } from '@/middleware-config'

describe('shop middleware config', () => {
  it('uses shop_mgmt_access feature key (not diagnostic_access)', () => {
    expect(FEATURE_KEY).toBe('shop_mgmt_access')
  })

  it('treats /upgrade as public so unauthorized users can land there', () => {
    expect(PUBLIC_PATHS).toContain('/upgrade')
  })

  it('treats / as public for the placeholder home page', () => {
    expect(PUBLIC_PATHS).toContain('/')
  })

  it('treats /sign-in as public for unauth flow', () => {
    expect(PUBLIC_PATHS).toContain('/sign-in')
  })
})
```

- [ ] **Step 6: Run tests, confirm pass (config exists, tests just verify the values)**

```bash
pnpm --filter shop test middleware-config
```

Expected: 4 tests passing.

(This is a "doc test" — it pins the contract that the shop middleware uses the right feature key. If a future refactor accidentally changes 'shop_mgmt_access' to anything else, this test fails immediately and obviously.)

- [ ] **Step 7: Add middleware as a thin shim that uses guardRoute + the config**

Create `apps/shop/middleware.ts`:

```ts
import { type NextRequest, NextResponse } from 'next/server'
import { refreshSession, guardRoute } from '@repo/auth'
import { getDb } from '@repo/db/client'
import { FEATURE_KEY, PUBLIC_PATHS } from './middleware-config'

export async function middleware(req: NextRequest) {
  const { res, supabase } = await refreshSession(req)
  const { data: { user } } = await supabase.auth.getUser()

  const result = await guardRoute(
    getDb(),
    user?.id ?? null,
    req.nextUrl.pathname,
    FEATURE_KEY,
    [...PUBLIC_PATHS],
  )

  if (result.kind === 'redirect') {
    return NextResponse.redirect(new URL(result.to, req.url))
  }
  return res
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
```

(The behavior is fully tested via the existing `guardRoute` test suite from Stage 3.4 plus the config tests above. No new integration test is needed because the shim is trivial — it converts NextRequest→inputs and GuardResult→NextResponse.)

- [ ] **Step 8: Install and verify**

```bash
cd /Volumes/Creativity/dev/projects/vyntechs/.claude/worktrees/monorepo-stage-1
pnpm install
pnpm --filter shop typecheck
pnpm --filter shop test
pnpm --filter shop build 2>&1 | tail -20
```

Expected: shop app builds clean. 4 middleware-config tests pass. Routes: `/`, `/upgrade`.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(monorepo): scaffold apps/shop placeholder + middleware-config tests

Stage 4.1 of the platform split migration. Empty Next.js 16 app at
apps/shop with auth, /upgrade page, and shop_mgmt_access entitlement
gating via the shared guardRoute helper from @repo/auth. Middleware
config (FEATURE_KEY + PUBLIC_PATHS) extracted to a separate module
with 4 doc tests pinning the contract. No shop management features
built — this is the deployable shell that proves the architecture
supports the second product.

Refs docs/superpowers/plans/2026-05-05-platform-split-migration.md"

git push -u origin stage-4-shop-placeholder
```

---

**Stage 4 verification gate:**
- [ ] `pnpm --filter shop build` clean.
- [ ] `pnpm --filter diagnostic build` still clean.
- [ ] `pnpm --filter diagnostic test` still passing at baseline + entitlement test count.
- [ ] No production change yet.

---

# Stage 5 — Operational wiring

**Goal:** CI migration job, second Vercel project for `apps/shop`, lint rule for cross-app imports, env scoping, AGENTS.md update.

**Risk:** Low.

**Owner:** Continue from `stage-4-shop-placeholder`.

### Task 5.1: GitHub Action for migrations

**Files:**
- Create: `.github/workflows/db-migrate.yml`

- [ ] **Step 1: Create the workflow**

`.github/workflows/db-migrate.yml`:

```yaml
name: DB migrations
on:
  push:
    branches: [main]
    paths:
      - 'packages/db/migrations/**'
      - 'packages/db/src/schema/**'

jobs:
  migrate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - name: Apply migrations
        env:
          DATABASE_URL_DIRECT: ${{ secrets.DATABASE_URL_DIRECT }}
        run: pnpm --filter @repo/db migrate
```

(Note: the AGENTS.md preference is to apply migrations via Supabase MCP. This GitHub Action is the *automation* path; the MCP path stays for ad-hoc work. Both write to the same `__drizzle_migrations` tracking table, so they don't conflict — but in practice prefer one path consistently per environment.)

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/db-migrate.yml
git commit -m "ci: add db-migrate workflow gated on packages/db changes

Stage 5.1 of the platform split migration."
```

### Task 5.2: Configure team-level Vercel env vars

**Files:** None in repo (Vercel dashboard config).

- [ ] **Step 1: Move shared env vars to Vercel team-level**

Via Vercel dashboard (Team Settings → Environment Variables → Shared):
- `DATABASE_URL`
- `DATABASE_URL_DIRECT`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ANTHROPIC_API_KEY`
- `ANTHROPIC_MODEL`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `VOYAGE_API_KEY`
- `CRON_SECRET`

Both projects automatically inherit. Project-level overrides for app-specific values (e.g., `NEXT_PUBLIC_APP_URL`) stay per-project.

### Task 5.3: Create the second Vercel project for apps/shop

**Files:** None in repo.

- [ ] **Step 1: Create the project**

```bash
cd apps/shop
vercel link --project vyntechs-shop-dev
```

Confirm the project is created, root directory is `apps/shop`.

- [ ] **Step 2: Set the production domain**

Via Vercel dashboard → Project → Domains: add `shop.vyntechs.dev`. Configure DNS record (CNAME pointing to the Vercel-provided alias).

- [ ] **Step 3: Enable auto skip-unaffected on both projects**

Vercel dashboard → Each project → Settings → Git → Ignored Build Step → "Automatic" (uses Turborepo dependency graph).

### Task 5.4: Configure cross-app no-imports lint rule with TDD

**Files:**
- Create: `packages/config/tests/eslint-no-cross-app.test.ts`
- Modify: `packages/config/eslint.preset.js` (the rule itself was added in Stage 2a; this task tests it and wires it to each app)
- Modify: `apps/diagnostic/eslint.config.js`
- Create: `apps/shop/eslint.config.js`
- Modify: `packages/config/package.json` (add `eslint` and `vitest` to devDependencies)

- [ ] **Step 1: Write failing tests for the lint rule**

Create `packages/config/tests/eslint-no-cross-app.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { ESLint } from 'eslint'
import preset from '../eslint.preset.js'

describe('shared eslint preset — no cross-app imports', () => {
  it('flags relative imports from another app', async () => {
    const eslint = new ESLint({
      overrideConfigFile: true,
      baseConfig: preset,
    })
    const results = await eslint.lintText(
      `import x from '../../shop/app/page'\nexport const a = x`,
      { filePath: 'apps/diagnostic/lib/test-violation.ts' },
    )
    const messages = results[0]?.messages ?? []
    expect(messages.some(m => m.ruleId === 'no-restricted-imports')).toBe(true)
  })

  it('flags relative imports from another app at deeper paths', async () => {
    const eslint = new ESLint({
      overrideConfigFile: true,
      baseConfig: preset,
    })
    const results = await eslint.lintText(
      `import x from '../../diagnostic/lib/intake'\nexport const a = x`,
      { filePath: 'apps/shop/components/foo.ts' },
    )
    const messages = results[0]?.messages ?? []
    expect(messages.some(m => m.ruleId === 'no-restricted-imports')).toBe(true)
  })

  it('allows imports from @repo/* packages', async () => {
    const eslint = new ESLint({
      overrideConfigFile: true,
      baseConfig: preset,
    })
    const results = await eslint.lintText(
      `import { hasEntitlement } from '@repo/auth'\nexport const a = hasEntitlement`,
      { filePath: 'apps/diagnostic/middleware.ts' },
    )
    const messages = results[0]?.messages ?? []
    expect(messages.every(m => m.ruleId !== 'no-restricted-imports')).toBe(true)
  })

  it('allows relative imports within the same app', async () => {
    const eslint = new ESLint({
      overrideConfigFile: true,
      baseConfig: preset,
    })
    const results = await eslint.lintText(
      `import { foo } from './foo'\nexport const a = foo`,
      { filePath: 'apps/diagnostic/lib/bar.ts' },
    )
    const messages = results[0]?.messages ?? []
    expect(messages.every(m => m.ruleId !== 'no-restricted-imports')).toBe(true)
  })
})
```

- [ ] **Step 2: Add eslint + vitest to packages/config**

Update `packages/config/package.json`:

```json
{
  "name": "@repo/config",
  "version": "0.0.0",
  "private": true,
  "main": "./index.js",
  "exports": {
    "./tsconfig.json": "./tsconfig.json",
    "./eslint": "./eslint.preset.js",
    "./tailwind": "./tailwind.preset.ts",
    "./prettier": "./prettier.config.js"
  },
  "scripts": {
    "test": "vitest run"
  },
  "devDependencies": {
    "eslint": "^9.0.0",
    "vitest": "^4.1.5"
  }
}
```

- [ ] **Step 3: Run the tests; if they fail, fix the eslint rule until they pass**

```bash
pnpm install
pnpm --filter @repo/config test
```

Expected (initial run): the first two tests (the violation cases) PASS — the rule from Stage 2a should already fire. The "allowed" tests should also PASS. If any test fails, fix `packages/config/eslint.preset.js`'s `no-restricted-imports` rule until all 4 pass.

If the rule from Stage 2a wasn't strict enough (e.g., it only matched one specific pattern), update it. The rule should match any relative import path that resolves into a sibling `apps/*` directory. The `patterns` array in `no-restricted-imports`:

```js
'no-restricted-imports': ['error', {
  patterns: [
    {
      group: ['../../apps/*', '../*/apps/*'],
      message: 'Apps may not import from other apps. Move shared code to a package under packages/.'
    },
    {
      // Catch sibling-app paths from inside any apps/X/* file
      group: ['../*/app/*', '../*/components/*', '../*/lib/*'],
      message: 'Apps may not import from other apps. Move shared code to a package under packages/.'
    }
  ]
}]
```

- [ ] **Step 4: Wire each app to consume the shared eslint preset**

Create `apps/diagnostic/eslint.config.js`:

```js
import shared from '@repo/config/eslint'
export default shared
```

Create `apps/shop/eslint.config.js`:

```js
import shared from '@repo/config/eslint'
export default shared
```

- [ ] **Step 5: Verify lint runs clean across both apps**

```bash
pnpm --filter diagnostic lint 2>&1 | tail -5
pnpm --filter shop lint 2>&1 | tail -5
```

Expected: clean (no violations) since neither app imports from the other.

### Task 5.5: Add smoke-test script for staging-rc + production validation

**Files:**
- Create: `apps/diagnostic/tests/smoke/prod-routes.test.ts`

This task adds an automated regression check runnable against any deployed URL via `SMOKE_TEST_URL`. Used in Stage 6 to validate staging-rc before merging and prod immediately after. Replaces the manual curl-and-eyeball pattern from prior sessions with a versioned, repeatable test.

- [ ] **Step 1: Write the smoke tests**

Create `apps/diagnostic/tests/smoke/prod-routes.test.ts`:

```ts
import { describe, it, expect } from 'vitest'

const BASE = process.env.SMOKE_TEST_URL ?? 'https://staging-rc.vercel.app'

describe(`diagnostic smoke (${BASE})`, () => {
  it('GET /sign-in returns 200 with sign-in form HTML', async () => {
    const res = await fetch(`${BASE}/sign-in`)
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('Sign in')
  })

  it('GET / returns 200', async () => {
    const res = await fetch(`${BASE}/`)
    expect(res.status).toBe(200)
  })

  it('GET /favicon.ico returns 200 image', async () => {
    const res = await fetch(`${BASE}/favicon.ico`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/^image\//)
  })

  it('GET /icon.svg returns 200 svg', async () => {
    const res = await fetch(`${BASE}/icon.svg`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/svg+xml')
  })

  it('GET /api/health returns 200 JSON with pingOk=true', async () => {
    const res = await fetch(`${BASE}/api/health`)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toHaveProperty('pingOk')
    expect(json.pingOk).toBe(true)
  })

  it('GET /today redirects to /sign-in for anon (307)', async () => {
    const res = await fetch(`${BASE}/today`, { redirect: 'manual' })
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toMatch(/\/sign-in/)
  })

  it('GET /intake/* returns 307 to /sign-in or 404 (route disabled in production)', async () => {
    const res = await fetch(`${BASE}/intake/plan-quote/test-smoke`, { redirect: 'manual' })
    // After Stage 6.1 sets the flag false, /intake/* either returns 307 (auth middleware
    // redirects anon to /sign-in) or 404 (if flag check fires first). Both are acceptable.
    expect([307, 404]).toContain(res.status)
  })

  it('GET /sessions/new redirects to /sign-in for anon', async () => {
    const res = await fetch(`${BASE}/sessions/new`, { redirect: 'manual' })
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toMatch(/\/sign-in/)
  })
})
```

- [ ] **Step 2: Run against staging-rc to confirm tests pass on the current preview**

```bash
SMOKE_TEST_URL=https://staging-rc.vercel.app pnpm --filter diagnostic test smoke 2>&1 | tail -10
```

Expected: 8 tests passing.

- [ ] **Step 3: Commit**

```bash
git add apps/diagnostic/tests/smoke/prod-routes.test.ts
git commit -m "test(smoke): automated regression check for diagnostic anonymous routes

Stage 5.5 of the platform split migration. Versioned smoke test
runnable against any URL via SMOKE_TEST_URL env. Used in Stage 6
to validate staging-rc before merging and vyntechs.dev after merging.
Replaces the prior manual curl-and-eyeball pattern with a repeatable
gate.

Refs docs/superpowers/plans/2026-05-05-platform-split-migration.md"
```

### Task 5.6: Update AGENTS.md with the dual-product model

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Add a dual-product section to AGENTS.md**

Append:

```markdown
## Dual-product platform (post-platform-split)

Vyntechs is two products in one monorepo:
- **`apps/diagnostic`** — the AI tool for bay technicians (production at `vyntechs.dev`).
- **`apps/shop`** — the shop management product for service advisors (production at `shop.vyntechs.dev`; placeholder until features ship).

Shared code lives in `packages/*`:
- `@repo/db` — Drizzle schema, client, migrations. Source of truth for DB structure.
- `@repo/auth` — Supabase auth helpers, `hasEntitlement` checker.
- `@repo/billing` — Stripe client, subscription webhook handlers.
- `@repo/ui` — shared shadcn primitives.
- `@repo/config` — shared tsconfig, eslint, tailwind, prettier presets.
- `@repo/types` — shared domain types.

**Boundary rules:**
- Apps may import from any `packages/*`. Apps may NOT import from another app. Enforced by ESLint's `no-restricted-imports` in `@repo/config/eslint`.
- `@repo/db` is the single source of truth for the schema. Schema changes happen there; both apps consume.
- Migrations apply via the GitHub Action `.github/workflows/db-migrate.yml` (gated on `packages/db/migrations/**`). The Supabase MCP `apply_migration` path remains the manual escape hatch.
- `drizzle-orm` is installed at the workspace root and hoisted via pnpm. Never install it inside a package or app.

**Entitlements:**
- Per-shop access is sourced from Stripe Entitlements API → webhook → `shop_entitlements` table. Per-profile overrides live in `profile_entitlements` (default-allow / opt-out-revoke).
- `hasEntitlement(db, shopId, profileId, featureKey)` from `@repo/auth` is the single check helper. Each app's middleware calls it with its own feature key.

**Adding a new package:**
1. Create the directory under `packages/`.
2. Add `package.json`, `tsconfig.json` extending `@repo/config`.
3. Add to consuming app's deps + `transpilePackages` in `next.config.js`.
4. If the package contains React components, also add the package's path to the consuming app's tailwind `content` glob.
```

- [ ] **Step 2: Commit Stage 5**

```bash
git add -A
git commit -m "ops(monorepo): wire CI migrations + cross-app lint + dual-product AGENTS.md

Stage 5 of the platform split migration. GitHub Action for db migrations,
shared eslint preset enforcing no-cross-app-imports, AGENTS.md updated
with the dual-product model and boundary rules.

Refs docs/superpowers/plans/2026-05-05-platform-split-migration.md"

git push -u origin stage-4-shop-placeholder
```

---

**Stage 5 verification gate:**
- [ ] CI workflow exists at `.github/workflows/db-migrate.yml`.
- [ ] Second Vercel project `vyntechs-shop-dev` exists and is linked to apps/shop.
- [ ] `shop.vyntechs.dev` DNS configured.
- [ ] Cross-app import lint rule fires when a violation is added.
- [ ] AGENTS.md updated with dual-product section.
- [ ] No production change yet.

---

# Stage 6 — Production cutover

**Goal:** Ship the migration to production. Turn off `/intake/*` flag. Verify both apps work in prod. Tag the post-migration baseline.

**Risk:** **High.** Production deployment.

**Owner:** From the worktree, with explicit Brandon's-eyeball gate before merging to main.

### Task 6.1: Set production env flag

**Files:** Vercel dashboard.

- [ ] **Step 1: Set `NEXT_PUBLIC_DESKTOP_INTAKE_ENABLED=false` in production env of `vyntechs-dev` project**

```bash
cd .claude/worktrees/monorepo-stage-1
echo "false" | tr -d '\n' | vercel env rm NEXT_PUBLIC_DESKTOP_INTAKE_ENABLED production --yes 2>/dev/null
printf "false" | vercel env add NEXT_PUBLIC_DESKTOP_INTAKE_ENABLED production
```

This turns off the `/intake/*` routes on `vyntechs.dev`. Returns 404 for any access to `/intake/*` after the next prod build.

### Task 6.2: Final validation on staging-rc

**Files:** None.

- [ ] **Step 1: Push the latest stage-5 branch and wait for staging-rc deploy**

```bash
git push
sleep 60
vercel ls | head -3
```

- [ ] **Step 2: Re-alias staging-rc to the latest build**

```bash
vercel alias set <new-deploy-url> staging-rc.vercel.app
```

- [ ] **Step 3: Run the smoke test suite against staging-rc**

```bash
SMOKE_TEST_URL=https://staging-rc.vercel.app pnpm --filter diagnostic test smoke 2>&1 | tail -10
```

Expected: 8 tests passing (per Task 5.5).

- [ ] **Step 3b: Anonymous header diff against baseline (manual sanity)**

```bash
diff <(curl -sI https://staging-rc.vercel.app/sign-in | head -3) /tmp/vyntechs-baseline/sign-in.headers
diff <(curl -sI https://staging-rc.vercel.app/today | head -3) /tmp/vyntechs-baseline/today.headers
diff <(curl -sI https://staging-rc.vercel.app/api/health | head -3) /tmp/vyntechs-baseline/api-health.headers
```

Expected: matches baseline (excluding cache/x-vercel-id headers). Reinforces what the smoke test already verifies.

- [ ] **Step 4: Authed full gap audit on staging-rc**

Sign in as `brandon@vyntechs.com` and confirm:
- `/today` shows In-Progress card and recent sessions
- `/sessions/new` form works (create + cancel)
- `/sessions/<existing>` opens an active session
- `/intake/*` returns 404 (flag is now false)
- Phase-r Check-ins regression test passes (insert/Held/verify/delete pattern)

- [ ] **Step 5: Run Lighthouse on auth-gated pages**

Per the Session 5 prod gap-audit pattern. All pages should score the same as the post-Session-5 baseline (some 100/100/100/100; `/today` 95/100/100/100 with the documented color-contrast carryover).

### Task 6.3: Brandon's eyeball gate

**Files:** None.

- [ ] **Step 1: Brandon visits `staging-rc.vercel.app`, signs in, confirms diagnostic flow works end-to-end.**

If anything looks off, **stop and roll back** before merging to main. Same playbook as the tier-2 RC pattern from Sessions 4 + 5.

### Task 6.4: Merge to main and ship to production

**Files:** None.

- [ ] **Step 1: Merge the migration branch to main**

```bash
cd /Volumes/Creativity/dev/projects/vyntechs
git checkout main
git merge --no-ff stage-4-shop-placeholder -m "merge: platform split into monorepo (diagnostic + shop products)

6-stage migration shipped per docs/superpowers/plans/2026-05-05-platform-split-migration.md.

- apps/diagnostic: existing AI tool, unchanged behavior on vyntechs.dev
- apps/shop: placeholder shell on shop.vyntechs.dev
- packages/{db,auth,ui,billing,config,types}: shared identity layer
- shop_entitlements + profile_entitlements tables: Stripe-driven access control
  with per-profile opt-out-revoke override
- /intake/* turned off in production (was Sessions-4-5 partial shop UI; will
  return on shop.vyntechs.dev when shop management features ship)

Validated on staging-rc.vercel.app at <commit-sha>. All anonymous header
samples + authed flows confirmed byte-equivalent to pre-monorepo-baseline.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"

git push origin main
```

- [ ] **Step 2: Wait for both Vercel projects to build and alias to prod**

```bash
sleep 90
vercel ls | head -5
```

Expected: 
- `vyntechs-dev` project deployed Ready, aliased to `vyntechs.dev`
- `vyntechs-shop-dev` project deployed Ready, aliased to `shop.vyntechs.dev`

- [ ] **Step 3: Run the smoke test suite against vyntechs.dev (post-merge)**

```bash
SMOKE_TEST_URL=https://vyntechs.dev pnpm --filter diagnostic test smoke 2>&1 | tail -10
```

Expected: 8 tests passing on production. **If any fail, immediately roll back per the Stage 6 rollback procedure.**

- [ ] **Step 3b: Final prod gap audit per Session 5 pattern**

Run the same audit Brandon validated for Session 5:
- Anonymous header diff vs baseline (already covered by smoke test, but eyeball cache headers)
- Authed `/today` + `/sessions/new` + `/sessions/<id>` flows on `vyntechs.dev`
- `/intake/*` returns 307 (auth) or 404 (flag) on `vyntechs.dev`
- `shop.vyntechs.dev/` returns the placeholder for shop_mgmt_access holders, redirects to `/upgrade` for non-holders

### Task 6.5: Tag and document the post-migration baseline

**Files:**
- Create: `docs/superpowers/sessions/2026-05-XX-handoff-monorepo-migration-shipped.md`

- [ ] **Step 1: Tag the post-migration commit**

```bash
git tag -a post-monorepo-migration -m "Post-platform-split baseline. Diagnostic + shop placeholder live in production."
git push origin post-monorepo-migration
```

- [ ] **Step 2: Write the shipped handoff**

Modeled on the existing Session 5 phase-r-in-prod handoff. Capture: prod head SHA, both Vercel deploy URLs, validation matrix passed, carryovers (the same `/today` color-contrast a11y, etc.), what's disposable now (the migration worktree + branches), what's queued next (shop management product spec).

- [ ] **Step 3: Commit and push the handoff**

```bash
git add docs/superpowers/sessions/2026-05-XX-handoff-monorepo-migration-shipped.md
git commit -m "docs(handoff): platform split shipped to production

Diagnostic at vyntechs.dev (unchanged behavior); shop placeholder at
shop.vyntechs.dev. Migration plan 2026-05-05-platform-split-migration.md
fully executed across N sessions.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"

git push origin main
```

### Task 6.6: Post-migration cleanup

**Files:**
- Modify: `apps/diagnostic/lib/feature-flags.ts` (remove `isDesktopIntakeEnabled` if no longer used)
- Delete: `apps/diagnostic/app/(app)/intake/` (the now-dead route subtree)

- [ ] **Step 1: Verify nothing imports `isDesktopIntakeEnabled` anymore**

```bash
grep -rE "isDesktopIntakeEnabled|NEXT_PUBLIC_DESKTOP_INTAKE_ENABLED" apps/ packages/ | head
```

- [ ] **Step 2: Remove the flag and dead routes**

```bash
git rm -rf apps/diagnostic/app/\(app\)/intake/
# Edit apps/diagnostic/lib/feature-flags.ts to remove the function
git rm apps/diagnostic/app/api/intake/ -r 2>/dev/null  # if dead too
```

- [ ] **Step 3: Run all checks**

```bash
pnpm install
pnpm --filter diagnostic typecheck
pnpm --filter diagnostic test
pnpm --filter diagnostic build
```

- [ ] **Step 4: Remove the env var from Vercel**

```bash
cd .claude/worktrees/monorepo-stage-1
vercel env rm NEXT_PUBLIC_DESKTOP_INTAKE_ENABLED production --yes
vercel env rm NEXT_PUBLIC_DESKTOP_INTAKE_ENABLED preview --yes 2>/dev/null
```

- [ ] **Step 5: Commit and push**

```bash
git add -A
git commit -m "chore: remove dead /intake routes + NEXT_PUBLIC_DESKTOP_INTAKE_ENABLED flag

Stage 6.6 cleanup. The /intake/* routes were Sessions 4-5 partial shop
management UI living inside the diagnostic app. Removed in favor of the
future shop management product on shop.vyntechs.dev. The feature flag
that gated them is also removed (no longer referenced anywhere)."

git push origin main
```

---

**Stage 6 verification gate (terminal — migration complete):**
- [ ] `vyntechs.dev` serves the diagnostic app from `apps/diagnostic`, behavior identical to pre-migration baseline (anonymous + authed validation passed).
- [ ] `shop.vyntechs.dev` serves the placeholder from `apps/shop`, redirects non-entitled users to `/upgrade`.
- [ ] `git tag post-monorepo-migration` exists and is pushed.
- [ ] `NEXT_PUBLIC_DESKTOP_INTAKE_ENABLED` removed from Vercel + repo.
- [ ] `/intake/*` dead routes removed from apps/diagnostic.
- [ ] Shipped handoff document committed.
- [ ] Migration worktree cleaned up: `git worktree remove .claude/worktrees/monorepo-stage-1 --force` and `git branch -D` for the stage-N branches.

**Rollback for Stage 6 (last resort):**
```bash
git revert <merge-commit-sha>
git push origin main
# Vercel auto-redeploys; diagnostic app reverts to pre-merge state
# Shop placeholder remains live but unused (harmless)
# Re-set NEXT_PUBLIC_DESKTOP_INTAKE_ENABLED=true if Counter 02-03 must be reachable again
```

---

## Self-Review

Spec coverage check (per writing-plans skill):

| Spec section | Plan tasks |
|---|---|
| Goal 1: two independently-deployable products | Stages 1-6 |
| Goal 2: shop-level entitlements | Stage 3 (3.1, 3.3, 3.4) |
| Goal 3: no production downtime | Stages 0, 1, 2, 6 (verification gates per stage) |
| Goal 4: clean architectural boundaries | Stages 2a-f, 5.4 (lint rule) |
| Goal 5: forced correctness via real second-app shell | Stage 4 |
| Decision 1: monorepo over multi-repo | Stage 1.2 (workspace config) |
| Decision 2: Turborepo + pnpm workspaces | Stage 1.2 |
| Decision 3: layout (apps/* + packages/*) | Stage 1.3, Stage 2a-f |
| Decision 4: two Vercel projects, one repo | Stage 5.3 |
| Decision 5: schema in packages/db, migrations from CI | Stage 2c, Stage 5.1 |
| Decision 6: entitlements model (4-layer) | Stage 3.1, 3.2, 3.3, 3.4 |
| Decision 7: no cross-app imports | Stage 2a (Step 5) + Stage 5.4 (with TDD test of the rule itself) |
| Data shape: shop_entitlements + profile_entitlements | Stage 3.1 |
| Per-tech entitlements (v1) | Stage 3.1 (table), 3.2 (helper) |
| `shop.vyntechs.dev` domain | Stage 5.3 |
| `/intake/*` flag off | Stage 6.1 |
| `/sessions/new` remains the diagnostic intake | No code change required (already there) |
| AGENTS.md updated | Stage 5.6 (renumbered after Task 5.5 became smoke test) |

All spec sections have at least one task. No gaps identified.

**TDD coverage check (added per Brandon's review):**

| New code introduced | TDD coverage |
|---|---|
| `hasEntitlement` helper | Stage 3.2 — 7 test cases written first |
| Stripe subscription webhook handler | Stage 3.3 — 4 test cases written first |
| `guardRoute` helper (auth + entitlement decision) | Stage 3.4 — 7 test cases written first |
| Diagnostic middleware | Thin shim over `guardRoute`; behavior covered by Stage 3.4 tests |
| `apps/shop` middleware | Thin shim over `guardRoute`; config tested in Stage 4.1 (4 tests) |
| Cross-app no-imports lint rule | Stage 5.4 — 4 test cases written first against the preset directly |
| Production smoke routes | Stage 5.5 — 8 anonymous-route tests runnable against any URL |

Mechanical migration tasks (Stages 0, 1, 2a-f, 4 scaffolding, 5.1-5.3, 5.6, 6) do NOT introduce new behavior — they relocate existing code. The pre-existing 378-test suite is the regression safety net for those stages, asserted at every verification gate.

Type consistency check: `hasEntitlement(db, shopId, profileId, featureKey)` signature is consistent across the helper definition (Stage 3.2 Step 3), test usage (Stage 3.2 Step 1), `guardRoute` consumption (Stage 3.4 Step 3). `guardRoute(db, userId, path, featureKey, publicPaths)` signature is consistent across definition (Stage 3.4 Step 3), tests (Stage 3.4 Step 1), and both apps' middlewares (Stage 3.4 Step 6, Stage 4.1 Step 7). The `FeatureKey` type is `'diagnostic_access' | 'shop_mgmt_access'` consistently. `KNOWN_FEATURE_KEYS` in the webhook handler (Stage 3.3) matches. Helper names and signatures consistent throughout.

No placeholders found in the plan body. All code blocks contain runnable code or explicit "copy from <source>" notes for version-pinned values that need to come from the existing repo at execution time.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-05-platform-split-migration.md`.

Two execution options:

1. **Subagent-Driven (recommended for Brandon's session model)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Required sub-skill: `superpowers:subagent-driven-development`.

2. **Inline Execution** — Execute tasks in the current session using `superpowers:executing-plans`, batch execution with checkpoints for review.

For this migration specifically: **stop points between stages are non-negotiable** regardless of execution mode. Stage 0 → Stage 1 → STOP. Stage 2c → STOP. Stage 3 → STOP. Each stop point is a Brandon's-eyeball gate before proceeding to the next stage.

**Which approach?**
