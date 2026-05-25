# Run 5 — F-250 6.7L PSD Engine Air + Aftertreatment P1

**Date:** 2026-05-19
**Platform:** Ford Super Duty 4th Gen / 6.7L Power Stroke Diesel (2017–2022)
**System scope:** Engine air intake path + turbocharger + EGR + exhaust + aftertreatment
**Prior runs NOT re-emitted:** Fuel system (F1–F23 / `sd4-67psd-*` slugs), cooling system loop (in-flight, run 4)
**Referenced existing slugs (not re-emitted):** `sd4-67psd-def-tank`, `sd4-67psd-def-dosing-system`, `sd4-67psd-pcm`, `sd4-67psd-hs-can-bus`

---

## Section 1 — Architecture narration

### 1.1 Intake air path

Fresh air enters through a large-diameter air filter housing located in the driver-side front corner of the engine compartment (passenger-side front on some build configurations — position is approximately right-front of the engine bay behind the headlight assembly). The housing uses a dry paper element filter. An intake hose routes filtered air from the housing outlet toward the turbo inlet.

A Mass Air Flow (MAF) sensor is positioned in the intake tract **upstream of the turbocharger compressor inlet and downstream of the air filter housing**. This placement is the platform-specific fact: the 6.7L PSD MAF is a pre-turbo MAF, meaning it samples ambient air (not boosted charge air). The MAF is the primary mass-flow metering signal for the PCM's fueling calculations at lower loads and contributes to VGT control logic at higher loads. The MAF is a hot-wire or hot-film five-wire sensor (12V power, ground, signal, IAT signal, IAT ground) — exact pin count is consistent with Ford diesel MAF architecture but exact harness detail requires WSM confirmation.

An Intake Air Temperature (IAT) sensor is co-located with the MAF assembly (integrated into the MAF housing on this platform) rather than being a standalone sensor. This is consistent with the Ford Integrated MAF/IAT unit used on the 6.7L PSD; the IAT signal rides in the same connector as the MAF. A second IAT sensor location (post-intercooler / manifold IAT, sometimes called IAT2 or IAT sensor 2) is present downstream in the intake system and is distinct from the MAF-integrated IAT.

An **intake heater grid** (grid-style resistance heater) is installed in the intake manifold inlet or boot. This is a glow-type resistance grid that heats intake air directly — it is categorically different from glow plugs (which heat each combustion chamber). The intake heater grid is used for cold-start assist, commanded by the PCM via a dedicated high-current relay. Its purpose is to raise incoming air temperature before first start events in cold weather, aiding cold-start combustion quality. The intake heater relay is in the underhood junction box; exact cavity is a GAP.

The intake manifold on the 6.7L PSD is a plastic composite unit (single-piece or two-piece, driver/passenger banks feeding from a common plenum). There are no individual per-cylinder runner length control valves (tumble/swirl valves) on the 4th-gen 6.7L PSD's intake manifold — intake swirl is handled via combustion chamber geometry and injection timing, not mechanical runner controls. This is consistent with the engine's port design for diesel operation.

An **intake throttle valve** (also called the Electronic Throttle Body or intake throttle) is present on this engine in the intake air path entering the intake manifold. On a diesel, this throttle is not used to control power output (fueling does that); instead it is primarily used to control EGR mixing (creating a pressure differential that drives EGR gas into the intake charge) and for controlled engine shutdown (preventing diesel run-on). The intake throttle is an electric stepper- or DC-motor-driven valve controlled directly by the PCM.

A **Manifold Absolute Pressure (MAP) sensor** (also called the boost pressure sensor in this context) is located in the intake manifold and measures absolute pressure in the intake charge. On a turbocharged diesel, this sensor's signal represents boost pressure above atmospheric. The PCM uses this signal in closed-loop VGT control and as a cross-check against the MAF signal. The MAP sensor is a three-wire sensor (5V reference, analog signal, ground).

---

### 1.2 Turbocharger

