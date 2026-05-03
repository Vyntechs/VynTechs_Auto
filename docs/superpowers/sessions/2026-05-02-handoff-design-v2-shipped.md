# Vyntechs MVP — Handoff (2026-05-02, design v2 shipped)

Supersedes `2026-05-02-handoff-phase-i-shipped.md`. Slim format per AGENTS.md.

## Resume

1. `cd /Volumes/Creativity/dev/projects/vyntechs/.worktrees/mvp-implementation`
2. Read `AGENTS.md`. Read `docs/superpowers/ui-design-toolkit.md` if the chosen task has UI.
3. Verify baseline: `pnpm test && pnpm exec tsc --noEmit`. Expect **195/195**, exit 0.
4. **Pick next phase per "Next session" below.** Recommended: **J → K → L** (Phase N tablet + Phase O desktop deferred until Brandon greenlights — see carryover).

## State

- Branch `feature/mvp-implementation`, **71 commits ahead of `main`**, no uncommitted changes.
- Tests **195/195**, tsc clean, build untested.
- Supabase project `ynmtszuybeenjbigxdyl` ("Vyntechs Auto") us-east-1 ACTIVE_HEALTHY. Migrations 0000–0007 applied. Storage bucket `artifacts` (private) live; `supabase/storage-setup.sql` committed for fresh-project repro.
- Dev user `brandon@vyntechs.com` / `Benny0812` (force-confirmed). Same shop / profile as prior sessions.
- 5 commits this session — design system pivot from dark Graphite to bone canvas + navy signal accent + serif body, full screen ports, instrument cluster, design closure on previously-unstyled surfaces.

## What shipped this session

**Design v2 — bone canonical, signal-navy accent, instrument cluster (5 commits):**

- **`refactor(design): bone-canonical foundation + signal-navy accent`** — `app/globals.css` rewritten: bone is canonical bg/surface/fg, `--vt-amber-*` renamed to `--vt-signal-*` (legacy name resolved to navy — fixed), `--vt-font-body` now resolves to Instrument Serif. Removed `[data-theme="light"]` block (bone IS the canonical theme). `components/vt/vt.css` full rewrite to match `design_handoff_vyntechs_design_system/` kit: bone surfaces, hairline borders, serif buttons, mono caps pills, tree rail with proper node dots, full `.dod-*` instrument cluster styles including the non-negotiable graph-paper grid background.
- **`feat(screens): port phone screens to bone canvas + serif typography`** — today-home (Bell icon, isFirst/isLast row props), tree-generating (italic 30px serif, mono meta tracking), active-session (serif step title 22px + italic rationale), active-step-form (textarea on bone-100 + serif), outcome-capture (footer bone-50 hairline). `/design` preview wrapper bone radial-gradient.
- **`feat(decline-or-defer): instrument-cluster surface`** — full SVG dial with engraved tick ring, gate arc, hatched deficit, quivering needle; center cluster readout; "DESTRUCTIVE CLASS · ${type}" eyebrow on bezel rim; printer-tape retrieval ledger (clip-path scallops); three compass spokes (NW · LOW EFFORT / E · EXIT / SE · RECOMMENDED) on grid-template-areas with bearing spanning all rows; defer spoke navy-lit; engraved-plate footer. Props extended with `confidence`/`gate` (default 73/85), `riskLabel`, `tapeBody`, `tapeTimestamp`, `engravedPlate`, optional `reason`+`meta` per option. Tests query spokes by title via `getByText().closest('button')`.
- **`feat(pages): close design gaps on the previously-unstyled surfaces`** — five surfaces ported from plain HTML to Workshop Instrument:
  - `/` — landing with eyebrow header, clamped serif gravity headline, italic sub, btn-primary + btn-secondary CTAs, mono-caps footer
  - `/(auth)/layout.tsx` (new) — shared auth shell with VYNTECHS wordmark + ← Back, centered 360px column
  - `/sign-in` — eyebrow / serif h1 / italic sub / `.field` form / `.ai-reject` for errors / footer with create-account + forgot-password links
  - `/sign-up` — same shell, green-rail success block on signup ok
  - `/sessions` — AppHeader with technician + shop-id meta, dark Plus-icon CTA, modules grouping open vs closed, queue-row pattern, italic-serif empty state
  - `/sessions/new` — AppHeader with ← Back, `.field` form for vehicle (year mono, make/model serif, optional engine + mileage) + complaint, "Generating tree from corpus" inline state with hairline progress while submitting
- **`vt.css` hoisted into root layout** — was only loaded when a route imported a vt component; new pages without vt-component imports rendered unstyled. Now loaded on every route.

