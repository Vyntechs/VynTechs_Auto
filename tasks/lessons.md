# Lessons

### mock-tested-ai-pipeline-has-latent-live-bugs
Trigger: an AI pipeline (subagents, tool-use, synthesis) is "done" but its tests only mock the model/API.
Rule: Run it end-to-end against the REAL API + real volume before trusting it. Expect several distinct latent bugs in a row.
Reason: The curator research pipeline passed all mocked unit tests but hit 3 separate live-only bugs — last-text-block parsing, synthesis max_tokens truncation, findings missing `sources`.

### prefer-tool-use-over-regex-json
Trigger: asking a model to emit a large JSON object as free text, then regex/JSON.parse-ing it.
Rule: Use tool-use structured output (forced tool_choice → SDK returns a parsed object) + graceful degradation so one bad pass falls back instead of killing an expensive run.
Reason: Free-text JSON truncated mid-array on big flows and failed the whole research run; tool-use + degrade made it resilient.

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

### drive-dont-fork-when-founder-says-go
Trigger: non-technical founder says "go"/"build" and is overwhelmed or "lost".
Rule: Take the wheel — make the obvious call yourself, do verified work, show a result. Don't keep surfacing technical forks or jargon.
Reason: Brandon said "lost/confused" three times when I offered decision menus; he wants me to drive and verify, not pick between abstractions he can't weigh.

### self-confirming-test-isnt-proof
Trigger: asserting a value via a hand-copied mirror of the real query/function.
Rule: Drive the REAL function end-to-end (seed its inputs, call it, assert its output). A mirror can pass while the real thing stays broken.
Reason: Adversarial review caught a test that mirrored the proof-of-fix count query; the real loadCachedDiagnostic e2e (0→1) was the honest proof.

### full-suite-pglite-flake-under-load
Trigger: `npm test` (full 177-file vitest run) shows scattered reds rooted in `createTestDb()` / `beforeEach` "Hook timed out in 10000ms" + "close is not a function".
Rule: This is resource-contention flake, NOT a regression. Confirm by re-running the failed files in ISOLATION (they pass). Don't trust one full run; counts are non-deterministic.
Reason: Identical code gave 1386/0 then 24-fail then 94-fail across three back-to-back full runs; every failure was a PGlite startup timeout, never an assertion.

### verify-gate-is-wired-to-the-right-route
Trigger: shipping a feature gate (topology, curator, etc.) that intercepts a user flow.
Rule: Confirm the gate runs in the ACTUAL entry route the UI uses, not just in "a" route that happens to handle similar logic. Trace the form submission from the client to the DB write.
Reason: PR #107 wired the topology gate only to `/api/sessions`; the intake form uses `/api/intake/submit`. Every real session bypassed the gate entirely. PR #109 fixed it.

### slug-contract-must-match-seeded-data-not-just-compile
Trigger: claiming a lookup/cache/topology gate is "wired" because the resolver runs and the code paths connect.
Rule: Prove the resolver's OUTPUT slug equals a slug that actually exists in the seeded DB, by observing the gate FIRE end-to-end (a real `_topology`/cache-hit row), not by reading code.
Reason: PR #109 extracted "p0087" from prose but the seeded symptom is "p0087-fuel-rail-pressure-too-low"; the bare-code slug never matched, so the topology gate fired for ZERO real sessions while being logged "non-blocking."

### dont-rerun-research-to-test-synthesis
Trigger: validating a synthesis/citations change end-to-end against the real API.
Rule: Never re-run the research phase (web_search fan-out = ~2M tokens, $$). Re-run synthesis-only against saved `research_runs.agent_outputs`.
Reason: The app bills the API key, not Brandon's subscription; research is the expensive part, synthesis is pennies. Reuse run f92e438e's findings.

### diagnostic-ux-is-the-diagram-not-a-wizard
Trigger: designing the user-facing diagnostic UX (mockups, screens, the "money shot").
Rule: The interactive topology diagram IS the surface. Intake/directive/reading/verdict/handoff are STATES on the one diagram. Never step-cards + "Next" buttons.
Reason: Brandon rejected a 7-screen wizard as "feels like a chatbot." Approved surface: tap a part → its circuit isolates, directive lives on the wire, answer emerges on the map.

### route-craft-questions-to-persona-not-brandon
Trigger: a design fork is really a domain/UX-craft question (how a tech works, how a screen should behave), not a founder call.
Rule: Don't hand Brandon an A/B/C of implementation options — he's a technician, not an engineer. Route it to the right persona, synthesize, bring ONE plain-language path to gut-check.
Reason: Brandon rejected three triage UI options as "hacks/excuses" and said "ask the persona required, idk these technical terms, I'm not an engineer." The right answer came from the technician advocate, not from him picking.

