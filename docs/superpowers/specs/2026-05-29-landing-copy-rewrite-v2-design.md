# Landing copy rewrite v2 — design / record (2026-05-29)

Supersedes the voice of `2026-05-13-landing-copy-rewrite-design.md` for the public landing page (`app/page.tsx` + `components/marketing/*`). Visual layout is unchanged — this is a **copy/voice + ship-honesty** rewrite, owned by the agent (not a Claude Design job). Approval happened inline in chat; this doc is the record + the source of the exact copy + the handoff for the follow-on capture task.

## Why this rewrite

The audited "bone-paper v2" page sold a **cited-retrieval + confidence-gate** product. Two problems:
1. **Ship-only violation.** The live app shows **no sources** (the engine is explicitly instructed not to surface URLs), per-VIN history does not auto-resurface, and the "theory of operation" engine is a reasoning approach, not a point-at-it feature. The page claimed all three.
2. **Wrong story.** Brandon's real differentiator and voice were barely present.

## Locked positioning decisions (Brandon, 2026-05-29)

- **Spine:** lead with the *approach* — "knows how the system works, won't guess when it doesn't." Make the **refuse-to-guess / confidence gate** the live proof (it's the strongest *shipped* thing; the doctrine says it's what makes a skeptic evangelize).
- **Theory of operation / interactive topology:** real but **staging-only, not prod** (one seeded system, learning loop not wired). Decision: **"Approach now, diagram later."** Market the method (true today); do NOT show/promise the interactive diagram until it ships to prod.
- **Sources: removed entirely.** No citations, no "links back," no TSB/forum/web/"open web"/"corpus"/"retrieval"/"three-rung ladder" language anywhere. Tell **how the AI builds its understanding**, never **what it reads**. Reason: copyright self-protection (see memory `marketing-no-sources-copyright`). The model is invisible plumbing (no "AI" word, no model name).
- **Lockout angle: soft + matter-of-fact.** "The information is hard to come by and priced like it." Never imply the tool reproduces withheld OEM/manual data.
- **Social proof: generic, no named shops** ("used daily in real shops, still in beta"). No counts.
- **Pricing:** keep `$100/mo`; add the **near-cost structural reason** ("close to what it costs to run this well… not what we could get away with"). Do **not** publish the margin/$ figure.
- **Kill "co-pilot"** (banned word) in nav + footer.
- **Screenshots:** the current phone reel is captured from the `/design` fixture and prints the model name, a fake timer, a "4 SOURCES CITED" panel, a "14 STEPS" plan, and a hardcoded "RISK LOW." **Pull the reel from the page this PR** (publish nothing fake). The **root fix** — a real-app, reproducible capture pipeline — is the immediate next task (spec below).

## Ship-only ledger

**Claim (shipped, verified):** refuses destructive work below a DB-backed confidence line (default 95%, configurable); decline-or-defer with a real 3-ask cap; reasons about the specific vehicle and won't assume one vehicle is like another; won't state a spec it can't stand behind; tells you when it's reasoning from general principles; every closed case sharpens it for the next tech; phone-first glove UI; no scan-tool cable; photo-of-scan-screen capture; per-vehicle record you can look up; $100/mo.

**Do NOT claim (not shipped / removed):** inline cited sources or a "where I looked" view; the interactive topology diagram; "your bay's per-VIN history auto-resurfaces into a new diagnosis"; any data source by name; the model name; a live/learning topology graph.

## Final copy (source of truth for the edits)

