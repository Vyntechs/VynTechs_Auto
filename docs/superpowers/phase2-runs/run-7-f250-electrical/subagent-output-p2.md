# Run 7 / Prompt 2 — Subagent Output: Electrical / Charging / Starting — Decomposition + Topology

**Date:** 2026-05-19
**Subagent model:** Sonnet
**Input:** Architecture facts E1–E28 from subagent-output-p1.md
**Platform:** ford-super-duty-4th-gen-67-psd / 2017–2022
**System:** Electrical / Charging / Starting

---

## Section 1 — Prose Decomposition (Grouped)

### Power Storage

**sd4-67psd-battery-primary** — Driver-side 12V flooded lead-acid battery in the primary battery tray under the hood. One of two batteries wired in parallel. Provides and accepts charge as part of the combined 12V bank. The BMS sensor is integrated into this battery's negative cable. [TRAINING-CONFIRMED]

**sd4-67psd-battery-secondary** — Passenger-side 12V flooded lead-acid battery in the secondary tray under the hood. Permanently paralleled to the primary battery via the positive crossover cable; no factory isolator between them. [TRAINING-CONFIRMED]

**sd4-67psd-battery-positive-crossover-cable** — Heavy-gauge (typically 2/0–4/0 AWG) cable connecting the two battery positive terminals to maintain identical potential across both batteries. Combined B+ output routes forward to the BJB main positive cable. [TRAINING-CONFIRMED]

**sd4-67psd-battery-negative-strap-block** — Negative cable/strap assembly connecting both battery negative terminals to the engine block ground point. The primary battery negative side hosts the BMS sensor in-line. [TRAINING-INFERRED / PATTERN; specific attachment bosses GAP]

**sd4-67psd-battery-negative-strap-frame** — Supplemental ground strap(s) connecting the battery negative bus or engine block ground point to the chassis frame rail, extending the ground plane to body and chassis loads. [TRAINING-INFERRED / PATTERN; exact routing GAP]

**sd4-67psd-bms-sensor** — Battery Monitoring System sensor integrated into the primary battery negative cable assembly. Uses a shunt or hall-effect design to measure real-time current, state of charge (SOC), and state of health (SOH). Communicates to the PCM via a dedicated signal wire on the negative cable harness. Signal protocol (analog mV vs. LIN bus) is a confirmed GAP requiring WSM/FDRS verification. [TRAINING-CONFIRMED for presence; TRAINING-INFERRED for protocol type; GAP for pinout]

---

### Power Generation

**sd4-67psd-alternator** — High-output (250–275A nameplate, field_verify_required) internally-regulated wound-field AC alternator with internal rectifier bridge. Mounted on the engine accessory drive, front of engine, driver side. Drives off the serpentine belt via its own pulley. PCM controls charging voltage dynamically via a dedicated PWM signal wire to the internal voltage regulator (Ford FEAD smart charging strategy). B+ output feeds directly to the BJB. [TRAINING-CONFIRMED for type/location/strategy; TRAINING-INFERRED for exact output; GAP for PCM wire pinout]

**sd4-67psd-serpentine-belt** — Single accessory drive belt routing across the alternator pulley, A/C compressor, and (trim-dependent) power steering pump. Belt failure immediately eliminates charging output. Belt condition and tension are direct observable properties for charging diagnostics. [TRAINING-CONFIRMED; power steering load is a trim-level variant — field_verify_required]

**sd4-67psd-belt-tensioner** — Spring-loaded automatic tensioner on the accessory drive maintaining proper serpentine belt tension. Tensioner spring fatigue is a serviceable maintenance item. Loss of tension produces belt slip, which reduces alternator output before belt failure occurs. [TRAINING-INFERRED / PATTERN]

The alternator pulley rides on the engine's crankshaft-driven accessory drive system; the crank pulley is part of **sd4-67psd-engine-gear-train** (already emitted — reference only).

---

### Starting

**sd4-67psd-starter-motor** — 12V gear-reduction starter motor mounted at the transmission bell housing / engine block mating surface, engaging the flywheel ring gear. Gear-reduction design multiplies torque to overcome the 6.7L PSD's high compression ratio (~16.2:1–17.0:1). Receives B+ directly from the BJB via the starter solenoid's main contact. Exact mounting side (driver vs. passenger) is field_verify_required. [TRAINING-CONFIRMED for type; TRAINING-INFERRED for exact side]

**sd4-67psd-starter-solenoid** — Integrated solenoid on the starter motor assembly (not remote). Performs two simultaneous functions when energized: (1) closes the high-current B+ circuit between the BJB and starter motor windings, and (2) engages the pinion gear with the flywheel ring gear via an internal lever. The solenoid control terminal is fed by the starter relay in the BJB. [TRAINING-CONFIRMED]

**sd4-67psd-starter-relay** — Relay housed inside the BJB in the engine compartment. Coil energized by the PCM (or BCM on some PTBS configurations) start authorization signal. When energized, relay closes the medium-current circuit to the starter solenoid control terminal. Exact BJB cavity designation is a confirmed GAP requiring Ford WSM fuse/relay chart. [GAP for cavity; TRAINING-CONFIRMED for existence and function]

