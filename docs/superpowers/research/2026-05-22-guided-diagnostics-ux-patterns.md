# Guided Diagnostics UX Patterns — Research

**Date:** 2026-05-22
**Purpose:** Inform product brainstorm for a guidance layer on top of the Vyntechs interactive topology diagram.
**Scope:** How leading real-world tools guide a technician through a step-by-step diagnosis, and what that means for Vyntechs.

---

## 1. How Each Major Tool Works

### Identifix Direct-Hit

**What it is:** Community-sourced confirmed-fix database plus OEM wiring/procedures. Subscription tool used browser or phone app.

**Sequence presentation:** Symptom-first search or DTC entry. Results are ranked "confirmed fixes" — a flat, ranked list of probable components/procedures ordered by how often other techs fixed the same symptom on the same vehicle. Not a wizard; more like "here's what 87 techs did, most popular first."

**Recording / routing:** There is no interactive recording step. The tech reads the fix, goes to the bay, does the work, then optionally comes back to submit "What Fixed It?" through the Confirmed Fix Dashboard (select component, select action from drop-downs). The feedback loop is crowd-sourced verification, not in-session guidance.

**Confidence / verdict:** Confidence is implicit in ranking — number-one confirmed fix = highest frequency. No formal confidence score is displayed. No final system-generated verdict; the tech decides when they're done.

**Handles ambiguity / "can't test":** No mechanism. If the fix doesn't apply, the tech scrolls to the next one.

**Key pattern:** The *confirmed-fix list* is the guidance. It's a pre-sorted checklist of hypotheses, not a live decision tree. Fast to read on a phone. Low cognitive overhead because each fix is a single sentence.