### Nav (`nav.tsx`)
- Brand tag: `Diagnostic Co-pilot` → **`Built for working techs`**
- Links: How it works (#how) · Pricing (#pricing) · Compare (#compare) · FAQ (#faq)  *(drop "Surfaces"/#product — reel is pulled)*
- CTA unchanged (`Start — $100/mo`).

### Hero (`hero.tsx`)
- Eyebrow: **Still in beta · onboarding by invite**
- H1: **Knows how the system works. Won't guess when it doesn't.**
- Sub: *Built by a working tech who got tired of guessing. It works from how your vehicle's system actually works, not a copied manual, so it reasons about your truck and not some other one. When it isn't sure, it says so, tells you what to check, and won't green-light tearing into something it can't stand behind.*
- CTA: `Subscribe — $100/month` · `See how it works`
- Meta stats: **95** — confidence line before it'll OK risky work · **3** — questions max before it defers instead of guessing · **0** — specs it'll make up

### Hero terminal (`hero-terminal.tsx`) — rewrite SCRIPT_ROWS, source-free
Rows (kinds STEP / OBS / THINK / CONF / OK; remove all RUNG/corpus/open-web/TSB rows, no model name, no fake elapsed timer):
1. STEP — *Step 03 · Inspect cold-side intercooler boot at the throttle-body joint.*
2. OBS — *Tech: visible weep at lower-clamp seam, oily film on pipe.*
3. THINK — *Reasoning from how the charge-air system holds pressure on this engine.*
4. STEP — *Step 04 · Smoke test cold-side at 5 psi. Note where it escapes.*
5. OBS — *Smoke at lower clamp seam · 3.6 psi*
6. CONF — *Confidence 87% — above the line, clear to call.* (keep dial)
7. OK — *Replace lower clamp at the throttle-body joint.*

Header: keep `Session log · Live · Bay 03`; vehicle tag `P0299 · 2018 F-150 — example session`.

### Strip (`strip.tsx`)
Built **in the bay**, not the boardroom · Won't OK risky work it **can't stand behind** · Works from **how the system works**, not a copied manual · Says **"I don't know"** out loud · **Still in beta** · onboarding by invite

### §00 Why (`why.tsx`) — the one first-person beat
- H2: **I built this for my own work. Sharing it because it works.**
- Lede: *I got tired of guessing. The information that tells you how a system really works is hard to come by and priced like it — so every diagnostic tool I tried would rather make something up than admit it didn't know. A procedure that doesn't fit my build year. A spec pulled from thin air. That's not a wrong sentence. It's eight wasted hours, a torn-down assembly, a comeback I eat. So I built one that works from how the system actually works, and shuts up when it isn't sure. I ran it on my own trucks until I trusted it. Now I'm opening it up.*
- Sig: unchanged ("a working tool, not a venture promise… Try it on one stubborn vehicle and decide if it does it for you.")

### §01 How it works (`ladder.tsx`) — replaces the retrieval ladder
- Section num label: `§ 01 How it works`
- H2: **How the system works. Not how the dealer labeled it.**
- Lede: *Give it the vehicle and the complaint. It reasons about how that system actually operates on your truck — what each part does, how it all connects, what should happen when it's working right. It won't assume your vehicle works like a different one, and it won't state a number it can't stand behind. Where it's short on something, it says so and asks you.*
- Three slots (reusing the 3-node visual):
  1. **Works from how the system works** — *Starts from how that system actually operates on your vehicle. Not a copied manual, not a borrowed procedure.*
  2. **Reasons about your truck** — *Won't assume your vehicle works like a different one. The thinking is specific to what's in front of you.*
  3. **Asks when it's short** — *Needs something it doesn't have, it asks you for one specific check. Three, max — then it defers instead of guessing.*
- Side stats: **0** specs it'll make up · **95%** confidence line before risky work unlocks (configurable) · **3** asks, then it defers

### §02 The gate (`gate.tsx`) — de-jargoned, de-sourced
- Section num label: `§ 02 How it knows when to call it`
- H2: **It either clears the line, or it doesn't. No middle ground.**
- Lede: *Above the line, you get a precise next step and the reason for it. Below it, it tells you exactly what's missing — and won't recommend tearing into anything it can't stand behind.*
- Card A: eyebrow **Above the line · clear to call** · `P0299 · turbocharger underboost` · dial 87.0 · line `▲ 12.3 above the line · clear to call` · finding *"Cold-side intercooler boot, lower clamp. Smoke test localizes the leak to the clamp seam at the throttle-body joint."* · meta: `3.6 psi leak rate` / `42 min time to call` / `87% confidence`
- Card B: eyebrow **Below the line · won't call it** · `P0420 · catalyst efficiency` · dial 43.4 · line `▼ 31.6 below the line · won't call it` · finding *"Cat replacement not on the table yet. Need post-cat O₂ under warm cruise; that reading's missing."* · meta: `post-cat O₂ — missing` / `refused destructive action` / `43% confidence`

### Reel (`reel.tsx`) — PULLED
Remove `<Reel />` + import from `app/page.tsx`; drop the `#product` nav/footer links. Leave the component file dormant for the capture task.

### §04 Pricing (`pricing.tsx`)
- H2 unchanged: **One plan. Per technician. No bundles, no seat-haggling.**
- Lede: *We don't sell shop tiers or platinum bay-fleet packs. One account, one tech, one month. The price is close to what it costs to run this well — enough to keep the lights on, not what we could get away with. Scale it by hiring; cancel it when you don't.*
- Inclusions:
  - **Unlimited diagnostic sessions** — *No per-session caps, no per-VIN caps. Every session, every observation, every call.*
  - **Works from how the system works** — *It reasons about your specific vehicle from how the system actually operates — and won't guess when it's unsure.*
  - **Refuses risky work it can't back** — *Default 95% line. Below it, the destructive action is gone — not greyed out, gone.*
  - **Today queue** — *Your morning bay schedule: what's in progress, what closed today, what's due.*
  - **Per-vehicle history** — *Every session you close is saved to that vehicle's record, so it's there next time it's in your bay.*
- Fine print (billing / cancel / shop packages): unchanged.

### §05 Compare (`compare.tsx`)
- Lede: *Most diagnostic "assistants" are a general chatbot with a wrench icon, or a stale code-lookup table. Here's how we measure against what techs actually replace.*
- Rows (subj · chatbot · scan-tool · us):
  - **Refuses at low confidence** · None. Confidently invents specs, procedures, pinouts. · N/A. Returns a code definition, no stance. · **Won't recommend destructive work below the confidence line. Tells you what's missing.**
  - **Makes things up** · Freely. A wrong spec costs you a torn-down assembly. · N/A. · **Won't state what it can't stand behind. Says so when it's unsure.**  *(replaces "Cites sources")*
  - **Learns from real work** · No. Resets every chat. · No. Static lookup tables. · **Every closed case sharpens it for the next tech.**
  - **Asks before it assumes** · Rarely. Guesses and hopes. · No. Reads what the tool returns. · **When it's short on what it needs, it asks you for one specific check. Three, max.**
  - **Built for the bay** · Desktop chat UI. Glove-hostile. · Bench tool, not shop-floor. · **Phone-first. Thumb-reach. Readable in shop light.**
  - **Voice match** · "Hi there! I'd be happy to help you with…" · N/A. · *"Smoke test the cold-side intercooler at 5 psi. Note where it escapes."*
  - **Price per technician** · $20–40/mo, plus rework when it's wrong. · $1,800–4,200/yr per bench license. · **$100/mo flat. Cancel anytime.**

### §06 FAQ (`faq.tsx`)
1. *Does it actually refuse, or just nag me with a warning?* — unchanged (gone, not greyed; shows what would unlock it).
2. *Does it need my shop's history to be useful?* — **No. It works from how the system operates from day one. The work you close just makes it sharper over time.**  *(replaces the "corpus" Q)*
3. *Why no shop or enterprise tier?* — unchanged.
4. *Does it ever make the call for me?* — **Never. It surfaces and reasons; you decide. Every call is your name, your timestamp.**  *(replaces the "AI takes over" Q)*
5. *What scan tools does it integrate with?* — **None directly. No cable to Autel, Snap-on, Launch, or anything else today. You tell it what the scan tool shows, or snap a photo of the screen. Direct capture's on the list.**
6. *Where does my data live?* — unchanged (US, encrypted, never sold; SOC 2 not done; DPA on ask).
7. *Will it work for European, JDM, or fleet diesel?* — **Depends on the vehicle. It's strongest where a system is well understood; on thinner ground it tells you it's reasoning from general principles instead of pretending it's sure. Domestic and the big Japanese makes are solid.**  *(removes "open web")*
8. *What does "still in beta" mean?* — unchanged.

### Final CTA (`final-cta.tsx`)
- H2: **Stop guessing.**
- Sub: *$100 per technician, per month. One account, one path in, no salesperson on the other side. Bring one stubborn vehicle. If it doesn't change how you work, cancel — your sessions stay yours, always.*

### Footer (`footer.tsx`)
- Blurb: **A diagnostic for working technicians. Built in the bay, by a working tech, and shared because it works.** (drop "co-pilot")
- Drop the `#product` "Surfaces" link. Keep "Built in the bay, not the boardroom" mark.

## Implementation checklist
- [ ] `app/page.tsx` — remove `<Reel />` + import
- [ ] `nav.tsx` — brand tag, drop Surfaces link
- [ ] `hero.tsx` — eyebrow/H1/sub/stats
- [ ] `hero-terminal.tsx` — rewrite SCRIPT_ROWS (source-free), map new kinds to CSS classes
- [ ] `strip.tsx` — 5 items
- [ ] `why.tsx` — lede
- [ ] `ladder.tsx` — full §01 rewrite (header, lede, 3 slots, side stats)
- [ ] `gate.tsx` — header/lede/card eyebrows/findings/meta
- [ ] `pricing.tsx` — lede + inclusions
- [ ] `compare.tsx` — lede + rows
- [ ] `faq.tsx` — Q2/Q4/Q5/Q7 rewrites
- [ ] `final-cta.tsx` — H2 + sub
- [ ] `footer.tsx` — blurb, drop Surfaces link
- [ ] Verify: typecheck/lint/build clean; mobile 375–414px; grep the page for banned terms (`co-pilot`, `corpus`, `retrieval`, `TSB`, `source`, `cite`, `open web`, model name)

## Out of scope (flagged, not touched here)
- **`active-session.tsx`** hardcodes `Risk: low` + `req. ≥ 70%` on every step — a real in-app bug (the doctrine notes it). File separately.
- **§01 diagram** was built as a sources ladder; copy is repurposed onto its 3 slots. A Claude Design polish of the diagram itself can follow.

## Next task — real screenshot capture pipeline (the root fix)
Marketing imagery must be generated from the **real production app**, reproducibly, so it can't drift from what ships:
1. Seeded demo shop/vehicle with truthful, representative data (no customer VIN).
2. Automated capture via the existing browser-test tooling, at phone viewport, driving a real diagnostic session through **shipped flows only** (refusal, next-step + why, structured capture). No sources, no model name, no step count.
3. `screenshots.config.ts` stays as the swap-slot; its inputs become these real captures.
4. Restore `<Reel />` once real captures exist.
Underlying principle (kills the fabricated gate too): **fixture/preview/demo-default data must never render on a real-user or customer surface** — real data or honest empty state only.
