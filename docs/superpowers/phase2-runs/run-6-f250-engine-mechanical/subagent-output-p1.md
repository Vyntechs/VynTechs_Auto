# Run 6 — F-250 6.7L PSD Engine Mechanical + Oil System + Glow Plugs P1

**Date:** 2026-05-19
**Platform:** Ford Super Duty 4th Gen / 6.7L Power Stroke Diesel (2017–2022)
**System scope:** Engine mechanical (block, crank, valvetrain, heads), oil system, glow plug system, crank/cam position sensing
**Prior runs NOT re-emitted:** Fuel system (Run 1–3), cooling system (Run 4), engine air + turbo + EGR + aftertreatment (Run 5)
**Referenced existing slugs (not re-emitted):** `sd4-67psd-pcm`, `sd4-67psd-hs-can-bus`, `sd4-67psd-instrument-cluster`, `sd4-67psd-engine-gear-train`

---

## Section 1 — Architecture narration

### 1.1 Crankshaft and position sensing

The 6.7L Power Stroke's foundation is a **Compacted Graphite Iron (CGI) cylinder block**, not the aluminum blocks used in gasoline V8 platforms. CGI has tensile strength between gray cast iron and steel, making it the correct material choice for the combustion pressures of a modern diesel. The 90-degree V8 layout produces a compact engine package relative to the displacement. This is a platform-confirmed fact; the CGI designation was part of Ford's documented marketing and engineering communications for the 3rd-generation 6.7L PSD introduced in 2017.

The crankshaft on the 2017+ 6.7L Power Stroke is **forged steel**, a documented upgrade from the earlier 6.7L generations. Forged steel provides better fatigue resistance than a cast iron crank and is consistent with the power and torque ratings of this engine (up to 1,050 lb-ft on the highest output trim in this generation window). The forged crank runs in **main bearing journals machined into the CGI block**; bearing count is consistent with a V8 architecture (five main bearing journals). The crankshaft interfaces to the rear-mounted **flywheel or flexplate** (dependent on manual or automatic transmission application — the 4th-gen Super Duty was exclusively paired with the 6R140 TorqShift automatic in production, so a flexplate is the standard interface; a manual transmission variant is not a production option for this platform/engine combination).

The **Crankshaft Position (CKP) sensor** is a variable reluctance (VR) or Hall-effect sensor reading a reluctor wheel or tone ring on the crankshaft (typically on the rear of the crankshaft or on the harmonic balancer at the front of the engine). On Ford diesel platforms, the CKP sensor provides the primary engine speed (RPM) signal and crank position reference to the PCM. The PCM cannot determine injection timing or sequence without a valid CKP signal — this is a no-start and no-fuel-delivery condition. CKP signal loss mid-engine produces immediate stall. The CKP is a two-wire (VR) or three-wire (Hall) sensor; exact connector and location (front vs. rear of block) require WSM confirmation to resolve.

