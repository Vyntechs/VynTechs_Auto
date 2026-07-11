# Row 21 Task 2 — Safe quote workspace projection

## Scope

- Extended the quote builder with bounded story/review facts, approval projection, fresh-actor approval capability, and validated immutable active-version totals.
- Reused the existing immutable snapshot validator for builder projection and diagnostic decision eligibility.
- Required priced diagnostic jobs to carry a valid reviewed AI or reviewed manual story before versioning; template and missing stories fail closed.
- Preserved repair and maintenance decision behavior while allowing diagnostic decisions only from a valid exact-version snapshot.
- Added strict client parsers for the expanded builder and decision response.

## TDD proof

- RED: focused tests failed on the absent projection fields/parser, unvalidated active snapshot totals, missing diagnostic version guard, and rejected diagnostic decisions.
- GREEN: `vitest run tests/unit/shop-os-quote-builder.test.ts tests/unit/shop-os-quote-builder-ui.test.ts tests/unit/shop-os-quote-decisions.test.ts tests/unit/shop-os-quote-versions.test.ts --reporter=dot` — 4 files, 87 tests passed.
- TypeScript: `tsc --noEmit` — passed.
- Diff: `git diff --check` on Task 2 files — passed.

## Assumptions

- Immutable snapshots intentionally retain only stable story source/session facts. A snapshot source of `ai` or `manual` is trustworthy because version creation validates the complete review audit before stripping volatile metadata.
- Newly added result fields remain additive/optional in the exported server result type for compatibility with existing typed fixtures; the wire parser requires every field and fails closed when any is missing.

## Skipped

- Full suite, build, browser verification, schema/DDL, routes, UI components, production, and live data, per Task 2 lane limits.