The 2017–2022 6.7L Power Stroke uses a **single Variable Geometry Turbocharger (VGT)** — this is the definitive platform architecture distinction from the 2008–2010 6.4L Power Stroke (which used twin sequential turbos). Ford's single-VGT configuration was introduced on the first-generation 6.7L PSD (2011–2014) and carried through all subsequent 6.7L generations on the 4th-gen Super Duty.

The VGT is a Honeywell/Garrett (or Ford Integrated Turbo) unit with a variable-geometry turbine housing. The variable vanes allow the turbo's effective A/R ratio to change under PCM command, enabling both high spool speed at low engine speeds (closed vanes = smaller effective exhaust nozzle = more turbine energy) and high flow at peak power (open vanes = less restriction). This is also the primary mechanism for the **engine exhaust brake** — closing the VGT vanes while the throttle is released creates significant backpressure, generating braking torque. The 6.7L PSD's exhaust brake uses the VGT as its primary braking device; no separate Jake brake or compression release mechanism is present.

The VGT vane position is controlled by an **electric VGT actuator** (electronic or electro-pneumatic, depending on exact build generation). On the 3rd-generation 6.7L PSD (2017–2022), the VGT actuator is an electronically controlled unit receiving a PWM or CAN-bus position command from the PCM. Actuator feedback (vane position) is provided by an internal position sensor within the actuator. The PCM uses this in closed-loop VGT position control.

The VGT is documented as the **primary failure-prone component** on the 6.7L PSD platform. Common failure modes: sticking/seized vanes (carbon accumulation), actuator motor failure, and broken vane assemblies. A VGT failure can cause low power, excessive backpressure codes (P0299 — turbo underboost, or P2263 — turbo/supercharger boost system performance). VGT replacement requires removal of the turbocharger assembly.

A **turbo speed sensor** is present on the 6.7L PSD turbocharger, providing turbine wheel RPM to the PCM. This signal is used for VGT control, over-speed protection, and as a diagnostic input. Exact sensor type (magnetic pickup or Hall-effect) and connector: GAP requiring WSM confirmation.

Between the turbocharger compressor outlet and the intake manifold inlet sits the **Charge Air Cooler (CAC)**, also called the intercooler. The 4th-gen Super Duty uses an air-to-air CAC — the compressed, heated charge air passes through a finned heat exchanger mounted in front of the engine radiator, cooling it before it enters the intake manifold. Cooler charge air is denser, improving combustion efficiency and reducing thermal stress. The CAC is passive (no active cooling control) and is subject to boost leak failures at the inlet/outlet hose connections.

The CAC system includes **charge air temperature sensors** at the inlet and outlet of the CAC to monitor heat rejection. These are typically two-wire NTC thermistor-type sensors. The PCM uses the CAC outlet temperature as part of intake charge modeling. Exact sensor locations and connector details: TRAINING-INFERRED based on 6.7L PSD diagnostic documentation, exact harness GAPS.

---

### 1.3 EGR system

The 4th-gen 6.7L Power Stroke uses a **high-pressure EGR configuration** — exhaust gas is recirculated from the high-pressure zone of the exhaust (upstream of the turbo turbine, or at least from a high-pressure exhaust tap) rather than from the low-pressure zone downstream of the DPF/SCR. This is the architecture standard for the 6.7L PSD across all generations.

An **EGR cooler** takes hot exhaust gas and runs it through a core cooled by engine coolant before the gas enters the EGR valve and then the intake. The EGR cooler is a shared component with the cooling system (coolant-side); this is referenced here as a topology fact — the EGR cooler coolant connections are emitted in the cooling system run. The EGR cooler is a documented failure point: coolant leaks into the EGR gas path (and potentially into the intake) are a known EGR cooler failure mode on the 6.7L PSD, traceable to thermal fatigue of the internal matrix. EGR cooler failure can produce white smoke (steam from coolant), coolant loss without external drip, and milky residue in the intake manifold.

