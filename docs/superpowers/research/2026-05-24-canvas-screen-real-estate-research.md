# Canvas + Chrome — Screen Real Estate Research

**Date:** 2026-05-24
**Purpose:** Inform the layout redesign of the interactive electrical topology page. Current shipped layout (PR #91 baseline) has chrome eating ~80% of the viewport on a 1440 px display; the diagram is starved. Brandon's product call: the canvas IS the diagnostic surface — supporting UI should be overlays / contextual reveals / floating panels, adapted per form factor, not "shrunk-down desktop" responsive web.

This document synthesizes findings from 4 parallel Sonnet subagents covering: (1) premium automotive diagnostic tools, (2) professional canvas / CAD tools (incl. KiCad + Altium, the closest analogs), (3) maps + AR + spatial UI, (4) cross-form-factor adaptive products + unorthodox patterns.

---

## TL;DR — the 7 convergent findings

These appeared in 3 or 4 of the subagent reports independently. Treat as evidence-grounded, not theory:

1. **Persistent right-side detail rails are an anti-pattern across the entire category.** Every premium auto diagnostic tool reviewed (Mitchell, AllData, Bosch ESI[tronic], Identifix, etc.) and every canvas CAD tool (KiCad, Altium) that ships one shrinks the canvas to ~60% width and the panel sits empty most of the time. Figma tried floating panels in UI3 and **explicitly reverted to docked** after user testing showed they slowed workflow — the lesson: floating works for **incidental** chrome (tool pickers, momentary actions), it fails for **continuous working** chrome (properties you read and adjust constantly).

2. **The phone-and-tablet rule (Apple Maps, Procreate, Things 3):** bottom sheet on phone, sidebar on iPad / desktop. Vertical sheets on landscape displays waste space. Apple's HIG codifies this: iPhone gets bottom-anchored sheet, iPad gets a sidebar. The spatial grammar flips from vertical to horizontal at ~768 px.

3. **Tap-to-split (Autel Topology 3.0) is a real shipping pattern in a competitor diesel diagnostic tool.** Canvas full-screen at rest. Tap a module → splits 50/50, canvas left, tabbed detail right. Deselect → canvas fills back. No persistent rail. This is the closest real-world precedent for "canvas-dominates by default, detail-on-demand."

4. **Status color belongs on the canvas object itself, not in a separate legend.** Launch X-431 topology view (another diesel diagnostic tool) color-codes modules in-place: green = good, red = fault, gray = not tested. ETAS ActiveSchematics goes further and renders measured voltage **next to nominal voltage at the precise wire segment** — the diagram IS the live readout. This is the deepest "everything inside the canvas" pattern in the diagnostic category.

5. **Net highlighting / spotlight (KiCad + Altium):** click a wire → that net glows full-saturation, every other wire dims to ~25% opacity transparent wash. Not hidden, just receded. Both EDA tools use this for any wire selection; Altium's Ctrl+Click triggers it across the whole schematic. Nearly zero cost to implement (CSS opacity transitions) and directly addresses cognitive load.

6. **Hover-HUD at cursor (Altium Board Insight):** hovering a wire / pin / pad surfaces a floating badge near the cursor showing net name, expected voltage, fuse upstream — eye stays on the object, data comes to the eye. 100 ms delay before expansion. Toggleable. Connectivity Insight thumbnail previews related schematic locations as a picture-in-picture near the cursor.

7. **Procreate QuickMenu radial** for touch / gloved hands: invoked by tap-and-hold on touch (or stylus squeeze), surfaces a 6-button radial menu **at the touch point**, dismissed by flicking toward a target. Directional intent replaces pixel-accurate targeting — this matches the precision profile of dirty / gloved hands. The menu is invisible at rest, so canvas is 100% clean until invoked.

---

## Pattern catalog — by form factor

### Phone (375–428 px)

**Dominant pattern: full-bleed canvas + bottom sheet (non-modal, multi-position).**

Five distinct bottom-sheet variants worth knowing:

| Variant | Behavior | Example |
|---|---|---|
| Persistent peek | Always visible at ~15% screen height, drag to expand | Apple Maps, Stocks |
| 3-position drag | peek (~15%) → half (~50%) → full (~90%) | Apple Maps iPhone |
| 2-position modal | half ↔ full, dims background at half+ | Google Maps POI detail |
| Floating sheet | Detached from edge, acts like a dialog | Waze ETA pill (2024) |
| Modeless drawer | Full height, slides from edge, canvas live behind | Apple Maps iPad |

**Critical rules:**
- Non-modal at all positions = canvas stays interactive. Use for browse / explore.
- Modal (with scrim) = only when user must resolve before continuing.
- Stacking two sheets is a confirmed anti-pattern (NN/g, Walmart cited as failure case).
- Drag handle (grabber) is mandatory for accessibility on dragable sheets.
- Auto-collapse on canvas pan = anti-pattern; sheet should persist at last position.

**Other phone moves:**
- **One-handed gesture vocabulary** (Procreate Pocket, Tot, Things 3): swipes, long-press, double-tap. Tech has one hand on multimeter, other on screen.
- **56–72 pt tap targets** for in-bay / gloved use (Apple's 44 pt is insufficient with gloves; CarPlay / Tesla / Waze production apps run 56–72 pt).
- **Persistent FAB cluster** in bottom-right inset for current-position / map-type / zoom (Google Maps, Apple Maps).
- **Floating pill for transient state** (Waze 2024): pinned ETA bar → floating pill recovered 12% of map area.

### iPad / tablet (768–1024 px)

**Dominant pattern: bottom sheet content migrates to a left sidebar (~280–320 px wide).**

This is Apple's codified rule: vertical sheets on landscape displays waste space. Procreate, Apple Maps, GoodNotes all flip the layout at this breakpoint. Samsung Galaxy Fold's Flex Mode does similar: split content/controls at the hinge, top = canvas, bottom = controls.

**Critical rules:**
- Sidebar takes 25–30% of width; canvas owns 70–75%.
- Sidebar scrolls independently of canvas.
- Apple Pencil + finger both first-class.
- The same gesture vocabulary as phone, scaled up.

### Laptop / desktop (1280–1920+ px)

**Dominant pattern: split view (sidebar + canvas), with the canvas dominant.**

- Google Maps desktop: left panel 320–400 px for search + results, map owns ~75% right.
- Apple Maps desktop: same pattern, sidebar contains POI / directions / settings.
- PicoScope 7 Auto: dockable panels (left, right, or float as detached window on second monitor) + waveform fills the rest. **User chooses overlay-or-squeeze per panel** — the chrome decision is opt-in.

**Critical rules:**
- Sidebar 280–400 px max; canvas owns 65–75%.
- Floating controls (zoom, layer toggle, current-location FAB) bottom-right inset of the canvas zone.
- Keyboard-driven power-user path (command palette, Cmd-K) is realistic on laptop / desktop, useless on touch.
- **Auto-dismiss for transient tools** (Tesla pattern): controls appear on tap, vanish after 4–5 s idle. Applies to zoom, layer toggles.

---

## Pattern catalog — by interaction

### Spotlight / net-highlight (universal)

Tap or hover a wire / pin → that net's path full-saturation + brighter; everything else dims to ~25% opacity. Used by: **KiCad** (single click on net), **Altium** (Ctrl+Click), **Mitchell 1 ProDemand** (their hidden-wire fade pattern), **Snap-on ShopKey Pro**.

Reads as "I'm telling you which subsystem matters right now without taking the rest off the table." CSS opacity transitions — near-zero build cost.

### Anchored callout on canvas (GIS standard)

Tap a feature → small floating bubble appears next to it on the canvas, with a thin leader line connecting bubble to feature. Bubble holds 2–3 facts + a "more →" link. Used by: **Apple Maps** (POIs), **ArcGIS** (technical maps), some GIS dashboards.

Best when feature density is low-to-medium. Breaks down with dense / overlapping features (KiCad-tier schematic density would be too cluttered).

### Tap-to-split (Autel pattern)

Canvas 100% at rest. Tap a feature → canvas slides to 50%, detail opens in the other half. Used by: **Autel Topology 3.0** (proven in a diesel diagnostic tool).

Stronger than callouts for medium-to-high feature density (no spatial-position constraint). Simpler mental model than multi-position bottom sheets ("canvas → split → canvas").

### Persistent peek sheet (Apple Maps)

Sheet always visible at the bottom at ~15% screen height. Drag up → ~50% → ~90%. Canvas stays interactive at every position. Detail expands progressively.

Hardest to get the snap points right but most polished feel when done well. Apple's `UISheetPresentationController` codifies it.

### HUD-at-cursor (Altium)

Hover a feature → floating badge appears near the cursor with metadata. Auto-dismisses on move. Toggleable. Used by: **Altium Board Insight**, **PCB design EDA category**.

Desktop / laptop only — touch has no hover analog (long-press is a different gesture). Best for "expert reads metadata constantly without clicking."

### QuickMenu radial (Procreate)

Tap-and-hold anywhere → 6-button radial menu appears at the touch point. Flick toward a target to commit. Used by: **Procreate**, **Procreate Pocket**.

Optimal for gloved / dirty hands (directional intent replaces precise targeting). Canvas 100% clean at rest. Implementation cost: medium (touch event tracking + radial layout math).

### Auto-dismiss transient tools (Tesla)

Controls visible at rest = none. Tap canvas → toolbar appears for 4–5 s, vanishes if not used. Used by: **Tesla in-car nav**, **Apple Maps in some states**.

Best for tools that are NEEDED but used briefly (zoom controls, layer toggles, fault injection). Wrong for tools that are needed continuously.

---

## Cross-form-factor DNA — what stays vs what changes

Five exemplars (Procreate, Things 3, Linear, GoodNotes, Apple Maps) all share this DNA. What stays the same across phone → tablet → desktop:

- Information hierarchy / data model
- Core gesture primitives (the vocabulary the user learns once)
- Keyboard shortcuts where applicable
- The identity of what the tool "is"

What changes per form factor:

- **Navigation chrome:** sidebar → drawer → gesture stack as screen shrinks
- **Toolbar density:** persistent → collapsible → radial / contextual
- **Input primary:** mouse / pencil → touch → finger-only
- **Secondary controls:** relegated to long-press / hold / QuickMenu on small screens; visible persistently on large

**The anti-pattern all five avoid: shrinking the desktop layout and calling it "mobile."** Each redesigns the navigation shell per form factor while keeping the canvas / content area's design language constant.

---

## Anti-patterns (consensus across all 4 reports)

1. **Persistent fixed-width right detail panel** (e.g., 380 px sticky rail) — destroys canvas on mobile, sits empty most of the time on desktop, slows workflow on the form factors where it "fits."

2. **Stacked chrome rows** (header + breadcrumb + scenario card + readout + canvas + footer) — every row is legitimate; four stacked rows eat 200+ px before the diagram starts. Exactly the current shipped layout.

3. **Floating panels that drift / overlap content unanchored** — Figma UI3's reverted experiment. Floating without anchoring logic piles cards on top of the content they're meant to describe.

4. **Glassmorphism / backdrop-blur over a complex canvas** — NN/g iOS 26 critique. Fails legibility against any color-varied background. Use opaque dark cards with explicit borders for floating chrome over the diagram. **(Note: the current `CapturedMissingFooter` uses backdrop-blur over the canvas — flagged.)**

5. **Modal sheets / dialogs that cover the canvas during diagnostic work** — breaks the dual-reference glance-back workflow (truck → screen → truck). Non-modal only when the canvas is still relevant to what's in the panel (which it always is here).

6. **Identical chrome weight across breakpoints** — what Lucidchart / draw.io do: shrink desktop to phone with the same panel widths. Tap targets become unusable, panels overlap canvas.

7. **Permanently-on hint cards / "Step N of M" progress indicators / always-listening voice** — standing memory rule (cognitive noise). Brandon's own principle: show only what's done and what's now.

8. **Phone wiring-diagram view treated as afterthought.** Every premium auto diagnostic tool reviewed has either no phone wiring view or one that's clearly not designed for the form factor. **This is the biggest gap in the entire category** — being phone-native is a real moat.

9. **Forced page-flips for wires that span pages.** Mitchell 1 ProDemand's single-page-at-a-time model is the most-cited frustration on ScannerDanner forum threads. Our compositional fuel-system diagram has no page boundaries; don't accidentally introduce one.

10. **Hover-only affordances** — useless on touch. Hover is a desktop / laptop enhancement, never a primary path.

---

## Unorthodox candidates worth seriously considering

Ranked by leverage × fit for Vyntechs (per subagent 4's evaluation):

1. **Spotlight Mode** — always-on KiCad / Altium pattern. CSS opacity. Highest-leverage move. Near-zero cost.

2. **Live values ON wire paths** — ETAS ActiveSchematics. The diagram IS the readout. Directly replaces the current "Now showing · Engine Idle — …" paragraph below the canvas with inline badges on the wire segments.

3. **Status color on canvas objects** — Launch X-431 topology. Component box fill changes (green / red / gray) to reflect state. Eliminates a separate status legend.

4. **Tap-to-split** — Autel Topology 3.0. Proven competitor pattern. Aggressive canvas-first without requiring all-overlay design.

5. **Bluetooth foot pedal** — $40–80 hardware, exposes as HID keyboard, no special API. Tech advances scenarios with foot while both hands on harness. Closest analog: surgical / transcription pedals. Could ship as undocumented power-user feature, hand-distributed to YMS techs as beta.

6. **Push-to-talk voice control** — Web Speech API + push button. "Show pin 5," "switch to fault." Surgical robots (VISA, 2025) prove the model. Push-to-talk avoids shop-noise false triggers.

7. **Procreate QuickMenu radial** — long-press anywhere → 6-button radial at touch point. Phone-only. Eliminates persistent mobile toolbar.

8. **Auto-dismissing tools** — Tesla pattern. Zoom controls, layer toggle, legend appear on tap, vanish after 4–5 s.

9. **HUD-at-cursor** — Altium Board Insight. Desktop only. Hover a wire → floating badge with role + expected voltage near cursor.

10. **Picture-in-picture diagram** — Document PiP API (Chrome stable). Diagram miniaturized while detail panel expands. Likely unnecessary if other moves work; flag as enhancement.

---

## Sources

### Subagent 1 — premium diagnostic tools
- [Mitchell 1 ProDemand interactive wiring diagrams](https://mitchell1.com/shopconnection/prodemand-update-interactive-wiring-diagrams/)
- [AllData interactive color wiring diagrams](https://www.alldata.com/us/en/support/repair-collision/article/interactive-colored-wiring-diagrams)
- [Autel Ultra S2 electrical diagnostics](https://autel.us/maxisys-ultra-s2-accelerating-electrical-system-diagnostics/)
- [Autel Topology training tutorial](https://www.autelshop.de/service/autel-ultra-training-tutorial-on-how-topology-mapping-innovatively-works-87.html)
- [Snap-on ShopKey Pro interactive wiring](https://www.snapon.com/EN/US/Diagnostics/ShopKey-Pro/Interactive-Wiring-Diagrams)
- [Snap-on ZEUS Intelligent Diagnostics guide](https://www.snapon.com/DiagnosticsManuals/ZEUS%20NA/Content/ZEUS/ITDiag.htm)
- [PicoScope 7 views](https://www.picoauto.com/library/picoscope/views)
- [PicoScope 7.2.3 features](https://www.picoauto.com/library/product-news/new-features-in-picoscope-7-2-3-ea)
- [Bosch ETAS ActiveSchematics](https://www.etas.com/ww/en/products-services/diagnosis-information-solutions/activeschematics/)
- [Texa IDC6 software](https://www.texa.com/idc6-software/)
- [Launch X-431 PAD IX](https://en.cnlaunch.com/products-detail/i-301.html)
- [ScannerDanner Mitchell vs AllData forum](https://www.scannerdanner.com/forum/diagnostic-tools-and-techniques/7688-mitchell-or-alldata-wiring-diagrams.html)

### Subagent 2 — canvas / CAD tools
- [KiCad 9.0 Schematic Editor docs](https://docs.kicad.org/9.0/en/eeschema/eeschema.html)
- [Altium Board Insight System](https://www.altium.com/documentation/altium-designer/pcb/board-insight-system)
- [Altium net highlighting](https://resources.altium.com/p/how-highlight-nets-altium-designer-simplify-schematic-and-pcb-designs)
- [Figma UI3 design approach](https://www.figma.com/blog/our-approach-to-designing-ui3/)
- [Figma fixed-panels return forum post](https://forum.figma.com/suggest-a-feature-11/launched-fixed-panels-are-back-23789)
- [Adobe Illustrator Contextual Task Bar](https://helpx.adobe.com/illustrator/using/contextual-task-bar.html)
- [Procreate interface handbook](https://help.procreate.com/procreate/handbook/interface-gestures/interface)
- [Procreate QuickMenu](https://help.procreate.com/procreate/handbook/interface-gestures/quickmenu)
- [Sketch Copenhagen tour](https://www.sketch.com/blog/a-tour-of-copenhagen/)
- [tldraw force-mobile example](https://tldraw.dev/examples/force-mobile)
- [Excalidraw UI options](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/props/ui-options)

### Subagent 3 — maps / AR / spatial UI
- [NN/g bottom sheet article](https://www.nngroup.com/articles/bottom-sheet/)
- [NN/g iOS 26 liquid-glass critique](https://www.nngroup.com/articles/liquid-glass/)
- [Apple Maps HIG](https://developer.apple.com/design/human-interface-guidelines/maps)
- [Sparrow Code UISheetPresentationController](https://sparrowcode.io/en/tutorials/uisheetpresentationcontroller)
- [Waze 2024 CarPlay update](https://thecarplayer.com/blogs/news/waze-2024-updates-car-icon-carplay-interface)
- [Tesla V12 UI analysis](https://www.notateslaapp.com/news/1988/inside-teslas-new-v12-user-interface)
- [Map UI Patterns callout](https://mapuipatterns.com/call-out/)
- [ArcGIS callout docs](https://developers.arcgis.com/documentation/glossary/callout/)
- [Launch X-431 topology map instruction](https://www.launchx431.fr/service/launch-x431-tool-topology-map-detailed-instruction.html)

### Subagent 4 — adaptive + unorthodox
- [Procreate Pocket FAQ](https://help.procreate.com/articles/zqbrql-procreate-pocket-faq)
- [Procreate gestures handbook](https://help.procreate.com/procreate/handbook/interface-gestures/gestures)
- [Things 3 using gestures](https://culturedcode.com/things/support/articles/2803582/)
- [Linear UI redesign part II](https://linear.app/now/how-we-redesigned-the-linear-ui)
- [GoodNotes improved user interface](https://support.goodnotes.com/hc/en-us/articles/13682253498767-Improved-User-Interface)
- [Samsung Galaxy Fold app adaptation](https://developer.samsung.com/one-ui/foldable-and-largescreen/app-cont-and-multi.html)
- [Volkswagen AR service department (MARTA)](https://www.vehicleservicepros.com/aftermarket-business-world/article/21183849/volkswagen-debuts-augmented-reality-for-the-service-department)
- [Voice-Interactive Surgical Agent (VISA), arXiv 2511.07392](https://arxiv.org/abs/2511.07392)
- [Document Picture-in-Picture API](https://developer.chrome.com/docs/web-platform/document-picture-in-picture)
- [vPedal vP-4 Bluetooth foot pedal review](https://newatlas.com/vpedal-vp-4-mkii-transcription-pedal-bluetooth/42565/)
- [Smashing Magazine one-handed mobile design](https://www.smashingmagazine.com/2020/02/design-mobile-apps-one-hand-usage/)
