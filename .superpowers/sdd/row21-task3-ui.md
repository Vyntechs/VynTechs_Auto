# Row 21 Task 3 — Integrated story and authorization UI

## Scope

- Added an in-job diagnostic story card for ordinary locked trees, manual topology stories, and honest wizard/unavailable states.
- Lazy-loaded bounded evidence, preserved server-owned proof, and exposed only finding/recommendation edits through strict Task 2 parsers.
- Replaced prepared draft totals with exact immutable version facts and one confirmation sheet for phone, in-person, or declined decisions.
- Kept request identity stable across decision and story transport retries.

## TDD proof

- RED: the two new focused test files were authored before production component edits and described the absent story and authorization interactions.
- GREEN: four focused files, 65 tests passed.
- TypeScript: `tsc --noEmit` passed.
- Diff: `git diff --check` passed.

## Accessibility and interaction proof

- Story proof is one native disclosure tap; customer decisions are action plus confirmation.
- Pivotal actions are 48px; supporting actions retain the existing 44px floor.
- Dialog focus enters, traps, returns, and moves to the dialog while busy; errors and verdicts use live regions.
- CSS covers 375px stacking, viewport-bounded confirmation, safe-area behavior, overflow wrapping, visible focus, and reduced motion.

## Assumptions

- The safe builder intentionally does not project a historical approval channel. The current decision announces its channel immediately; refreshed historical truth remains approved/declined plus exact version.
- Story review is available to every server-authorized story role. Customer decisions render enabled only from the server-derived advisor/owner capability.

## Skipped

- Full suite, build, browser, production, schema/domain/route/docs changes, per lane limits.
- One incorrectly formed `pnpm test -- ... --run` command expanded beyond the intended focus and was stopped by the control lane. All subsequent verification used exact Vitest paths.
