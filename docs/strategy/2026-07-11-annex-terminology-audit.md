# Annex — terminology audit (inventory of user-visible strings, 2026-07-11)

Supports `2026-07-11-brief-plain-language-terminology.md`; graded against `2026-07-11-plain-language-and-trust-copy-standard.md` (PROPOSED). Read-only crawl of `main`. **No replacements proposed here** — replacements come after the standard is approved.

## 0. Method + counts

- ~200 files read in full (app pages, screens, vt/intake/comeback/topology components, customer-language lib code, marketing/legal) + ~60 swept by grep (API routes, CSS `content:`, middleware, helpers).
- ~1,350 user-visible strings inventoried; **~620 flagged (≈560 unique)**: JARGON ≈250 · INCONSISTENT-NAMING ≈150 · INTERNAL-CONCEPT-LEAK ≈120 · ABSTRACT/LATINATE ≈80 · READING-LEVEL ≈25.
- Excluded as out-of-audience: `app/curator/**`, `components/curator/**`, `lib/curator|founder|research` (internal-operator tool) — but every leak of the word "curator" *into* shop-staff UI is flagged.
- Email/SMS templates: none exist in repo. Outbound customer text is AI-generated (`generateDeclineLanguage`, customer story) plus the SMS preview at `counter-work-order-confirm.tsx:137`.
- Spot verification: 5 random flagged rows re-read at cited path:line by the auditor, plus 15 sub-inventory re-checks — all matched.

## 0.1 The mechanical root cause: zero string centralization

No i18n / shared copy layer exists (nothing in `package.json`; no strings/copy/labels module). Instead:
- Private per-component label maps that never get shared (`TICKET_STATUS_LABELS` etc. in `components/screens/ticket-detail.tsx:6-45`; `COVERAGE_LABELS` `adaptive-diagnostic-entry.tsx:11-17`; `ROLE_LABELS` `components/vt/team-section.tsx:37-49`; more) — so the same enum renders humanized on one screen and raw lowercase on another (`manual-quote-builder.tsx:672`).
- Duplicated per-component error humanizers (`team-section.tsx:388-416`, `quick-ticket.tsx:63-76`, `counter-intake.tsx:60-75`, `lib/shop-os/quote-builder-ui.ts:377-385,480-503`…) while other components render raw API codes or `response.text()` (`repair-ask-form.tsx:37`, `outcome-capture.tsx:165`, `decline-or-defer-live.tsx:104`).
- 140+ snake_case machine codes returned by `app/api/**` with no shared code→copy translation layer.
- Exactly **one** shared user-visible constant in the whole app: `CUSTOMER_STORY_WAIVER` (`lib/shop-os/customer-story-contracts.ts:7-8`).
- AI-generated customer copy is governed only by prompt constants (`lib/ai/prompts.ts:155-165`; `lib/ai/customer-story.ts:101-105`).

**Implication for the fix:** application slices should introduce a shared label/copy layer as they go (per-surface, not big-bang), or the same drift regrows.

## 1. Shop-staff UI — flagged strings (condensed; full locations preserved)

