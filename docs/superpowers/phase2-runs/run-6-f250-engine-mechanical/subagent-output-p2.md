# Run 6 — F-250 6.7L PSD Engine Mechanical + Oil System + Glow Plugs P2

**Date:** 2026-05-19
**Platform:** Ford Super Duty 4th Gen / 6.7L Power Stroke Diesel (2017–2022)
**Input source:** subagent-output-p1.md (m1–m29)
**Existing slugs referenced (not re-emitted):** sd4-67psd-pcm, sd4-67psd-hs-can-bus, sd4-67psd-instrument-cluster, sd4-67psd-engine-gear-train, sd4-67psd-cp4-pump, sd4-67psd-vgt-turbo, sd4-67psd-egr-cooler, sd4-67psd-injector-1 through sd4-67psd-injector-8

---

## Section 1 — Decomposition prose

### 1.1 Crankshaft / Valvetrain group

The **cylinder block** (sd4-67psd-cylinder-block) is the structural foundation of the system — Compacted Graphite Iron (CGI), 90-degree V8. It contains the machined main bearing journals, all oil gallery passages, piston cooling jet bores, and the crankcase volume that the CCV system manages. Virtually every other mechanical component in this group either bolts to or lives inside the block; it is the reference node for physical location on all other components.

The **crankshaft** (sd4-67psd-crankshaft) is forged steel (2017+ confirmed upgrade), running five main bearing journals in the block. It converts piston reciprocating force into rotational torque. At its forward snout it connects to the front gear train and carries the harmonic balancer. At its rear flange it drives the flexplate. The crankshaft is also drilled internally to route oil from the main bearing journals outward to the connecting rod bearing journals.

The **harmonic balancer** (sd4-67psd-harmonic-balancer) bolts to the crankshaft front snout. It dampens torsional crankshaft vibration through a rubber-isolated outer ring. It carries the accessory drive belt pulley surfaces and — on this platform — most likely hosts the CKP reluctor wheel if the CKP sensor is front-mounted (field-verify-required). Delamination of the rubber isolator is a diagnosable failure mode (visible cracking, vibration, belt walk) that does not produce an immediate shutdown.

The **flexplate** (sd4-67psd-flexplate) bolts to the crankshaft rear flange. Stamped steel with a ring gear on its outer diameter. The ring gear is the starter motor engagement surface. The flexplate center connects to the 6R140 torque converter. It is the rearward structural boundary of the engine mechanical system scope.

The **camshaft** (sd4-67psd-camshaft) sits inside the block, driven by the front gear train at half crankshaft speed. Lobe profiles lift the hydraulic roller lifters; lifter motion transfers through pushrods to rocker arms. The cam snout carries a reluctor wheel or trigger ring read by the CMP sensor.

The **hydraulic roller lifters** (sd4-67psd-valvetrain-lifters — emitted as a single grouped component covering all 16 lifters) translate cam lobe rotation to linear pushrod motion. Each lifter has an internal hydraulic plunger that self-adjusts to maintain zero valve lash. Collapsed lifters produce a characteristic mechanical tick at low RPM that is audible and worsens with oil pressure drops.

The **pushrods and rocker arms** are grouped as **sd4-67psd-valvetrain-rockers**. Each pushrod transfers lifter motion up through the head to the rocker arm; the rocker pivots and opens the valve. Rocker arm geometry sets the ratio of pushrod motion to valve lift. Bent pushrods and rocker wear are direct observables through valve cover removal.

The **CKP sensor** (sd4-67psd-ckp-sensor) is a 2- or 3-wire sensor reading the crankshaft reluctor ring. Provides the primary engine speed (RPM) and crank position signal to the PCM. Loss of CKP = no-start + no-fuel-delivery in all conditions; mid-engine loss = immediate stall. TRAINING-INFERRED on exact location (front vs. rear mount) — WSM required.

The **CMP sensor** (sd4-67psd-cmp-sensor) reads a cam-mounted reluctor at the front of the block near the timing cover. Provides cylinder phase reference to the PCM for sequential injection. Loss of CMP: PCM calibration-dependent — may fall back to degraded fueling using CKP alone or may no-start. WSM confirmation on exact mount and fallback behavior required.

### 1.2 Cylinder Heads group

The **driver-side cylinder head** (sd4-67psd-cylinder-head-driver) and **passenger-side cylinder head** (sd4-67psd-cylinder-head-passenger) are separate cast-iron castings bolted to the top of the block. Each contains four combustion chambers (one per cylinder), valve ports, multi-layer steel head gasket mating surfaces, glow plug threaded bores, injector bores (fuel system — existing slugs sd4-67psd-injector-1 through -8), oil passage feeds to valvetrain, and coolant jacket passages. Cast iron is the correct material — aluminum heads are not appropriate for diesel combustion pressures. Head gasket failure is a key failure mode: combustion gas into coolant, coolant into oil, or direct cylinder-to-cylinder breach.

A **CHT sensor** (sd4-67psd-cht-sensor) is emitted as a GAP component — presence on the 4th-gen 6.7L PSD as a distinct head-metal temperature sensor (vs. the ECT sensor from the cooling system run) is unconfirmed from training data. If present, it would be threaded into one cylinder head and provide a head-metal temp PID to the PCM.

### 1.3 Oil System group

The **oil pan** (sd4-67psd-oil-pan) is the oil reservoir bolted beneath the block. Oil drains from the engine and turbo drain line into this reservoir. Exact sump position (rear vs. center) is TRAINING-INFERRED; capacity approximately 13–15 quarts with filter (WSM-authoritative).

The **oil pickup tube** (sd4-67psd-oil-pickup-tube) connects the bottom of the oil pump to the pan sump through a mesh screen. First-stage debris filter. If the mesh screen clogs with sludge, oil starvation begins before any downstream oil filter is ever reached. Air ingestion at a loose pickup-to-pump seal produces cavitation (frothy, aerated oil, pressure fluctuation).

The **oil pump** (sd4-67psd-oil-pump) is a positive-displacement gear-type pump driven directly from the front gear train (sd4-67psd-engine-gear-train). No separate chain or belt. Oil pressure is proportional to engine RPM from cranking onward. The pump discharges into the oil system supply path toward the filter housing.

The **oil filter housing** (sd4-67psd-oil-filter-housing) is remote-mounted at the top of the engine (not integrated into the pan). Houses the cartridge filter element. Contains an anti-drain-back valve (retains oil at shutdown to prevent dry starts) and a bypass valve (routes oil around a clogged filter element to prevent starvation — at the cost of unfiltered circulation). The housing is a service-access point for oil pressure sensor port and filter replacement.

The **oil cooler** (sd4-67psd-oil-cooler) is engine-mounted between the filter circuit and main galleries. Coolant flows through an internal matrix to cool engine oil. Shared boundary with the cooling system (Run 4 coolant loop). Known failure: internal matrix breach allows oil-coolant cross-contamination. Restricted coolant side = elevated oil temp without obvious external leak.

The **oil pressure sensor** (sd4-67psd-oil-pressure-sensor) is an analog 0–5V sensor threaded into the block, providing the PCM's oil pressure PID. Used for P0520/P0521 DTC monitors and ECM protection logic. Distinct from the warning lamp switch.

