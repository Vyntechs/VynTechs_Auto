# Shop OS Technician Work Core — Release Test Report

## Result

The Chunk 5 product candidate passed its real-component Work Rail proof on phone and desktop. A technician can start and complete approved work without typing or timing, optionally record unusual detail in the completion action, use a personal job timer when enabled, and recover without losing or inventing work truth.

## Reviewed state

- Production baseline: `0be601555aaf964255bbed64b07027a8ccb817d6`
- Exact browser-tested candidate: `1a39cb79740d677f17c2afbf1181002748c63c50`
- Branch: `codex/technician-work-core-2026-08-05`
- Revised design approval: Buzz event `74bfb55967e73f88da82b341d5404bd8bc29259750a23795c57b61fa3078c3b0`
- Written Work Rail approval: Buzz event `f695178533302a501fcf5476d5810d70619d4ab276ed877775c93be153ca25ae`

The report commit is documentation-only. Final source-suite, build, security, hosted-check, migration, merge, and production conclusions remain later gates.

## Real technician journeys

The exact-head command below passed 14/14 tests in one hermetic invocation: seven at 390×844 and the same seven at 1440×900.

```bash
PLAYWRIGHT_USE_SYSTEM_CHROME=1 GOLDEN_QA_RETAIN_EVIDENCE=1 \
  node scripts/shop-os-golden-browser.mjs test --suite technician-handoff
```

1. Timer off: Claim work → exact approved scope → Start work → Complete as approved, with no typing or timer.
2. Optional detail: one atomic Complete with detail action; no separate save step.
3. Personal timer: Start work, pause, resume, preference-off visibility, and final stop remain truthful; typed detail survives every clock response.
4. Detail recovery: a reload restores the local draft; a changed server baseline displays both versions for a deliberate choice.
5. Ambiguous response: an invalid Start work response reloads exact server truth before reporting the result.
6. State matrix: waiting, below-tier, deferred, and declined work suppress forbidden actions.
7. Recovery: claim race, idempotent retry, work-load failure, and stale mounted access remain truthful.

Every checkpoint also proved:

- 44×44px minimum enabled targets;
- no horizontal overflow;
- no serious or critical Axe finding;
- no uncaught browser error or unexpected failed request;
- no outside-origin HTTP or WebSocket traffic;
- no technician price/quote-control leakage;
- one active mounted Work tool;
- visible scope, progress, completion, failure, and recovery focus;
- normal and reduced-motion handoff treatment.

With evidence retention enabled, Playwright kept 44 screenshot files across the phone and desktop checkpoint directories under ignored local `test-results/`. They are disposable proof output, not source artifacts.

## Focused source evidence

- Work Rail and Today integration: 97/97 tests passed.
- Living-ticket, ticket-detail, Today, and Work surfaces: 166/166 tests passed.
- Hermetic browser tooling and fault receipts: 16/16 tests passed.
- TypeScript and `git diff --check`: passed before the exact browser run.

Expected localhost connection noise appeared only inside existing unit failure-path probes; every named test file completed green.

## Proof-harness corrections

- The first sandboxed attempt could not bind loopback port 4173; the authorized loopback-only run proceeded.
- Playwright's bundled browser was absent, so the proof used the already-installed system Chrome.
- Early journey runs found exact-selector drift and a real missing focus move after Start work. The selector was narrowed and the product now focuses Work in progress after server confirmation.
- The original list-reporter attachment path did not retain screenshots, and separate project invocations could erase the first viewport's output. The harness now passes only the non-secret evidence flag, runs both hermetic projects together, and writes screenshots to Playwright-owned output paths.

## Release boundaries and rollback

- No migration was applied. Independent migration `0049a` remains unapplied.
- Paused migrations `0050` and `0051` remain untouched.
- No correction/customer-approval feature was activated.
- No production repair-order data was read or changed.
- No merge, deployment, price, permission, or production setting changed.
- Source rollback is a normal revert of the future Chunk 5 merge. If `0049a` is later approved and applied, its separate rollback decision must be handled at that owner gate.

## Remaining gates

Run one integrated static/security review, the focused regression pack, the complete repository suite, TypeScript, production build, and the exact-head browser proof. Then push and open the review PR. Stop for explicit owner approval before applying `0049a`, merging, or deploying.
