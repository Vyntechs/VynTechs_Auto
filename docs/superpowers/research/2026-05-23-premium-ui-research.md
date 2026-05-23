# Premium UI Research — Topology Guided Diagnostic

**Date:** 2026-05-23
**Branch:** `feat/topology-guided-walk`
**Purpose:** Rebuild mockup round 2 with premium intent. Research-only — no code.

---

## TL;DR (five moves that change your next session)

1. **Kill the grid-paper background and the progress pills.** Both are top-ten markers of AI-generated SaaS templates. Replace with raw bone surface and a single amber pip or inline counter.
2. **One branch answer = one full-width bar, no icon, no rounded pill badge.** The ✓/!/✗ circle badges in colored buckets are the single most "todo app" thing in the mockup. Remove them. Use left-border weight and color instead.
3. **The active-test component name should be hero-scale serif — 48–56px — on mobile.** Right now it's 20–24px, which reads as a subheading. That component name is the only thing the tech needs to know. Give it all the real estate it earned.
4. **Motion should convey weight, not speed.** The branch-tap transition needs 280ms with a decelerating ease (not a symmetric ease-in-out) and should sequence: border collapses first, then next card enters — not a simultaneous swap. Right now there is no motion at all in the mockup, which makes state changes invisible.
5. **Remove "Step 6 of 10" completely.** Counting steps ahead is cognitive overhead, not comfort. Replace with a quiet backward-looking count: "6 checked" is a finished-action score, not a task-list. Or nothing. The diagram is already the progress record.

---

## 1. Why the mockup reads as vibecoded — specific and unkind

### The grid-paper background (styles.css lines 161–165, 559–565)

This is the single most recognizable fingerprint of AI-generated interfaces in 2024–2026. It appears on every v0 output, every Cursor-generated dashboard, every Tailwind-starter kit that tries to evoke a "workspace." It signals: "I looked up 'graph paper background CSS' and pasted the result." It says nothing about Vyntechs. The irony is worse here: Vyntechs already has a genuine visual metaphor — ink on bone paper — and the graph-paper grid actively undermines it by making the surface look like engineering graph paper, not a technician's notebook.

The canvas background is bone-100. That's already the right call for the topology canvas. The graph lines add zero information and subtract all character. Delete them. If you need to differentiate the canvas area from the panel, use a bone-200 background with no pattern.

### The color-coded circle badges on branch options (styles.css lines 383–400)

Green circle with ✓, amber circle with !, red circle with ✗ — in front of text options — is the "every todo app, recipe app, and checklist app ever" pattern. It is the visual signature of any AI that was told "make a result list." The problem isn't the colors; the problem is the structure: icon-in-circle + text in a grid column. This layout exists because it's what AI tools generate when asked to show categorical options. An experienced designer does not default to this. They ask: what is the tech actually trying to do? They're not categorizing — they're tapping the one thing that matches what they saw. The branch answer should feel like a statement, not a classification. Left-border color (2px or 3px), no icon, does that. The color still carries meaning but the shape doesn't scream "status badge."

### The progress pills at the top (mid-walk.html lines 18–22, styles.css lines 133–150)

Colored dots inside pill-shaped backgrounds arranged in a row is the default status-summary pattern of every project management SaaS, every onboarding wizard, every Notion-inspired tool. The dots-in-pills pattern has been so overused that it reads as placeholder now. Worse: it shows the tech how many steps are ahead. That is explicitly harmful for this use case. The tech does not need to know they have 4 more tests to go. They need to do this one test. Counting them adds dread, not confidence. Remove the whole strip.

### "Step 6 of 10" (mid-walk.html line 21)

The "/10" is the killer. It is the textbook example of making the user feel they're at step 6 of a 10-step bureaucratic form. It is also the #1 signal that the mockup was built by someone thinking of this as a checklist, not a diagnostic instrument. A torque wrench does not tell you how many bolts are left. It tells you when this bolt is done.

### The mono-uppercase section labels (styles.css lines 330–336)

`.panel__section-label` at 10px, 0.16em letter-spacing, uppercase, bone-700 — this is the universal fingerprint of AI-generated dashboards. Every single AI-built interface uses this pattern for secondary labels. It's copied from Tailwind UI's component library and from Vercel's earliest dashboard era. It reads as "I ran out of hierarchy ideas and used the smallest possible mono text with tracking to signal that this is metadata." An experienced type person would either go bigger (let the label breathe) or eliminate it (trust the prose to contextualize itself).