The **oil pressure switch** (sd4-67psd-oil-pressure-switch) is a two-wire on/off device that grounds the instrument cluster low-oil-pressure warning lamp when pressure drops below threshold (~6–10 PSI). Electrically simpler than the sensor; serves as the traditional dash warning independent of the PCM's analog monitoring.

The **oil temperature sensor** (sd4-67psd-oil-temp-sensor) is emitted as a GAP component — may not exist as a discrete physical sensor on this platform; oil temp may be a PCM-calculated estimate. If present, it would be in the oil gallery or pan and feed a dedicated PCM PID.

The **piston cooling jets** (sd4-67psd-piston-cooling-jets — grouped component, one per cylinder, 8 total) are block-mounted spray nozzles fed from the main oil gallery. Each jet directs pressurized oil at the underside of its cylinder's piston crown. Cooling function is critical at high load/temperature. A pressure-check valve on each jet prevents oil spray at idle (where gallery pressure is insufficient) — jets activate when pressure exceeds the valve threshold. Exact feed-pressure threshold is TRAINING-INFERRED (WSM-authoritative).

The **turbo oil supply line** (sd4-67psd-turbo-oil-supply-line) routes pressurized filtered oil from the main gallery or filter housing area up to the VGT turbocharger center housing. Full-flow plain bearing lubrication. Oil coking (carbon deposit from baked residual oil after hot shutdown) is the primary physical cause of turbo bearing failure over time.

The **turbo oil drain line** (sd4-67psd-turbo-oil-drain-line) gravity-returns oil from the turbo center housing back to the oil pan. Larger diameter than the supply line. Gravity-only — no back-pressure. Sag, kink, or pooling in the drain line can pressurize the turbo center section and push oil past compressor or turbine seals (blue smoke diagnostic symptom).

### 1.4 Glow Plug system group

Eight **glow plugs** (sd4-67psd-glow-plug-1 through sd4-67psd-glow-plug-8, one per cylinder) are threaded into each combustion chamber bore in the cylinder heads. These are documented as Combustion Pressure Sensor Glow Plugs (CPSGP) on at least some 4th-gen build years — dual-function units that both heat the prechamber air and relay in-cylinder combustion pressure data back through the GPCM to the PCM. This makes each glow plug a sensor as well as a heater; the "combustion pressure" signal is the diagnostic pathway for per-cylinder misfire and combustion quality evaluation without spark plug access. Build-year applicability across all 2017–2022 requires WSM confirmation.

The **GPCM** (sd4-67psd-gpcm — Glow Plug Control Module) is a dedicated standalone module communicating with the PCM over the HS-CAN bus. It receives PCM commands (on-time, duty cycle, post-start schedule) and drives high-current output to each glow plug individually through its own per-cylinder driver circuits. Per-cylinder control enables the GPCM to detect open-circuit failures on individual plugs and log P0671–P0678 DTCs. The GPCM is powered from the battery via a high-current fuse or fusible link in the underhood junction box.

### 1.5 Crankcase Ventilation group

The **CCV separator** (sd4-67psd-ccv-separator) is a coalescer/oil-separator unit mounted on or near the valve cover area. Blow-by gases from the crankcase pass through the separator element; oil mist and soot particles are stripped and drain back to the crankcase via a dedicated oil return line. The cleaned blow-by gas routes back to the intake tract. The separator element is serviceable — it has a defined replacement interval. A clogged separator raises crankcase pressure and can force oil past front/rear crankshaft seals and valve cover gaskets, producing external oil loss that mimics turbo seal failure.

### 1.6 Engine Boundary notes

**Gaps carried forward from P1:**
- CHT sensor (m7) — discrete head-metal temp sensor vs. ECT: unconfirmed on this diesel platform
- Oil temperature sensor (m15) — may be PCM-calculated rather than a physical sensor
- CKP sensor exact mounting location (front vs. rear of block) — m3
- CPSGP build-year coverage across all 2017–2022 4th-gen trucks — m22

**Cross-system connections noted:**
- Oil cooler shares coolant supply/return with the cooling system loop (Run 4 — coolant system)
- Turbo oil supply and drain lines interface with sd4-67psd-vgt-turbo (Run 5 — air/turbo system)
- CCV separator output routes to engine air intake tract (Run 5 — air system)
- Cylinder heads contain injector bores (sd4-67psd-injector-1 through -8, Run 1–3 — fuel system)
- Front gear train (sd4-67psd-engine-gear-train) drives the oil pump, cam, CP4, and water pump at fixed ratios

---

## Section 2 — JSON sidecar