### painless-language-is-a-hard-invariant
Trigger: writing any user-facing label, directive, transition, or empty-state for the diagnostic surface (any role).
Rule: Every word must be self-evident — the user never thinks about HOW to interact, what a button means, or what's next. Achieve it with FEWER words, never bloat. No jargon reaches the user.
Reason: Brandon made this non-negotiable mid-brainstorm: "the language throughout must be painless... shouldn't need to think about an interaction, button label, or what's next... without bloating with unnecessary content."

### diagnostics-is-one-elimination-asking-is-the-craft
Trigger: designing diagnostic UX, or worrying about whether to "ask" the tech anything (questions/checks/readings).
Rule: Diagnostics IS one elimination at a time. Asking the tech to do a check is REQUIRED, not a hack to avoid. The craft is HOW you ask — minimize friction per step and use motivation psychology so the tech WANTS to answer. Triage is just the first elimination, not a special "mode." Each turn: present the single best next elimination → painless → motivating → answer advances the map → repeat.
Reason: Brandon corrected me for inventing tricks (silent probes/tie-breakers) to avoid asking — "it's fine to ask them for questions, checks. You have to... it's all about how you do it without causing excessive pain/friction; use psychology to make them where they wanna give the answer." "The diagram is the diagnostic" means the asking happens ON the diagram in a painless rhythm, NOT that you never ask.

### confidence-is-a-true-compass-not-a-scoreboard
Trigger: designing, computing, or displaying any confidence/score in the diagnostic.
Rule: Confidence must be TRUE (built only from real checks the tech confirmed — never hard-coded/faked) AND it is the tool's private compass, not a scoreboard shown to pain the tech. Low confidence = the cue to surface the ONE answer/question/step/test that raises it most toward the most accurate diagnosis with the LEAST friction — never a scary number, never "refuse and stop." Confidence is felt as progress, not judgment. Universal across symptom/application. This reconciles "restraint" with "never give up": low confidence means quietly find the least-painful highest-yield next step.
Reason: Brandon on the live fake-confidence finding: "the confidence needs to be true, but we don't need to pain the user/tech because the confidence... if confidence is low [zoom out]: what step/test/question gets the confidence to the highest / most efficient + accurate diagnosis with the least pain." The live product was showing a hard-coded 0.85 to paying shops (legal-fatal). See memory diagnostic-loop-is-frictionless-elimination.


### browser-verify-chromium-version-drift
Trigger: writing a Node @playwright/test script to browser-verify locally (Playwright MCP is broken here).
Rule: Don't trust the bundled default — it requests a chromium version often NOT in the cache (this session it wanted chromium_headless_shell-1217; cache had 1223/1228 and the full Chromium.app was absent). GLOB ~/Library/Caches/ms-playwright for whatever chromium_headless_shell-<N> exists and pass it as executablePath. Headless-shell is enough to drive the DOM + screenshot. Brandon does NOT need Chrome to view localhost himself — Safari works.
Reason: Two failed launches this session ("Executable doesn't exist") before pinning executablePath. See memory local-browser-verification.

### flag-missing-data-in-an-image-immediately
Trigger: user shares an image/file expecting it carries specific data (codes, a list, a value) and it doesn't.
Rule: In the SAME turn, say explicitly "this image does not contain X." Never proceed or ask for it later as if unsent — the user may discard the source.
Reason: Brandon sent an Escalade topology screen (no DTC numbers); I asked for the codes a turn later as if he hadn't sent them. He'd already cleared the photos → the full code list was lost and trust eroded.

### field-data-is-fuel-to-build-from-not-a-fork
Trigger: Brandon feeds real-world field cases (trucks, complaints, codes, what he found) — especially out-of-coverage ones.
Rule: Treat each as seed/training input. Capture & structure it to GROW coverage toward predicting/prefilling what he'll see next. Never gate it behind a "should we cover this" fork.
Reason: He fed two real Rams; I framed it as a Ford-vs-Ram strategy decision. He's not asking permission — he's giving data so the tool gets ahead of his real work. Out-of-coverage = the ranked map of what to fill next, by what he's actually seeing.

### functional-verify-isnt-visual-verify
Trigger: calling a UI "browser-verified" because the flow completes (clicks → expected end state).
Rule: Also EYEBALL the default first-render a fresh user lands on (screenshot it). A completed flow does not mean the screen looks right.
Reason: The loop was handed off "browser-verified end-to-end" (11 checks → verdict worked), but the default P0087 diagram renders near-empty — one floating part, no wires — and read as "broken" to Brandon; the real wired circuit was hidden behind a "Whole system" toggle.