| Term/String | Where (path:line) | Why |
|---|---|---|
| Work-unit named 5 ways: `Work Orders` / `Sessions` / `New work order` / `Create repair order` / `RO {n}` / `ticket` / `service job` | `app/(app)/sessions/page.tsx:27,66`; `sessions/new/page.tsx:28`; `today-home.tsx:83,95,191`; `counter-intake.tsx:71,73,287,315,354,631,710`; `counter-work-order-confirm.tsx:55`; `ticket-detail.tsx:54,73`; `manual-quote-builder.tsx:542,552,1204` | INCONSISTENT — 2–3 names inside single screens |
| Diagnostic unit named 4–5 ways: `session` / `case` / `diagnosis` / `job`; status `Live` vs `Open` for same state | `vehicle-strip.tsx:29`; `active-session.tsx:49`; `sessions/page.tsx:77,88,154`; `new-session-form.tsx:58,64,173,227`; `abandon-button.tsx:22`; `repair-phase-view.tsx:181,203`; `follow-up-panel.tsx:137`; `ticket-detail.tsx:230`; `outcome-capture.tsx:165`; `vehicle-history.tsx:169` | INCONSISTENT — switches mid-flow |
| Raw status fallbacks render enums (`declined` etc.); `Closed · {n}` group contains non-closed | `sessions/page.tsx:100,171`; `vehicle-history.tsx:186` | LEAK |
| UUID fragments as copy: `Session · {id.slice(0,8)}` ×4 template variants + `{shopId.slice(0,8)}` | `active-session.tsx:49`; `diagnosis-proposed-review.tsx:25`; `repair-phase-view.tsx:35`; `decline/page.tsx:37`; `outcome/page.tsx:56`; `closed-case-summary.tsx:21`; `declined-no-repair-close.tsx:51`; `sessions/page.tsx:32` | LEAK |
| `Defer for curator review` / `Deferred` / `Curator` menu vs `Reviewer →` vs "curator console"/"Incomplete bucket" in a confirm dialog | `decline-or-defer-live.tsx:28`; `sessions/page.tsx:155`; `app-header-menu.tsx:95`; `today-home.tsx:63,77`; `abandon-button.tsx:22`; `team-section.tsx:380,392` | JARGON + LEAK + INCONSISTENT |
| Gating/ML vocabulary as primary copy: `Gating · {riskClass} class`, `GATE` dial, `Below gate · {pct}%`, `−{n} BELOW THRESHOLD`, `gap: {confidenceGap}`, `based on AI reasoning + retrieval`, `Confidence-weighted plan`, `Gather more low-risk data`, `non-destructive observation`, `Risk class: Destructive` | `decline-or-defer.tsx:232,277,326-329`; `decline-or-defer-live.tsx:22,23,155`; `confidence-block.tsx:29`; `active-session.tsx:85,136-142`; `decline/page.tsx:39`; `diagnosis-proposed-review.tsx:106-112`; `desktop/plan-tree.tsx:26,38`; `components/vt/risk.tsx:13,15` | JARGON |
| Lock-in state-machine language: `Lock in diagnosis & start repair →`, `Locking…`, `lock-in failed ({status})`, `repair mode` | `lock-diagnosis-button.tsx:28,42`; `repair-phase-view.tsx:52,56`; `diagnosis-proposed-review.tsx:146,157`; `wizard-finding-card.tsx:47`; `curator-guided-wizard.tsx:93,102` | JARGON |
| Bare all-caps status flags `NOT PREPARED` / `NO REPAIR APPROVAL` / `OPEN` / `UNASSIGNED` | `quick-ticket.tsx:496-499` | LEAK |
| "Prepare(d)" as proper-noun workflow verb; pipeline chains ("Draft quote lines now. Prepare, send, approval, delivery, and closeout stay blocked until this ticket is reconciled.") | `manual-quote-builder.tsx:575,792,829,835,869`; `quick-ticket.tsx:404,515`; `ticket-detail.tsx:104` | JARGON + READING |
| `Server truth did not match…` ×3 + `…load current server truth` + `Loading story truth…` | `manual-quote-builder.tsx:427,1049,1114,1179`; `tickets/[id]/quote/page.tsx:46` | LEAK — engineering idiom at the money screen |
| `Quote is busy`; catch-all `Review the visible fields, then refresh and retry.` reused for ≥7 unrelated failures | `quote/page.tsx:45`; `lib/shop-os/quote-builder-ui.ts:496,500`; `manual-quote-builder.tsx:221-506` | LEAK + vague |
| DB register in the builder: `Persisted work`, `immutable`, `Quote ledger` vs `Job ledger`, `Live quote tape`, `Authorization strip` | `manual-quote-builder.tsx:583,584,791,1201,1202,1235`; `ticket-detail.tsx:196,197,199` | JARGON/LEAK |
| Job templates named 3 ways: `Canned jobs` / `Saved work` / `the library` | `manual-quote-builder.tsx:591-645`; `canned-jobs-section.tsx:37-150`; `quick-ticket.tsx:417,463`; `settings/shop/page.tsx:44,45`; `lib/shop-os/canned-jobs-ui.ts:159,195,197` | JARGON + INCONSISTENT |
| Raw lowercase enums where other screens humanize: `{job.kind} · {workStatus}` | `manual-quote-builder.tsx:672,1495-1497`; `canned-jobs-section.tsx:121,158` vs `ticket-detail.tsx:19-37` | LEAK + INCONSISTENT |
| Skill tier: `A-tech/B-tech/C-tech` vs `Tier 1/2/3` vs `A-tier` vs `wrenching tier` vs `skill tier`; "below the A-tier required…" | `ticket-detail.tsx:26-28,249`; `team-section.tsx:46-48,394,406`; `tech-selector/index.tsx:223`; `today-jobs-board.tsx:402`; `counter-intake.tsx:658` | INCONSISTENT + LEAK |
| Vendor/model leaks: `Supabase rejected the invite…`; `claude-sonnet-4-6` rendered on loading screen; `Stripe customer portal` | `team-section.tsx:412`; `tree-generating.tsx:14,92`; `settings/(admin)/billing/page.tsx:50-51` | LEAK |
| Counter-search programmer-speak: "cached rows… we'll reconcile", "re-fetch", `Searching · {ms} ms`, `The create-new path is never blocked.` | `intake-search/dropdown.tsx:99,112,151,285,299-301,314,324,333` | JARGON + LEAK |
| `Decode VIN` family; `Diagnostic authorization` register; `authorization` vs `approval` for one concept | `counter-intake.tsx:162,187,415,448,581-603`; `ticket-detail.tsx:178`; `repair-phase-view.tsx:106-149` | JARGON/ABSTRACT + INCONSISTENT |
| Capture/log house verbs + forensic register: `Capture ambient conditions`, `Ambient °F`, `{n}% RH`, `capture evidence`, `Log observation` | `ambient-conditions-capture.tsx:53,114,187,204,244,273`; `photo-capture.tsx:15,16`; `adaptive-diagnostic-entry.tsx:115`; `log-button.tsx:35`; `active-step-form.tsx:81,119` | JARGON |
| HTTP/raw-error leaks: `Upload failed ({res.status})`, raw `err.message` | `audio-capture.tsx:84-153`; `photo-capture.tsx:45,52`; `video-capture.tsx:56,62`; `subscribe-client.tsx:24`; `decline-or-defer-live.tsx:104,133` | LEAK |
| Story workspace: `Events selected · {n} of 20` / `Artifacts selected` (DB nouns); story named 5 ways in one file (`Diagnostic story` / `Customer-ready finding` / `customer story` / `short story` / story truth); `Published-wizard stories are not supported yet.`; `Pending human review` | `manual-quote-builder.tsx:996,1131,1140-1179` | LEAK + INCONSISTENT + JARGON |
| Misc: `Tech quick` / `Legacy repair order` source labels; `Quick quote` vs `Quick ticket`; Topbar `Shop` vs `Counter`; `product surface` in viewport gate; `Wires up in Counter 04` tooltip; `My Jobs` vs `dashboard` vs `Today`; `Deactivated` vs `Retire`; "shop admin" (role that exists nowhere); `Subscribe` vs `/sign-up` vs `Create account · Continue to checkout`; "Nothing here yet. Each deploy will land a plain-English changelog entry here."; window.confirm with "Incomplete bucket / curator console / can't be undone"; topology `{overlay.kind}` kebab-case enum rendered live (severe); `from theory` provenance labels; "needs field check" ×10 vs "needs field verification" | `ticket-detail.tsx:14-16`; `quick-ticket.tsx:284,285,292`; `tickets/new/page.tsx:11,40`; `desktop/viewport-gate.tsx:44,67-68`; `counter-work-order-confirm.tsx:65`; `closed-case-summary.tsx:159`; `whats-new.tsx:13,36`; `team-section.tsx:152-203`; `deactivated/page.tsx:64,75`; `sign-up-form.tsx:92,104,211`; `abandon-button.tsx:22`; `slot-box-overlay.tsx:30`; `topology-node.tsx:60,65`; `topology-detail-panel.tsx:63-66,108`; diagram-kit (10 sites) | all classes |
| 140+ snake_case API codes with untranslated fallbacks (`open_session_limit`, `specificity_required`, `version pin mismatch`, `malformed lock-in payload`…) | `app/api/**` e.g. `api/sessions/route.ts:77,107,131`; `api/sessions/[id]/wizard-state/route.ts:30-45`; `lib/sessions.ts:435,653`; rendered raw at `repair-ask-form.tsx:37`, `outcome-capture.tsx:156-165` | LEAK — no code→copy layer |