```json
{
  "components": [
    {
      "slug": "sd4-67psd-cylinder-block",
      "name": "Cylinder Block (CGI)",
      "kind": "mechanical",
      "electrical_contract": null,
      "location": "Engine center — structural foundation, 90-degree V8 layout",
      "function": "Structural housing for crankshaft, camshaft, pistons, oil galleries, and crankcase. CGI material resists diesel combustion pressures. Contains main bearing journals, piston cooling jet bores, and CCV blow-by volume.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-crankshaft",
      "name": "Crankshaft (Forged Steel)",
      "kind": "mechanical",
      "electrical_contract": null,
      "location": "Inside cylinder block, running in five main bearing journals",
      "function": "Converts piston reciprocating force to rotational torque. Drilled internally for rod bearing oil supply. Forward snout interfaces to gear train and harmonic balancer; rear flange to flexplate.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-harmonic-balancer",
      "name": "Harmonic Balancer / Crankshaft Vibration Damper",
      "kind": "mechanical",
      "electrical_contract": null,
      "location": "Front of crankshaft snout, outside front timing cover",
      "function": "Dampens torsional crankshaft vibration via rubber isolator. Carries accessory drive belt pulley surface. May carry CKP reluctor wheel if CKP sensor is front-mounted (field-verify).",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "sd4-67psd-flexplate",
      "name": "Flexplate (with Ring Gear)",
      "kind": "mechanical",
      "electrical_contract": null,
      "location": "Crankshaft rear flange, between engine block and 6R140 torque converter",
      "function": "Connects crankshaft to 6R140 TorqShift torque converter. Ring gear is starter motor engagement surface. Rearward structural boundary of engine mechanical system scope.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-camshaft",
      "name": "Camshaft",
      "kind": "mechanical",
      "electrical_contract": null,
      "location": "Inside cylinder block (cam-in-block OHV design), driven from front gear train",
      "function": "Rotates at half crankshaft speed to actuate hydraulic roller lifters via lobe profiles. Cam snout carries CMP reluctor wheel. Drives OHV valvetrain for all 8 cylinders.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-valvetrain-lifters",
      "name": "Hydraulic Roller Lifters (16x)",
      "kind": "mechanical",
      "electrical_contract": null,
      "location": "Block lifter bores, one per valve (16 total for 8 cylinders, 2 valves each)",
      "function": "Translate cam lobe rotation to linear pushrod motion. Internal hydraulic plunger self-adjusts for zero valve lash. Roller follower reduces friction at low-RPM diesel operation. Collapsed lifters produce audible tick at low RPM.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "sd4-67psd-valvetrain-rockers",
      "name": "Pushrods and Rocker Arms (16x each)",
      "kind": "mechanical",
      "electrical_contract": null,
      "location": "Cylinder heads — pushrods traverse head bolt area; rocker arms pivot on head-mounted studs or shafts",
      "function": "Transfer lifter motion through pushrods to rocker arms, which pivot to open intake and exhaust valves. Rocker geometry sets valve lift ratio. Bent pushrods and rocker wear are visually observable with valve cover removed.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-ckp-sensor",
      "name": "Crankshaft Position (CKP) Sensor",
      "kind": "sensor",
      "electrical_contract": "2-wire (VR type) or 3-wire (Hall-effect) — WSM confirmation required",
      "location": "Front of engine near harmonic balancer or rear of block near flywheel — exact location WSM-required",
      "function": "Primary engine RPM and crank position reference to PCM. No-start / no-fuel-delivery without valid CKP signal. Mid-engine loss causes immediate stall. Reads reluctor ring on crankshaft.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "sd4-67psd-cmp-sensor",
      "name": "Camshaft Position (CMP) Sensor",
      "kind": "sensor",
      "electrical_contract": "3-wire Hall-effect (typical Ford diesel) — WSM confirmation required",
      "location": "Front of block near timing cover, reading cam snout reluctor wheel",
      "function": "Provides cylinder phase reference to PCM for sequential injection sequencing. Loss of CMP may cause PCM fallback to degraded fueling using CKP alone, or may produce no-start depending on PCM calibration.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "sd4-67psd-cylinder-head-driver",
      "name": "Cylinder Head — Driver Side (Left Bank)",
      "kind": "mechanical",
      "electrical_contract": null,
      "location": "Top of block, driver (left) bank — bolted via head bolts with multi-layer steel head gasket",
      "function": "Houses 4 combustion chambers, intake/exhaust valve ports and seats, glow plug threaded bores, injector bores, oil passage feeds to valvetrain, and coolant jacket passages. Cast iron construction.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-cylinder-head-passenger",
      "name": "Cylinder Head — Passenger Side (Right Bank)",
      "kind": "mechanical",
      "electrical_contract": null,
      "location": "Top of block, passenger (right) bank — bolted via head bolts with multi-layer steel head gasket",
      "function": "Houses 4 combustion chambers, intake/exhaust valve ports and seats, glow plug threaded bores, injector bores, oil passage feeds to valvetrain, and coolant jacket passages. Cast iron construction.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-cht-sensor",
      "name": "Cylinder Head Temperature (CHT) Sensor — GAP",
      "kind": "sensor",
      "electrical_contract": "2-wire (if present) — presence unconfirmed",
      "location": "Threaded into cylinder head (bank and exact port unknown) — if present",
      "function": "Provides head metal temperature (not coolant temperature) to PCM as a distinct PID. Presence on 4th-gen 6.7L PSD as a standalone sensor is unconfirmed — may not exist as a separate component (ECT from cooling system may be sole thermal input).",
      "source_provenance": "GAP",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-oil-pan",
      "name": "Oil Pan (Sump)",
      "kind": "mechanical",
      "electrical_contract": null,
      "location": "Bottom of cylinder block — bolted to lower block rail",
      "function": "Oil reservoir. Receives drain-back oil from block galleries, head galleries, and turbo drain line. Sump position (rear vs. center) WSM-required. Oil capacity approximately 13–15 qt with filter (WSM-authoritative).",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "sd4-67psd-oil-pickup-tube",
      "name": "Oil Pickup Tube and Screen",
      "kind": "mechanical",
      "electrical_contract": null,
      "location": "Inside oil pan, connected to oil pump inlet",
      "function": "First-stage debris filtration and oil pump inlet supply. Mesh screen catches large debris. Screen clog produces starvation before filter housing. Loose seal at pump inlet causes air ingestion and oil pressure fluctuation.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LAW"
    },
    {
      "slug": "sd4-67psd-oil-pump",
      "name": "Oil Pump (Gear-Type)",
      "kind": "pump",
      "electrical_contract": null,
      "location": "Front of block, driven from engine front gear train",
      "function": "Positive-displacement gear pump draws oil from pan via pickup tube and pressurizes the oil system. Driven mechanically from gear train at fixed ratio to crankshaft — no chain or belt. Oil pressure proportional to RPM from cranking onward.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-oil-filter-housing",
      "name": "Oil Filter Housing (Remote Cartridge)",
      "kind": "mechanical",
      "electrical_contract": null,
      "location": "Top of engine, remote-mounted (not integrated into pan)",
      "function": "Houses cartridge-style filter element. Contains anti-drain-back valve (retains oil at shutdown for dry-start prevention) and bypass valve (routes oil around clogged element to prevent starvation). Service access point for filter replacement.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "sd4-67psd-oil-cooler",
      "name": "Engine-Mounted Oil Cooler",
      "kind": "mechanical",
      "electrical_contract": null,
      "location": "Engine block — between oil filter circuit outlet and main oil galleries",
      "function": "Uses engine coolant flowing through internal matrix to cool engine oil. Cross-system boundary with cooling system (Run 4). Failure mode: matrix breach allows oil-coolant cross-contamination. Coolant-side restriction raises oil temp without visible external leak.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-oil-pressure-sensor",
      "name": "Oil Pressure Sensor (Analog)",
      "kind": "sensor",
      "electrical_contract": "3-wire (5V ref, signal, ground — typical Ford analog sensor)",
      "location": "Threaded into engine block oil gallery — exact port WSM-required",
      "function": "0–5V analog signal to PCM for oil pressure PID. Enables P0520 (circuit fault) and P0521 (range/performance) DTC monitors. Drives PCM protection logic. Separate from the oil pressure warning lamp switch.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "sd4-67psd-oil-pressure-switch",
      "name": "Oil Pressure Warning Lamp Switch",
      "kind": "sensor",
      "electrical_contract": "2-wire on/off switch — normally open, closes to ground at low pressure",
      "location": "Threaded into engine block oil gallery — separate port from analog sensor, exact location WSM-required",
      "function": "Simple threshold switch that completes the low-oil-pressure warning lamp circuit to the instrument cluster when pressure drops below ~6–10 PSI. Operates independently of the PCM analog sensor. Parallel to but electrically separate from sd4-67psd-oil-pressure-sensor.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "sd4-67psd-oil-temp-sensor",
      "name": "Oil Temperature Sensor — GAP",
      "kind": "sensor",
      "electrical_contract": "2-wire NTC thermistor (if present) — presence unconfirmed",
      "location": "Oil gallery or oil pan — if present",
      "function": "Provides oil temperature PID to PCM. Presence as a discrete physical sensor is uncertain — may be a PCM-calculated estimate rather than a standalone sensor. WSM confirmation required.",
      "source_provenance": "GAP",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-piston-cooling-jets",
      "name": "Piston Cooling Oil Jets (8x)",
      "kind": "mechanical",
      "electrical_contract": null,
      "location": "Block lower cylinder bores, one per cylinder (8 total), directed upward at piston crown underside",
      "function": "Spray pressurized oil from main gallery at piston crown undersides for thermal management under high load. Pressure-check valve prevents spray at low-pressure idle (WSM-authoritative threshold). Critical for preventing piston overheating at full diesel load.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "sd4-67psd-turbo-oil-supply-line",
      "name": "Turbocharger Oil Supply Line",
      "kind": "mechanical",
      "electrical_contract": null,
      "location": "Routes from engine main gallery or filter housing port up to VGT turbo center housing",
      "function": "Delivers pressurized, filtered engine oil to turbo plain-bearing shaft for continuous lubrication during operation. Oil coking in this line after hot shutdown is the primary cause of turbo bearing failure. Steel or stainless braided construction.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-turbo-oil-drain-line",
      "name": "Turbocharger Oil Drain (Return) Line",
      "kind": "mechanical",
      "electrical_contract": null,
      "location": "Routes from VGT turbo center housing downward to oil pan upper rail or block return port",
      "function": "Gravity-returns oil from turbo center housing to oil pan. No back-pressure — relies entirely on downward grade. Sag, kink, or pooling in the line pressurizes turbo center housing and forces oil past compressor or turbine seals (blue smoke symptom).",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-glow-plug-1",
      "name": "Glow Plug #1 (CPSGP)",
      "kind": "actuator",
      "electrical_contract": "Single-wire high-current hot feed from GPCM; body grounds through cylinder head threads",
      "location": "Cylinder #1 combustion chamber bore in cylinder head",
      "function": "Resistive heater preheat for cold-start combustion air. Dual-function CPSGP: also transmits in-cylinder combustion pressure data to GPCM/PCM. CPSGP build-year applicability WSM-required.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "sd4-67psd-glow-plug-2",
      "name": "Glow Plug #2 (CPSGP)",
      "kind": "actuator",
      "electrical_contract": "Single-wire high-current hot feed from GPCM; body grounds through cylinder head threads",
      "location": "Cylinder #2 combustion chamber bore in cylinder head",
      "function": "Resistive heater preheat for cold-start combustion air. Dual-function CPSGP: also transmits in-cylinder combustion pressure data to GPCM/PCM.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "sd4-67psd-glow-plug-3",
      "name": "Glow Plug #3 (CPSGP)",
      "kind": "actuator",
      "electrical_contract": "Single-wire high-current hot feed from GPCM; body grounds through cylinder head threads",
      "location": "Cylinder #3 combustion chamber bore in cylinder head",
      "function": "Resistive heater preheat for cold-start combustion air. Dual-function CPSGP: also transmits in-cylinder combustion pressure data to GPCM/PCM.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "sd4-67psd-glow-plug-4",
      "name": "Glow Plug #4 (CPSGP)",
      "kind": "actuator",
      "electrical_contract": "Single-wire high-current hot feed from GPCM; body grounds through cylinder head threads",
      "location": "Cylinder #4 combustion chamber bore in cylinder head",
      "function": "Resistive heater preheat for cold-start combustion air. Dual-function CPSGP: also transmits in-cylinder combustion pressure data to GPCM/PCM.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "sd4-67psd-glow-plug-5",
      "name": "Glow Plug #5 (CPSGP)",
      "kind": "actuator",
      "electrical_contract": "Single-wire high-current hot feed from GPCM; body grounds through cylinder head threads",
      "location": "Cylinder #5 combustion chamber bore in cylinder head",
      "function": "Resistive heater preheat for cold-start combustion air. Dual-function CPSGP: also transmits in-cylinder combustion pressure data to GPCM/PCM.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "sd4-67psd-glow-plug-6",
      "name": "Glow Plug #6 (CPSGP)",
      "kind": "actuator",
      "electrical_contract": "Single-wire high-current hot feed from GPCM; body grounds through cylinder head threads",
      "location": "Cylinder #6 combustion chamber bore in cylinder head",
      "function": "Resistive heater preheat for cold-start combustion air. Dual-function CPSGP: also transmits in-cylinder combustion pressure data to GPCM/PCM.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "sd4-67psd-glow-plug-7",
      "name": "Glow Plug #7 (CPSGP)",
      "kind": "actuator",
      "electrical_contract": "Single-wire high-current hot feed from GPCM; body grounds through cylinder head threads",
      "location": "Cylinder #7 combustion chamber bore in cylinder head",
      "function": "Resistive heater preheat for cold-start combustion air. Dual-function CPSGP: also transmits in-cylinder combustion pressure data to GPCM/PCM.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "sd4-67psd-glow-plug-8",
      "name": "Glow Plug #8 (CPSGP)",
      "kind": "actuator",
      "electrical_contract": "Single-wire high-current hot feed from GPCM; body grounds through cylinder head threads",
      "location": "Cylinder #8 combustion chamber bore in cylinder head",
      "function": "Resistive heater preheat for cold-start combustion air. Dual-function CPSGP: also transmits in-cylinder combustion pressure data to GPCM/PCM.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "sd4-67psd-gpcm",
      "name": "Glow Plug Control Module (GPCM)",
      "kind": "module",
      "electrical_contract": "HS-CAN (communication to PCM); high-current per-cylinder output drivers (one per glow plug); high-current battery feed via underhood fuse/fusible link",
      "location": "Engine bay — near valve covers or firewall (exact mount WSM-required)",
      "function": "Controls glow plug heating cycle per PCM command. Drives high-current output to each glow plug individually via per-cylinder drivers. Detects open-circuit failures per cylinder and logs P0671–P0678 DTCs. Receives on-time, duty cycle, and post-start schedule from PCM over CAN.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-ccv-separator",
      "name": "CCV Oil Separator / Coalescer",
      "kind": "mechanical",
      "electrical_contract": null,
      "location": "Valve cover area or top of block",
      "function": "Strips oil mist and soot particulate from crankcase blow-by gases before routing cleaned gas to intake. Separated oil drains back to crankcase via return line. Serviceable element with defined replacement interval. Clogged separator raises crankcase pressure and forces oil past crankshaft seals and valve cover gaskets.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    }
  ],

  "observable_properties": [
    {
      "slug": "sd4-67psd-obs-block-external-oil-leak",
      "component_slug": "sd4-67psd-cylinder-block",
      "description": "External engine oil seepage or leak visible at block sealing surfaces — front and rear main seals, oil pan rail, head gasket interfaces. Oil staining, wet residue, or pooled oil beneath engine. Distinguishes from turbo drain or CCV as leak origin.",
      "observation_method": "direct_visual_external",
      "housing_opacity_status": "transparent",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-obs-crank-rpm-pid",
      "component_slug": "sd4-67psd-crankshaft",
      "description": "Engine RPM PID via scan tool — derived from CKP sensor reading crankshaft reluctor ring. Confirms CKP signal integrity and crankshaft rotation. Loss of signal shows 0 RPM with engine cranking.",
      "observation_method": "scan_tool_pid",
      "housing_opacity_status": "opaque",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-obs-harmonic-balancer-visual",
      "component_slug": "sd4-67psd-harmonic-balancer",
      "description": "Visual inspection of harmonic balancer outer ring for rubber isolator delamination, cracking, or separation. A delaminated balancer shows the outer ring walking or wobbling relative to the hub. Observable from engine bay with engine running or stopped.",
      "observation_method": "direct_visual_external",
      "housing_opacity_status": "transparent",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-obs-harmonic-balancer-vibration",
      "component_slug": "sd4-67psd-harmonic-balancer",
      "description": "Abnormal engine vibration or accessory belt noise (squealing, belt walk, belt throw) with engine running. Indicates possible harmonic balancer rubber isolator failure. Audible and tactile from engine bay.",
      "observation_method": "audible",
      "housing_opacity_status": "transparent",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-obs-flexplate-ring-gear-visual",
      "component_slug": "sd4-67psd-flexplate",
      "description": "Visual inspection of ring gear teeth for wear, chipping, or missing teeth. Accessible via starter motor opening with transmission in place. Worn ring gear produces abnormal starter engagement noise (grinding) before cranking.",
      "observation_method": "direct_visual_internal",
      "housing_opacity_status": "removable",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "sd4-67psd-obs-camshaft-lobe-wear-visual",
      "component_slug": "sd4-67psd-camshaft",
      "description": "Direct visual inspection of cam lobe surfaces for scoring, pitting, or flat spots after engine disassembly. Cam lobe wear produces collapsed lifter motion and reduced valve lift. Accessed by removing oil pan and front cover to slide cam.",
      "observation_method": "direct_visual_internal",
      "housing_opacity_status": "opaque",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "sd4-67psd-obs-lifter-tick-audible",
      "component_slug": "sd4-67psd-valvetrain-lifters",
      "description": "Audible mechanical tick or tapping from the valvetrain at low RPM. Collapsed lifter or lifter bleed-down produces a distinct tick that worsens with low oil pressure or cold starts. Distinguishable from injector tick by rhythm and location.",
      "observation_method": "audible",
      "housing_opacity_status": "opaque",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-obs-rocker-pushrod-visual",
      "component_slug": "sd4-67psd-valvetrain-rockers",
      "description": "Direct visual inspection of pushrods (bent, scored) and rocker arms (worn contact surfaces, cracked) after removing valve covers. Bent pushrod is a direct indicator of lifter, valve, or timing event issue.",
      "observation_method": "direct_visual_internal",
      "housing_opacity_status": "removable",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-obs-ckp-signal-waveform",
      "component_slug": "sd4-67psd-ckp-sensor",
      "description": "CKP sensor signal waveform captured at PCM connector or sensor pigtail with oscilloscope. VR sensor: AC sine wave amplitude proportional to RPM. Hall-effect: square wave. Missing teeth, erratic signal, or no signal identifies sensor vs. reluctor vs. wiring fault.",
      "observation_method": "waveform_capture",
      "housing_opacity_status": "opaque",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-obs-ckp-dtc",
      "component_slug": "sd4-67psd-ckp-sensor",
      "description": "P0335/P0336 (CKP circuit range/performance) DTCs logged in PCM. First diagnostic indicator of CKP signal integrity loss. Confirm with waveform before condemning sensor — also check reluctor ring and wiring.",
      "observation_method": "scan_tool_pid",
      "housing_opacity_status": "opaque",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-obs-cmp-signal-waveform",
      "component_slug": "sd4-67psd-cmp-sensor",
      "description": "CMP sensor signal waveform captured at sensor connector or PCM pin. Hall-effect square wave with cam-speed frequency. Irregular or missing pattern identifies phase reference loss, which can cause injection timing degradation or no-start on some PCM calibrations.",
      "observation_method": "waveform_capture",
      "housing_opacity_status": "opaque",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "sd4-67psd-obs-cmp-dtc",
      "component_slug": "sd4-67psd-cmp-sensor",
      "description": "P0340/P0341 (CMP circuit range/performance) DTCs logged in PCM. Indicates CMP signal integrity issue. May accompany degraded fueling or hard/no-start depending on PCM calibration fallback behavior.",
      "observation_method": "scan_tool_pid",
      "housing_opacity_status": "opaque",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-obs-head-gasket-coolant-oil-emulsion",
      "component_slug": "sd4-67psd-cylinder-head-driver",
      "description": "Milky or foamy oil on dipstick or under oil fill cap indicating coolant contamination of engine oil. Sign of head gasket breach or oil cooler matrix failure allowing coolant into oil circuit. Requires distinguishing from oil cooler as source.",
      "observation_method": "direct_visual_external",
      "housing_opacity_status": "transparent",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-obs-head-gasket-combustion-leak",
      "component_slug": "sd4-67psd-cylinder-head-driver",
      "description": "Combustion gas detected in cooling system via block-check (combustion gas test kit) or cylinder leakdown into coolant. White exhaust from coolant entering combustion chamber. Pressure testing cooling system identifies inter-system breach.",
      "observation_method": "pressure_test_with_gauge",
      "housing_opacity_status": "opaque",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-obs-head-gasket-passenger-emulsion",
      "component_slug": "sd4-67psd-cylinder-head-passenger",
      "description": "Milky or foamy oil on dipstick or under oil fill cap on passenger-bank side — same failure mode as driver-side head gasket breach. Passenger bank identical observation. Requires distinguishing from oil cooler as source.",
      "observation_method": "direct_visual_external",
      "housing_opacity_status": "transparent",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-obs-compression-test",
      "component_slug": "sd4-67psd-cylinder-head-driver",
      "description": "Cylinder compression test using diesel compression tester threaded into injector or glow plug bore. Confirms ring seal and valve seating integrity. Low compression on one or more cylinders indicates ring wear, valve failure, or head gasket breach. Baseline spec requires WSM for exact PSI target on 6.7L PSD.",
      "observation_method": "pressure_test_with_gauge",
      "housing_opacity_status": "opaque",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-obs-oil-level-dipstick",
      "component_slug": "sd4-67psd-oil-pan",
      "description": "Engine oil level and condition checked via dipstick. Overfull level (indicates coolant dilution or fuel dilution). Low level (consumption). Dark/black coloration (normal diesel). Milky/frothy (coolant contamination). Fuel smell (injector return or CP4 leak-off contamination). Direct visual at dipstick.",
      "observation_method": "direct_visual_external",
      "housing_opacity_status": "transparent",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-obs-oil-pan-drain-inspection",
      "component_slug": "sd4-67psd-oil-pan",
      "description": "Metal particle inspection during oil drain into clean drain pan. Fine metallic glitter (bearing wear). Larger particles or flakes (catastrophic internal wear). Magnetic drain plug residue quantification. Direct visual with adequate lighting.",
      "observation_method": "direct_visual_external",
      "housing_opacity_status": "transparent",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-obs-oil-pickup-screen-clog",
      "component_slug": "sd4-67psd-oil-pickup-tube",
      "description": "Oil pickup tube screen condition visible after pan removal. Sludge accumulation on screen restricts inlet flow and drops oil pressure at all RPM. Assessed by direct visual after draining oil and removing pan.",
      "observation_method": "direct_visual_internal",
      "housing_opacity_status": "removable",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "sd4-67psd-obs-oil-pressure-pid",
      "component_slug": "sd4-67psd-oil-pressure-sensor",
      "description": "Engine oil pressure PID via scan tool, sourced from analog oil pressure sensor. Evaluate at idle vs. operating RPM vs. hot idle. Low idle pressure (<10 PSI hot) indicates pump wear, main bearing clearance, or restricted pickup. Spec requires WSM for exact min/max targets.",
      "observation_method": "scan_tool_pid",
      "housing_opacity_status": "opaque",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-obs-oil-pressure-gauge-physical",
      "component_slug": "sd4-67psd-oil-pressure-sensor",
      "description": "Mechanical oil pressure gauge installed at oil pressure sensor port for independent confirmation of actual gallery pressure. Eliminates sensor drift as a variable. Compare gauge reading to scan tool PID to determine if sensor circuit is accurate.",
      "observation_method": "pressure_test_with_gauge",
      "housing_opacity_status": "opaque",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-obs-oil-pressure-sensor-dtc",
      "component_slug": "sd4-67psd-oil-pressure-sensor",
      "description": "P0520 (oil pressure sensor circuit) or P0521 (oil pressure sensor range/performance) DTC in PCM. Indicates sensor signal out of range or circuit fault. Confirm with physical gauge before condemning engine internals.",
      "observation_method": "scan_tool_pid",
      "housing_opacity_status": "opaque",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-obs-oil-pressure-warning-lamp",
      "component_slug": "sd4-67psd-oil-pressure-switch",
      "description": "Low oil pressure warning lamp illuminated on instrument cluster (oil can icon). Driven by oil pressure switch closing circuit at or below threshold pressure. Independent of PCM oil pressure PID. Lamp on with normal scan tool PID suggests switch or wiring fault vs. actual low pressure.",
      "observation_method": "direct_visual_external",
      "housing_opacity_status": "transparent",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-obs-oil-cooler-cross-contamination",
      "component_slug": "sd4-67psd-oil-cooler",
      "description": "Oil-coolant cross-contamination — milky oil (coolant into oil) or oily coolant (oil into coolant system). The oil cooler matrix is a distinct suspect from the head gasket when diagnosing cross-contamination; both must be ruled in or out. Observed at dipstick, oil fill cap underside, and coolant overflow reservoir.",
      "observation_method": "direct_visual_external",
      "housing_opacity_status": "opaque",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-obs-oil-cooler-coolant-restriction",
      "component_slug": "sd4-67psd-oil-cooler",
      "description": "Elevated oil temperature with normal coolant temperature — suggests coolant-side restriction in oil cooler matrix reducing heat transfer. Observable by comparing oil temp PID trend against coolant temp; elevated delta is diagnostic.",
      "observation_method": "scan_tool_pid",
      "housing_opacity_status": "opaque",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-obs-piston-cooling-jet-visual",
      "component_slug": "sd4-67psd-piston-cooling-jets",
      "description": "Direct visual inspection of piston cooling jet nozzle alignment and condition after oil pan removal. Jets can be dislodged by debris impact or improper pan installation, directing oil away from piston crown. Each jet position verifiable by eye with pan off.",
      "observation_method": "direct_visual_internal",
      "housing_opacity_status": "removable",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "sd4-67psd-obs-turbo-supply-line-visual",
      "component_slug": "sd4-67psd-turbo-oil-supply-line",
      "description": "Visual inspection of turbo oil supply line for oil residue, leaks, kinks, or hardened/coked sections. Coked oil in supply line restricts flow and starves turbo bearings. Inspect at engine connection and turbo center housing connection.",
      "observation_method": "direct_visual_external",
      "housing_opacity_status": "transparent",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-obs-turbo-drain-line-routing",
      "component_slug": "sd4-67psd-turbo-oil-drain-line",
      "description": "Physical routing check of turbo oil drain line for sag, kinks, or sections that pool oil rather than allowing free gravity drain. Squeeze or flex line to detect internal collapse. Line must slope continuously downward from turbo to pan. Critical diagnostic step before condemning turbo seals.",
      "observation_method": "direct_visual_external",
      "housing_opacity_status": "transparent",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-obs-glow-plug-resistance",
      "component_slug": "sd4-67psd-glow-plug-1",
      "description": "Ohmmeter measurement at glow plug terminal to body (ground) to confirm electrical resistance. A good glow plug shows low resistance (~0.5–1.5 ohms typical for pencil-type). Open circuit = failed plug (infinite resistance). Short to ground = internal short. Perform at plug connector, not through GPCM harness.",
      "observation_method": "electrical_measurement_at_pin",
      "housing_opacity_status": "opaque",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-obs-glow-plug-dtc-per-cylinder",
      "component_slug": "sd4-67psd-glow-plug-1",
      "description": "P0671–P0678 DTCs in GPCM or PCM, one per cylinder. These codes are unique to individual glow plug circuit faults and are the primary scan-tool indicator for glow plug failure. P0671=cyl1, P0672=cyl2 ... P0678=cyl8. Confirm with resistance measurement at plug.",
      "observation_method": "scan_tool_pid",
      "housing_opacity_status": "opaque",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-obs-glow-plug-combustion-pressure-pid",
      "component_slug": "sd4-67psd-glow-plug-1",
      "description": "In-cylinder combustion pressure PID available per cylinder via scan tool (if CPSGP installed). Confirms individual cylinder combustion event quality. Misfire or incomplete combustion on a cylinder shows a distinct deviation from neighboring cylinder pressure traces. CPSGP presence WSM-required.",
      "observation_method": "scan_tool_pid",
      "housing_opacity_status": "opaque",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "sd4-67psd-obs-gpcm-can-communication",
      "component_slug": "sd4-67psd-gpcm",
      "description": "GPCM presence and communication status visible on scan tool network scan (all CAN nodes). Missing GPCM node indicates module fault, power/ground loss, or CAN bus wiring issue. Confirm GPCM power and ground at module connector before condemning module.",
      "observation_method": "scan_tool_pid",
      "housing_opacity_status": "opaque",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-obs-gpcm-current-per-cylinder",
      "component_slug": "sd4-67psd-gpcm",
      "description": "Current clamp measurement on individual glow plug feed wire during preheat cycle. Good plug shows expected amperage spike at activation then drop as element warms. Open circuit plug shows zero current. Short shows excess current. Confirms GPCM per-cylinder output health.",
      "observation_method": "electrical_measurement_at_pin",
      "housing_opacity_status": "opaque",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-obs-ccv-crankcase-pressure",
      "component_slug": "sd4-67psd-ccv-separator",
      "description": "Crankcase pressure measurement via manometer at dipstick tube or oil fill port. Elevated positive pressure (above spec) indicates CCV separator restriction, clogged hoses, or excessive ring blow-by. Distinguishes CCV restriction from turbo seal failure or valve stem seal wear as source of oil consumption.",
      "observation_method": "pressure_test_with_gauge",
      "housing_opacity_status": "opaque",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-obs-ccv-separator-visual",
      "component_slug": "sd4-67psd-ccv-separator",
      "description": "Visual inspection of CCV separator housing, hoses, and oil drain return line for sludge buildup, cracks, or disconnection. Separated oil return line disconnection routes oil to intake rather than crankcase. Direct visual inspection with engine off.",
      "observation_method": "direct_visual_external",
      "housing_opacity_status": "transparent",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-obs-oil-filter-bypass-condition",
      "component_slug": "sd4-67psd-oil-filter-housing",
      "description": "Oil filter element condition inspection on removal — collapsed, clogged, or bypassed element. Bypass valve activation (filter heavily loaded) allows unfiltered oil to circulate, accelerating bearing wear. Oil sample analysis (particle count) is the downstream diagnostic for bypass condition during operation.",
      "observation_method": "direct_visual_external",
      "housing_opacity_status": "removable",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    }
  ],

  "component_connections": [
    {
      "from_component_slug": "sd4-67psd-engine-gear-train",
      "to_component_slug": "sd4-67psd-oil-pump",
      "connection_kind": "mechanical-linkage",
      "direction": "unidirectional",
      "description": "Front gear train drives oil pump gear at fixed ratio to crankshaft speed. No chain or belt — direct helical gear mesh. Oil pump builds pressure from cranking speed onward.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-engine-gear-train",
      "to_component_slug": "sd4-67psd-camshaft",
      "connection_kind": "mechanical-linkage",
      "direction": "unidirectional",
      "description": "Front gear train drives camshaft at half crankshaft speed (2:1 reduction) via cam gear in the gear set.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-crankshaft",
      "to_component_slug": "sd4-67psd-engine-gear-train",
      "connection_kind": "mechanical-linkage",
      "direction": "unidirectional",
      "description": "Crankshaft front snout drives the front gear train crank gear — the input to all gear-train driven accessories.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-crankshaft",
      "to_component_slug": "sd4-67psd-harmonic-balancer",
      "connection_kind": "mechanical-linkage",
      "direction": "unidirectional",
      "description": "Harmonic balancer bolts to crankshaft front snout and rotates with the crankshaft. Torsional vibration damper. Also serves as CKP reluctor mount if sensor is front-mounted.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-crankshaft",
      "to_component_slug": "sd4-67psd-flexplate",
      "connection_kind": "mechanical-linkage",
      "direction": "unidirectional",
      "description": "Flexplate bolts to crankshaft rear flange. Transfers engine torque to 6R140 torque converter and transmits starter engagement via ring gear.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-crankshaft",
      "to_component_slug": "sd4-67psd-ckp-sensor",
      "connection_kind": "mechanical-linkage",
      "direction": "unidirectional",
      "description": "Crankshaft reluctor ring (on balancer or crank body) rotates past CKP sensor face, inducing signal pulses that the PCM uses for RPM and crank position.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "from_component_slug": "sd4-67psd-ckp-sensor",
      "to_component_slug": "sd4-67psd-pcm",
      "connection_kind": "electrical-wire",
      "direction": "unidirectional",
      "description": "CKP sensor signal wire carries RPM/position pulses to PCM. Critical no-start input — PCM cannot determine injection timing without valid CKP. 2-wire (VR) or 3-wire (Hall) depending on sensor type.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-camshaft",
      "to_component_slug": "sd4-67psd-cmp-sensor",
      "connection_kind": "mechanical-linkage",
      "direction": "unidirectional",
      "description": "Camshaft reluctor ring rotates past CMP sensor face, generating cylinder phase reference pulses at cam speed (half crank speed).",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "from_component_slug": "sd4-67psd-cmp-sensor",
      "to_component_slug": "sd4-67psd-pcm",
      "connection_kind": "electrical-wire",
      "direction": "unidirectional",
      "description": "CMP sensor signal carries cylinder phase reference to PCM. Enables sequential injection sequencing. Loss may cause PCM calibration-dependent fueling fallback or no-start.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-camshaft",
      "to_component_slug": "sd4-67psd-valvetrain-lifters",
      "connection_kind": "mechanical-linkage",
      "direction": "unidirectional",
      "description": "Cam lobe profiles lift each hydraulic roller lifter as the camshaft rotates. Lobe geometry sets lift timing and duration.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-valvetrain-lifters",
      "to_component_slug": "sd4-67psd-valvetrain-rockers",
      "connection_kind": "mechanical-linkage",
      "direction": "unidirectional",
      "description": "Each lifter pushes its pushrod upward; the pushrod actuates the corresponding rocker arm in the cylinder head.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-oil-pan",
      "to_component_slug": "sd4-67psd-oil-pickup-tube",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "Oil pan sump supplies oil to the pickup tube screen inlet. Gravity-feed to screen; suction from oil pump draws oil through.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-oil-pickup-tube",
      "to_component_slug": "sd4-67psd-oil-pump",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "Pickup tube delivers screened oil from pan sump to oil pump inlet. Loose seal at pump connection allows air ingestion and cavitation.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-oil-pump",
      "to_component_slug": "sd4-67psd-oil-filter-housing",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "Pressurized oil from pump outlet routes to remote oil filter housing. Passes through filter element (or bypass valve if clogged).",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-oil-filter-housing",
      "to_component_slug": "sd4-67psd-oil-cooler",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "Filtered oil exits filter housing and routes to engine-mounted oil cooler for thermal management before entering main galleries.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "from_component_slug": "sd4-67psd-oil-cooler",
      "to_component_slug": "sd4-67psd-cylinder-block",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "Cooled, filtered oil enters block main oil galleries for distribution to crankshaft bearings, rod bearings, valvetrain, and piston cooling jets.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LAW"
    },
    {
      "from_component_slug": "sd4-67psd-egr-cooler",
      "to_component_slug": "sd4-67psd-oil-cooler",
      "connection_kind": "fluid-line",
      "direction": "bidirectional",
      "description": "Engine coolant loop shared between EGR cooler and oil cooler. Coolant supply and return for the oil cooler matrix are part of the same cooling circuit documented in Run 4 and Run 5. Cross-system boundary connection.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "from_component_slug": "sd4-67psd-cylinder-block",
      "to_component_slug": "sd4-67psd-piston-cooling-jets",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "Main oil gallery in block feeds pressurized oil to piston cooling jet nozzles. Each jet has a pressure-check valve that activates above a threshold PSI.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "from_component_slug": "sd4-67psd-cylinder-block",
      "to_component_slug": "sd4-67psd-cylinder-head-driver",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "Block oil galleries feed upward oil passages to driver-side cylinder head for rocker arm and valvetrain lubrication.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-cylinder-block",
      "to_component_slug": "sd4-67psd-cylinder-head-passenger",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "Block oil galleries feed upward oil passages to passenger-side cylinder head for rocker arm and valvetrain lubrication.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-cylinder-block",
      "to_component_slug": "sd4-67psd-oil-pressure-sensor",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "Oil gallery pressure is exposed to the oil pressure sensor threaded into the block. Sensor reads live gallery pressure.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-cylinder-block",
      "to_component_slug": "sd4-67psd-oil-pressure-switch",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "Oil gallery pressure is exposed to the oil pressure switch threaded into the block. Switch closes warning lamp circuit below threshold pressure.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "from_component_slug": "sd4-67psd-oil-pressure-sensor",
      "to_component_slug": "sd4-67psd-pcm",
      "connection_kind": "electrical-wire",
      "direction": "unidirectional",
      "description": "Analog 0–5V oil pressure signal from sensor to PCM. Source of oil pressure scan tool PID and P0520/P0521 DTC monitoring.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-oil-pressure-switch",
      "to_component_slug": "sd4-67psd-instrument-cluster",
      "connection_kind": "electrical-wire",
      "direction": "unidirectional",
      "description": "Oil pressure switch completes low-oil-pressure warning lamp circuit to instrument cluster when pressure drops below threshold. Independent of PCM.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-cylinder-block",
      "to_component_slug": "sd4-67psd-turbo-oil-supply-line",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "Pressurized, filtered oil from block main gallery (or filter housing port) feeds the turbo oil supply line routing to the VGT turbo center housing.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-turbo-oil-supply-line",
      "to_component_slug": "sd4-67psd-vgt-turbo",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "Turbo oil supply line delivers pressurized engine oil to VGT turbocharger center housing for plain shaft-bearing lubrication.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-vgt-turbo",
      "to_component_slug": "sd4-67psd-turbo-oil-drain-line",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "Oil exits VGT turbo center housing via drain port into turbo oil drain line for gravity return to oil pan.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-turbo-oil-drain-line",
      "to_component_slug": "sd4-67psd-oil-pan",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "Gravity drain returns oil from turbo center housing to oil pan via return port on upper pan rail or block. Free-flow gravity path — no pumping required.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-pcm",
      "to_component_slug": "sd4-67psd-gpcm",
      "connection_kind": "can-bus",
      "direction": "bidirectional",
      "description": "PCM communicates glow plug activation commands (on-time, duty cycle, post-start schedule) to GPCM over HS-CAN bus. GPCM reports individual glow plug fault status and combustion pressure data (if CPSGP) back to PCM over CAN.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-gpcm",
      "to_component_slug": "sd4-67psd-glow-plug-1",
      "connection_kind": "electrical-wire",
      "direction": "unidirectional",
      "description": "GPCM per-cylinder output driver provides high-current hot feed to glow plug #1. Single-wire feed; plug body grounds through cylinder head threads.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-gpcm",
      "to_component_slug": "sd4-67psd-glow-plug-2",
      "connection_kind": "electrical-wire",
      "direction": "unidirectional",
      "description": "GPCM per-cylinder output driver provides high-current hot feed to glow plug #2.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-gpcm",
      "to_component_slug": "sd4-67psd-glow-plug-3",
      "connection_kind": "electrical-wire",
      "direction": "unidirectional",
      "description": "GPCM per-cylinder output driver provides high-current hot feed to glow plug #3.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-gpcm",
      "to_component_slug": "sd4-67psd-glow-plug-4",
      "connection_kind": "electrical-wire",
      "direction": "unidirectional",
      "description": "GPCM per-cylinder output driver provides high-current hot feed to glow plug #4.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-gpcm",
      "to_component_slug": "sd4-67psd-glow-plug-5",
      "connection_kind": "electrical-wire",
      "direction": "unidirectional",
      "description": "GPCM per-cylinder output driver provides high-current hot feed to glow plug #5.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-gpcm",
      "to_component_slug": "sd4-67psd-glow-plug-6",
      "connection_kind": "electrical-wire",
      "direction": "unidirectional",
      "description": "GPCM per-cylinder output driver provides high-current hot feed to glow plug #6.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-gpcm",
      "to_component_slug": "sd4-67psd-glow-plug-7",
      "connection_kind": "electrical-wire",
      "direction": "unidirectional",
      "description": "GPCM per-cylinder output driver provides high-current hot feed to glow plug #7.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-gpcm",
      "to_component_slug": "sd4-67psd-glow-plug-8",
      "connection_kind": "electrical-wire",
      "direction": "unidirectional",
      "description": "GPCM per-cylinder output driver provides high-current hot feed to glow plug #8.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-glow-plug-1",
      "to_component_slug": "sd4-67psd-cylinder-head-driver",
      "connection_kind": "mechanical-linkage",
      "direction": "unidirectional",
      "description": "Glow plug #1 threads into combustion chamber bore in driver-side cylinder head. Body grounds through head. CPSGP pressure signal also routes back through this mechanical/electrical interface.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-glow-plug-3",
      "to_component_slug": "sd4-67psd-cylinder-head-driver",
      "connection_kind": "mechanical-linkage",
      "direction": "unidirectional",
      "description": "Glow plug #3 threads into combustion chamber bore in driver-side cylinder head.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-glow-plug-5",
      "to_component_slug": "sd4-67psd-cylinder-head-driver",
      "connection_kind": "mechanical-linkage",
      "direction": "unidirectional",
      "description": "Glow plug #5 threads into combustion chamber bore in driver-side cylinder head.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-glow-plug-7",
      "to_component_slug": "sd4-67psd-cylinder-head-driver",
      "connection_kind": "mechanical-linkage",
      "direction": "unidirectional",
      "description": "Glow plug #7 threads into combustion chamber bore in driver-side cylinder head.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-glow-plug-2",
      "to_component_slug": "sd4-67psd-cylinder-head-passenger",
      "connection_kind": "mechanical-linkage",
      "direction": "unidirectional",
      "description": "Glow plug #2 threads into combustion chamber bore in passenger-side cylinder head.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-glow-plug-4",
      "to_component_slug": "sd4-67psd-cylinder-head-passenger",
      "connection_kind": "mechanical-linkage",
      "direction": "unidirectional",
      "description": "Glow plug #4 threads into combustion chamber bore in passenger-side cylinder head.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-glow-plug-6",
      "to_component_slug": "sd4-67psd-cylinder-head-passenger",
      "connection_kind": "mechanical-linkage",
      "direction": "unidirectional",
      "description": "Glow plug #6 threads into combustion chamber bore in passenger-side cylinder head.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-glow-plug-8",
      "to_component_slug": "sd4-67psd-cylinder-head-passenger",
      "connection_kind": "mechanical-linkage",
      "direction": "unidirectional",
      "description": "Glow plug #8 threads into combustion chamber bore in passenger-side cylinder head.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-ccv-separator",
      "to_component_slug": "sd4-67psd-cylinder-block",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "CCV separator separated oil return line drains collected oil mist back to crankcase (block crankcase volume). Prevents oil from going to intake.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-cylinder-head-driver",
      "to_component_slug": "sd4-67psd-valvetrain-rockers",
      "connection_kind": "mechanical-linkage",
      "direction": "unidirectional",
      "description": "Driver-side cylinder head provides mounting surface and pivot studs/shafts for rocker arms. Oil feed from head gallery lubricates rocker pivots.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-cylinder-head-passenger",
      "to_component_slug": "sd4-67psd-valvetrain-rockers",
      "connection_kind": "mechanical-linkage",
      "direction": "unidirectional",
      "description": "Passenger-side cylinder head provides mounting surface and pivot studs/shafts for rocker arms on that bank.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-hs-can-bus",
      "to_component_slug": "sd4-67psd-gpcm",
      "connection_kind": "can-bus",
      "direction": "bidirectional",
      "description": "GPCM connects to HS-CAN bus as a network node. PCM commands and GPCM fault reporting travel over this shared bus.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    }
  ]
}
```