### The node hover: translateY(-1px) + box-shadow (styles.css lines 191–195)

Generic lift-on-hover is the most default interaction state in existence. Every Tailwind component, every shadcn card, every Bootstrap panel does this. The hover is not communicating anything specific to Vyntechs or to the diagnostic context. An experienced designer would either do nothing on hover (let the cursor change handle it) or do something specific: a brief amber tint on the border, a pulse, a deliberate glow that means "this node has test data attached." Lift-and-shadow says "I'm a clickable card in a generic web app."

### Uniform spacing throughout (styles.css lines 280–350, panel section gaps)

Every section gap in the panel is `var(--vt-space-4)` — 16px. Every branch gap is `var(--vt-space-2)` — 8px. The spacing is perfectly even, which is the design equivalent of monotone speech. Premium designers use irregular spacing deliberately. The component name should have more air below it than above it. The "What did you see?" label should sit visually close to the branches (6–8px above) with generous space (24–32px) above it from the prose section. The uniformity makes the hierarchy invisible.

### The sidebar + canvas layout with no idiosyncrasy

The two-column layout — canvas left, panel right — is the correct structural call for desktop. But the proportions are default: the panel is a fixed 420px, the canvas gets the remainder. There's no visual signature to the split. Premium tools like Linear either make the panel feel like it's *on top of* the canvas (floating) or use a proportion that clearly prioritizes one surface (90/10 rather than 70/30). The 420px panel on a 1280px canvas reads as "I assigned the sidebar a comfortable width."

### Status colors used literally at full saturation

The verdict-ok, verdict-fail, verdict-warn tokens are deployed at full chroma in backgrounds, borders, and badges simultaneously. Green backgrounds, green borders, and green icons all at once on the same node. That is three applications of the same signal, which dilutes all three. Premium color discipline means color earns each application separately. The node background might desaturate to a 5% tint; only the border gets the full-chroma signal; the badge gets white text on the color. Using all three together at full saturation is the sign of a designer who wasn't forced to make a hard choice.

---

## 2. What "premium" looks like in digital pro-tool UI

### Linear: restraint and the cost of earning attention

Linear's 2024–2025 redesign crystallized a principle they stated directly: "Don't compete for attention you haven't earned." The sidebar runs "a few notches dimmer" than the content area — not different in hue, just lower in luminance. The icons were redrawn smaller. Navigation was made "more compact rather than spanning full width." Their stated goal: "Software rarely gets worse all at once. More often, it contours out of shape one useful feature at a time." The redesign was corrective surgery, not a rebrand.

What Linear does that the mockup doesn't: they made a hard decision about what the primary surface is (the issues list, the issue detail) and dimmed everything else. The topology walk has a clear primary surface: the active test detail. The diagram is secondary — it's the record, not the prompt. The mockup treats them as visual equals, which diffuses focus.

Linear also switched to Inter Display for headings — a variation of Inter specifically optimized for display sizes — while keeping regular Inter for body. The decision signals that type choices at different scales are separate choices, not one font scaled up.

### Stripe: every microstate is designed, not defaulted

The Mantlr analysis of Stripe, Linear, and Vercel identified the single clearest separator between premium and generic: "Every interactive element has six distinct states: default, hover, focus, active, disabled, loading. If one is missing, the element isn't done."

The mockup's branch buttons have: default, hover, and a JavaScript alert on click. That is three states. There is no focus ring design, no active (pressed) state, no disabled state, no loading state. The branch button is not done.

Stripe's design system is also notable for what it removed: they moved from a card-based dashboard to a "no-card" layout. Cards are the default neutral container. Removing them forces every element to justify its position by type, space, and hierarchy alone rather than by having a border drawn around it. The mockup panel is a card inside a card: the panel has a 1px border, and every section inside it has its own 1px borders. The borders are doing the organizing work that hierarchy should do.

### Vercel: monochrome confidence

