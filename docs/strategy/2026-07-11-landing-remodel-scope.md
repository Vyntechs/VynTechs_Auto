# Landing remodel — scope (v1, for Brandon's red-line)

**Date:** 2026-07-11 · **Status:** PROPOSED — gate 1 of the landing lane. Redline freely; everything here is cheap to change until the Figma gate.
**Inputs:** current-state annex (`2026-07-11-annex-landing-current-state.md`), customer-interaction doctrine (personas + trust principles), plain-language standard (counter voice), Brandon's product-scope framework (adapted to a single surface).

## 1. What this page is

The front door of a trust-first diagnostic tool, aimed at one reader: **the Owner-Tech** — owns the shop, still wrenches, signs the checks, and has been burned by every tool that guessed. Secondary reader over his shoulder: **the Gate** (master tech), who will try to catch it lying. The page's *one job*: **turn a skeptical owner into someone who brings us one stubborn vehicle.** Not "sign up" — *test us*. The subscription is the consequence of that test going well.

## 2. The promise (counter voice)

"It knows how your vehicle's system works, shows you where it looked, and refuses to guess when it can't back the call." Every section of the page is a different form of proving that one sentence.

## 3. Psychology architecture (all devices inspectable — see §8)

Ordered the way trust actually forms for this audience:

1. **Recognition before persuasion.** First screen mirrors the reader's lived cost — the comeback eaten on flat rate, the spec pulled from thin air — before saying anything about us. If he doesn't see his Tuesday in the first five seconds, nothing after matters.
2. **Costly signal as centerpiece.** Our signature move is the *refusal*: below the line, the destructive action is gone. Anyone can claim accuracy; refusing to answer is the one signal hype can't counterfeit. The refusal gets its own section, framed as the product's spine — this is also the moment the doctrine says techs text each other about.
3. **Proof he can poke, not claims he must trust.** The audience triangulates AllData + Identifix + forums for a living; their trust bar is "a number with a story" ("124 techs confirmed"). The page's core artifact: **one real case, shown honestly** — where it looked, what it read, what it called, labeled as the real case it is. Never a mocked-up fiction dressed as live product (current hero terminal's "Live · Bay 03" labeling gets corrected to visible example/real-case labeling — doctrine rule 5).
4. **Loss math, stated flat.** Flat-rate arithmetic is the buying emotion: a wrong call = a free re-do = personal income event. State it as arithmetic, never as fear theater (ethics floor).
5. **A low-commitment proof step.** Today the page offers subscribe-or-nothing. Add exactly one inspection path short of paying (replay of a real session, or a real customer story artifact to read). One, not three — decision paralysis is friction.
6. **Price as relief, not negotiation.** One number, the reason it's that number (existing copy's "close to what it costs to run this well" is the right instinct), cancel-anytime with your data kept. No tiers, no talk-to-sales.

## 4. What the page must feel like (design feeling)

**Recommended direction — evolve "Workshop Instrument," don't replace it.** The live system (bone paper, single navy signal, instrument serif, mono numerics) is already original and audience-native. Evolved target feeling: **a calibration certificate crossed with an instrument panel — a document that tells the truth and a tool that shows its work.** Paper that means something (spec sheets, torque cards, signed inspection tags) — not SaaS gradient-land, not orange-black "rugged" cliché, not terminal-cosplay.

Must never feel like: a generic AI product (Inter-on-white, purple gradients, sparkles); a Linear/Stripe clone; the influence repo's "Counter-Ready" system (that language belongs to a different product for a different reader); a venture deck; a tool that's smarter than its user. **The anti-familiarity bar:** if a visitor can name another site it feels like, the direction failed.

## 5. Required first impressions (falsifiable)