## 2. Customer-facing (vehicle-owner) — flagged strings

| Term/String | Where | Why |
|---|---|---|
| `CUSTOMER_STORY_WAIVER = 'If you choose not to proceed, the diagnosed issue remains unresolved.'` — the one sentence every customer reads | `lib/shop-os/customer-story-contracts.ts:7-8`; injected `lib/shop-os/quotes.ts:584-589`; rendered `manual-quote-builder.tsx:1170,1174` | READING + ABSTRACT — passive, latinate; untailored. Legal-neutral floor: rewrite may simplify, never escalate threat (gated slice) |
| Label `If deferred` over field `whatItMeansIfWaived` whose sentence says "choose not to proceed" — three framings of one customer decision | `manual-quote-builder.tsx:1170,1174`; `customer-story-contracts.ts:52` | INCONSISTENT + JARGON |
| Label `Proof · {n} sourced observation(s)` over field `howWeKnow` | `manual-quote-builder.tsx:1173` | INCONSISTENT + JARGON — field name is the better copy |
| `What you told us` / `What we found` / `What we recommend` | `manual-quote-builder.tsx:1167-1175` | OK — the anchor vocabulary; keep |
| Third vocabulary layer in the AI prompt (`concern/root cause/recommendation/waiver`) | `lib/ai/customer-story.ts:101-105` | INCONSISTENT — 3 layers for 4 fields |
| Decline-language prompt still instructs for "declined" though decline flow was removed 2026-05-09 — AI can still write "declined" wording to customers | `lib/ai/prompts.ts:155`; `lib/gating/decline-language.ts:10-13,20` | INCONSISTENT (engine-adjacent; own gated slice) |
| Prompt context feeds gating vocabulary to the customer-language AI (`Diagnostic gap:`, `Risk class blocking commit:`); "asynchronous expert review (24-72h)" vs UI's "curator review" | `lib/gating/decline-language.ts:26-30` | LEAK + INCONSISTENT |
| Decline/defer/waive family — **15 spellings over 2 colliding concepts** (tech-defers-diagnostic vs customer-declines-quote): `decline`, `defer(red)`, `declined_no_repair`, `whatItMeansIfWaived`, `waiver`, `If deferred`, `No repair authorized`, `Close without repair`, `Confirm no repair`, `Keep open`, "holding the job", "choose not to proceed", dead `E · EXIT` spoke; DB enums still carry removed `'decline'`/`'declined'` | `lib/db/schema.ts:224,758,765-773`; `decline-language.ts:20`; `repair-authorization.ts:16,92-103`; `quotes.ts:85`; `decline-or-defer(-live).tsx`; `declined-no-repair-close.tsx:31-116`; `repair-phase-view.tsx:130-139`; `ticket-detail.tsx:44`; `sessions/page.tsx:155` | INCONSISTENT — worst cluster in the repo, customer-visible |
| Quote-line abbreviations customers may read (`Qty`, `hr`, `core charge` unexplained, `Taxable subtotal`); customer decision rendered with internal version numbers (`Approved · V{n}` / `Record declined`) | `manual-quote-builder.tsx:801-825,1198-1241,1452,1464-1466` | mild JARGON + LEAK |