The **EGR valve** is an electrically actuated, DC motor or stepper motor-driven valve positioned between the EGR cooler outlet and the intake manifold (or intake throttle body inlet area). It is position-controlled by the PCM using a PWM or direct motor-drive signal. An internal position sensor (potentiometer or Hall-effect) provides feedback to the PCM. The PCM uses the EGR valve in closed-loop control to achieve the commanded EGR mass flow rate.

An **EGR temperature sensor** is located in the EGR gas path, typically downstream of the EGR cooler and upstream of or at the EGR valve, to monitor the temperature of recirculated exhaust gas entering the intake. This is a two-wire NTC thermistor or thermocouple-type sensor. The PCM uses this for EGR system diagnostics and to monitor EGR cooler performance. Some 6.7L PSD configurations may have a second EGR temperature sensor upstream of the cooler (pre-cooler EGT) to bracket the cooler's heat rejection; exact sensor count and positions: TRAINING-INFERRED.

---

### 1.4 Exhaust and aftertreatment

The 6.7L Power Stroke V8 has **two exhaust manifolds** — one per cylinder bank (driver's side bank and passenger's side bank). The manifolds collect exhaust from each bank's cylinders and route to a common collector feeding the single VGT turbine inlet. On a diesel, exhaust manifold material is typically cast iron or nodular iron due to high exhaust temperatures and thermal cycling.

Multiple **Exhaust Gas Temperature (EGT) sensors** are present at different positions along the exhaust stream. For emissions compliance and DPF/SCR management, the 6.7L PSD typically has:
- EGT sensor pre-turbo or at the turbine inlet (upstream EGT)
- EGT sensor post-turbo / pre-DPF (DOC/DPF inlet)
- EGT sensor at the DPF outlet / SCR inlet
- EGT sensor at the SCR outlet

Exact sensor count and positions vary slightly between model years and emissions calibrations. The EGT sensors feed the PCM for active DPF regeneration temperature control and SCR catalyst temperature management. All EGT sensors are typically two-wire thermocouple-type sensors (K-type or similar).

The **Diesel Oxidation Catalyst (DOC)** is integrated into or immediately precedes the DPF in the aftertreatment housing. The DOC oxidizes hydrocarbons and CO in the exhaust stream and also creates exothermic heat during active DPF regeneration by combusting unburned fuel injected late in the exhaust stroke. The DOC is not monitored by a separate dedicated sensor — its performance is inferred by the PCM from EGT differential across the DOC/DPF assembly.

The **Diesel Particulate Filter (DPF)** is a ceramic wall-flow filter in the exhaust stream that traps particulate matter (soot) from diesel combustion. It requires periodic regeneration to burn off accumulated soot. Regeneration types:
- **Passive regen:** occurs naturally at highway speeds when exhaust temperatures are high enough to oxidize soot without PCM intervention.
- **Active regen:** PCM-commanded cycle that increases exhaust temperatures (via post-injection, intake throttle closure, and EGT targeting) to burn the soot filter clean. Active regen is triggered by accumulated soot load estimated from driving conditions and DPF differential pressure.
- **Forced/parked regen:** stationary regen commanded via scan tool (Ford FDRS or compatible) when passive/active regen has been interrupted enough times that soot load is critical.

A **DPF differential pressure sensor** (delta-pressure sensor) monitors the pressure drop across the DPF. As soot loads up, differential pressure rises. The PCM uses this signal (along with exhaust flow models) to estimate soot load and trigger active regen. The sensor is a two-port differential pressure transducer with tubes connected upstream and downstream of the DPF. It is a three-wire sensor (5V reference, signal, ground). This sensor is a documented failure point — the sensing tubes can clog with condensation/soot, causing false regen triggers or DPF-full codes (P2002 / P244A / P244B family).