---

## 5-line summary

1. **Counts:** 34 new components (including 8 individual glow plugs and 2 GAP components) | 39 observable properties | 52 component connections.
2. **All connection slugs verified:** Every from/to slug resolves to either a new component in this document or one of the 8 existing-reference slugs (sd4-67psd-pcm, sd4-67psd-hs-can-bus, sd4-67psd-instrument-cluster, sd4-67psd-engine-gear-train, sd4-67psd-cp4-pump, sd4-67psd-vgt-turbo, sd4-67psd-egr-cooler, sd4-67psd-injector-1 through -8); no dangling slugs.
3. **Notable gaps carried forward:** CHT sensor (sd4-67psd-cht-sensor) — head-metal temp sensor vs. ECT is unresolved on this diesel platform; oil temperature sensor (sd4-67psd-oil-temp-sensor) — may be a PCM-calculated model rather than a discrete sensor; CKP sensor front-vs-rear mounting location; CPSGP build-year applicability across all 2017–2022 trucks.
4. **Cross-system boundary connections:** Oil cooler ↔ egr-cooler (shared coolant loop from Run 4/5); turbo supply/drain ↔ vgt-turbo (Run 5 air system); ccv-separator outlet routes to engine intake tract (Run 5 — not emitted as a connection here since intake-tract slug is owned by Run 5); injector bores in heads reference sd4-67psd-injector-1 through -8 (Run 1–3 fuel system).
5. **Schema compliance note:** All observable properties carry `description` field (not property_name/notes); glow plug CPSGP combustion pressure observables are emitted under glow-plug-1 as exemplar but production seed should fan all 8 cylinders individually for per-cylinder diagnostic resolution.