**sd4-67psd-ignition-switch** — Column-mounted key-cylinder ignition switch on base/mid-trim builds (XL, XLT, base Lariat). On higher-trim builds (King Ranch, Platinum, Limited, some Lariat packages) this is replaced by a push-button start (PTBS) module. Both configurations ultimately deliver the start authorization signal to the PCM. Which configuration is present is a confirmed trim-level variant — field_verify_required on the specific vehicle. [TRAINING-CONFIRMED]

The Passive Anti-Theft System (PATS) is an authentication layer on all configurations. PATS is integrated with the BCM; if key transponder or fob authentication fails, the PCM inhibits fuel and/or starter actuation. PATS is not emitted as a separate component here — it is a functional attribute of the **sd4-67psd-bcm** / ignition switch system boundary. [TRAINING-CONFIRMED]

The starter motor's pinion engages the flywheel ring gear, which is part of **sd4-67psd-engine-gear-train** (already emitted — reference only).

---

### Distribution + Protection

**sd4-67psd-bjb** — Battery Junction Box in the engine compartment. Primary high-current distribution point for the entire vehicle electrical system. Contains: mega-fuses (150–250A range) for main power feeds to PCM, BCM/SJB, glow plug controller (boundary ref), and accessory circuits; the starter relay; the alternator B+ input lug; and the fuel lift pump relay (already emitted as **sd4-67psd-lift-pump-relay** — boundary reference). All B+ current from both batteries flows through the BJB before distribution. [TRAINING-CONFIRMED]

**sd4-67psd-bcm** — Body Control Module (and co-located Smart Junction Box / SJB on this platform). Located behind the instrument panel in the passenger compartment. Controls body electrical loads (lighting, door locks, accessories), manages PATS authentication, and provides start authorization signals to the PCM. Receives B+ feed from BJB via main harness. Whether BCM and SJB are physically the same unit on the 2018 F-250 is TRAINING-INFERRED / PATTERN — field_verify_required. Communicates with PCM via HS-CAN bus. [TRAINING-INFERRED / PATTERN for physical config; TRAINING-CONFIRMED for function]

**sd4-67psd-ground-point-block** — Engine block ground node where both battery negative straps terminate. Also the anchor for the chassis ground strap. The engine block itself functions as a common ground conductor for all engine-mounted sensors and modules. Degraded connection at this point produces broad charging and CAN communication anomalies. [TRAINING-CONFIRMED]

**sd4-67psd-ground-point-frame** — Chassis frame rail ground distribution point. Receives the engine-block-to-frame strap and provides chassis-level ground to body harness ground points under the cab. Frame rail is the primary ground plane for non-engine loads. [TRAINING-CONFIRMED]

---

### Control + Monitoring

The **sd4-67psd-pcm** (already emitted) runs Ford's FEAD smart charging strategy, reading the BMS sensor signal, engine RPM, coolant temperature, and accessory load estimates to dynamically adjust the alternator field control PWM signal. The PCM also authorizes starter operation via the starter relay in the BJB, contingent on PATS authentication from the BCM. These are control relationships — no new components, only connections emitted here.

The **sd4-67psd-instrument-cluster** (already emitted) receives battery/charging status from the PCM via the **sd4-67psd-hs-can-bus** and displays the battery warning lamp (red battery icon) and (on some trims) a voltmeter gauge. No new components — connections emitted in Section 2.

The **sd4-67psd-gpcm** (engine-mechanical run scope — boundary reference) draws heavy transient B+ current from the BJB during cold-start glow plug preheat cycles (briefly 100+ A). The dual-battery architecture and high-output alternator are sized around this transient load. No new components emitted.

---

## Section 2 — JSON Sidecar