Vercel's design language — Geist font, pure blacks at oklch(0,0,0), pure whites — is the most extreme example of commitment. They restricted themselves to almost no color and let typography, spacing, and the occasional gradient carry everything. The "confidence" read comes from the restraint: they were willing to be wrong about removing color and committed anyway. Vercel's design language notes: "Animations should only be used when they clarify cause and effect or add deliberate delight." They have a defined preference hierarchy for animation: CSS > Web Animations API > JavaScript libraries. The mockup uses JavaScript-triggered alert dialogs for branch feedback. That is not animation — it's a browser default interrupt.

### Things 3: the satisfaction physics of a finished action

Things 3 received multiple Apple Design Awards for a reason that's hard to articulate without experiencing it: the completion animation for a task has a *physical quality*. The circular radial fill before the check mark registers is not decorative. It is giving the action its due weight — a brief moment of "this is happening" before the item disappears. The item doesn't vanish immediately. The animation communicates that the tap was received, processed, and committed. The check mark itself uses a natural ink-stroke easing that decelerates at the end, not a linear draw.

The lesson: confirmation before disappearance. The action (tapping a branch) should show commitment before the state changes. A 120ms press state (the button darkens, border brightens) followed by 280ms transition (old content exits, new enters) is the minimum choreography.

### Teenage Engineering: limitation as confidence signal

Teenage Engineering's OP-1 is the clearest physical analogue to what this diagnostic tool is trying to be. As their founder stated: "Limitations are OP-1's biggest feature." An instrument with fewer options per mode feels more confident — it's telling you that the right choices are visible here, you don't need to look elsewhere. The OP-1's screen shows exactly one thing at a time with intense focus. The knob colors map to functions, not to status. Their design principle — Scandinavian restraint with deliberate color accents — is exactly the brief Vyntechs already has: bone (the Swedish birch), graphite (the industrial), amber (the single ignition signal).

The key translation for the diagnostic walk: one thing on screen at a time. The active test card doesn't need a companion strip of pills, a section header, a divider, a step counter, and an escape link. It needs the component name, the test description, and the branch answers. Everything else is noise.

### Leica: clarity, precision, restraint — and no explaining yourself

Leica's UI philosophy: "clarity, precision, and restraint." Their interfaces don't explain themselves. There are no tooltips on the shutter speed dial. The assumption is that the person holding the camera has earned the right to operate it. This is directly applicable to Vyntechs: master techs don't need the panel to have a "WHAT TO DO" section label and a "WHAT IT TELLS YOU" section label. The test description is self-contained. Labels that explain what the labels are explaining are noise.

### Bloomberg Terminal: intentional density without visual chaos

Bloomberg's designers stated their goal as "concealing complexity." On a single screen, the Terminal shows scrolling sparklines, trading tables, news feeds, and keyboard shortcuts simultaneously — yet expert users report it reads as clean. The mechanism is not simplicity but hierarchy: the most critical item for the current task dominates by size and position, everything else recedes by color (lower contrast) and scale (smaller). The mockup's context nodes on the topology diagram use `opacity: 0.35` and `filter: saturate(0.4)` — that's the right instinct, taken from Bloomberg's approach. The problem is the active node competes with the panel by being in a different spatial zone entirely. The diagram says "active" and the panel also says "active." They should reinforce, not compete.

---

## 3. Satisfaction mechanics in workflow tools

### The "earned confirmation" sequence

Stripe's design team identified the core principle in a piece by Michaël Villar: **"If you disable animations, the flow should feel broken."** That's the test. The branch-tap in the mockup currently produces an alert dialog (JavaScript `alert()`). Removing that produces nothing — the flow doesn't feel broken because there was no motion conveying state in the first place. That's the diagnosis.

The correct sequence for a branch tap in this tool:

1. **Press (0ms → 80ms):** The tapped button immediately darkens — bone-200 background fills in. Border takes on the verdict color at full opacity. This is instantaneous feedback that the tap registered.
2. **Commit (80ms → 200ms, ease-out, cubic-bezier(0.2,0,0,1)):** The button face locks — small scale-down (97%) as the user "pushes" the result in. The diagram badge corresponding to the active node takes on the verdict color at this moment, silently.
3. **Transition (200ms → 440ms, the same ease):** The panel content cross-fades: old test prose exits at opacity 0, new test component name enters at opacity 1. The entrance is from 8px below (translateY(8px) → 0). Not a slide — a settle.
4. **Resolution (440ms):** The new state is stable. The tech has a new component name and a new test description in front of them.