Within the first viewport + one scroll, an Owner-Tech should think:
1. "This was built by someone who's eaten a comeback."
2. "It shows its work — I could check this."
3. "It admits what it doesn't know. Nothing else I use does that."
4. "Nobody is selling me. There's no salesperson to even talk to."
5. "The price is one number I understand."
6. "I haven't seen a page like this." *(tested by §10's scrutiny audit)*

## 6. Page structure (prototype hypothesis — Figma will test it)

1. **Hero** — recognition line + promise + one honest proof element; CTA pair: primary "Bring it one stubborn vehicle" (subscribe), secondary = the §3.5 inspection path.
2. **The refusal** (signature section) — the below-the-line moment, shown.
3. **Where it looked** — the real-case evidence artifact, inspectable.
4. **The math** — comeback arithmetic vs $100, flat.
5. **How it works** — three steps, counter voice, no diagram-soup.
6. **The price** — one card, the why, the exit terms.
7. **Straight answers** — keep the honest FAQ (it's a trust asset today), tightened to the plain-language standard.
8. **Close** — "Stop guessing. Bring it one vehicle." Founder-signed.

Kept from today: founder Why story (compressed, moved near the close as the signature), the honest FAQ, the no-logos/no-inflated-benchmarks stance, the three enforcement-backed stats (only where machinery demonstrably enforces them). Killed: "Live · Bay 03" fake-live labeling, phantom "Vyntechs Bay" plan name, CTA label drift, undefined "confidence line" jargon (the concept stays — it gets *shown*, then named).

## 7. Copy register

Counter voice, public (per the plain-language standard): the best service writer you ever met, meeting a stranger. 6th–8th grade sentences; zero anti-vocabulary; every acronym earns its first use or gets cut; the word "AI" appears where honesty requires it, never as the selling adjective.

## 8. Ethical conversion standard (binding, and part of the pitch)

No fake urgency, scarcity, counters, testimonials, or invented numbers — the doctrine's no-theater rule applies to marketing exactly as it does to product. Working rule for "elite scrutiny": **no device on this page requires the visitor's ignorance to work.** Every persuasion mechanism (recognition, costly signal, loss math, proof artifact) works *better* when the visitor sees exactly what it's doing. That property — inspectable psychology — is what makes the page survive an elite marketing team's audit and is itself the brand.

## 9. Non-goals

Multi-page marketing site · SEO/content program · paid acquisition · pricing *strategy* changes (gate #2 owns the truth it displays) · app UI changes · blog · video production (the inspection path may *use* an existing real artifact; producing new media is its own decision).

## 10. Launch bar (what "done" means after the Figma gate)

- Every claim on the page maps to enforcement or a real artifact (claims audit checklist in the implementation plan).
- Real proof artifact has shop/customer consent, or the section restructures to not need one. **No placeholder ships.**
- Reading check: whole page at 6th–8th grade; zero anti-vocabulary hits.
- Scrutiny audit: an adversarial review (elite-marketing lens) finds no device that depends on concealment, no unverifiable number, no borrowed feeling.
- Desktop 1440 + 390 mobile, bay conditions honored (glare-legible contrast, thumb-reach CTAs).
- Brandon has approved: scope (gate 1) → Figma prototype (gate 2) → implementation plan (gate 3).

## 11. Open questions (owner gates — the prototype will carry placeholders marked as such)

1. **Brand on the door:** Vyntechs (live today) or PlainWrench (currently a different, unbuilt product in `influence`)? Prototype proceeds as **Vyntechs** unless redlined.
2. **Pricing truth:** per-technician $100 (live) vs per-shop (README/doctrine)? Prototype uses the live $100/tech **marked PLACEHOLDER-PENDING-DECISION**.
3. **The public proof artifact:** which real case/story may we show (consent)? Prototype uses a clearly-labeled placeholder built from the doctrine's excellent-vs-flat examples.
4. **Design direction:** evolve Workshop Instrument (recommended) or clean-sheet? Prototype v1 shows the evolved direction.

## 12. Assumptions (labeled)

US independent shops; Owner-Tech primary reader; the current page's honesty is an asset to amplify, not a problem to replace; beta/invite framing stays until Brandon says otherwise; no real customer data appears in the prototype.