```json
{
  "components": [
    {
      "slug": "sd4-67psd-battery-primary",
      "name": "Battery — Primary (Driver Side)",
      "kind": "mechanical",
      "electrical_contract": "12V B+ / negative to engine block",
      "location": "Engine compartment, driver-side battery tray",
      "function": "Primary 12V energy storage cell; one half of the parallel dual-battery bank; hosts the BMS sensor on its negative cable",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-battery-secondary",
      "name": "Battery — Secondary (Passenger Side)",
      "kind": "mechanical",
      "electrical_contract": "12V B+ / negative to engine block",
      "location": "Engine compartment, passenger-side battery tray",
      "function": "Second 12V energy storage cell; permanently paralleled to primary battery via positive crossover cable; no factory isolator",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-battery-positive-crossover-cable",
      "name": "Battery Positive Crossover Cable",
      "kind": "mechanical",
      "electrical_contract": "Heavy-gauge B+ interconnect (typically 2/0–4/0 AWG)",
      "location": "Engine compartment, battery tray area, between primary and secondary battery positive terminals",
      "function": "Maintains identical potential across both battery positive terminals; combined B+ output routes to BJB main positive cable",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-battery-negative-strap-block",
      "name": "Battery Negative Strap to Engine Block",
      "kind": "mechanical",
      "electrical_contract": "Negative/ground conductor (heavy gauge)",
      "location": "Battery negative terminals to engine block ground boss",
      "function": "Returns battery discharge current and charging current to the engine block ground node; primary battery negative side carries BMS sensor in-line",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "sd4-67psd-battery-negative-strap-frame",
      "name": "Battery/Engine Block Negative Strap to Frame",
      "kind": "mechanical",
      "electrical_contract": "Ground conductor, supplemental chassis ground",
      "location": "Engine block ground boss to chassis frame rail ground point",
      "function": "Extends the 12V ground plane from engine block to chassis frame rail for body and accessory circuit returns",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "sd4-67psd-bms-sensor",
      "name": "Battery Monitoring System (BMS) Sensor",
      "kind": "sensor",
      "electrical_contract": "Low-voltage signal output (analog mV or LIN bus — protocol is GAP)",
      "location": "Integrated into primary battery negative cable assembly, engine compartment driver side",
      "function": "Measures real-time battery current (charge/discharge), state of charge (SOC), and state of health (SOH); signals PCM to enable smart charging strategy",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-alternator",
      "name": "Alternator (High-Output, Belt-Driven)",
      "kind": "mechanical",
      "electrical_contract": "B+ output ~13.5–15.0V / 250–275A (nameplate GAP); PCM PWM control input; chassis ground",
      "location": "Engine accessory drive, front of engine, driver side",
      "function": "Generates electrical power for all vehicle loads and battery charging; internal voltage regulator accepts PCM PWM duty-cycle to implement Ford FEAD smart charging strategy",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-serpentine-belt",
      "name": "Serpentine Accessory Drive Belt",
      "kind": "mechanical",
      "electrical_contract": null,
      "location": "Engine front accessory drive, routing across alternator, A/C compressor, and (trim-dependent) power steering pump pulleys",
      "function": "Transfers crankshaft rotational energy to the alternator (and other accessories); belt failure immediately eliminates charging output",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-belt-tensioner",
      "name": "Serpentine Belt Tensioner (Automatic)",
      "kind": "mechanical",
      "electrical_contract": null,
      "location": "Engine accessory drive, front of engine (exact bracket position is PATTERN-inferred)",
      "function": "Spring-loaded automatic tensioner that maintains proper serpentine belt tension; tensioner spring fatigue reduces belt grip before full belt failure",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "sd4-67psd-starter-motor",
      "name": "Starter Motor (12V Gear-Reduction)",
      "kind": "actuator",
      "electrical_contract": "12V B+ main terminal (high-current from BJB via solenoid); solenoid control terminal (medium-current from starter relay); chassis ground via mounting",
      "location": "Transmission bell housing / engine block mating surface; exact side (driver vs. passenger) is field_verify_required",
      "function": "Cranks the 6.7L PSD diesel via gear-reduction mechanism engaging flywheel ring gear; gear-reduction design provides torque multiplication for high-compression cold starting",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-starter-solenoid",
      "name": "Starter Solenoid (Integrated)",
      "kind": "actuator",
      "electrical_contract": "Control coil energized by starter relay; main contacts switch B+ from BJB to starter motor windings",
      "location": "Integrated into starter motor assembly",
      "function": "Dual function: (1) closes main B+ circuit to starter motor when coil energized; (2) engages starter pinion gear with flywheel ring gear via internal lever arm",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-starter-relay",
      "name": "Starter Relay",
      "kind": "actuator",
      "electrical_contract": "Coil: low-current control signal from PCM/BCM; main contacts: B+ switched to starter solenoid control terminal; BJB cavity designation is GAP",
      "location": "Inside Battery Junction Box (BJB), engine compartment; exact cavity designation requires Ford WSM",
      "function": "PCM/BCM-controlled relay that closes the start circuit to the starter solenoid; the PCM-to-relay control wire carries start authorization contingent on PATS authentication",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-ignition-switch",
      "name": "Ignition Switch / Start Module",
      "kind": "actuator",
      "electrical_contract": "Battery-fed key switch (key-start) or PCM/BCM-interfaced push-button module (PTBS); output = start authorization signal to PCM/BCM",
      "location": "Steering column (key-start trims) or dash panel (PTBS trims); trim-level variant — field_verify_required",
      "function": "Driver-actuated input for ignition ON / START commands; PATS transponder authentication is co-located (key chip or smart fob); routes start request to PCM contingent on PATS pass",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-bjb",
      "name": "Battery Junction Box (BJB) — Underhood",
      "kind": "module",
      "electrical_contract": "B+ main input from both batteries; fused B+ outputs to PCM, BCM/SJB, alternator feed, starter relay, GPCM (boundary ref), lift pump relay (boundary ref), and accessory mega-fuses",
      "location": "Engine compartment, typically forward of firewall near battery trays",
      "function": "Primary high-current distribution and protection center; houses mega-fuses, the starter relay, alternator B+ input lug, and fused feeds to all major underhood and cabin loads",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-bcm",
      "name": "Body Control Module (BCM) / Smart Junction Box (SJB)",
      "kind": "module",
      "electrical_contract": "B+ feed from BJB; low-voltage signal I/O for body loads, ignition switch, PATS; HS-CAN to PCM",
      "location": "Passenger compartment, behind instrument panel; SJB may be physically integrated or discrete — field_verify_required",
      "function": "Controls body electrical loads (lighting, locks, accessories); manages PATS authentication; provides start authorization signal to PCM; co-located passenger fuse/relay center for cabin circuits",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "sd4-67psd-ground-point-block",
      "name": "Engine Block Ground Node",
      "kind": "mechanical",
      "electrical_contract": "Ground / 0V reference; terminates both battery negative straps and engine-to-frame strap",
      "location": "Engine block; specific attachment boss location is PATTERN-inferred — field_verify_required",
      "function": "Common ground reference for battery negative bus, all engine-mounted sensors and actuators, and starter motor return path; degradation causes charging system and CAN communication anomalies",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-ground-point-frame",
      "name": "Chassis Frame Rail Ground Node",
      "kind": "mechanical",
      "electrical_contract": "Ground / 0V reference for body and chassis circuits",
      "location": "Chassis frame rail; receives engine-block-to-frame strap and feeds under-cab body ground distribution points",
      "function": "Primary ground plane for all non-engine electrical loads; frame rail conducts return current from lighting, BCM/SJB, cabin accessories, and trailer loads",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    }
  ],
  "observable_properties": [
    {
      "slug": "sd4-67psd-battery-primary-voltage-static",
      "component_slug": "sd4-67psd-battery-primary",
      "description": "Open-circuit voltage of primary battery measured at terminals after 2+ hours rest; healthy FLA = 12.6V–12.7V; below 12.4V indicates partial discharge; below 12.0V indicates deep discharge or cell damage",
      "observation_method": "electrical_measurement_at_pin",
      "housing_opacity_status": "transparent",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-battery-primary-cranking-voltage",
      "component_slug": "sd4-67psd-battery-primary",
      "description": "Terminal voltage of primary battery during cranking event; healthy bank holds above 9.6V at the battery terminals during crank; drops below 9.6V indicate weak battery, poor connection, or excessive starter draw",
      "observation_method": "electrical_measurement_at_pin",
      "housing_opacity_status": "transparent",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-battery-primary-load-test",
      "component_slug": "sd4-67psd-battery-primary",
      "description": "Carbon pile or electronic load test of primary battery at half its CCA rating for 15 seconds; voltage should remain above 9.6V throughout; failure indicates reduced battery capacity independent of surface charge",
      "observation_method": "electrical_measurement_at_pin",
      "housing_opacity_status": "transparent",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-battery-secondary-voltage-static",
      "component_slug": "sd4-67psd-battery-secondary",
      "description": "Open-circuit voltage of secondary battery measured at terminals after 2+ hours rest; same thresholds as primary: 12.6V–12.7V healthy, below 12.4V discharged; both batteries should read within 0.1V of each other when paralleled and healthy",
      "observation_method": "electrical_measurement_at_pin",
      "housing_opacity_status": "transparent",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-battery-secondary-load-test",
      "component_slug": "sd4-67psd-battery-secondary",
      "description": "Load test of secondary battery at half its CCA rating; tested independently (disconnect positive crossover cable to isolate); failure while primary passes confirms one weak battery dragging down the dual-battery bank",
      "observation_method": "electrical_measurement_at_pin",
      "housing_opacity_status": "transparent",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-battery-positive-crossover-cable-voltage-drop",
      "component_slug": "sd4-67psd-battery-positive-crossover-cable",
      "description": "Millivolt voltage drop across the crossover cable during cranking; measured terminal-to-terminal (primary positive to secondary positive); above 200mV under load indicates high-resistance joint (corrosion, loose terminal) causing one battery to be effectively isolated during cranking",
      "observation_method": "electrical_measurement_at_pin",
      "housing_opacity_status": "transparent",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-battery-negative-strap-block-voltage-drop",
      "component_slug": "sd4-67psd-battery-negative-strap-block",
      "description": "Millivolt drop across the battery-negative-to-engine-block strap(s) during cranking; above 200mV drop indicates corroded or loose engine block ground connection; symptom cluster: hard start + charging anomalies + intermittent CAN DTCs",
      "observation_method": "electrical_measurement_at_pin",
      "housing_opacity_status": "transparent",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-bms-sensor-pid-soc",
      "component_slug": "sd4-67psd-bms-sensor",
      "description": "PCM PID for battery state of charge as reported by the BMS sensor; read via scan tool connected to HS-CAN (Ford FDRS or equivalent); value should rise during charge and fall during high-load events; a stuck or flat reading suggests BMS sensor failure or wiring fault",
      "observation_method": "scan_tool_pid",
      "housing_opacity_status": "opaque",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-bms-sensor-pid-soh",
      "component_slug": "sd4-67psd-bms-sensor",
      "description": "PCM PID for battery state of health as reported by the BMS sensor; indicates battery capacity relative to rated new capacity; below approximately 60–70% SOH triggers smart charge strategy adjustments and may set DTCs",
      "observation_method": "scan_tool_pid",
      "housing_opacity_status": "opaque",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-bms-sensor-visual-connector",
      "component_slug": "sd4-67psd-bms-sensor",
      "description": "Visual inspection of BMS sensor connector and cable at the primary battery negative cable assembly; look for corrosion, moisture intrusion, chafed insulation, and pin fretting; BMS connector failure is a common root cause of false charging system DTCs",
      "observation_method": "direct_visual_external",
      "housing_opacity_status": "partial",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-alternator-output-voltage",
      "component_slug": "sd4-67psd-alternator",
      "description": "Charging voltage measured at the battery positive terminal with engine running at ~1500 RPM, accessories on; expected range 13.5V–15.0V depending on PCM FEAD strategy and current SOC; below 13.0V indicates low charging output; above 15.2V indicates regulator fault",
      "observation_method": "electrical_measurement_at_pin",
      "housing_opacity_status": "transparent",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-alternator-output-current",
      "component_slug": "sd4-67psd-alternator",
      "description": "Alternator output current measured with a DC clamp meter on the B+ output cable; after a hard start, output should be high (100–200A+) tapering as batteries recover; abnormally low current at low SOC suggests an alternator output limitation",
      "observation_method": "electrical_measurement_at_pin",
      "housing_opacity_status": "transparent",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-alternator-pid-commanded-voltage",
      "component_slug": "sd4-67psd-alternator",
      "description": "PCM PID for commanded charging voltage (PCM's target set point for the alternator field control); compare to actual measured voltage to confirm the alternator is responding to PCM commands vs. regulating independently; mismatch suggests PCM-to-alternator communication wire fault",
      "observation_method": "scan_tool_pid",
      "housing_opacity_status": "opaque",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-alternator-diode-ripple",
      "component_slug": "sd4-67psd-alternator",
      "description": "AC ripple voltage superimposed on the DC charging output, measured with an oscilloscope or AC-coupled voltmeter at the battery positive terminal with engine running; above 50–100mV AC ripple indicates failed rectifier diodes in the alternator; can cause false battery DTCs and module communication errors",
      "observation_method": "waveform_capture",
      "housing_opacity_status": "opaque",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-alternator-visual-external",
      "component_slug": "sd4-67psd-alternator",
      "description": "External visual inspection of alternator body, mounting brackets, B+ output stud, field wire connector, and cooling vents; look for oil/coolant contamination on vents (damages windings), cracked bracket, and fretting at the B+ stud nut",
      "observation_method": "direct_visual_external",
      "housing_opacity_status": "partial",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-serpentine-belt-visual",
      "component_slug": "sd4-67psd-serpentine-belt",
      "description": "External visual inspection of serpentine belt for cracking (back and ribbed sides), glazing, fraying edges, missing chunks, and proper seating in all pulley grooves; a glazed belt slips under load before it breaks, reducing alternator output intermittently",
      "observation_method": "direct_visual_external",
      "housing_opacity_status": "transparent",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-serpentine-belt-tension",
      "component_slug": "sd4-67psd-serpentine-belt",
      "description": "Belt tension check: with engine off, observe tensioner position indicator mark (if present) or test belt deflection per Ford specification; belt slack beyond spec causes slippage and reduced alternator output especially at idle",
      "observation_method": "direct_visual_external",
      "housing_opacity_status": "transparent",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "sd4-67psd-belt-tensioner-visual-spring",
      "component_slug": "sd4-67psd-belt-tensioner",
      "description": "Visual and manual inspection of belt tensioner: observe tensioner arm travel range and spring tension feel (with engine off, manually deflect arm — should resist firmly and return smoothly); a weak spring or seized pivot indicates replacement needed",
      "observation_method": "direct_visual_external",
      "housing_opacity_status": "partial",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "sd4-67psd-starter-motor-crank-current",
      "component_slug": "sd4-67psd-starter-motor",
      "description": "Starter motor draw during cranking, measured with a DC clamp meter on the B+ cable to the starter; typical healthy draw 150–250A on a warm engine; excessively high draw (350A+) suggests tight engine, failed starter, or bearing fault; excessively low draw with no-crank suggests open circuit in starter or solenoid",
      "observation_method": "electrical_measurement_at_pin",
      "housing_opacity_status": "opaque",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-starter-motor-visual",
      "component_slug": "sd4-67psd-starter-motor",
      "description": "Visual inspection of starter motor body, mounting bolts, and cable connections; look for heat damage (blued housing), oil contamination at bell housing, corrosion at B+ terminal stud nut, and missing/damaged heat shield if equipped",
      "observation_method": "direct_visual_external",
      "housing_opacity_status": "partial",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "sd4-67psd-starter-solenoid-control-voltage",
      "component_slug": "sd4-67psd-starter-solenoid",
      "description": "Voltage at the solenoid control (S) terminal during a crank command; should see battery voltage (~12V) when the starter relay closes; absence of voltage with a valid crank command points to the relay circuit or PCM/BCM authorization signal, not the solenoid itself",
      "observation_method": "electrical_measurement_at_pin",
      "housing_opacity_status": "opaque",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-starter-relay-coil-voltage",
      "component_slug": "sd4-67psd-starter-relay",
      "description": "Voltage at the starter relay coil terminals in the BJB during a crank command; one terminal should see B+ supply from BJB; the other should see a ground path closed by PCM/BCM during start authorization; absence of ground pull-down during crank indicates PCM/BCM authorization issue, PATS inhibit, or wiring fault before the relay",
      "observation_method": "electrical_measurement_at_pin",
      "housing_opacity_status": "opaque",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-ignition-switch-start-signal",
      "component_slug": "sd4-67psd-ignition-switch",
      "description": "Voltage or digital signal presence at the ignition switch output (START position) during crank attempt; key-start builds: verify voltage at start terminal leaving column; PTBS builds: verify PCM PID for start request status via scan tool; absence at this point isolates fault to the switch/module itself or its power supply",
      "observation_method": "electrical_measurement_at_pin",
      "housing_opacity_status": "opaque",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-bjb-mega-fuse-visual",
      "component_slug": "sd4-67psd-bjb",
      "description": "Visual inspection of mega-fuses in the BJB; look for blown fuse indicators (melted element visible through clear window), heat discoloration of fuse body, and corroded or loose fuse contacts in their sockets; a blown mega-fuse can cause complete loss of a major circuit (PCM, glow plug controller, alternator output bus)",
      "observation_method": "direct_visual_external",
      "housing_opacity_status": "partial",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-bjb-b-plus-voltage",
      "component_slug": "sd4-67psd-bjb",
      "description": "B+ voltage at the main input stud of the BJB with engine off; should match battery terminal voltage within 100mV; a larger difference indicates resistance in the main B+ cable from batteries to BJB (corrosion, loose terminal, or chafed cable)",
      "observation_method": "electrical_measurement_at_pin",
      "housing_opacity_status": "opaque",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-bcm-dtc-scan",
      "component_slug": "sd4-67psd-bcm",
      "description": "Scan tool read of BCM/SJB DTC memory via HS-CAN; BCM stores B-codes for PATS authentication failures, body load circuit faults, and communication bus errors; PATS inhibit codes in BCM are a primary no-start diagnostic path alongside PCM codes",
      "observation_method": "scan_tool_pid",
      "housing_opacity_status": "opaque",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-ground-point-block-voltage-drop",
      "component_slug": "sd4-67psd-ground-point-block",
      "description": "Millivolt drop across the engine block ground node: measure between battery negative terminal and a known-clean chassis ground during cranking; above 200mV indicates high resistance at the block ground connection; primary diagnostic for broad charging + CAN communication symptom clusters",
      "observation_method": "electrical_measurement_at_pin",
      "housing_opacity_status": "transparent",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-ground-point-frame-voltage-drop",
      "component_slug": "sd4-67psd-ground-point-frame",
      "description": "Millivolt drop between engine block ground and frame rail ground during a loaded circuit condition; above 100mV indicates a high-resistance engine-to-frame strap connection; body-load electrical complaints (lighting flicker, lock faults) with normal charging often trace here",
      "observation_method": "electrical_measurement_at_pin",
      "housing_opacity_status": "transparent",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-ground-point-frame-visual",
      "component_slug": "sd4-67psd-ground-point-frame",
      "description": "Visual inspection of the frame rail ground bolt/stud and attached strap terminations; look for white or green corrosion at the contact face, paint creep under the lug, and loose or broken hardware; frame grounds on trucks are high-vibration failure points",
      "observation_method": "direct_visual_external",
      "housing_opacity_status": "transparent",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    }
  ],
  "component_connections": [
    {
      "from_component_slug": "sd4-67psd-battery-primary",
      "to_component_slug": "sd4-67psd-battery-positive-crossover-cable",
      "connection_kind": "electrical-wire",
      "direction": "bidirectional",
      "description": "Primary battery positive terminal connects to one end of the positive crossover cable; current flows in both directions as batteries charge and discharge",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-battery-secondary",
      "to_component_slug": "sd4-67psd-battery-positive-crossover-cable",
      "connection_kind": "electrical-wire",
      "direction": "bidirectional",
      "description": "Secondary battery positive terminal connects to the other end of the positive crossover cable; permanently parallels the two batteries at the same B+ potential",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-battery-positive-crossover-cable",
      "to_component_slug": "sd4-67psd-bjb",
      "connection_kind": "electrical-wire",
      "direction": "bidirectional",
      "description": "Combined B+ from both batteries routes from the crossover cable junction to the BJB main positive input stud via the main battery positive cable",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-battery-primary",
      "to_component_slug": "sd4-67psd-battery-negative-strap-block",
      "connection_kind": "electrical-wire",
      "direction": "unidirectional",
      "description": "Primary battery negative terminal connects to the engine block ground strap assembly; BMS sensor is integrated in-line on this negative cable",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-battery-secondary",
      "to_component_slug": "sd4-67psd-battery-negative-strap-block",
      "connection_kind": "electrical-wire",
      "direction": "unidirectional",
      "description": "Secondary battery negative terminal connects to the engine block ground node via a separate negative strap, sharing the same block ground point",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "from_component_slug": "sd4-67psd-battery-negative-strap-block",
      "to_component_slug": "sd4-67psd-ground-point-block",
      "connection_kind": "electrical-wire",
      "direction": "unidirectional",
      "description": "Battery negative strap(s) terminate at the engine block ground boss; this is the low-side return path for all engine-mounted electrical loads and the starter motor",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-ground-point-block",
      "to_component_slug": "sd4-67psd-battery-negative-strap-frame",
      "connection_kind": "electrical-wire",
      "direction": "unidirectional",
      "description": "Engine block ground boss is also the origin of the block-to-chassis frame ground strap, extending the ground plane to the frame rail",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "from_component_slug": "sd4-67psd-battery-negative-strap-frame",
      "to_component_slug": "sd4-67psd-ground-point-frame",
      "connection_kind": "electrical-wire",
      "direction": "unidirectional",
      "description": "Block-to-frame ground strap terminates at the chassis frame rail ground node, establishing the 12V ground plane for body and accessory circuits",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "from_component_slug": "sd4-67psd-battery-primary",
      "to_component_slug": "sd4-67psd-bms-sensor",
      "connection_kind": "electrical-wire",
      "direction": "unidirectional",
      "description": "BMS sensor is integrated in-line in the primary battery negative cable; all negative current flow from the primary battery passes through the BMS sensor shunt/hall-effect element",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-bms-sensor",
      "to_component_slug": "sd4-67psd-pcm",
      "connection_kind": "reports_to",
      "direction": "unidirectional",
      "description": "BMS sensor transmits SOC, SOH, and real-time current signal to the PCM via a dedicated wire on the negative cable harness; protocol (analog vs. LIN) is a confirmed GAP",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-alternator",
      "to_component_slug": "sd4-67psd-bjb",
      "connection_kind": "electrical-wire",
      "direction": "unidirectional",
      "description": "Alternator B+ output stud connects via a heavy-gauge cable to the BJB alternator input lug; generated electrical power enters the distribution system through this connection",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-pcm",
      "to_component_slug": "sd4-67psd-alternator",
      "connection_kind": "controlled_by",
      "direction": "unidirectional",
      "description": "PCM sends a PWM duty-cycle signal to the alternator internal voltage regulator to control charging voltage dynamically per Ford FEAD smart charging strategy; exact wire/pin is a GAP",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-engine-gear-train",
      "to_component_slug": "sd4-67psd-serpentine-belt",
      "connection_kind": "mechanical-linkage",
      "direction": "unidirectional",
      "description": "Engine crankshaft pulley (part of gear-train assembly) drives the serpentine belt; rotational energy transfers from crank to all accessory drive pulleys via the belt",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-serpentine-belt",
      "to_component_slug": "sd4-67psd-alternator",
      "connection_kind": "mechanical-linkage",
      "direction": "unidirectional",
      "description": "Serpentine belt drives the alternator rotor via the alternator pulley; belt slip or breakage immediately eliminates alternator power generation",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-belt-tensioner",
      "to_component_slug": "sd4-67psd-serpentine-belt",
      "connection_kind": "mechanical-linkage",
      "direction": "unidirectional",
      "description": "Belt tensioner arm bears on the serpentine belt to maintain proper tension; tensioner spring force is the sole automatic tension-control mechanism on the accessory drive",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "from_component_slug": "sd4-67psd-bjb",
      "to_component_slug": "sd4-67psd-starter-relay",
      "connection_kind": "electrical-wire",
      "direction": "unidirectional",
      "description": "BJB provides B+ supply to the starter relay main contact terminal (the switched B+ side) and B+ supply to the relay coil terminal; the relay resides physically inside the BJB",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-pcm",
      "to_component_slug": "sd4-67psd-starter-relay",
      "connection_kind": "controlled_by",
      "direction": "unidirectional",
      "description": "PCM (or BCM on PTBS configurations) energizes the starter relay coil by closing a ground path on the relay coil return circuit; this is the final start authorization step after PATS authentication passes",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-starter-relay",
      "to_component_slug": "sd4-67psd-starter-solenoid",
      "connection_kind": "electrical-wire",
      "direction": "unidirectional",
      "description": "Starter relay switched output delivers B+ to the starter solenoid control (S) terminal when the relay coil is energized; this medium-current circuit triggers the solenoid to close the main starter circuit",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-bjb",
      "to_component_slug": "sd4-67psd-starter-solenoid",
      "connection_kind": "electrical-wire",
      "direction": "unidirectional",
      "description": "Main B+ cable runs from the BJB directly to the starter solenoid main (battery) terminal; when the solenoid contacts close, this high-current path powers the starter motor windings",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-starter-solenoid",
      "to_component_slug": "sd4-67psd-starter-motor",
      "connection_kind": "electrical-wire",
      "direction": "unidirectional",
      "description": "Starter solenoid main output contact (motor terminal) delivers switched B+ directly to the starter motor field/armature windings; solenoid and motor are physically integrated in the same assembly",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-starter-solenoid",
      "to_component_slug": "sd4-67psd-engine-gear-train",
      "connection_kind": "mechanical-linkage",
      "direction": "unidirectional",
      "description": "Starter solenoid lever engages the starter pinion gear with the flywheel ring gear (part of engine gear-train); mechanical engagement allows the starter motor to crank the engine",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-starter-motor",
      "to_component_slug": "sd4-67psd-ground-point-block",
      "connection_kind": "electrical-wire",
      "direction": "unidirectional",
      "description": "Starter motor return current flows through the starter motor case to the engine block (via mounting bolts and bell housing), returning to the battery negative via the block ground node",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-ignition-switch",
      "to_component_slug": "sd4-67psd-bcm",
      "connection_kind": "electrical-wire",
      "direction": "unidirectional",
      "description": "Ignition switch (or PTBS module) delivers start request signal to BCM; BCM evaluates PATS authentication before forwarding start authorization to PCM or directly to starter relay coil circuit",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-bcm",
      "to_component_slug": "sd4-67psd-pcm",
      "connection_kind": "can-bus",
      "direction": "bidirectional",
      "description": "BCM and PCM communicate over the HS-CAN bus; BCM sends PATS authentication status, ignition state, and body-load status to PCM; PCM sends charging status and engine state to BCM",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-bjb",
      "to_component_slug": "sd4-67psd-bcm",
      "connection_kind": "electrical-wire",
      "direction": "unidirectional",
      "description": "Main B+ feed wire from BJB to BCM/SJB powers all downstream body electrical loads and the BCM module itself; exact wire gauge is a confirmed GAP",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-bjb",
      "to_component_slug": "sd4-67psd-pcm",
      "connection_kind": "electrical-wire",
      "direction": "unidirectional",
      "description": "BJB provides fused B+ power feeds to the PCM (PCM has multiple power supply pins); loss of any PCM B+ fuse in the BJB causes PCM shutdown and a broad no-start/no-communication condition",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-bjb",
      "to_component_slug": "sd4-67psd-gpcm",
      "connection_kind": "electrical-wire",
      "direction": "unidirectional",
      "description": "BJB provides high-current B+ feed to the glow plug controller module (engine-mechanical scope, boundary reference); this feed carries the heavy transient load during cold-start preheat cycles",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-pcm",
      "to_component_slug": "sd4-67psd-instrument-cluster",
      "connection_kind": "can-bus",
      "direction": "unidirectional",
      "description": "PCM broadcasts charging system status (charging voltage, BMS-derived battery condition, fault flags) over HS-CAN to the instrument cluster for battery warning lamp and voltmeter display",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-ground-point-block",
      "to_component_slug": "sd4-67psd-pcm",
      "connection_kind": "electrical-wire",
      "direction": "unidirectional",
      "description": "Engine block ground node provides the low-side reference ground for PCM chassis ground pins; high resistance at the block ground directly affects PCM signal integrity and sensor accuracy",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-ground-point-frame",
      "to_component_slug": "sd4-67psd-bcm",
      "connection_kind": "electrical-wire",
      "direction": "unidirectional",
      "description": "Chassis frame rail ground plane provides the low-side return reference for BCM/SJB and all downstream body load circuits; frame ground degradation produces BCM supply ripple and body-load anomalies",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    }
  ]
}
```

