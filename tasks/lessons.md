# Lessons

### dont-push-main-readiness-unprompted
Trigger: work is committed on a feature branch and feels "done."
Rule: Don't raise merge-to-main / PR scope unless Brandon asks. Mid-dev branches stay on-branch until he validates.
Reason: "all planned code committed" is not "done." Brandon decides merge timing after he sees it operate.

### built-is-not-validated
Trigger: about to call a feature "complete" because tests pass and code is merged on-branch.
Rule: Say "built, not yet validated in operation" until Brandon has watched it actually run/diagnose as intended.
Reason: Green tests prove the tracks shipped; they don't prove it diagnoses correctly. Brandon's eyes are the bar.

### dont-assume-architecture-read-it
Trigger: planning or validating a feature whose data flow / orchestration you have not traced in the code.
Rule: Read the real pipeline (entry → reuse-or-build decision → data → render) before scoping. Reflect it back to Brandon to confirm.
Reason: Brandon corrected me for assuming the diagnostic flow; my briefs encoded a wrong model. The system is a reuse-or-build keyed on vehicle+symptom, not a per-case diagnoser. Ground in code, not guesses.

### keep-it-short-depth-in-docs
Trigger: explaining system state or research findings back to Brandon.
Rule: A few plain sentences/bullets in chat; put tables/evidence/file:line in a doc and point to it. Gloss all jargon.
Reason: He called long, structured chat answers "painful to follow." He reads the lead and acts.

### topology-is-the-user-diagnostic-not-a-curator-tool
Trigger: describing or planning the interactive topology diagnostic.
Rule: Treat it as the future USER diagnostic that replaces the AI tree/wizard at intake. Curator is back-office. Don't center the curator; don't call "users can't see it yet" a defect (not on main).
Reason: Brandon corrected repeated curator-centric framing; the vision is build-as-needed, self-connecting, user-facing. See memory interactive-diagnostic-vision.

