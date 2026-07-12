# Annex — landing page current state (2026-07-11)

Supports `2026-07-11-brief-landing-remodel.md`. Facts only; the scope doc carries judgment.

## What exists (live at https://vyntechs.dev)

Single page at `app/page.tsx`, sections in `components/marketing/`: Nav → Hero (+ animated `HeroTerminal` example session) → Strip (claims marquee) → §00 Why → §01 Ladder (how it works) → §02 Gate (above/below-the-line example cards) → §04 Pricing → §05 Compare → §06 FAQ → FinalCTA → Footer. Design system: "Workshop Instrument" (`app/globals.css:1-8`) — bone canvas, single navy accent, Instrument Serif body + Inter Tight chrome + JetBrains Mono numerics.

Current voice (verbatim anchors):
- H1: **"Knows how the system works. Won't guess when it doesn't."** (`hero.tsx:16-18`)
- Why-section lede is a first-person founder story ("I got tired of guessing… I ran it on my own trucks until I trusted it. Now I'm opening it up." `why.tsx:14-24`) plus an anti-hype signature: "a working tool, not a venture promise. No customers being quoted, no logos being borrowed, no benchmarks being inflated." (`why.tsx:28-33`)
- Strip: "Built in the bay, not the boardroom" · "Says 'I don't know' out loud" (`strip.tsx`)
- FAQ is genuinely honest (no SOC 2 yet; no scan-tool integrations; what beta means) (`faq.tsx`)
- Stats: "95% confidence line before it'll OK risky work" · "3 questions max before it defers" · "0 specs it'll make up" (`hero.tsx:37-56`)

Conversion architecture: every CTA funnels to `/sign-up` ("Subscribe — $100/month"); **no other path exists** — no demo, no waitlist, no email capture, no video (`nav/hero/pricing/final-cta/footer`).

## Findings the remodel must resolve or consciously keep

1. **The page's honesty is load-bearing.** The founder voice, the refusal-as-hero framing, and the anti-hype signature are doctrine-true and rare. A remodel that loses this loses the moat. (Judgment: scope doc.)
2. **Brand split (owner gate):** page brands **Vyntechs**; "PlainWrench" appears nowhere in this repo. In `Vyntechs/influence`, PlainWrench is a *different, unbuilt* product (tech-note → customer-explanation writing aid) with its own "Counter-Ready" design system (cream/terracotta, Fraunces/Hanken Grotesk, explicit ban on monospace/terminal/gauges) — **incompatible** with the live "Workshop Instrument" system (monospace numerics, terminal motif, confidence dials). These are two products and two design languages, not one.
3. **Pricing story conflict (owner gate):** page + ToS sell **$100/technician/month** ("Vyntechs Bay"; "eight techs = $800"; pro-rated seats `terms.tsx:100-113`) while `README.md:5,74` says **per-shop** ("no per-seat math — one subscription per shop") and the customer-interaction doctrine's evidenced buyer behavior is shop-license (`auth-access.ts` gates Stripe at shop level). One truth must win before the pricing section is rebuilt.
4. **Single-lane conversion:** subscribe-or-nothing. For a skeptical, evidence-demanding buyer (doctrine: the Gate persona kills adoption on one fake), there is no low-commitment proof step (no demo, no example story/case to inspect, no "see a real session").
5. **Orphaned §03:** `reel.tsx` ("What you'll use" phone-screenshot showcase) is fully built with real assets and **not rendered** — the live section numbering literally skips 02 → 04.
6. **Copy drift on the page:** CTA label (`Start — $100/mo` vs `Subscribe — $100/month`), three product one-liners across meta/manifest/hero, phantom plan name "Vyntechs Bay", "Today queue" (a name the product doesn't use), and the site-wide undefined "confidence line" metaphor (full inventory: terminology annex §3).
7. **Claims needing real backing at launch:** "0 specs it'll make up", "95% line", "3 questions max" — strong, checkable claims; the remodel must keep them only where the product demonstrably enforces them (they map to real gating machinery — see doctrine).
8. **Hero terminal is honest-but-fake-adjacent:** the animated session is explicitly labeled "example session" in code comments, but on-page labeling is "Live · Bay 03" (`hero-terminal.tsx:138-145`) — doctrine's no-theater rule says label example content as example, visibly.
9. **`.design-shots/` is app-UI exploration** (confidence-meter prototypes, topology/session walks) — no landing-page design assets exist there. Prior marketing design exploration lives only in the `influence` repo (different product).
10. **Prior branch:** `origin/chore/landing-copy-rewrite` exists (unmerged); salvage-check during implementation, not during scoping.
11. Screenshots of the live page were not captured (Playwright write-sandbox restriction in the analysis agent); verbatim copy + structure above are code-extracted. Non-blocking for scope/prototype.

## Audience + positioning inputs (evidence, from existing docs)

- **Buyer:** the Owner-Tech — owns the shop, still wrenches, signs the checks; buys as a shop decision. **Kingmaker:** the Gate (master tech) — one fabricated thing = shopwide kill. **Daily heart:** the Climber (B-tech). (Doctrine §1, evidenced.)
- **Trust bar the audience already lives by:** Identifix's "124 techs confirmed" — numbers with a story; AllData's OEM accuracy; instant death for hallucinated confidence. (Doctrine App. B, cited field research.)
- **Voice rules already greenlit** (influence repo `marketing/strategy.md:41-46`, written for PlainWrench but audience-true): "Peer, not vendor · Warm, plain, human · Show, don't claim · Honest, not hype · Founder-real."
- **Anti-references** (design-context `QUALITY_BAR.md`): generic AI aesthetic (Inter-on-white, purple gradients, sparkles), orange-black "rugged" field-service cliché, wrench-as-logo, grease-monkey condescension.