## 3. Marketing + legal — flagged strings

| Term/String | Where | Why |
|---|---|---|
| `confidence line` / `above/below the line` / `95% line` — site-wide core metaphor, never defined once | `hero.tsx:40,43`; `ladder.tsx:90-103`; `gate.tsx` passim; `pricing.tsx:14,59`; `compare.tsx:12,15`; `faq.tsx:6`; `hero-terminal.tsx:42,44` | JARGON — insider term as the main pitch device |
| Unit-of-work drift mirrors the app: `session` vs `case` vs `the work` | `hero-terminal.tsx:138`; `pricing.tsx:5,6,59`; `compare.tsx:27`; `faq.tsx:15` | INCONSISTENT |
| Three competing one-liners; `assistant` used in layout meta while `compare.tsx:76` mocks "assistants"; "AI master tech" collides with ASE Master Technician | `app/layout.tsx:27`; `app/manifest.ts:7`; `hero.tsx:16-17` | INCONSISTENT |
| Phantom plan name `Vyntechs Bay` vs "One plan"/no-tiers claims; CTA drift `Start — $100/mo` vs `Subscribe — $100/month`; `Today queue` (name the product doesn't use) | `pricing.tsx:17,28,37,56`; `nav.tsx:7`; `faq.tsx:18` | INCONSISTENT |
| SaaS licensing vocabulary for shop owners: `seat`, `seat-haggling`, `30+ seats` | `pricing.tsx:53,85,122-125`; `faq.tsx:19`; `terms.tsx:101,111` | JARGON |
| Engineering leaks: `destructive-action button`, `confirm modal`, `State resets per chat`, `STEP/OBS/THINK/CONF` badges, "the surface is still moving… hardening", `configurable`/`hard refusal` | `faq.tsx:6-9,39`; `compare.tsx:25,26`; `hero-terminal.tsx:13-42`; `ladder.tsx:95,103` | JARGON + LEAK |
| Legal terms-of-art in a "plain-English" policy: `sub-processors`, `data controller/processor`, `indemnifies and holds harmless`, `fails of its essential purpose`, `corpus entries`, `derivative works`, `pro-rated`, `survive termination`, "the auto-renewal doesn't fire" | `privacy/page.tsx:122-416`; `terms/page.tsx:110-436,506-512` | JARGON + READING (headings above them are good counterweights) |
| Reading-level: hero body ~55 words / 3-clause sentence; fragment "Needs something it doesn't have, it asks you…"; vague "one path in" | `hero.tsx:20-24`; `ladder.tsx:65-66`; `final-cta.tsx:13-18` | READING |
| Brand/domain drift: `brandon@vyntechs.com` vs `vyntechs.dev`; Vyntechs vs "PlainWrench" (0 hits in repo) | `privacy/page.tsx:26-31`; `footer.tsx:95` | INCONSISTENT — owner decision |

## 4. Naming clusters (the 12 the lexicon must resolve)

1. Work-unit (5 names) · 2. Diagnostic unit (5 names + Live/Open) · 3. Decline/defer/waive (15 spellings, 2 concepts) · 4. Job templates (canned/saved/library) · 5. Skill tier (3 schemes + 2 field names) · 6. Customer story (5 names, 3 vocabulary layers) · 7. Internal reviewer (curator/Reviewer/"expert review") · 8. "needs field check" vs "needs field verification" · 9. `/today` destination (My Jobs/dashboard/Today) · 10. Sign-up flow (Sign up/Subscribe/billing) · 11. Brand + one-liner (Vyntechs/PlainWrench; 3 descriptions) · 12. Authorization vs approval.

## 5. Top-15 worst offenders (fix-first list)

1. Work-unit named 5 ways — every service-writer screen. 2. Diagnostic unit named 5 ways. 3. Decline/defer/waive family (customer-visible). 4. `CUSTOMER_STORY_WAIVER` sentence (the one guaranteed customer read). 5. "Server truth" error family at the money screen. 6. Raw enum/status leaks (live diagram `{overlay.kind}` severe). 7. UUID fragments as copy. 8. Curator leaks into tech UI. 9. Gating/confidence vocabulary (app + marketing share the undefined metaphor). 10. Canned/Saved/library triple-name in the quote builder. 11. Tier triple-scheme. 12. Vendor/model leaks (Supabase, claude-sonnet-4-6, Stripe). 13. Quote-builder engineering register (Persisted/immutable/ledger/tape/strip). 14. Marketing identity drift (3 one-liners, phantom plan, CTA drift, brand question). 15. Field-check/verification split + counter-search programmer-speak.
