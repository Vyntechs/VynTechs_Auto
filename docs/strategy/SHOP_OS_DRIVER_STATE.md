# Shop OS driver state

- **Outcome:** Ship the approved Shop OS plan into `main`, one tested and independently reviewed PR at a time, without changing diagnostic-engine behavior.
- **Current slice:** Row 20 final publish and merge from source head `240e719`.
- **Last proof:** Row 20 passes 5 focused files / 129 tests and the complete 227-file / 2,251-test suite, TypeScript, production build, and diff check. Independent task reviews, the whole-branch review after all fixes, and the final narrow review are approved with zero remaining findings.
- **Next safe move:** Publish row 20, pass PR checks, squash-merge and verify `main`; then prepare row 21's authenticated human story review/edit and phone/in-person approval UI packet. Row 21 has not started.
- **Open gates:** Published-wizard story generation requires a separately approved provenance bridge because the current client-supplied lock provenance cannot satisfy the evidence contract without engine changes; topology remains manual/template pending a separate bridge. True two-connection PostgreSQL `NOWAIT` timing is deferred to integration proof. Two quote-trigger search-path advisor warnings still require a separately reviewed source migration before further production hardening. Loaded protected-page browser proof requires owner permission to launch installed Chrome.
- **Worker lanes:** The control lane owns row 20 publication, checks, merge, and verified-main convergence; row 21 remains the next unstarted advisor lane.
- **Stop only when:** A production database change, external account or credential, spend, irreversible action, or unresolved business decision is required.
- **Usage balance:** Native tests/git handle routine proof; specialist workers implement/review bounded slices; the control lane reserves strongest effort for convergence, final verification, and merge. Automate repeated route-proof scaffolding after the third stable repeat.
