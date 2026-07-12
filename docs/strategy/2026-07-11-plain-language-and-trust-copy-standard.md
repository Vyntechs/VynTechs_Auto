# Plain-language & trust copy standard — PROPOSED

**Date:** 2026-07-11
**Status:** PROPOSED — nothing in the product changes until Brandon approves this standard. Once approved, it governs every user-visible word.
**Relationship to existing doctrine:** This extends `2026-05-29-customer-interaction-doctrine.md` (which stays authoritative on personas, trust principles, and interaction quality). That doctrine defined *don't lie*. This standard defines *speak plainly* — same moat, second layer.
**Companion:** `2026-07-11-terminology-audit.md` (the inventory of today's offenders, with locations).

---

## 1. Why words are a product surface here

Three readers, none of whom owe us patience:

- **The tech / service writer** (shop staff): working gloved, in glare and noise, often without a college vocabulary — and sharp enough to resent being made to feel otherwise. Every unfamiliar word is a tap-equivalent: friction. The doctrine's "two taps to the answer" has a language twin: **two seconds to the meaning.**
- **The vehicle owner** (the shop's customer): anxious, money on the line, and pre-loaded with distrust of repair shops. They can't verify the mechanics — they can only verify whether they *understood* and whether anyone *played them*. Words are the only trust instrument they can inspect.
- **The prospect** (shop owner on the landing page): allergic to SaaS hype-dialect. Talks like the bay talks.

A word that sends any of them to a dictionary — or worse, makes them *feel* dumb — spends trust we sell as our moat.

## 2. The reading bar

- **Grade level:** every user-visible sentence reads at 6th–8th grade. Not because readers are limited — because nobody at a counter or under a hood wants to parse prose.
- **The counter test (the core rule):** *if a good service writer wouldn't say the word out loud across the counter, it doesn't ship.* "Diagnostic session" fails; "diagnosis" passes. "Artifact" fails; "photo" passes. "Defer" fails; "hand it to a senior tech" passes.
- **One idea per sentence.** Short sentences. Verbs over noun-stacks ("we tested the battery," not "battery testing was performed").
- **Same thing, same name, everywhere.** One concept never has two names across screens. (The audit lists today's violations.)
- **Internal concepts never leak:** no enum values, status slugs, IDs, or engineering nouns in any user-visible string.

## 3. The customer story trust test — "the six answers"

Brandon's bar: after a customer reads their story, they should not be left wondering who, what, when, where, why — or whether it was worth it. Made operational: **every customer-facing story/quote surface must answer six questions, or say honestly that it can't yet.**

| # | Question in the customer's head | The surface must answer |
|---|---|---|
| 1 | **Who** looked at my car, and who stands behind this? | Named shop, named tech/role — a person, not a system |
| 2 | **What** is wrong — in words I can repeat to my spouse? | Plain-words finding, no acronym unexplained |
| 3 | **Where** did this come from — how do you know? | The evidence, shown (the story's `howWeKnow` excerpts) |
| 4 | **When** — what happens next, and how long? | Next step + honest timing, or "we'll call you by X" |
| 5 | **Why** does this matter — what happens if I wait? | Factual consequence, stated calmly (see ethics floor) |
| 6 | **Worth** — is the price fair for what I get? | Price tied visibly to the finding and the work |

Today's story schema (`whatYouToldUs` / `whatWeFound` / `whatWeRecommend` / `howWeKnow` / `whatItMeansIfWaived`) natively answers #2, #3, #5 — and partially #6 via the quote. **#1 (who) and #4 (when) have no home in the schema today.** That gap goes in the terminology brief as a product question, not silently patched here.

## 4. The ethics floor (non-negotiable)

Psychology is allowed only in service of comprehension and honest confidence — never manipulation. Concretely:

- **Never manufacture certainty.** Empty evidence yields a short honest story — never padded proof. (Already enforced server-side by row 20; this extends the rule to every human-written word.)
- **No fear-selling.** Consequence-if-waived is stated factually and calmly. The current waiver line — "If you choose not to proceed, the diagnosed issue remains unresolved." — is the *legal-neutral floor*; approved plain rewrites may soften vocabulary, never escalate threat.
- **No fake urgency, fake scarcity, fake social proof, dark-pattern anything.** A real count or a real excerpt, or nothing.
- **Agency is visible.** The customer always sees a real choice ("proceed / wait / ask a question"), stated without penalty-framing beyond fact.
- **The felt result** (the actual psychology goal): *"I understand it, I can choose freely, and nobody is playing me."* That feeling is the conversion engine and the retention engine — trust converts better than pressure, and it's the only lever that survives scrutiny.

## 5. Voice registers (one voice, three volumes)

| Surface | Register | Rule of thumb |
|---|---|---|
| Shop-staff UI | Calm / technical / imperative (existing AGENTS.md rule — unchanged) | Talk like a sharp foreman: short, exact, no decoration |
| Customer surfaces (story, quote, decline language, follow-ups) | **Counter voice** | The way the best service writer you ever met explains it face to face |
| Marketing / landing | Counter voice, public | Same person, meeting a stranger: confident, plain, zero hype-dialect |

**Anti-vocabulary (all surfaces):** leverage, seamless, revolutionize, empower, solutions, cutting-edge, "AI-powered" as a selling adjective, synergy, streamline, "unlock." If it sounds like a SaaS deck, it's off-brand — the brand is a person who fixes cars and tells the truth.

## 6. How the audit grades (rubric)

Each flagged string gets: **location** (path:line) → **surface class** → **violation** (jargon / leak / inconsistency / reading level / trust gap) → **severity** (customer-facing > marketing > shop-staff, because the customer can't ask "what does that mean?" without embarrassment) → **proposed replacement** (only after this standard is approved).

## 7. What this standard is not

- Not a rewrite authorization — application happens per-surface, in reviewed slices, after approval.
- Not a change to generated-copy code paths (story generator, decline-language generator) — those are engine-adjacent and get their own gated slices.
- Not a dumbing-down: technical precision stays wherever a tech needs the exact term (DTC codes, pin numbers, specs). Plain language is for *structure and connective tissue*, never at the cost of a spec a tech relies on.

---

*Verify by (once applied, per slice): readability score of changed strings at 6th–8th grade; zero anti-vocabulary hits in changed files; the six answers demonstrably present on the story surface; no regression in existing copy tests.*
