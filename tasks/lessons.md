# Lessons

### dont-push-main-readiness-unprompted
Trigger: work is committed on a feature branch and feels "done."
Rule: Don't raise merge-to-main / PR scope unless Brandon asks. Mid-dev branches stay on-branch until he validates.
Reason: "all planned code committed" is not "done." Brandon decides merge timing after he sees it operate.

### built-is-not-validated
Trigger: about to call a feature "complete" because tests pass and code is merged on-branch.
Rule: Say "built, not yet validated in operation" until Brandon has watched it actually run/diagnose as intended.
Reason: Green tests prove the tracks shipped; they don't prove it diagnoses correctly. Brandon's eyes are the bar.