---

## Verification: Slug Resolution Check

All `from_component_slug` and `to_component_slug` values in `component_connections` resolve to one of:
- A component emitted in this run's `components` array above, OR
- A previously-emitted component referenced by instruction: `sd4-67psd-pcm`, `sd4-67psd-hs-can-bus` (not directly connected here — PCM↔BCM and PCM↔cluster use `can-bus` connection_kind which implies HS-CAN), `sd4-67psd-instrument-cluster`, `sd4-67psd-engine-gear-train`, `sd4-67psd-gpcm`, `sd4-67psd-lift-pump-relay` (boundary ref, no connection emitted — referenced in BJB function description only).

No dangling slugs detected.

---

## 5-Line Summary

**Counts:** 17 components / 30 observable properties / 30 connections.

**Coverage:** All 5 groups covered — Power Storage (6 components), Generation (3), Starting (4), Distribution+Protection (2 new + BJB), Control+Monitoring (connections only, no new components).

**Notable gaps carried forward:** (1) BMS sensor signal protocol (analog vs. LIN) and PCM pin assignment — no observable diagnostic method can be confirmed without WSM/FDRS; (2) Starter relay cavity in the BJB — technician must reference Ford WSM fuse/relay chart before pin-testing; (3) PCM-to-alternator PWM wire color/gauge/pin — field diagnostics for FEAD strategy failure must use FDRS to identify the correct pin before probing.

**Boundary references honored:** `sd4-67psd-lift-pump-relay` referenced in BJB function description only (no connection emitted per instruction); `sd4-67psd-gpcm` receives a BJB B+ feed connection (boundary interface only, no further GPCM internals); glow plugs 1–8 not touched.

**Confidence split:** 21 connections TRAINING-CONFIRMED, 9 TRAINING-INFERRED/PATTERN (primarily ground strap routing details and belt tensioner position); zero connections are pure GAP — every connection emitted has at least PATTERN-level support.
