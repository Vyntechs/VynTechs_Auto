# Shop OS driver state

- **Outcome:** Ship the approved Shop OS plan into `main`, one tested and independently reviewed PR at a time, without changing diagnostic-engine behavior.
- **Current slice:** Row 21 planning — authenticated human story review/edit plus phone/in-person approval UI.
- **Last proof:** Row 20 merged in PR #132 as `e9bc780`; `origin/main` is tree-identical to the reviewed source. Production deployment `dpl_7XqmkL2UJhvz8jdrK1xrcSM2Uak3` is Ready, the story route returns the expected unauthenticated 401, and deployment error logs are empty.
- **Next safe move:** Prepare and independently review the row 21 execution packet before UI implementation. Row 21 has not started.
- **Open gates:** Published-wizard story generation requires a separately approved provenance bridge because the current client-supplied lock provenance cannot satisfy the evidence contract without engine changes; topology remains manual/template pending a separate bridge. True two-connection PostgreSQL `NOWAIT` timing is deferred to integration proof. Two quote-trigger search-path advisor warnings still require a separately reviewed source migration before further production hardening. Loaded protected-page browser proof requires owner permission to launch installed Chrome.
- **Worker lanes:** The control lane owns row 21 planning; no row 21 implementation writer has started.
- **Stop only when:** A production database change, external account or credential, spend, irreversible action, or unresolved business decision is required.
- **Usage balance:** Native tests/git handle routine proof; specialist workers implement/review bounded slices; the control lane reserves strongest effort for convergence, final verification, and merge. Automate repeated route-proof scaffolding after the third stable repeat.