Total: 440ms. The research consensus (Apple HIG, Stripe's animation guidance) is that confirmations must register within 100ms and resolve within 500ms to feel responsive without feeling rushed. 440ms is within the window.

The Stripe checkmark analysis stated: the check mark animation "encourages you to feel like you easily did the purchase" — the motion validates the action. For the diagnostic walk, the branch-tap commits an observation. It should feel like pulling a lever: some resistance (press state), then a decisive snap to the new state.

### What Things 3 gets right that gamification gets wrong

Things 3 does not give you points. It does not tell you how many tasks you completed today. It does not show a streak. What it does is give every completed action a brief, physical *thunk* — the visual equivalent of a key clicking into a lock. The satisfaction comes from the action, not from a reward system. This is the crucial distinction for Vyntechs: the tech's satisfaction should come from the test completing, not from any UI decoration (badges earned, progress bars filling, step counters ticking). The motion IS the reward. No confetti, no progress rings, no score displays.

For the all-passes ending: a simple, non-alarming shift in the active-test panel — the component name area shows the system name ("Fuel System") at the same hero scale, the test description area says the plain-English verdict ("All implicated components checked — no fault found in this system"), and the branches area is replaced by two actions: "View full record" and "Start over." No congratulations banner. No success illustration. Confidence, not celebration.

### The fail terminal as "answer reveal"

The terminal-fail moment (when a branch routes to a definitive fault) is the most emotionally loaded moment in the diagnostic. It is not a failure — it is a diagnosis. The UI should treat it as revelation, not alert. The pattern from surgical and safety-critical contexts: state changes that carry weight should animate into place deliberately, not pop. The fix recommendation card should enter the same way new test content enters — a settle from below, 280ms — but the card itself should be visually heavier. Bone-900 background (near-black) on the repair recommendation. White text. The signal-navy or amber border. This is the first time in the entire walk where the background changes. It signals: this is different, this is the answer. A soft sound of a notification, if the device has sound enabled, is appropriate and within web API capabilities — but do not make it mandatory.

---

## 4. Applied brief: the tech in the bay

### The active test card — what premium looks like for this brief

The tech in coveralls has one job per screen: read the test, run it, tap the answer. The active test card is the only element that matters. Everything else is silent context.

**Component name at hero scale.** "Rail Pressure Relief Valve" should be rendered in Instrument Serif at 48px on mobile, 56px on desktop. Line height 1.0. Letter spacing -0.025em. This is the only text on the card that the tech needs to identify at arm's length. Right now it's 20–24px. That's the same scale as body text in a news article. Make it unmissable.

**Test description in Inter Tight, not mono.** The test description ("Monitor FRP rail pressure PID on scan tool during a smooth key-off from idle") should be Inter Tight, 16–17px, line-height 1.5. Not mono. Mono at this scale reads as code, not instruction. The tech is reading instructions, not a log file.

**Branch answers as full-width bars, no icons.** Replace the icon-grid layout with full-width buttons, no left icon, colored left border (3px). The text describes what the tech saw. The verdict label (PASS / FLAG / FAIL) runs in small-caps Inter Tight at 11px, bone-700, right-aligned. The branch answer should be tall enough (minimum 52px on mobile) to tap with a gloved thumb without precision. No 28px circular icons. The icon is taking up real estate that could be touch target.

**The diagram's role during a walk: quiet, not silent.** The diagram is a scoreboard, not a distraction. During the walk, only the implicated nodes should be visible at opacity 1.0. Context nodes should be at 0.2 opacity — near-invisible. The active node should have a single, continuous amber border pulse: not a shadow-glow pulsing, but a border that cycles from amber-400 to amber-600 at 2s duration, infinite, `easing: ease-in-out`. This is subtle enough to be peripheral vision, not demanding foreground attention.

**Transitions between tests.** The tech taps a branch. The branch darkens (press). The diagram badge updates (amber → verdict color, 80ms). The panel content cross-fades: old exits opacity 0 in 160ms, new enters from translateY(8px), opacity 0 to 1 in 160ms with 80ms delay. Total transition: 240ms. The tech never sees both states simultaneously.

### Branch targets — not verdict-icon cards

Replace the three-column verdict-icon-text-grid layout with one of these alternatives:

**Option A — text-forward with left-border color signal.** Full-width button, no border-radius (or 2px maximum — near-square). Left border 3px, verdict color. Padding: 16px vertical, 20px horizontal. Component name at 16px Instrument Serif. Verdict label at 11px small-caps Inter Tight, bone-600, below the text. Tap anywhere on the bar.

**Option B — dial-style.** Three large text-only buttons, stacked, same width. Pass / Flag / Fail at 20px Inter Tight weight 500. Below each, a brief observation text at 14px Instrument Serif, muted. No colors at resting state — color only applies on press and after commit. The lack of pre-colored states means the tech reads the text, not the traffic light.

Option A is the recommendation. It reads as a professional judgment call, not a multiple-choice test.

---

## 5. Concrete recommendations for this token set

### Type ramp: specific sizes, specific assignments

| Element | Family | Size | Weight | Tracking | Case |
|---|---|---|---|---|---|
| Active component name (mobile) | Instrument Serif | 48px | 400 | -0.025em | Sentence |
| Active component name (desktop) | Instrument Serif | 56px | 400 | -0.028em | Sentence |
| Test description | Inter Tight | 17px | 400 | -0.01em | Sentence |
| Branch answer text | Instrument Serif | 15px | 400 | 0 | Sentence |
| Verdict label (below branch) | Inter Tight | 11px | 500 | 0.06em | Small-caps |
| Node label in diagram | Inter Tight | 12px | 500 | -0.01em | Sentence |
| Node kind/type | Inter Tight | 9px | 400 | 0.06em | Upper |
| Backward counter ("6 checked") | JetBrains Mono | 13px | 400 | 0.04em | Upper |

**Remove:** The 10px/0.16em/uppercase mono section labels entirely. They are a visual tic that means nothing and reads as placeholder. Trust the hierarchy.

**Remove:** "Step 6 of 10" entirely. Replace with a discrete backward-looking counter, right-aligned in the header: "6 checked" in JetBrains Mono 13px. Or nothing — the diagram is the record.

### Spacing: deliberate irregularity

The current panel uses uniform 16px gaps. The rebuilt panel should:

- Component name: 8px above (from step counter line), 4px below (tight to the test type label)
- Test type label: 4px below component name, 24px below it (before the prose)
- Branch answer text prose: 28px above (from "What did you see?" removed — no label), 0px between branches
- Between each branch: 2px (not 8px) — they are a set, not a list

This creates a visual cluster: the name + label are tight together (a unit), then a breath of air, then the prose, then another breath, then the branches tight together. The rhythm signals structure without needing dividers.

### Radius: pick a side

The current radius ladder (2/4/6/10/999px) produces inconsistency: branches use 6px, badges use 50% (circle), pills use 999px, nodes use 4px. This is the Tailwind default ladder applied at different scales with no editorial decision.

**Recommendation:** Commit to near-zero (0–2px) for all actionable elements — branches, nodes, the active test panel boundary. Reserve 999px only for the diagnostic session status pill in the app chrome (not the mockup). The 0–2px choice reads as "instrument" — a torque spec card, a diagnostic report, a repair order. Not a consumer app. The current 6–10px radii read as "mobile app card." That's the wrong reference.

### Color: earned, not literal

Current usage: green bg + green border + green badge all on the same node. Three applications of the same signal.

**Prescription:**
- Node background for completed tests: bone-100 (no color fill — just slightly raised surface). The result is NOT the node's identity.
- Node border: verdict color at 60% opacity for completed tests. Full opacity only for the active node.
- Node badge: verdict color background, white glyph. This is the one place verdict color appears at full saturation — because the badge is the distillation of the result.
- Branch buttons (resting): no verdict color at all. Bone-50 background, bone-300 border.
- Branch buttons (hover): bone-100 background, left border takes verdict color at 60% opacity.
- Branch buttons (pressed): bone-200 background, left border full verdict color.

This reduces the ambient color noise from "traffic light everywhere" to "color appears when you're about to commit or have committed." It makes color an event, not decoration.

### Iconography: remove emoji, use nothing or custom marks

Current: ✓ / ! / ✗ Unicode characters inside colored circles. These are browser-default unicode characters in colored containers — the most generic possible implementation of status iconography.

**Remove the icons entirely from branch buttons.** The text is sufficient. A "PASS" result doesn't need a green checkmark in front of it; the text "Gradual decay over many seconds" plus the "Pass — rail holds" verdict label is unambiguous. If you want a mark in the branch, consider a simple filled square (▪) in the verdict color, 8×8px, left-aligned at the text midline — minimal, non-representational, a positioning device not an illustration.

For the diagram badges: replace emoji characters with the node number in JetBrains Mono at the current size. For completed nodes, replace the number with a filled square (▪) or a simple horizontal rule — not a Unicode checkmark. The square mark is industrial; the checkmark is consumer.

### Grid-paper background: kill it, replace with nothing

Delete both instances of the `background-image` grid pattern (styles.css lines 161–165 and 559–565). The canvas background should be `--vt-bone-100` — full stop. If you want a visual signal that separates canvas from panel, use a 1px border between them in bone-300. The bone-100 surface already reads as "document area" without the grid noise.

### Borders and weight

Current: 1px and 1.2–1.4px borders everywhere, uniformly. This is the flat-design default. Premium pro tools use borders selectively:

- Between canvas and panel: 1px bone-300 (structural, permanent)
- Node borders: 1.6px bone-900 for default nodes — heavier than current 1.4px. Not a rounding — a stroke weight that matches a mechanical diagram convention. Think circuit schematic line weight.
- Active node: 2.4px amber-500 border, no glow/shadow
- Branch buttons: no border at rest (bone-50 background is enough differentiation). Left border 3px on hover and press.
- Sheet top border on mobile: 2px bone-800 (heavy top edge — the sheet is "lifting" from the bottom)

### Motion choreography

**Defined curves using existing tokens:**

| Transition | Duration | Easing | Property |
|---|---|---|---|
| Branch press state | 60ms | linear | background |
| Branch commit | 120ms | `cubic-bezier(0.2,0,0,1)` | scale(0.98), background |
| Panel content exit | 160ms | `cubic-bezier(0.4,0,1,1)` | opacity 1→0 |
| Panel content enter | 200ms | `cubic-bezier(0.2,0,0,1)` | opacity 0→1, translateY(6px→0) |
| Diagram badge verdict update | 80ms | linear | background-color, border-color |
| Active node border pulse | 2000ms | ease-in-out | border-color |
| Terminal fix card enter | 280ms | `cubic-bezier(0.2,0,0,1)` | opacity 0→1, translateY(12px→0) |

The existing `--vt-ease: cubic-bezier(0.2,0,0,1)` is a deceleration curve — things start fast and settle. That is the right easing for entering content (it mimics weight settling). Use `cubic-bezier(0.4,0,1,1)` (an acceleration curve) for exiting content — things that leave start slow and accelerate out of frame. This asymmetry is what separates motion that "has weight" from motion that feels symmetric and therefore artificial.

### Materiality: lean into ink-on-paper, not tablet-app

The bone palette's stated design intention is "Workshop Instrument: bone canvas, signal-navy blueprint ink on bond paper." That metaphor has been underused in the mockup. Specific moves:

- The panel border at the top of the mobile sheet should be visually heavy (2px bone-800) — like the fold of a paper form
- The active test card background on mobile should be bone-50 (the lightest paper) while the canvas behind it is bone-200 (a slightly different paper weight)
- The node names in the diagram should be Inter Tight (not serif) to read as *labels on a diagram*, not prose — consistent with how labels appear on a wiring schematic
- The component name in the panel should be Instrument Serif at hero scale — this is where the tech reads the name of the thing they're about to test; it deserves the serif's warmth and authority

### What to remove entirely

1. **The grid-paper background** on both canvas and mobile canvas
2. **The progress pill strip** (5 passed / 1 active / 4 to go)
3. **"Step 6 of 10"** — replace with backward-looking "6 checked" or remove
4. **Section labels ("What to do," "What it tells you," "What did you see?")** — the prose and branches are self-contextualizing
5. **The `.branch__icon` circles** — the ✓/!/✗ in colored circles
6. **The `.node:hover { transform: translateY(-1px) }` lift** — replace with nothing or a border-color shift
7. **The `.panel__divider` hr** — use spacing (24px gap) instead of a 1px line between sections
8. **`"Step 6 of 10"` in the mobile sheet header** — same rationale as desktop
9. **The `context-strip` chip row on mobile** — the chips ("Rail B," "Inj 1–8," "Return," "PCM") have no diagnostic value during the walk. The tech isn't going to tap "Rail B" and feel informed. Remove it.
10. **`alert()` for branch feedback** — replace with the motion sequence described in section 3

---

## Next mockup recipe — step-by-step prescription

**Step 1 — Reset the canvas.**
Canvas background: `--vt-bone-100`, no grid. Panel background: `--vt-bone-50`. 1px `--vt-bone-300` divider between them. Done.

**Step 2 — Strip the header.**
Remove the progress pill strip. Remove "Step 6 of 10." Keep only: eyebrow (9px JetBrains Mono uppercase: "Diagnostic · 2017 F-350 6.7L PSD"), title (32px Instrument Serif), and a right-aligned "6 checked" counter in JetBrains Mono 13px.

**Step 3 — Rebuild the active test card.**
Component name at 48px (mobile) / 56px (desktop) Instrument Serif. Below it: test type at 13px JetBrains Mono, bone-700. Then 24px gap. Then test description prose at 17px Inter Tight. No section label. No "What to do." No divider.

**Step 4 — Rebuild the branch answers.**
Full-width buttons. No border-radius (or 2px). No left icon. Left border 3px, verdict color (resting state: bone-300 left border). Top padding 16px, bottom 16px, left 20px. Branch text: 15px Instrument Serif, bone-900. Below it (4px gap): verdict label: 11px Inter Tight small-caps, bone-600, right-aligned. 2px gap between branches (not 8px).

**Step 5 — Add the motion.**
Press state: background → bone-200, left border → verdict color, 60ms linear. On release: commit sequence (scale 0.98, 120ms). Panel content exit: opacity 0, 160ms accelerate-out. New content: translateY(6px)→0, opacity 0→1, 200ms decelerate-in, 80ms delay.

**Step 6 — Fix the diagram.**
Context nodes at 0.2 opacity, no saturation filter (the opacity carries it). Active node: 2.4px amber-500 border, pulsing border-color between amber-400 and amber-600 on 2s loop. Badges: number-only for upcoming, filled square (▪) for completed — no Unicode checkmarks.

**Step 7 — Radius discipline.**
Everything actionable: 0–2px. Nothing 6px or 10px except the pill chrome element in the app header (not present in these mockups). Mobile sheet top border-radius: 12px (down from 18px — less consumer, more instrument).

**Step 8 — Remove context strip on mobile.**
Let the canvas fill the space. The topology is already the context. The chips added nothing.

**Step 9 — Stub the terminal fix card.**
Background: bone-900. Text: bone-50. Border-left: 3px amber-500 or verdict-fail coral. Enter animation: 280ms settle-down. No dialog, no modal. It slides into the panel's content area as the final "page" of the walk.

**Step 10 — Review the complete screen against one criterion.**
*Can a tech who has never used this tool identify: (a) what component they're testing right now, (b) what they need to do, and (c) where to tap — within 3 seconds, at arm's length, in a noisy bay?* If the answer to any of the three is "maybe," simplify further.

---

*Sources consulted: [Linear Design Refresh](https://linear.app/now/behind-the-latest-design-refresh) · [Linear UI Redesign Part II](https://linear.app/now/how-we-redesigned-the-linear-ui) · [Mantlr: Stripe, Linear, Vercel Premium UI](https://mantlr.com/blog/stripe-linear-vercel-premium-ui) · [Stripe Animation Principles](https://medium.com/bridge-collection/improve-the-payment-experience-with-animations-3d1b0a9b810e) · [Banani Vibe Designing](https://www.banani.co/blog/vibe-designing) · [Teenage Engineering Design](https://medium.com/@ihorkostiuk.design/the-product-design-of-teenage-engineering-why-it-works-71071f359a97) · [Bloomberg UX](https://www.bloomberg.com/company/stories/how-bloomberg-terminal-ux-designers-conceal-complexity/) · [Apple HIG Motion](https://developer.apple.com/design/human-interface-guidelines/motion) · [Vercel Design Guidelines](https://vercel.com/design/guidelines) · [Leica Design Philosophy](https://www.macfilos.com/2026/03/13/leicas-journey-to-ui-convergence-in-conversation-with-stefan-daniel-and-nico-kohler/)*
