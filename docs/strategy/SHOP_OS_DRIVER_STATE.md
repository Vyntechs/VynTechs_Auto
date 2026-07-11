# Shop OS driver state

- **Outcome:** Ship the approved Shop OS plan into `main`, one tested and independently reviewed PR at a time, without changing diagnostic-engine behavior.
- **Current slice:** Production recovery hotfix, then resume row 20 evidence-bound story generation.
- **Last proof:** Brandon-approved production migrations `shop_os_ticket_spine`, `team_membership_lifecycle`, and `shop_os_quote_foundation` applied successfully; live invariants passed, `/today` no longer returns the missing-`skill_tier` 500, and the `/sw.js` auth-exemption regression passes with the full 224-file / 2,167-test suite, TypeScript, and production build.
- **Next safe move:** Merge and observe the `/sw.js` hotfix, obtain Brandon's authenticated production retry, then continue row 20 from `feat/shop-os-p3-story-generator`.
- **Open gates:** Authenticated production proof requires Brandon's login retry; two quote-trigger search-path advisor warnings need a separately reviewed source migration before production hardening. Loaded protected-page browser proof requires owner permission to launch installed Chrome. True two-connection PostgreSQL `NOWAIT` timing is deferred to integration proof.
- **Worker lanes:** The control lane owns production recovery and convergence; the existing row-20 story-generator worktree remains paused until recovery is verified.
- **Stop only when:** A production database change, external account or credential, spend, irreversible action, or unresolved business decision is required.
- **Usage balance:** Native tests/git handle routine proof; specialist workers implement/review bounded slices; the control lane reserves strongest effort for convergence, final verification, and merge. Automate repeated route-proof scaffolding after the third stable repeat.