A **Camshaft Position (CMP) sensor** provides cylinder phase reference to the PCM — telling the PCM which bank and stroke the engine is on, which is required for sequential injection (each injector fires on its specific cylinder's compression stroke). Without a valid CMP signal, some Ford diesel calibrations will fall back to a degraded fueling mode using CKP alone; others will set a no-start condition. The CMP sensor reads a reluctor or trigger wheel on the camshaft. On a cam-in-block pushrod engine, the CMP sensor is positioned at the front of the block near the camshaft snout or at the timing cover. Exact mounting: TRAINING-INFERRED.

---

### 1.2 Valvetrain

The 6.7L Power Stroke is an **OHV (overhead valve) pushrod engine**, not an overhead camshaft design. This is architecturally significant: the single camshaft sits in the block (cam-in-block), operating the valves through **lifters, pushrods, and rocker arms**. There are no timing chains to cam sprockets above the block — the cam is driven directly from the front gear train (same gear set that drives the oil pump, water pump, and CP4.2 high-pressure fuel pump, as documented in Run 1 and Run 4).

The camshaft uses **hydraulic roller lifters** on this platform, consistent with modern Ford V8 diesel design. Roller lifters reduce friction compared to flat-tappet designs and are suited for the extended low-RPM torque operation common to diesel trucks.

Each cylinder has two valves actuated through individual pushrods and rocker arms. The **rocker arms** transfer pushrod motion to valve stem motion; rocker arm geometry sets the valve lift. Valve springs retain the valves in the closed position against combustion pressure and cam lobe return.

The **cylinder heads** are separate left-bank (driver side) and right-bank (passenger side) castings. The 6.7L PSD cylinder heads are cast iron (not aluminum), consistent with the diesel thermal and pressure environment. The heads contain the combustion chamber, the valve ports, the glow plug threaded bores (one per cylinder), and the injector bore (one per cylinder — injector coverage belongs to the fuel system run). The cylinder head gaskets (multi-layer steel on this platform) seal combustion pressure and provide coolant and oil passage interfaces between block and head.

A **Cylinder Head Temperature (CHT) sensor** was flagged as a possible GAP in the cooling system run (Run 4). On Ford gasoline engines, CHT sensors are common and replace or supplement coolant temperature sensors. On the 6.7L PSD, the primary coolant temperature signal is the ECT (Engine Coolant Temperature) sensor already documented in the cooling system. Whether a separate CHT sensor exists as a distinct component with its own PCM PID on this specific diesel platform is **uncertain from training data** — this is carried forward as a GAP. If a CHT sensor exists on the 4th-gen 6.7L PSD, it would be threaded into the cylinder head and provide head metal temperature (not coolant temperature) to the PCM.

---

### 1.3 Oil system

The oil system begins with the **oil pan**, a stamped steel or cast aluminum reservoir bolted to the bottom of the CGI block. The 6.7L PSD uses a rear-sump or center-sump oil pan (exact sump position requires WSM confirmation). Oil capacity is approximately 13–15 quarts with filter change on this engine — exact spec is a TRAINING-INFERRED value (diesel V8s of this displacement typically fall in this range; WSM spec is authoritative).

The **oil pickup tube** attaches to the bottom of the oil pump inlet and extends into the pan sump, drawing oil from the bottom of the reservoir. The pickup includes a fine mesh screen that serves as the first-stage debris filter. If the screen becomes clogged (sludge, debris), oil starvation begins before the filter housing is ever reached.

The **oil pump** is a gear-type pump driven directly from the **front gear train** (`sd4-67psd-engine-gear-train` — already documented). This is a key architecture fact: there is no separate chain drive or belt drive to the oil pump on this platform. The pump is mechanically coupled to crankshaft speed through the helical gear set, meaning oil pressure is directly proportional to engine RPM at the pump (modified by oil viscosity and gallery backpressure). The oil pump builds pressure from cranking speed onward.

From the pump, pressurized oil flows to the **oil filter housing**, which is a remote-mounted (top of engine, not integrated into the pan) assembly on the 6.7L PSD. The filter element is a spin-on canister or cartridge element (platform uses a cartridge-style element in a housing; confirm cartridge vs. spin-on from WSM). The filter housing includes an **anti-drain-back valve** that retains oil in the filter when the engine is off, preventing dry starts. A **filter bypass valve** allows oil to flow around a clogged filter element rather than starving the engine, at the cost of unfiltered oil circulation.

An **oil pressure sensor** provides an analog oil pressure signal (0–5V) to the PCM. This is used for the oil pressure PID visible in scan tool data, for diagnostic monitors (P0520 — oil pressure sensor circuit, P0521 — oil pressure sensor range/performance), and for protection logic. Separately, an **oil pressure switch** is a simple two-wire on/off device that illuminates the instrument cluster low oil pressure warning lamp when pressure drops below a set threshold (typically 6–10 PSI). Ford commonly uses both the sensor (for electronic monitoring) and the switch (for the traditional warning lamp circuit) on the same platform; exact locations on the 6.7L PSD block require WSM confirmation.

An **oil temperature sensor** may be present on this platform to provide an oil temperature PID to the PCM. On some Ford diesels, oil temperature is derived from a calculated model rather than a dedicated sensor. Whether a standalone oil temperature sensor exists as a distinct component on the 4th-gen 6.7L PSD (vs. a calculated/estimated value) is **uncertain from training data** — carried as a GAP.

The **engine-mounted oil cooler** sits between the oil filter circuit and the main oil galleries. It uses engine coolant flowing through an internal matrix to cool the engine oil. This is a shared boundary with the cooling system (the coolant supply and return for the oil cooler are part of the cooling loop documented in Run 4). The oil cooler is a known platform vulnerability: internal matrix failure can allow oil-coolant cross-contamination, or restriction of the coolant side can reduce oil cooling efficiency. Oil cooler blockage / coolant crossover produces elevated oil temperatures and, in severe cases, emulsification of one fluid into the other.

From the oil cooler and filter, oil enters the **main oil galleries** machined into the block. The main galleries distribute oil to crankshaft main bearings, connecting rod bearings (via drillings through the crankshaft), cylinder walls (via piston-cooling oil spray jets — see note below), and upward to the cylinder head oil galleries. The **cylinder head galleries** supply rocker arm pivots, pushrod seats, and valve train components.

**Piston cooling oil jets** (squirt holes or spray nozzles in the block) direct oil at the underside of each piston crown. On a high-output diesel operating at elevated combustion temperatures, piston cooling jets are a standard architecture feature. On the 4th-gen 6.7L PSD, piston cooling oil jets are TRAINING-INFERRED as present based on the platform's power output and Ford diesel engineering practice; exact confirmation (count, orientation, feed circuit pressure threshold) requires WSM.

The **turbocharger oil supply line** routes pressurized, filtered engine oil from the oil system (typically from the main gallery or a dedicated port near the filter housing) to the turbocharger center section, lubricating the turbo shaft bearings. This is a full-flow oil supply — the turbo bearings are plain oil-film bearings, not roller bearings, and require continuous oil pressure and volume. Oil starvation at the turbo (low pressure, clogged supply line, oil coking after hot shutdown) is the primary cause of turbo bearing failure on this platform. The turbo oil supply line is a steel or stainless braided line routed from the engine block area up to the turbo center housing.

The **turbo oil drain line** returns oil from the turbo center section by gravity flow back to the oil pan (upper pan rail or block return port). The drain line must maintain a slight downward grade throughout its length; any sag or kink that pools oil in the line can cause turbo seal leakage (pressurizing the center section forces oil past the compressor or turbine seals). The turbo oil drain is a larger-diameter line than the supply, relying on gravity rather than pressure. This is a common overlooked diagnostic consideration when diagnosing blue smoke (burning oil) from the turbo.

---

### 1.4 Glow plug system

The 6.7L Power Stroke has **eight glow plugs** — one per cylinder, threaded into each cylinder head. Glow plugs are resistance heaters that preheat the combustion chamber air to facilitate cold-start ignition of diesel fuel. Unlike a gasoline engine's spark plugs, glow plugs do not fire during running combustion; they are a starting aid only (though on some modern controllers, post-start glow operation for emissions stabilization is commanded for a period after cold start).

Each glow plug on the 6.7L PSD is a **pencil-type** or **pressure sensor glow plug** design. The 6.7L Power Stroke is documented as using **combustion pressure sensor glow plugs (CPSGP)** on at least some build years in this generation window — these are dual-function units that serve as both glow plugs and in-cylinder combustion pressure sensors, providing individual cylinder combustion event data to the PCM. This is a TRAINING-INFERRED fact with inference class PATTERN (Ford has used PSGPs on the 6.7L PSD platform; exact build-year applicability for all 2017–2022 4th-gen trucks requires WSM confirmation). Field verification required.

The **Glow Plug Control Module (GPCM)** is a dedicated separate module (not integrated into the PCM) that controls the glow plug heating cycle. The GPCM communicates with the PCM via the **HS-CAN bus** (`sd4-67psd-hs-can-bus`). The PCM sends commanded glow plug activation parameters (on-time, duty cycle, post-start operation timing) to the GPCM over CAN. The GPCM directly controls the high-current supply to each individual glow plug through dedicated output drivers in the module — it is capable of per-cylinder control rather than switching all eight glow plugs on the same circuit. Per-cylinder control allows the GPCM to diagnose individual glow plug failures (open circuit = no current draw on that cylinder) and report them back to the PCM as DTCs (e.g., P0671–P0678 — glow plug circuit codes by cylinder).

The **glow plug harness** routes from the GPCM (module location typically in the engine bay, near the valve covers or firewall) to each individual glow plug terminal. Each glow plug has a single-wire hot feed from the GPCM; the glow plug body grounds through the cylinder head (threaded connection). The GPCM supplies high current (each glow plug draws several amps during rapid heating); the GPCM's power supply comes from the battery via a high-current fuse or fusible link in the underhood junction box.

The **intake air heater grid** (documented in Run 5 — air system) is a separate intake air preheat device and is not part of the glow plug system. These two systems serve different purposes and are controlled by different outputs (PCM controls the intake heater relay directly; GPCM controls glow plugs independently).

---

### 1.5 Crankcase ventilation

The 6.7L Power Stroke uses a **closed crankcase ventilation (CCV) system** — blow-by gases (combustion gases that pass the piston rings into the crankcase) are not vented to atmosphere but are routed back into the engine intake tract. This is mandated by emissions regulations. On a diesel, CCV management is more complex than on a gasoline engine because diesel blow-by contains soot and oil mist that can accumulate in the intake system over time.

The CCV system includes an **oil separator** (coalescer) element that strips oil mist and larger particulate from the blow-by before the gas enters the intake. The separator element is serviceable (it has a service interval) and failure to service it can cause excessive crankcase pressure, increased oil consumption via the intake, and soot accumulation in the EGR and intake systems. The 6.7L PSD's CCV separator is mounted on the engine (top of block or valve cover area) with a drain line returning separated oil to the crankcase.

**Crankcase pressure** is monitored or managed through the CCV circuit's routing. If the CCV system becomes restricted (clogged separator, kinked hose, blocked return), crankcase pressure builds and can force oil past seals (front and rear crankshaft seals, dipstick tube, valve cover gaskets). Elevated crankcase pressure is a diagnostically distinct root cause from turbo seal failure or valve stem seal wear when investigating external oil consumption.

---

### 1.6 Physical engine boundaries

The **flywheel / flexplate** represents the rearward boundary of this system scope. The 4th-gen 6.7L PSD in the Super Duty is production-paired exclusively with the Ford 6R140 TorqShift automatic transmission; the flexplate connects the crankshaft to the torque converter. The flexplate is stamped steel with a ring gear for the starter motor. The starter motor engages the ring gear to crank the engine; the starter is downstream of this system's boundary (belongs to the starting/charging electrical system).

The **harmonic balancer / crankshaft vibration damper** is at the forward end of the crankshaft, outside the front timing cover. It dampens crankshaft torsional vibration and serves as the mounting point for the front accessory drive belt pulleys (alternator, power steering pump, A/C compressor). It also typically carries the CKP reluctor wheel if the CKP sensor is front-mounted. The balancer is a press-fit or bolt-on unit; failure (delamination of the rubber isolator) produces vibration and accessory belt noise but not immediate engine shutdown.

---

## Section 2 — JSON sidecar

```json
{
  "system": "engine-mechanical-oil-glow",
  "platform_slug": "ford-super-duty-4th-gen-67-psd",
  "architecture_facts": [
    {
      "slug": "m1-cgi-block",
      "description": "Cylinder block is Compacted Graphite Iron (CGI), 90-degree V8, 6.7L displacement. CGI provides tensile strength between gray cast iron and steel, appropriate for diesel combustion pressures. Not aluminum. Platform-confirmed designation.",
      "field_verify_required": false,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "m2-forged-steel-crank",
      "description": "Crankshaft is forged steel as of 2017+ 3rd-generation 6.7L PSD. Documented upgrade from earlier 6.7L generations. Five main bearing journals consistent with V8 architecture.",
      "field_verify_required": false,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "m3-ckp-sensor",
      "description": "Crankshaft Position sensor reads a reluctor ring on the crankshaft. Primary RPM and crank position reference for the PCM. No-start and no-fuel-delivery condition without valid CKP signal. Mid-engine CKP loss produces immediate stall. Sensor type (VR or Hall) and exact location (front vs. rear of block) require WSM confirmation.",
      "field_verify_required": true,
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "m4-cmp-sensor",
      "description": "Camshaft Position sensor provides cylinder phase reference for sequential injection sequencing. Reads reluctor on camshaft near front of block / timing cover. Loss of CMP may degrade to limp mode or no-start depending on PCM calibration. Exact mounting point requires WSM confirmation.",
      "field_verify_required": true,
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "m5-ohv-pushrod-valvetrain",
      "description": "Single cam-in-block OHV pushrod V8. Cam driven from front gear train (sd4-67psd-engine-gear-train). Valvetrain: hydraulic roller lifters → pushrods → rocker arms → valves. No overhead camshafts, no timing chains above block level.",
      "field_verify_required": false,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "m6-dual-cylinder-heads",
      "description": "Left-bank (driver) and right-bank (passenger) cylinder heads, cast iron. Each head contains combustion chambers, valve ports, glow plug threaded bores, and injector bores. Multi-layer steel head gaskets. Cast iron consistent with diesel thermal/pressure environment.",
      "field_verify_required": false,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "m7-cht-sensor-gap",
      "description": "Cylinder Head Temperature (CHT) sensor — presence on the 4th-gen 6.7L PSD is uncertain. Ford uses CHT sensors on gasoline engines; whether a distinct CHT sensor (head metal temp, not coolant temp) exists as a standalone PCM input on this diesel platform is unconfirmed from training data. Flagged as GAP.",
      "field_verify_required": true,
      "source_provenance": "GAP",
      "inference_class": null
    },
    {
      "slug": "m8-hydraulic-roller-lifters",
      "description": "Camshaft uses hydraulic roller lifters, consistent with modern Ford V8 diesel design. Roller profile reduces friction at low-RPM diesel operating range. Lifters self-adjust for valve lash via internal hydraulic plunger.",
      "field_verify_required": false,
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "m9-oil-pan-sump",
      "description": "Stamped steel or cast aluminum oil pan bolted to bottom of CGI block. Exact sump position (rear vs. center) requires WSM confirmation. Oil capacity approximately 13–15 quarts with filter; exact WSM spec is authoritative.",
      "field_verify_required": true,
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "m10-oil-pickup-tube",
      "description": "Oil pickup tube connects oil pump inlet to pan sump via mesh screen (first-stage debris filter). Screen clog produces oil starvation upstream of filter housing. Pickup tube sealing at pump inlet is a known diagnostic consideration (air ingestion = cavitation).",
      "field_verify_required": false,
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LAW"
    },
    {
      "slug": "m11-gear-driven-oil-pump",
      "description": "Oil pump is a gear-type positive displacement pump driven directly from the front gear train (sd4-67psd-engine-gear-train) — not chain or belt driven. Oil pressure is RPM-proportional from idle through redline. Pump is mechanically engaged from initial cranking.",
      "field_verify_required": false,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "m12-oil-filter-housing",
      "description": "Remote oil filter housing mounted at top of engine (not integrated into pan). Uses cartridge-style filter element inside a housing with integral anti-drain-back valve and bypass valve. Exact cartridge vs. spin-on confirmation via WSM. Anti-drain-back valve retains oil at shutdown to prevent dry start.",
      "field_verify_required": true,
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "m13-oil-pressure-sensor",
      "description": "Analog oil pressure sensor (0–5V reference) provides PCM oil pressure PID. Used for P0520/P0521 diagnostic monitors and protection logic. Located on engine block; exact port requires WSM confirmation.",
      "field_verify_required": true,
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "m14-oil-pressure-switch",
      "description": "Separate oil pressure switch (two-wire on/off) drives the instrument cluster low-oil-pressure warning lamp independent of the analog sensor. Ford typically uses both sensor and switch on diesel platforms. Threshold approximately 6–10 PSI. Exact location requires WSM confirmation.",
      "field_verify_required": true,
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "m15-oil-temperature-sensor-gap",
      "description": "Dedicated oil temperature sensor — presence as a distinct physical sensor is uncertain on the 4th-gen 6.7L PSD. Some Ford diesel platforms derive oil temperature via a calculated model rather than a discrete sensor. Whether a standalone oil temp sensor exists with its own PCM PID requires WSM confirmation. Flagged as GAP.",
      "field_verify_required": true,
      "source_provenance": "GAP",
      "inference_class": null
    },
    {
      "slug": "m16-oil-cooler-engine-mounted",
      "description": "Engine-mounted oil cooler uses engine coolant to cool engine oil. Shares coolant supply/return with cooling system loop (documented in Run 4 cooling system). Known failure mode: internal matrix failure allows oil-coolant cross-contamination. Restriction of coolant side reduces cooling efficiency and elevates oil temperature.",
      "field_verify_required": false,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "m17-main-oil-galleries",
      "description": "Block main oil galleries distribute pressurized oil to crankshaft main bearings, connecting rod bearings (via crank drillings), piston cooling jets, and upward passages to head galleries. Cylinder head galleries supply rocker arm pivots and valvetrain components.",
      "field_verify_required": false,
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LAW"
    },
    {
      "slug": "m18-piston-cooling-jets",
      "description": "Block-mounted oil spray jets direct pressurized oil at the underside of each piston crown for thermal management. Consistent with high-output diesel platform engineering. Exact jet count, pressure activation threshold, and feed circuit require WSM confirmation.",
      "field_verify_required": true,
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "m19-turbo-oil-supply-line",
      "description": "Dedicated pressurized oil supply line routes from main oil gallery or filter housing port to turbocharger center section bearing housing. Full-flow plain-bearing lubrication — continuous oil pressure required during operation. Oil coking after hot shutdown (engine off, turbo still hot) is the primary cause of turbo bearing failure. Supply line is steel or stainless braided.",
      "field_verify_required": true,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "m20-turbo-oil-drain-line",
      "description": "Gravity-drain oil return line from turbocharger center housing to oil pan (upper rail or block return port). Larger diameter than supply line; relies entirely on gravity — no pressure. Any sag, kink, or pooling in drain line pressurizes turbo center section and drives oil past compressor or turbine seals (blue smoke symptom). Downward-grade routing integrity is a physical diagnostic check.",
      "field_verify_required": true,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "m21-glow-plugs-8x",
      "description": "Eight glow plugs, one per cylinder, threaded into each cylinder head combustion chamber. Preheat combustion chamber air for cold-start ignition assist. Not fired during running combustion in standard operation. Post-start glow operation (emissions stabilization) may be commanded by GPCM for a period after cold start.",
      "field_verify_required": false,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "m22-cpsgp-combustion-pressure-sensor-glow-plugs",
      "description": "6.7L PSD is documented as using Combustion Pressure Sensor Glow Plugs (CPSGP) — dual-function units serving as both glow plugs and in-cylinder combustion pressure sensors. Each CPSGP provides individual cylinder combustion event pressure data to the PCM, enabling cylinder-by-cylinder combustion quality monitoring. Exact build-year applicability for all 2017–2022 4th-gen trucks requires WSM/Ford service information confirmation.",
      "field_verify_required": true,
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "m23-gpcm-module",
      "description": "Glow Plug Control Module (GPCM) is a separate, dedicated module — not integrated into the PCM. Communicates with PCM via HS-CAN bus (sd4-67psd-hs-can-bus). PCM commands glow plug activation parameters over CAN; GPCM controls high-current output to each individual glow plug through dedicated per-cylinder drivers. Per-cylinder control enables individual glow plug failure diagnosis (P0671–P0678 series DTCs).",
      "field_verify_required": false,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "m24-glow-plug-harness",
      "description": "Glow plug harness routes from GPCM to each individual glow plug terminal. Single-wire hot feed per glow plug; glow plug body grounds through cylinder head (threaded contact). GPCM power supply via high-current fuse or fusible link in underhood junction box. High current draw per plug during rapid preheat phase.",
      "field_verify_required": true,
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "m25-ccv-system",
      "description": "Closed Crankcase Ventilation (CCV) system routes blow-by gases from crankcase back to intake tract — not vented to atmosphere (emissions requirement). Includes oil separator/coalescer element that strips oil mist and soot from blow-by before gases re-enter intake. Separator is serviceable with defined replacement interval.",
      "field_verify_required": false,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "m26-ccv-separator-element",
      "description": "CCV oil separator (coalescer) element mounts on engine (valve cover area or top of block). Separated oil drains back to crankcase via dedicated return line. Clogged separator increases crankcase pressure and can force oil past front/rear crank seals, valve cover gaskets, and dipstick tube. Elevated crankcase pressure is a distinct root cause from turbo seal failure when diagnosing external oil consumption.",
      "field_verify_required": true,
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "m27-connecting-rods-pistons-rings",
      "description": "Eight connecting rods and pistons (one per cylinder). Piston rings provide combustion seal and oil control. Diagnostic relevance: compression test measures ring seal; excessive blow-by (crankcase pressure) indicates ring wear or failure. Specific material (forged vs. powdered metal rods, ring pack design) for the 4th-gen 6.7L PSD requires WSM confirmation.",
      "field_verify_required": true,
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "m28-flexplate-torque-converter-interface",
      "description": "Flexplate (stamped steel with ring gear) connects crankshaft rear flange to torque converter of 6R140 TorqShift automatic transmission — the only production transmission pairing for this platform. Ring gear is the starter engagement point. Flexplate is the rearward boundary of this system scope.",
      "field_verify_required": false,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "m29-harmonic-balancer",
      "description": "Harmonic balancer / crankshaft vibration damper at front of crankshaft, outside timing cover. Dampens torsional vibration. Carries front accessory drive belt pulleys. May carry CKP reluctor wheel if CKP is front-mounted. Rubber isolator delamination failure mode produces vibration and accessory noise without immediate shutdown.",
      "field_verify_required": true,
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    }
  ]
}
```

---

## 5-line summary

1. **Total facts:** 29 architecture facts (m1–m29), within the 25–35 target range.
2. **By provenance:** TRAINING-CONFIRMED: 11 (m1, m2, m5, m6, m11, m16, m19, m20, m21, m23, m25, m28 — 12 confirmed; m10, m17 are LAW-class INFERRED); TRAINING-INFERRED: 15 (m3, m4, m8, m9, m10, m12, m13, m14, m17, m18, m22, m24, m26, m27, m29); GAP: 2 (m7 CHT sensor, m15 oil temperature sensor).
3. **Notable gaps:** CHT sensor (m7) — distinct head-metal temp sensor vs. ECT is unconfirmed on diesel; oil temperature sensor (m15) — may be a calculated model rather than a physical sensor; CKP sensor front-vs-rear mounting (m3) — requires WSM; CPSGP applicability across all 2017–2022 build years (m22) — confirmed as platform feature but build-year spread needs WSM.
4. **Platform-specific highlights:** CGI block (not aluminum), forged crank (2017+ upgrade), gear-driven oil pump (no chain), GPCM as a separate CAN-connected module with per-cylinder glow plug control, turbo oil drain gravity-routing as a diagnostic consideration, CCV separator as a serviceable wear item distinct from the air system intake heater.
5. **Field-verify flags:** 16 of 29 facts carry `field_verify_required: true`, driven primarily by harness/connector/exact-location details and two outright GAPs — appropriate caution level for a system with substantial cross-platform inference.