The **Selective Catalytic Reduction (SCR)** catalyst is downstream of the DPF. The SCR reduces NOx emissions by reacting with DEF (urea solution) that is dosed into the exhaust stream by the DEF dosing injector. The SCR catalyst requires a minimum temperature window (approximately 200–600°C) for effective NOx conversion. The PCM controls DEF dosing to target optimal NOx conversion efficiency based on NOx sensor feedback and exhaust temperature.

The **DEF dosing system** — DEF tank, DEF pump, DEF dosing injector, and DEF quality/level sensors — is referenced here as existing entries `sd4-67psd-def-tank` and `sd4-67psd-def-dosing-system` already in the DB from Run 1. Not re-emitted.

**NOx sensors** are present at two positions:
- **Upstream NOx sensor (pre-SCR):** Located between the DPF outlet and the SCR inlet (or integrated into the combined aftertreatment housing outlet before the SCR brick). Measures raw NOx entering the SCR.
- **Downstream NOx sensor (post-SCR):** Located at the SCR outlet, measuring NOx after catalytic reduction. The PCM uses the difference to assess SCR conversion efficiency and adjust DEF dosing.

Both NOx sensors are smart sensors with integrated signal conditioning — they communicate with the PCM via a dedicated CAN-bus or PWM protocol (not a simple analog voltage). They require a separate sensor module/controller (often integrated into the sensor body). Exact communication protocol for the 2018 6.7L PSD NOx sensors: TRAINING-INFERRED.

The **tailpipe and muffler** assembly routes treated exhaust from the SCR outlet to atmosphere. The 6.7L PSD Super Duty uses a conventional muffler (passive resonance-type) and a single or dual tailpipe exit depending on configuration. No active exhaust valve or switchable exhaust path is present on the stock 4th-gen Super Duty diesel.

---

### 1.5 Control interfaces

All intake, turbo, EGR, and aftertreatment actuators are controlled by the existing **PCM** (`sd4-67psd-pcm`) via the **HS-CAN bus** (`sd4-67psd-hs-can-bus`). No separate turbo control module or aftertreatment control module exists as a distinct controller — all logic resides in the PCM on this platform. The NOx sensors communicate back to the PCM via dedicated protocols as noted above.

---

## Section 2 — JSON sidecar