**Sources:** [Identifix Direct-Hit](https://www.identifix.com/direct-hit/) · [spotsaas.com review 2025](https://www.spotsaas.com/blog/unlock-identifix-direct-hit/) · [Confirmed Fix workflow](https://updates.identifix.com/tag/confirmed-fix/)

---

### Mitchell 1 ProDemand + SureTrack

**What it is:** OEM repair data + SureTrack community fixes + guided component tests. Desktop/browser, some mobile.

**Sequence presentation:**
- **SureTrack Real Fixes:** Like Identifix — ranked list of probable components tied to a code/symptom. Components ranked most-likely to least-likely based on billion-repair-order database.
- **ProView:** An interactive relationship map between DTCs and components. Tech can see which code clusters point to which components, and toggle back and forth.
- **Guided Component Tests (GCTs):** A focused card-based workflow. For a selected component, shows: component description → location → best test location → connector end view → test procedure → known-good waveform. One card per component, stepped linearly.
- **Interactive Wiring Diagrams:** Any component in the diagram is clickable → pop-up with links to location, connector view, specs, guided component test. No exit required.

**Recording / routing:** The GCT workflow is informational — it tells you what to measure and shows the known-good waveform, but the tech records nothing in the tool itself. Routing to "next step" is manual (the tech moves to the next component or closes out).

**Confidence / verdict:** SureTrack ranks probable components. The "Probable Component" feature groups Real Fixes by component and ranks them. There is no explicit confidence percentage shown, but ordering itself communicates priority.

**Handles ambiguity:** ProView lets the tech explore code-to-component relationships interactively, which supports "I got an unexpected result — what else could cause this?" No explicit "skip this test" option in GCTs, but cards are independent; the tech simply doesn't run one they can't access.

**Key patterns:**
1. *Click-in-diagram to component info* — the diagram is a live index into all other data, not just a picture.
2. *Card per component* — all info for one component in one place, not scattered across tabs.
3. *Rank by probability first* — the tool starts you at the most likely cause, not at step 1 of a fixed sequence.

**Sources:** [ProDemand guided component testing process](https://mitchell1.com/shopconnection/guided-component-testing-process/) · [SureTrack Real Fixes](https://www.m1repair.com/mitchell1-prodemand-suretrack-real-fixes/) · [Interactive wiring diagrams](https://mitchell1.com/press/mitchell-1-introduces-interactive-wiring-diagrams-in-latest-software-release/) · [ProDemand wiring diagrams update](https://mitchell1.com/shopconnection/prodemand-update-interactive-wiring-diagrams/) · [Probable Component feature](https://mitchell1.com/press/latest-release-of-mitchell-1s-prodemand-includes-probable-component-feature/)

---

### Snap-on Fast-Track Intelligent Diagnostics + Guided Component Tests

**What it is:** Scan-tool software built into Snap-on hardware (Zeus, VERUS Edge, Triton, etc.). Most tightly hardware-integrated of any platform.

**Sequence presentation:** Branching from DTC. The sequence is: scan → DTC → Fast-Track narrows from the full service data to only the content relevant to that code → presents a filtered list of tests (functional tests + guided component tests). This is not a flat list — it pre-routes based on the code, showing only the tests that matter for that fault path.

**Guided Component Tests (hardware-integrated):**
- Step 1: Connection instructions with diagram showing where exactly to probe (connector view, pin identification).
- Step 2: Scope screen shown alongside the setup card simultaneously.
- Step 3: Live waveform captured; side-by-side with known-good reference waveform.
- The tech visually compares live vs. known-good. The tool does not automatically read the waveform and render a verdict — the tech makes the call.

**Smart Data:** PID list auto-filtered to only the PIDs relevant to the active DTC; out-of-range values are automatically flagged. This is passive recording — values appear, flagged ones are highlighted.

**Recording / routing:** No explicit "record a result" step that drives routing. The tech decides which test to run next based on what they've found. The structure narrows the universe of tests but doesn't enforce a sequence.

**Confidence / verdict:** SureTrack (same database as Mitchell 1) provides ranked Real Fixes. No explicit confidence score in the guided test flow. The verdict is the tech's conclusion after comparing waveforms.

**Handles "can't test":** The tool skips unnecessary steps by design — Fast-Track pre-filters, so the tech should only see tests relevant to their path. There is no explicit "I can't run this" button, but the test list is independent and the tech can skip any card.

**Key patterns:**
1. *Code-driven pre-filtering* — the tech doesn't get 200 tests; they get the 5-8 relevant ones.
2. *Live + reference side-by-side* — the most compelling argument for annotated-diagram-style presentation; the test makes sense in context.
3. *Smart Data flagging* — the tool surfaces what's wrong in the data stream without requiring the tech to interpret every PID.

**Sources:** [Fast-Track introduction](https://www.snapon.com/EN/US/Diagnostics/News-Center/Press-Release-Archive/What_Is_Fast-Track_Guided_Component_Testing) · [Fast-Track Intelligent Diagnostics overview](https://www.snapon.com/EN/US/Diagnostics/Information--Software-Products/Intelligent-Diagnostics) · [2025 press release — Guided Component Tests](https://www.snapon.com/Snap-on-Files/News-Business-Units/News-Tools/2025/Go-Beyond-Scanner-Data-with-Fast-Track-Guided-Component-Tests-Exclusively-from-Snap-on.pdf) · [Vehicle Service Pros guest blog](https://www.vehicleservicepros.com/training-and-resources/guest-blogs/blog/53081763/snap-on-diagnostics-guest-blog-guided-component-tests-deliver-potential-for-higher-levels-of-efficiency-productivity-and-profitability)

---

### Bosch ESI[tronic] 2.0

**What it is:** Workshop software linked to Bosch KTS scan tools. Primarily European market; used globally in independent shops.

**Sequence presentation:** The Service Information System (SIS) is the core guidance path. After a fault code is found, SIS generates a test plan for that circuit/component. The test plan walks the tech through checking power supply → ground → signal wires, with required pin assignments and expected value ranges shown alongside each step.

**Recording / routing:** Each step shows what value to expect. The tech enters or confirms the reading at that step, and the system routes to the next step. This is the closest to a true decision-tree step-recorder among aftermarket tools. Some steps are automated (the KTS hardware can perform the measurement, inject the result, and automatically advance).

**Confidence / verdict:** Access to a database of 1.7 million known fixes across 150+ brands. When a pattern matches, the tool surfaces the known fix with a confidence level tied to match frequency.

**Handles ambiguity:** SIS has conditional branching — if the tech enters an unexpected value, the path forks to a sub-procedure for that condition. Not just "go to step X"; it's "if value is below X, follow this path; if above Y, follow this other path."

**Key patterns:**
1. *Test plan with explicit expected values* — not just "check the wire"; "check pin 3 for 12V ± 0.5V; if not, go to sub-procedure 4B."
2. *Conditional branching that auto-routes* — the tech enters the reading, the tool decides what comes next.
3. *Hardware-integrated measurement* — when a KTS is connected, some steps run automatically and the result is captured without manual entry.

**Sources:** [ESI[tronic] 2.0 guide (pmmonline.co.uk)](https://pmmonline.co.uk/technical/boschs-guide-to-using-its-esitronic-2-0-software/) · [Lesson 5 — SIS repair instructions](https://www.boschaftermarket.com/gb/en/news/tips-and-technology/esitronic-lesson-5/) · [ESI[tronic] fact sheet (PDF)](https://www.boschaftermarket.com/xrm/media/images/equipment/esitronic_software/xx_pdf_1/tds_fact_sheet_esi_en_77391.pdf)

---

### Autel MaxiSYS — Topology Map + Intelligent Diagnostics + Guided Functions

**What it is:** Tablet-based scan tool platform (MS919, Ultra, Ultra Lite, etc.). Notable for being the most direct analog to Vyntechs's topology model.

**Sequence presentation:** Autel introduced a "Topology Module Mapping" feature that renders all vehicle ECUs as nodes on a visual map, connected by bus lines. Nodes are color-coded by status (OK / fault / communication error). The tech taps a node on the map → sees its DTCs → enters Intelligent Diagnostics.

**Intelligent Diagnostics:** Links from the node/DTC directly to: OEM repair info, guided component tests, and bi-directional controls for that module. Described as "from code to repair to test in one path."

**Guided Functions:** Step-by-step special function sequences (e.g., injector coding, throttle relearn, DPF regen). These follow a strict linear wizard: Step 1 → confirm conditions met → Step 2 → tool performs action → confirm result → next step. Fully recorded in session.

**Recording / routing:** For guided functions: the tool records each step's completion. For regular component tests: informational only (same limitation as Mitchell 1/Snap-on). The topology map itself does not drive a guided test sequence — it's a navigation layer, not a procedure runner.

**Confidence / verdict:** No explicit confidence score. The topology map's color-coding is the closest to a system-level health indicator.

**Handles ambiguity:** No explicit skip/can't-test mechanism documented. The topology map handles the "I don't know where to start" problem elegantly — failed nodes announce themselves.

**Key patterns:**
1. *Topology as navigation layer* — the tech starts global (see all modules) and drills into the problem node. This is the most important pattern for Vyntechs.
2. *Color-coded health at a glance* — faulted nodes are visually distinct before the tech even picks a starting point.
3. *Guided Functions as strict wizards* — when the procedure has known steps and known outcomes (e.g., a calibration), a linear wizard works well; when it's diagnosis, guidance is informational only.

**Sources:** [Autel topology helps techs diagnose hidden module problems](https://autel.us/new-autel-topology-helps-techs-diagnose-hidden-module-problems/) · [MaxiCOM Ultra Lite topology mapping](https://store.autel.com/products/autel-maxicom-ultra-lite) · [MaxiSYS Ultra topology + Intelligent Diagnostics](https://www.autelmfg.com/products/autel-maxisys-ultra-autel-scanner-2022-top-automotive-intelligent-diagnostic-scan-tool-with-5-in-1-vcmi-j2534-ecu-programming-40-services-topology-map-upgraded-of-ms908s-pro-elite-ms909-ms919-ms919)

---

### ALLDATA

**What it is:** OEM-sourced repair information (factory manuals digitized) plus TSBs, DTC descriptions. Heavy on documentation.

**Sequence presentation:** Diagnostic Flow Charts — factory-style decision trees for specific DTCs/symptoms. Not interactive; they are rendered as static flowchart images (or text procedures) with yes/no branches. The tech reads the chart and navigates manually.

**Recording / routing:** No in-tool recording. The flow chart says "if voltage > 4.5V go to step 12; if < 1.5V go to step 8." The tech follows it manually.

**Confidence / verdict:** No scoring. The OEM procedure ends with "replace component X" or "repair harness." That IS the verdict — it's the factory conclusion of the decision tree.

**Handles ambiguity:** The flow charts include "if result is inconclusive" branches in factory text. The quality varies by OEM. No software-level handling.

**Key pattern:** *Factory decision trees as the gold standard* — every OEM designed their service procedure as a branching decision tree. Every aftermarket tool is trying to replicate or improve on this. ALLDATA shows you the original; the others interpret it.

**Sources:** [ALLDATA DIY](https://www.alldata.com/diy-us/en) · [ALLDATA Diagnostics](https://www.alldata.com/us/en/diagnostics)

---

### BMW ISTA (factory OEM tool)

**What it is:** BMW's official dealer diagnostic platform. Relevant as a benchmark for OEM-grade guided test plans.

**Sequence presentation:** After a scan, ISTA generates a structured Test Plan: a numbered list of procedures tied to the fault codes found. Each procedure is a sub-sequence with informational messages, queries, measurement instructions, and recommendations.

**Recording / routing:** Technician confirms each step or enters a value. ISTA routes to the next step based on input. Some tests are automated (ISTA can command the vehicle to run a test and read the result directly). The system tracks progress per procedure.

**Confidence / verdict:** The test plan prioritizes suspected components. After the tech completes a path, ISTA provides a repair recommendation. This is the clearest example of a tool-generated verdict based on the tech's path through the procedure.

**Handles ambiguity:** Procedures include "enter substitute values when needed" and support alternative branches. The tech can progress with an estimated value if they can't get an exact reading.

**Key pattern:** *Structured test plan with step tracking and a repair recommendation at the end* — the most complete loop: guided test → recorded result → system verdict. Aftermarket tools rarely reach this completeness. It's the design ceiling.

**Sources:** [BMW ISTA explained](https://brisbanebmwservice.com/bmw-ista-explained-the-diagnostic-software-behind-every-great-bmw-repair/) · [ISTA diagnostic platforms explained](https://automotivetraining.info/bmw-diagnostic-platforms-explained-aos-ista-air/)

---

### DSA PRODIS.WTS (Guided Diagnostics Platform)

**What it is:** An OEM/dealer-targeted guided diagnostics platform used by VW Group and others. Used at authorized dealerships. Notable for its authoring model.

**Sequence presentation:** Objects in the system are: customer-perceived symptoms → diagnostic symptoms → components → causes → preconditions → repair steps. The tech enters the symptom; the system builds a session-specific decision tree. Branching is conditional: each node outcome routes to the next test.

**Recording / routing:** Full step logging. Each step records its result. The system routes the next step based on recorded outcomes. Integration of "test sequences and measurements" means hardware-integrated results flow into the tree.

**Confidence / verdict:** Determined by tree traversal — the path the tech took through the decision tree leads to a confirmed cause and repair action.

**Handles ambiguity:** Preconditions can block a path if conditions aren't met. The system can route to a workaround if a condition fails.

**Key pattern:** *Authoring-driven conditional trees, not linear wizards* — the diagnostic content is defined by subject-matter experts as a tree, and the runtime system navigates it per session. This is the closest thing to what Vyntechs's `branch_logic` already encodes.

**Sources:** [DSA guided diagnostics (automotive)](https://www.dsa.de/en/automotive/applications/guided-diagnostics.html) · [Guided diagnostics supports efficient repair](https://dsa.de/en/news/news-detail/guided-diagnostics-supports-efficient-vehicle-repair.html)

---

### Par-Tech Enhanced Guided Diagnostics

**What it is:** Custom guided diagnostics systems for OEMs/dealers. Integrates live scan tool data directly into diagnostic steps.

**Key patterns:**
- Live data relating to the current step of the procedure is shown on-screen — the tech doesn't need a separate scan tool to get a reading; it appears inline.
- Can automatically check for related DTCs and forward the tech to the relevant procedure.
- Each recorded data event can be triggered automatically (for a DTC match) or manually.

**Source:** [Par-Tech enhanced diagnostics](https://www.partechgss.com/products/enhanced_diagnostics/)

---

### Shop Management Tools: Tekmetric, Shop-Ware

**What they are:** Shop management systems — repair orders, customer communications, invoicing. They are not diagnostic tools.

**Guided diagnostic relevance:** Minimal and indirect. Tekmetric has a "Guided Mode" for its inspection workflow that walks a service advisor or tech through best practices for filling out a digital vehicle inspection (DVI). The DVI is a pass/warn/fail checklist (pre-defined inspection items with photo/video attachment), not a branching diagnostic procedure.

**Key pattern:** *Checklist + photo attachment as the inspection UX* — simple, fast, and phone-native. Not a decision tree; every item is independent. Useful when the domain is inspection (known items to check), not diagnosis (unknown cause to find).

**Sources:** [Tekmetric performing an inspection](https://support.tekmetric.com/hc/en-us/articles/360037472154-Performing-an-Inspection) · [Tekmetric repair order workflow for technicians](https://support.tekmetric.com/hc/en-us/articles/360047413853-Repair-Order-Workflow-for-Technicians)

---

## 2. UX Shape Analysis

### Shape A: Ranked Confirmed-Fix List (Identifix, SureTrack)

The tech gets a prioritized list of "what fixed this in other cars." Each entry is a single-sentence hypothesis.

**Pros for bay use:** Extremely fast to read on a phone. No cognitive overhead. Highest-probability hypothesis first.
**Cons:** Passive — tech still has to figure out how to test each hypothesis. No path-narrowing as results come in. Doesn't help with rare or novel faults.
**Fit for Vyntechs:** Strong as a *starting point* or a complementary layer — "here's the most likely component based on real-world data." Does not replace the test-execution guidance.

### Shape B: Linear Card Wizard (Mitchell 1 GCT, Autel Guided Functions, BMW ISTA sub-procedures)

For a selected component, a fixed sequence of cards: description → location → connector view → test → waveform. Each card has a "next" action.

**Pros:** Easy to follow; no decision to make about what comes next. Low cognitive load. Well-suited for calibration/programming sequences where the order is fixed and conditions are known.
**Cons:** Brittle when the real world diverges from the expected path. Assumes the tech can run every step. No branching on outcome — the same sequence plays regardless of what the tech finds. Becomes frustrating quickly if the tech hits a step they can't do.
**Fit for Vyntechs:** Right shape for *per-component test execution* (once a component is selected, walk through its test procedure). Weak for *steering between components* based on what was found.

### Shape C: Decision Tree / Conditional Branching (Bosch SIS, DSA PRODIS, BMW ISTA full test plan, ALLDATA flow charts)

A branching tree where each step's outcome routes the next step. The classic OEM diagnostic procedure format.

**Pros:** Mirrors how expert diagnosticians actually think. Can handle ambiguity by branching on it. Produces a defensible, path-traced verdict.
**Cons:** Hard to read on a phone — trees get wide. Requires well-authored content for every branch. When a branch condition doesn't apply, the tech is lost. The tree has to be freshly authored per system/symptom; it doesn't emerge from a flat test list.
**Fit for Vyntechs:** The `branch_logic` rows in each `test_action` ARE already a decision-tree structure. The Vyntechs data model is a decision tree that hasn't been given a decision-tree UX yet. This is the most important fit.

### Shape D: Annotated Interactive Diagram (Autel Topology, Mitchell 1 Interactive Wiring, Par-Tech live data inline)

The diagram IS the navigation. Clicking a component opens its tests. Faulted components are visually flagged. Live data appears inline.

**Pros:** Spatial context — the tech sees where the component lives in the system, not just its name. No context-switching between diagram and data. Fastest path from "I see a problem" to "I start testing."
**Cons:** Requires the diagram to be correct and detailed enough to be useful. Mobile screen size limits how much can be shown at once. Adding guidance layers on top of a diagram risks visual overload.
**Fit for Vyntechs:** This is what the topology diagram already is. The Vyntechs topology is the closest existing analog to Autel's topology map or Mitchell 1's interactive wiring diagram. The question is how much guidance to layer onto the diagram vs. how much to push into a slide-up panel.

### Shape E: Session-Logged Step Journal (BMW ISTA full session, DSA PRODIS, Par-Tech)

The tool keeps a running log of: test run → result entered → next step taken. At the end, the log + path = a complete diagnostic session record.

**Pros:** Creates accountability and documentation. Enables a repair recommendation based on traversed path. The log is valuable for warranty/comebacks.
**Cons:** Adds recording overhead — every step requires a "confirm result" input from the tech. In a busy bay, that friction is real.
**Fit for Vyntechs:** High strategic value (creates a session record tied to the vehicle), but the recording UX needs to be lightweight — a single tap (pass/fail/skip), not a form.

---

## 3. Patterns That Recur Across All Tools

**Pattern 1: Probability-first ordering.**
Every sophisticated tool ranks hypotheses by likelihood before the tech lifts a wrench. Nobody sends a tech to step 1 of a 30-step procedure if step 22 fixes 80% of the cases.

**Pattern 2: The diagram as index.**
The best tools (Mitchell 1, Autel) use diagrams not as reference images but as live navigation. Clicking a component is the fastest path to everything known about it.

**Pattern 3: Component card — all info in one place.**
Setup instructions + connector view + expected value + known-good reference, all together. Forces the tech to context-switch as little as possible.

**Pattern 4: Live data inline with the step.**
Par-Tech and Snap-on Smart Data surface the relevant reading at the moment the tech needs it, inside the procedure. The tech isn't flipping between a "data monitor" screen and a "procedure" screen.

**Pattern 5: Light recording, strong routing.**
The tools that actually drive routing (Bosch, BMW ISTA, DSA) ask the tech for binary or simple inputs (in range / out of range, yes / no) and use that to branch. The recording UX is tap-light; the routing logic is the heavy work.

---

## 4. Patterns That Do Not Fit Vyntechs's Model

**Ranked confirmed-fix lists without test paths:** Identifix's model works because techs already know how to test a component — they just want to know which one to start with. Vyntechs's value is in teaching the test procedure, so the ranking needs to exist alongside the procedure, not instead of it.

**Strict linear wizards for diagnosis:** Fine for a calibration (fixed steps, fixed outcome). For diagnosis, the world doesn't cooperate — the tech will get an unexpected reading, or can't access a connector. A pure wizard without branching will strand the tech.

**Fully pre-built decision trees (ALLDATA model):** Static flowchart images from OEM manuals are hard to maintain and hard to use on a phone. Vyntechs already has the raw decision-tree data (`branch_logic` rows). The design question is how to render it interactively, not whether to create a static image.

**Full session logging with every result typed in:** Adds too much friction for a bay environment. The recording UX must be one-tap or voice-driven.

---

## 5. What "Guided Diagnosis on the Topology Diagram" Could Look Like — Options and Trade-offs

### Option A: Topology Map as the Whole UX — Highlight and Drill

The tech starts at the topology. Based on DTCs or symptom selection, faulted/suspected components are highlighted (color-coded). The tech taps a highlighted component → gets its component card. Inside the card, the test actions are shown in branch-logic order (not alphabetical). The card has a three-button footer: `Pass` / `Fail` / `Skip`. Tapping branches to the next recommended action (could be the next test on this component, or the tool recommends a different component based on the result).

The topology stays visible (or accessible) throughout — the tech can always see where they are in the system.

**Pros:** Leverages the existing topology without a new surface. Spatial context is preserved. No separate "guided mode" to enter.
**Cons:** Small per-component cards on a phone can feel cramped when the tech needs to see connector views. The diagram itself may feel noisy if multiple components are highlighted.
**Best for:** Techs who already understand the system and want to move fast. The guidance is ambient, not prescriptive.

### Option B: Guided Session Panel — Topology + Step Runner Side by Side

The tech enters "guided mode" from the topology (a button, or automatic on DTC import). A slide-up panel (or split view on tablet) shows the active step: component name, what to measure, where to probe, expected value. The topology diagram behind the panel highlights the active component. The tech enters a result (Pass/Fail/Skip/Other) and the system routes to the next step based on `branch_logic`. The panel shows a step counter ("Step 3 of ~8") and a progress trail showing what's been completed.

The topology is always visible in the background as a spatial anchor — the tech can see the component being tested in context.

**Pros:** Explicit sequence makes it usable for less experienced techs. Step counter reduces anxiety ("how long is this?"). The result-based routing uses the existing `branch_logic` data structure directly. Produces a session log automatically.
**Cons:** "Guided mode" is a modal context — harder to exit and return. Requires good estimation of step count (else the "~8" feels deceptive). Side-by-side layout needs a tablet to work well; on a phone, the topology is compressed.
**Best for:** Apprentice techs or unfamiliar systems. The guidance is explicit and prescriptive.

### Option C: Component Card with Inline Branch Routing — No Separate Mode

No "guided mode." The component card (already in Vyntechs) gains a "test this" section. Inside the card: the first test action is shown with its expected outcome(s). The tech taps the result they got. The card updates to show the next recommended action (whether that's the next step on the same component or a different component). There's a small "session trail" — a breadcrumb at the top of the card showing what's been done in this session.

The topology diagram updates passively — completed/passed components get a checkmark, failed get a flag.

**Pros:** Lowest friction to implement. Doesn't require a separate "mode." Works on phone natively. Fits the existing card model.
**Cons:** Less explicit about sequence — the tech sees one step at a time and may not understand where they are in the overall diagnosis. The topology diagram updates are subtle enough that they might go unnoticed.
**Best for:** Experienced techs who know the system but want branch-logic suggestions rather than a full walkthrough.

### Option D: Hybrid — Topology Overview + Progressive Reveal

The tech starts at the topology. The system (based on DTCs/symptoms) orders the components into a recommended test sequence. Components are numbered on the diagram: "1. Mass Airflow Sensor → 2. Boost Pressure Sensor → 3. EGR Valve." The tech taps component 1. The card opens with its test action and branch routing. When they complete it, the topology updates — component 1 gets a result badge, component 2 gets the active-state highlight. The tech always sees the full system and their progress within it.

**Pros:** Combines spatial overview (topology) with explicit sequence (numbered components). Progress is visible on the diagram itself without a separate progress panel. Experienced techs can skip ahead; guided techs follow the numbers.
**Cons:** Numbering on a topology diagram can get visually noisy. The sequencing logic (which component to test first?) needs to be deterministic and trustworthy, or techs will override it constantly.
**Best for:** Mixed experience levels. The numbers give guidance without being mandatory.

---

## 6. Key Trade-offs Summary

| Dimension | Option A | Option B | Option C | Option D |
|---|---|---|---|---|
| Good for experienced tech | Yes | Moderate | Yes | Yes |
| Good for apprentice tech | Moderate | Yes | No | Yes |
| Phone-native | Yes | Harder | Yes | Yes |
| Produces session log | Partial | Yes | Partial | Yes |
| Reuses existing data model | Yes | Yes | Yes | Yes |
| Implementation complexity | Low | Medium | Low | Medium |
| Visual noise on diagram | Low | Low | Low | Moderate |
| "Where am I in the diagnosis?" clarity | Low | High | Low | High |

---

## 7. Recommendation for the Brainstorm

The highest-value convergence is **Option D (topology overview + progressive reveal)**, constrained by Option C's card model for the component interaction.

The core insight from across every tool researched: the tools that best serve techs keep the *spatial/system overview* always visible while running the *current step* in a focused panel. The topology diagram is Vyntechs's biggest differentiating asset — it should never be hidden by the guidance layer, only enhanced.

The `branch_logic` rows are already decision-tree data. The remaining design question is the *routing UX*: how the tech records a result and receives the next step. The answer, based on every tool that has solved this: **binary or simple-categorical tap** (Pass / Fail / Skip, or the value bucket if needed). Typing a number into a field adds too much friction; asking for an exact reading is a form, not a step.

The one thing no aftermarket tool does well today — and where Vyntechs has an opening — is **using the topology diagram as the live progress indicator**. Autel shows health at the start (color-coded nodes). Mitchell 1 lets you click into data from the diagram. But neither uses the diagram as a running record of what's been tested, what passed, what failed, and what's next. That is the untapped design space.

---

*Research compiled from web sources on 2026-05-22. No training-data assumptions used for product-specific claims.*
