# Shop OS Technician Work Core — Release Test Report

## Result

The Chunk 5 product candidate passed its real-component Work Rail proof on phone and desktop. A technician can start and complete approved work without typing or timing, optionally record unusual detail in the completion action, use a personal job timer when enabled, and recover without losing or inventing work truth.

## Reviewed state

- Production baseline: `0be601555aaf964255bbed64b07027a8ccb817d6`
- Exact final tested candidate: `312a42d3547fd4c9fb8ae4e204b713e08693547a`
- Branch: `codex/technician-work-core-2026-08-05`
- Revised design approval: Buzz event `74bfb55967e73f88da82b341d5404bd8bc29259750a23795c57b61fa3078c3b0`
- Written Work Rail approval: Buzz event `f695178533302a501fcf5476d5810d70619d4ab276ed877775c93be153ca25ae`

The final local candidate is not merged or deployed. Hosted checks, migration apply, merge, deployment, and production smoke/log proof remain later gates.

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
- Five widened-contract and Golden Shop Day regressions were repaired together and passed 197/197 before the full rerun.
- One unrelated Quote Bench focus assertion raced its post-busy effect under full-shard load. The test now waits for the same required focus without weakening the behavior; its 103-test file passed three consecutive runs and the formerly red shard passed 568/568.
- Complete repository suite: 4,348/4,348 tests passed across eight serialized shards with at most two workers.
- TypeScript, `git diff --check`, and the 71-page production build passed.
- Final exact-head Work Rail browser proof: 14/14 tests passed at `312a42d3547fd4c9fb8ae4e204b713e08693547a`.

Expected localhost connection noise appeared only inside existing unit failure-path probes; every named test file completed green.

## Independent review

- Formal branch-diff security review covered every changed production, migration, and proof-runner surface through exact product head `5ecb33094c1b1665474ffc657efcce54538dfea9`; coverage was complete and no reportable finding survived validation.
- Every change after that security head through `247dd8c` was documentation or test-only.
- Independent final static review then found one Important gap: completion updated the job but omitted the accepted one-time activity receipt. A RED-first test proved the miss; repair `312a42d` appends `work_completed` inside the same transaction and proves replay leaves exactly one receipt.
- Focused re-review passed with no new Critical or Important defect. A separate security delta review found no Critical, Important, or Minor issue across tenant/actor binding, privacy, transaction rollback, replay, migration exact-state guards, or dormant `0051` compatibility.

## Proof-harness corrections

- The first sandboxed attempt could not bind loopback port 4173; the authorized loopback-only run proceeded.
- Playwright's bundled browser was absent, so the proof used the already-installed system Chrome.
- Early journey runs found exact-selector drift and a real missing focus move after Start work. The selector was narrowed and the product now focuses Work in progress after server confirmation.
- The original list-reporter attachment path did not retain screenshots, and separate project invocations could erase the first viewport's output. The harness now passes only the non-secret evidence flag, runs both hermetic projects together, and writes screenshots to Playwright-owned output paths.

## Release boundaries and rollback

- No migration was applied. Independent migration `0049a` remains unapplied.
- Paused migrations `0050` and `0051` remain unapplied. `0051` received source-only compatibility maintenance so a later separately approved correction migration preserves `work_completed`; no correction behavior was activated.
- No correction/customer-approval feature was activated.
- No production repair-order data was read or changed.
- No merge, deployment, price, permission, or production setting changed.
- Source rollback is a normal revert of the future Chunk 5 merge. If `0049a` is later approved and applied, its separate rollback decision must be handled at that owner gate.

## Remaining gates

Commit this durable proof, push the exact branch, open the GitHub fallback review PR with the Buzz channel recorded, and wait for every hosted check. Stop for explicit owner approval before applying `0049a`, merging, or deploying.