```json
{
  "system": "engine-air-and-aftertreatment",
  "platform_slug": "ford-super-duty-4th-gen-67-psd",
  "architecture_facts": [
    {
      "slug": "a1-air-filter-housing-location",
      "description": "The air filter housing is located in the front corner of the engine compartment (driver-side or passenger-side front, behind headlight area); uses a dry paper element; the intake hose routes filtered air to the turbocharger compressor inlet.",
      "field_verify_required": false,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "a2-maf-sensor-pre-turbo-placement",
      "description": "The Mass Air Flow (MAF) sensor on the 6.7L Power Stroke is positioned upstream of the turbocharger compressor inlet and downstream of the air filter — it samples ambient (pre-boost) air, not charge air. This is the platform-specific placement distinguishing it from post-turbo MAF configurations.",
      "field_verify_required": false,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "a3-maf-iat-integrated-sensor",
      "description": "The MAF sensor and Intake Air Temperature (IAT) sensor are integrated into a single housing (Ford Integrated MAF/IAT unit); the IAT signal rides in the same connector as the MAF signal rather than being a standalone two-wire sensor.",
      "field_verify_required": false,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "a4-iat2-post-intercooler-sensor",
      "description": "A second intake air temperature sensor (IAT2, sometimes labeled Manifold IAT or Charge Air Cooler Outlet Temp sensor) is present downstream of the CAC intercooler, distinct from the MAF-integrated IAT; the PCM uses this for charge-air density modeling.",
      "field_verify_required": true,
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "a5-intake-heater-grid",
      "description": "An intake air heater grid (resistance heater element) is installed in the intake manifold inlet area; it heats incoming air directly for cold-start assist and is categorically different from glow plugs — the grid heats air, glow plugs heat each cylinder. Commanded by PCM via a high-current relay in the underhood junction box.",
      "field_verify_required": false,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "a6-intake-heater-relay-cavity",
      "description": "The intake air heater grid relay is in the underhood power distribution / battery junction box, but the exact relay cavity designation and fuse assignment for the 2018 F-250 are not reliably confirmed in training data.",
      "field_verify_required": true,
      "source_provenance": "GAP",
      "inference_class": null
    },
    {
      "slug": "a7-intake-manifold-no-runner-controls",
      "description": "The 4th-gen 6.7L PSD intake manifold is a composite plastic unit with no individual runner length or swirl/tumble valve control; intake charge management is achieved via injection timing, EGR mixing, and combustion chamber geometry rather than mechanical runner actuation.",
      "field_verify_required": false,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "a8-intake-throttle-valve-egr-mixing",
      "description": "An electric intake throttle valve (intake restriction valve) is present in the intake air path entering the manifold; on this diesel application its primary functions are (1) creating pressure differential to drive EGR gas into the intake, and (2) controlled shutdown to prevent diesel run-on — it does not control power output.",
      "field_verify_required": false,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "a9-map-boost-pressure-sensor",
      "description": "A Manifold Absolute Pressure (MAP) sensor is located in the intake manifold; on this turbocharged diesel it functions as the boost pressure sensor, providing absolute pressure signal (3-wire: 5V ref, analog signal, ground) used by the PCM for closed-loop VGT control and fueling corrections.",
      "field_verify_required": false,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "a10-single-vgt-architecture",
      "description": "The 2017–2022 6.7L Power Stroke uses a single Variable Geometry Turbocharger (VGT) — not twin sequential turbos. This is the definitive platform architecture distinction from the 2008–2010 6.4L Power Stroke (twin sequential) and has been the 6.7L PSD configuration since the first generation (2011+).",
      "field_verify_required": false,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "a11-vgt-variable-geometry-vane-mechanism",
      "description": "The VGT turbine housing contains variable-position vanes that alter the effective A/R ratio under PCM command: closing vanes increases turbine energy (faster spool at low RPM), opening vanes reduces restriction at peak power. The vane mechanism is also the primary hardware for the engine exhaust brake.",
      "field_verify_required": false,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "a12-vgt-exhaust-brake-mechanism",
      "description": "The 6.7L PSD exhaust brake operates by closing the VGT vanes at closed throttle, creating exhaust backpressure that generates engine braking torque. No separate compression-release (Jake) brake mechanism is present on the stock 4th-gen Super Duty; the VGT is the sole exhaust braking device.",
      "field_verify_required": false,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "a13-vgt-electric-actuator",
      "description": "The VGT vane position is commanded by an electronic actuator (electric motor-driven) receiving PWM or CAN-bus position signals from the PCM; the actuator contains an internal position sensor providing closed-loop feedback to the PCM. Exact actuator communication protocol (PWM vs CAN sub-bus) for the 3rd-gen 6.7L PSD (2017+) requires WSM confirmation.",
      "field_verify_required": true,
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "a14-vgt-primary-failure-component",
      "description": "The VGT is the primary failure-prone component on the 6.7L PSD platform; documented failure modes include sticking or seized variable vanes (carbon accumulation), actuator motor failure, and broken vane assemblies; these typically produce P0299 (underboost) or P2263 (boost system performance) codes.",
      "field_verify_required": false,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "a15-turbo-speed-sensor",
      "description": "A turbo speed sensor is present on the 6.7L PSD turbocharger, providing turbine wheel RPM to the PCM for VGT control, overspeed protection, and diagnostics. Exact sensor type (magnetic pickup vs Hall-effect) and harness connector pinout require WSM confirmation.",
      "field_verify_required": true,
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "a16-charge-air-cooler-air-to-air",
      "description": "The 4th-gen Super Duty 6.7L PSD uses an air-to-air Charge Air Cooler (CAC / intercooler) mounted in front of the radiator; compressed, heated turbo outlet air passes through the finned core and is cooled by ambient airflow before entering the intake manifold. The CAC is passive with no active cooling control.",
      "field_verify_required": false,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "a17-cac-boost-leak-failure-mode",
      "description": "The CAC and its inlet/outlet hose connections are a documented boost leak failure point on the 6.7L PSD; cracked hoses, loose clamps, or intercooler end-tank leaks cause underboost conditions and increased smoke; a boost leak test (pressurize intake system with engine off) is the standard diagnostic.",
      "field_verify_required": false,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "a18-cac-inlet-outlet-temp-sensors",
      "description": "Charge air temperature sensors are present at the CAC inlet and outlet (two-wire NTC thermistor type); the PCM uses the CAC outlet temperature for intake charge density modeling. Exact sensor mounting locations and connector details are not fully confirmed in training data.",
      "field_verify_required": true,
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "a19-egr-high-pressure-configuration",
      "description": "The 4th-gen 6.7L PSD uses a high-pressure EGR configuration — exhaust gas is recirculated from the high-pressure side of the exhaust upstream of the turbo turbine, not from downstream of the DPF/SCR (low-pressure path). This is consistent across all 6.7L PSD generations.",
      "field_verify_required": false,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "a20-egr-cooler-shared-coolant-circuit",
      "description": "The EGR cooler uses engine coolant to reduce exhaust gas temperature before the gas reaches the EGR valve; the coolant connections are shared with the engine cooling circuit (reference cooling system run — not re-emitted here). EGR cooler failure (internal matrix fatigue) can cause coolant intrusion into the intake stream, producing white smoke and unexplained coolant loss.",
      "field_verify_required": false,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "a21-egr-valve-electric-position-control",
      "description": "The EGR valve is electrically actuated (DC motor or stepper motor drive) and position-controlled by the PCM via PWM or direct motor commands; an internal position sensor provides closed-loop position feedback. The valve sits between the EGR cooler outlet and the intake manifold/throttle body inlet.",
      "field_verify_required": false,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "a22-egr-temperature-sensor",
      "description": "An EGR temperature sensor is present in the EGR gas path, located downstream of the EGR cooler and at or near the EGR valve, monitoring the temperature of recirculated exhaust gas to confirm EGR cooler function and protect the EGR valve from thermal damage.",
      "field_verify_required": false,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "a23-egr-pre-cooler-temp-sensor",
      "description": "Some 6.7L PSD configurations include a second EGR temperature sensor upstream of the EGR cooler (pre-cooler EGT) to bracket the cooler's heat rejection; whether this is present on all 2018 model year builds or only specific calibration tunes requires WSM confirmation.",
      "field_verify_required": true,
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "a24-exhaust-manifolds-dual-bank",
      "description": "Two cast-iron exhaust manifolds collect exhaust from the driver-side and passenger-side cylinder banks respectively; they feed a common collector at the VGT turbine inlet. Cast iron material is standard for diesel exhaust manifolds due to high operating temperatures and thermal cycling demands.",
      "field_verify_required": false,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "a25-egt-sensor-positions-multiple",
      "description": "Multiple Exhaust Gas Temperature (EGT) sensors are present at staged positions: (1) pre-DPF / DOC inlet, (2) DPF outlet / SCR inlet, (3) SCR outlet / tailpipe area; some calibrations include a pre-turbo upstream EGT. All EGT sensors are two-wire thermocouple-type. The PCM uses these for active regen temperature targeting and SCR catalyst window management.",
      "field_verify_required": true,
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "a26-doc-diesel-oxidation-catalyst",
      "description": "A Diesel Oxidation Catalyst (DOC) is integrated into the aftertreatment assembly upstream of the DPF; it oxidizes hydrocarbons and CO and provides the exothermic reaction that raises exhaust temperature during active DPF regeneration when the PCM commands late post-injection or fuel dosing.",
      "field_verify_required": false,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "a27-dpf-diesel-particulate-filter",
      "description": "A Diesel Particulate Filter (DPF) is in the exhaust aftertreatment housing downstream of the DOC; it captures soot via wall-flow filtration and requires periodic regeneration (passive at highway temps, active PCM-commanded via increased EGT, or forced/parked regen via scan tool) to burn off accumulated soot.",
      "field_verify_required": false,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "a28-dpf-differential-pressure-sensor",
      "description": "A differential pressure sensor monitors pressure drop across the DPF (two sensing ports, upstream and downstream of the filter); the PCM uses the delta-pressure signal plus exhaust flow models to estimate soot load and trigger active regen. Sensor type is a 3-wire transducer (5V ref, analog signal, ground). Sensing tubes are documented as a clogging failure point causing false regen triggers or P244A/P244B codes.",
      "field_verify_required": false,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "a29-dpf-regen-active-mechanism",
      "description": "Active DPF regeneration is PCM-commanded: the PCM closes the intake throttle, adjusts VGT vane position, and commands late post-injection to raise DOC/DPF inlet temperature to the soot combustion threshold (~600°C target). Regen is transparent to the driver except for elevated idle RPM and a brief increase in exhaust odor. Interrupted regens accumulate; after multiple interruptions, parked/forced regen is required.",
      "field_verify_required": false,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "a30-scr-selective-catalytic-reduction",
      "description": "A Selective Catalytic Reduction (SCR) catalyst is downstream of the DPF; it converts NOx to nitrogen and water by reacting with ammonia released from DEF (urea solution) injected by the dosing system. SCR requires a minimum catalyst temperature window (~200–600°C) for effective NOx conversion; below this window, DEF dosing is suspended.",
      "field_verify_required": false,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "a31-def-system-reference",
      "description": "DEF tank, DEF pump, and DEF dosing injector are referenced here as existing DB entries (slugs: sd4-67psd-def-tank and sd4-67psd-def-dosing-system from fuel system Run 1) — not re-emitted in this run. The dosing injector injects DEF spray into the exhaust stream upstream of the SCR catalyst.",
      "field_verify_required": false,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "a32-nox-sensor-upstream-pre-scr",
      "description": "An upstream NOx sensor is located between the DPF outlet and the SCR catalyst inlet (or at the aftertreatment housing inlet before the SCR brick); it measures raw NOx concentration entering the SCR to provide a baseline for DEF dosing calculation.",
      "field_verify_required": true,
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "a33-nox-sensor-downstream-post-scr",
      "description": "A downstream NOx sensor is located at the SCR outlet; the PCM compares upstream vs downstream NOx readings to assess SCR conversion efficiency and adjust DEF dosing rate in closed-loop control. Degraded SCR efficiency triggers P20EE / P2BAD and related NOx catalyst codes.",
      "field_verify_required": false,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "a34-nox-sensor-smart-can-communication",
      "description": "Both NOx sensors are 'smart' sensors with integrated signal conditioning electronics; they communicate with the PCM via a dedicated protocol (likely PWM or sub-CAN, not simple analog voltage). Exact communication protocol for the 2018 6.7L PSD NOx sensor pair requires WSM confirmation.",
      "field_verify_required": true,
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "a35-muffler-tailpipe-configuration",
      "description": "A conventional passive muffler and single or dual tailpipe exit route SCR-treated exhaust to atmosphere; no active exhaust valve or switchable exhaust path is present on the stock 4th-gen Super Duty diesel. Exact tailpipe configuration (single vs dual) varies by body/frame configuration.",
      "field_verify_required": false,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "a36-pcm-sole-controller-air-aftertreatment",
      "description": "All air-system and aftertreatment actuators — intake throttle, intake heater grid relay, VGT actuator, EGR valve, DEF dosing — are controlled by the existing PCM (sd4-67psd-pcm) via the HS-CAN bus (sd4-67psd-hs-can-bus). No separate turbo control module or aftertreatment control module exists as a distinct CAN node on this platform.",
      "field_verify_required": false,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    }
  ]
}
```