Each commit's review iteration verified at 390×844 phone viewport via Chrome DevTools MCP.

## Carryovers (track or address next session)

- **Phase N (tablet) and Phase O (desktop) explicitly deferred 2026-05-02 by Brandon** — "let's not build tablet mode yet nor desktop mode yet." Resume only when Brandon greenlights. The recommended phase order from prior handoff (N → J → K → L) is now **J → K → L**.
- **`DeclineOrDeferLive` doesn't pass numeric `confidence`/`gate` to the instrument cluster** — defaults 73/85 take over until real gate-decision data flows through. Only visible in the dial readout (cluster, deficit calc, GATE arc position) — text headline + spokes use the existing `gap`/`confidenceGap` strings, so the live experience is correct minus the dial accuracy. Wire `confidence` + `gate` from `gateProposedAction()` payload through `DeclineOrDeferLive` props when picking up Phase L or first field test.
- **`today-home`'s active-row DTC chip shows sliced customer complaint** ("LOSS OF POWER UP HILLS,") instead of an actual DTC. Real fix needs DTCs in the `IntakePayload` — that's a data-model change not a design port. Track for the same field-test follow-up that wires Phase L's audio transport.
- **I8 audio transport API-pending** — unchanged from prior handoff. `transcribeAudio` will throw `BadRequestError` against live Anthropic API; worker catches and sets `extractionStatus='failed'`. Phase L precondition.
- **`requestedArtifact` clearing trusts Sonnet entirely** — unchanged from prior handoff. MVP-acceptable.
- **Inline auto-trigger blocks the HTTP response** for high-signal kinds — unchanged from prior handoff.
- **`router.refresh()` on artifact upload** triggers two server fetches per step — unchanged from prior handoff.
- **Pooler `DATABASE_URL` still broken** — unchanged. Vercel deploy will fail until pooler URL is fixed before Phase S.
- **NewSessionForm now has loading state** (this session) but no toast/notification on 409 collision case other than redirect to existing open session. UX-acceptable for MVP.
- **Phase F a11y** — 2 unlabeled fields in `OutcomeCapture` — unchanged.
- **Custom SMTP for `support@vyntechs.com`** — unchanged.
- **`createProfile` in `lib/db/queries.ts`** is dead code — unchanged.
- **Rung-2 kind set hardcoded** in `lib/sessions.ts` — unchanged.
- **`audio/m4a`** in `TRANSCRIBE_MIME_TYPES` is non-IANA — unchanged.
- **No bucket-level RLS policies on `storage.objects`** for `artifacts` bucket — unchanged. Service-role key bypass by design; document before Phase P.
- **`tree-engine.ts` doesn't apply withRetry-skip-terminal-errors fix** — unchanged.
- **Phase G/Stripe billing** — pages not designed yet. Brandon: "no payment surface until ready to ship."
- **Settings, /settings/billing, /settings/shop, comeback/follow-up surface** — listed in design brief but Claude Design package only included the 5 phone screens (today, intake, generating, active, decline, outcome). When Brandon designs them in Claude Design, point me at the package directory.

## Design v2 reference

- **Original design package archive**: `.design-from-claude/2UJtnId7e4pQZa1DbwpQew/` (gitignored; re-fetchable from `https://api.anthropic.com/v1/design/h/2UJtnId7e4pQZa1DbwpQew`).
- **Canonical kit files** (the post-iteration version with the instrument cluster): `vyntechs-design-system/project/design_handoff_vyntechs_design_system/`. The older `project/ui_kits/` subdirectory has the simpler decline-or-defer with option cards — ignore that one.
- **Chat transcript**: `vyntechs-design-system/chats/chat1.md`. Contains Brandon's iteration history including the explicit "I don't like cards or pills" pivot that produced the instrument cluster.

## Next session — likely focus

Per the plan, recommended order: **J → K → L**. (Phase G/Stripe, Phase N tablet, Phase O desktop deferred — Brandon decides when to resume.)

- **Phase J — Photo Storage Tiering (6 tasks):** cost discipline now that I1's `storageTier` column is in place. Hot → warm → cold.
- **Phase K — Cross-Shop Corpus.** Was blocked behind I9 (extracted artifact data is the corpus input).
- **Phase L — Bounded Internet Retrieval.** Closes the loop on `whatWouldClose` (Sonnet does its own research first, then asks the tech for the smallest delta). Also unblocks the I8 audio path if Whisper is wired here. Wire `confidence`/`gate` flow through `DeclineOrDeferLive` here too.

Recommend Brandon `/clear` before starting the next phase and resume from this handoff in a fresh session.
