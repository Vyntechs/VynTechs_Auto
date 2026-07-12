# Task brief — every word reduces friction (global terminology & customer-story language)

**Date:** 2026-07-11 · **Origin:** Brandon, intake session · **Lane:** cross-cutting copy (customer surfaces first)
**Collision note:** rows 20–22 shipped the customer story + review + closeout; row 23+ continues on quotes. This lane proposes standards now, applies copy per-surface later in reviewed slices — it does not edit code the control lane has in flight, and generated-copy code paths (story generator, decline language) are engine-adjacent and explicitly separate gated slices.

## Goal

Every user-visible word in PlainWrench passes the counter test — a non-college-educated tech is never slowed by vocabulary, and a vehicle owner who reads their story is left with zero open questions (who / what / when / where / why / worth it) and the feeling that nobody is playing them.

## What Brandon said (intent)

Terminology globally causes friction; every word must reduce it. Most users aren't college-educated. Customer-facing content must be clear and trust-building. Ethics and psychology in service of the best customer experience — not manipulation.

## Deliverables (this lane)

1. **Standard:** `2026-07-11-plain-language-and-trust-copy-standard.md` — the reading bar (6th–8th grade), the counter test, the six-answers trust test for the story, the ethics floor, voice registers, anti-vocabulary. **PROPOSED — Brandon approval is the gate.**
2. **Audit:** `2026-07-11-annex-terminology-audit.md` — inventory of today's offenders with path:line, classified by surface (shop-staff / customer-facing / marketing), graded by the rubric.
3. After approval: per-surface application slices (see steps).

## Scope

- **In:** all user-visible strings in `app/` + `components/`, customer story presentation, decline/defer customer language, estimate/quote presentation, follow-up copy, empty states, errors, statuses.
- **Out (own gated slices):** prompt/generator changes inside AI copy paths (story generator, decline-language generator — engine-adjacent); the landing page (owned by the landing remodel lane, same standard applies); renaming code identifiers/DB columns (user-visible words only).

## Steps

1. Audit shipped (annex). Standard proposed.
2. **GATE (Brandon):** approve/red-line the standard — especially the six-answers story bar and the counter-test rule.
3. Apply in slices, highest trust-stakes first: (a) customer story + quote surfaces, (b) decline/defer + follow-ups, (c) shop-staff daily loop (Today, ticket, intake), (d) long tail. One PR per slice, copy-only diffs, tests updated with wording.
4. Story schema gap (who/when have no home) → product decision fed to the quote/story roadmap rather than patched in copy.
5. Add the standard to AGENTS.md working rules (one line, pointer) so every future feature inherits it.

## Verify by

- Per slice: readability check of changed strings hits 6th–8th grade; zero anti-vocabulary hits; concept-name consistency table shows one name per concept; `pnpm test` green (snapshot/copy tests updated deliberately, never weakened).
- The story surface demonstrably answers the six questions on a real staged case, or honestly declines to.

**Stop conditions:** any slice that requires touching engine prompts/gating copy generation → separate plan + gate. Legal-neutral strings (waiver line) never soften below legal floor.
