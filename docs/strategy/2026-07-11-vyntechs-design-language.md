# Vyntechs design language — THE SERVICE MANUAL (v3, for Brandon's red-line)

**Date:** 2026-07-11 · **Status:** PROPOSED — supersedes the *visual* carrier of v2's paperwork brand; the personality doc's voice and character rules still govern every word.
**Origin:** Brandon's red-line on v2 + the live app: "doesn't have enough personality… compared to other AI products it feels average… must be show-stopping… people researching who the founder is."

## 1. The honest diagnosis (why v2 and the app feel average)

The concept was original; the **materials weren't**. Warm cream paper + a high-contrast serif display with one italic accent + terracotta highlights is the single most common AI-generated design combination of 2025–26 — it appears on thousands of AI product pages regardless of subject. v2 used it (bone/Instrument Serif/oxide). The app uses it (`--vt-bg` bone, serif as the default body face, `app/globals.css:49,165`). A visitor can't say *why* it feels familiar — but it does, and familiarity reads as average. The fix is not more decoration. It's a different material world.

## 2. The direction, in one sentence

**Vyntechs is not marketed. It is documented.** The most trusted printed object in a technician's life is the factory service manual — the book that has no adjectives, no persuasion, and no errors it doesn't admit. Every Vyntechs surface (landing page today; product screens when Brandon approves migration) is built as the service manual *for the modern repair shop*: numbered sections, spec strips, exploded-view figures, symptom→test→action tables, index tabs, an authorization page at the end.

Why it stops each audience:
- **Owner-techs and master techs:** the FSM is home. A company that documents itself like a Toyota manual is speaking their most trusted dialect. Comfort is structural, not cosmetic.
- **AI engineers / peer devs / recruiters:** a landing page where every marketing claim carries a receipt tag that resolves to a named mechanism — provenance-as-UI — is the product's architecture performed by its own marketing. That's the screenshot that travels ("look at this landing page with footnotes to code paths").
- **Brandon-as-founder showpiece:** the conceit is falsifiable and disciplined, which is what makes people ask who built it.

## 3. Tokens

Palette (6, named; TICKET already exists in the app as `--vt-amber-500`):

| Token | Hex (≈) | Role | Rule |
|---|---|---|---|
| MANUAL | `#F7F7F4` | page field | cold service-manual white — never warm cream |
| CARBON | `#181512` | ink, headers, the centerfold | the only dark; dark = the machine speaking |
| TICKET | `#E8AC3F` | goldenrod job-ticket stock | **paper, never text** — tabs, part tags, SHIPPED chips |
| OXIDE | `#A35129` | stamps, warnings, margin notes, PLACEHOLDER tags | **mark, never large fill** |
| NAVY | `#1C3A5B` | the one action color | buttons and the accent H1 line only |
| TRACE | `#7FA3C8` | instrument signal on CARBON | never on light backgrounds |

Type (all Google-available; Barlow's heritage is literally California license-plate/highway lettering — automotive by birth):
- **Barlow Condensed Black/Bold, caps** — display and section heads. Poster-scale (H1 132/62), tracking tight.
- **Barlow Regular/Medium** — body. Plain, legible, unprecious.
- **JetBrains Mono** — anything measured, logged, or enforced: numbers, times, spec rows, receipts, margin notes. (Carryover from product.)
- **Instrument Serif Italic — the only serif on any surface is a human being speaking.** Customer story sentences and the founder's sign-off. Nothing else. (This demotes the app's serif-as-body-default; the serif becomes precious instead of ambient.)

## 4. Signature devices (each earns attention without requiring ignorance)

1. **FIG. exploded views** — provenance drawn as technical illustration. FIG. 1: one customer quote pulled apart into its four plies (the words / the evidence / the measurement / the name), leader lines to goldenrod part tags. It's the actual data structure, not an illustration — and the caption says so.
2. **Receipt tags → Appendix A** — claims on the page carry numbered RECEIPT tags; the appendix lists each claim's mechanism and status (SHIPPED — ENFORCED IN CODE / PLACEHOLDER — DECISION PENDING). Marketing with footnotes. The pending one is marked, which is the brand.
3. **The diagnostic table** (symptom → test it yourself → root cause → corrective action) — the page diagnoses the *reader's* shop, and every test runs on his own records, not our claims. Elite persuasion that works better the more he inspects it.
4. **Goldenrod index tabs** bleeding off the right edge — navigation as a thumbed manual; structure visible at any zoom.
5. **The carbon centerfold** (carried from v2) — the refusal: 43.4 with a dashed void where the button was; 87.0 with the earned button. The only dark section; dark = the machine's own page.
6. **The authorization close** (carried from v2) — signature line, date line, "Authorize the work." The reader is treated exactly like the shop's own customer.

## 5. Psychology map (all inspectable — the ethics floor is the pitch)

Declined jobs → diagnostic row 1 + FIG. 1. Eaten comebacks → row 2 + the centerfold. One-tech dependency → row 3 + "the shop keeps what the tech knows." Filing-cabinet software → row 4 + operating procedure. AI distrust → row 5 + 0-specs receipt. Demo-call dread → spec table ("DEMO CALL: NONE") + no chat widget. Data fear → straight answer incl. "no SOC 2 yet." Emptiness prevention: the tests in §02 are genuinely useful self-audits — the visitor leaves with value even if he never buys. **No device on any surface requires the reader's ignorance to work.**

## 6. Product-wide migration sketch (Brandon-gated; "could set the remodel through the entire project")

The app's bones cooperate: tokens already centralized (`app/globals.css`), TICKET ≈ existing `--vt-amber-500`, mono already owns data, modules already numbered ("01·"). Phased, each phase its own approved slice:
1. **Tokens:** bone → MANUAL; add TICKET/OXIDE roles; serif demoted from default body to human-voice moments (customer stories — which is what they are).
2. **Chrome:** app header becomes the manual masthead (doc number = shop name + date); screens get SECTION eyebrows; index-tab motif for primary nav.
3. **Screens:** ticket detail = the ticket's manual page (evidence plies as FIG. views); diagnosis = the operating-limit instrument; closeout = the authorization page. Empty states = manual pages ("NO CONDITIONS REPORTED").
4. **Marketing implementation** of v3 (gate 3 of the landing lane) with motion: plies settle into their stack on load (staggered, ~150ms); leader lines draw in on scroll; the centerfold's 87.0 counts up as evidence rows check in; **the absent button never animates — absence doesn't perform.** `prefers-reduced-motion` collapses all of it to instant state.

## 7. Never (additions to the personality doc's list)

Warm-cream + serif-display + terracotta hero (the AI default this doc exists to kill) · purple gradients / sparkles / "AI-powered" badges · dark mode as drama anywhere except the carbon centerfold · fake-live labels (EXAMPLE tags stay mandatory) · a serif word that isn't a human speaking · TICKET used as text color · roadmap promises on price surfaces.

## 8. Falsifiable bar

- **Thumbnail test:** at 10% zoom the page is identifiable by structure alone (index tabs, figure, carbon band, ruled tables) — v2 failed this; v3 passes.
- **Familiarity test:** no visitor can name another product page it feels like; specifically, it shares zero of the three 2025–26 AI-default looks.
- **Receipt test:** every claim is tagged-and-resolved in Appendix A or unclaimed; anything pending is visibly marked PLACEHOLDER.
- **Serif test:** grep the surface — every serif string is quoted human speech.

**Prototype v3 embodying this:** same Figma file — "Landing / Desktop 1440 — v3" + "Landing / Mobile 390 — v3" (v2 frames renamed *superseded*, kept for comparison).
