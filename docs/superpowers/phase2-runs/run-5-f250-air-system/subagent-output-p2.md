# Run 5 — F-250 6.7L PSD Engine Air + Aftertreatment P2
# System Decomposition + Topology

**Date:** 2026-05-19
**Platform:** Ford Super Duty 4th Gen / 6.7L Power Stroke Diesel (2017–2022)
**System scope:** Engine air intake path + turbocharger + EGR + exhaust + aftertreatment
**Input:** subagent-output-p1.md Section 1 (36 architecture facts)
**Existing slugs referenced (not re-emitted):** sd4-67psd-pcm, sd4-67psd-hs-can-bus, sd4-67psd-instrument-cluster, sd4-67psd-engine-gear-train, sd4-67psd-def-tank, sd4-67psd-def-dosing-system, sd4-67psd-egr-cooler

---

## Section 1 — Component Prose (grouped by subsystem)

### 1.1 Intake Air Path

**Air Filter Housing** (`sd4-67psd-air-filter-housing`) is a large-diameter plastic housing mounted in the front corner of the engine compartment (driver-side or passenger-side front, behind the headlight assembly). It contains a replaceable dry paper element filter. The housing is opaque plastic — the filter element is accessible only by removing the lid. Air exits through a single outlet hose to the MAF sensor and then to the turbo compressor inlet. No electrical connections on the housing itself; the housing is a purely mechanical component.

**MAF/IAT Sensor** (`sd4-67psd-maf-iat-sensor`) is an integrated unit — the Mass Air Flow sensor and Intake Air Temperature sensor share a single housing and single harness connector. Positioned in the intake tract downstream of the air filter housing and upstream of the turbocharger compressor inlet. This pre-turbo placement means it samples ambient (non-boosted) air. The MAF is the PCM's primary mass-flow input for fueling calculations at lower loads and contributes to VGT closed-loop control. The IAT signal from this unit is IAT1 (pre-turbo ambient temperature). Electrical contract: 5-wire (12V power, ground, MAF signal, IAT signal, IAT ground) — consistent with Ford diesel MAF/IAT architecture; exact pinout requires WSM confirmation.

**IAT2 Sensor (Charge Air Cooler Outlet / Manifold IAT)** (`sd4-67psd-iat2-sensor`) is a standalone two-wire NTC thermistor sensor located downstream of the charge air cooler, measuring the temperature of the cooled boost charge entering the intake manifold. This is distinct from the MAF-integrated IAT1. The PCM uses IAT2 for charge-air density modeling. Exact mounting location (on the CAC outlet pipe, on the intake boot, or on the intake manifold) and exact connector pinout require WSM confirmation; sensor existence is TRAINING-INFERRED based on 6.7L PSD diagnostic documentation patterns.

**Intake Air Heater Grid** (`sd4-67psd-intake-heater-grid`) is a resistance element heater installed in the intake manifold inlet area (or the large intake boot preceding the manifold). It heats incoming air directly for cold-start assist — categorically different from glow plugs, which heat each combustion chamber. The grid draws very high current and is not directly controlled by the PCM's low-current output circuits; instead the PCM commands a dedicated high-current relay in the underhood junction box. The grid itself has no feedback sensor; PCM infers function from current draw and starts.

**Intake Heater Relay** (`sd4-67psd-intake-heater-relay`) is a high-current relay in the underhood battery/power distribution junction box. It receives a PCM command signal and closes to supply battery voltage directly to the intake heater grid. Exact relay cavity and fuse assignment in the 2018 F-250 underhood junction box are a confirmed GAP in training data.

**Intake Throttle Valve** (`sd4-67psd-intake-throttle`) is an electrically driven valve (DC motor or stepper motor) in the intake air path at or near the intake manifold inlet. On this diesel application it does not control engine power — it serves two purposes: (1) creating a pressure differential to drive EGR gas into the intake charge, and (2) controlled engine shutdown to prevent diesel run-on. The PCM drives the motor directly; an internal position sensor (potentiometer or Hall-effect) provides closed-loop feedback. The electrical contract is a multi-wire harness (motor drive + position sensor signal + reference + ground); exact pin count requires WSM confirmation.

**MAP Sensor / Boost Pressure Sensor** (`sd4-67psd-map-sensor`) is a three-wire sensor (5V reference, analog signal, ground) mounted in the intake manifold, measuring absolute pressure. On this turbocharged diesel application the MAP signal represents boost pressure above atmospheric. The PCM uses it for closed-loop VGT control and as a cross-check against MAF-derived airflow. This is a standard three-wire piezoresistive or capacitive pressure transducer.

**Intake Manifold** (`sd4-67psd-intake-manifold`) is a composite plastic unit (single-piece or two-piece with a common plenum feeding both cylinder banks). No individual runner length or swirl/tumble control valves are present — the 6.7L PSD does not use mechanical runner actuation for intake charge management. The manifold is mechanically connected to the cylinder head ports and to the intake throttle valve inlet. No electrical connections directly on the manifold body; sensors mounted into manifold ports are separate components.

---

### 1.2 Turbocharger Subsystem

**VGT Turbocharger Assembly** (`sd4-67psd-vgt-turbo`) is the single Variable Geometry Turbocharger used on the 2017–2022 6.7L Power Stroke. It is a Honeywell/Garrett (or Ford-integrated) unit with a variable-geometry turbine housing. The turbine side is driven by exhaust gas; the compressor side pressurizes intake air. The variable vanes in the turbine housing alter the effective A/R ratio under PCM command via the VGT actuator. The VGT mechanism is also the sole exhaust brake device — closing vanes at closed throttle creates backpressure for engine braking. The turbo is driven by exhaust enthalpy and is mechanically linked to the exhaust and compressor side airflow — no direct electrical connections to the turbo core itself.

**VGT Actuator** (`sd4-67psd-vgt-actuator`) is an electronically controlled actuator (electric motor-driven) mounted on the VGT turbine housing. It receives position commands from the PCM and moves the variable vane ring. An internal position sensor (potentiometer or Hall-effect) provides closed-loop position feedback to the PCM. On the 3rd-gen 6.7L PSD (2017+), the actuator communicates via PWM or a dedicated sub-bus signal; exact protocol requires WSM confirmation. The actuator is electrically distinct from the turbo core itself.

**Turbo Speed Sensor** (`sd4-67psd-turbo-speed-sensor`) monitors turbine wheel RPM. The PCM uses this signal for closed-loop VGT control, turbine overspeed protection, and diagnostic functions. Sensor type (magnetic pickup or Hall-effect) and exact harness connector/pinout are a confirmed TRAINING-INFERRED gap requiring WSM confirmation. Mounted on the turbo bearing housing near the turbine wheel.

**Charge Air Cooler (CAC / Intercooler)** (`sd4-67psd-cac-intercooler`) is an air-to-air heat exchanger mounted in front of the engine radiator. Compressed, hot air from the turbo compressor outlet passes through the finned core and is cooled by ambient airflow before entering the intake manifold. The CAC is entirely passive — no active cooling control, no valves, no actuators. The CAC core and its inlet/outlet hose connections are documented boost-leak failure points. No electrical connections on the CAC itself; the temperature sensors at its inlet/outlet are separate components.

**CAC Inlet Temperature Sensor** (`sd4-67psd-cac-inlet-temp-sensor`) is a two-wire NTC thermistor mounted at the inlet of the charge air cooler (turbo compressor outlet side). It measures the temperature of the incoming hot boost charge. The PCM uses inlet vs outlet temperature differential to assess CAC heat rejection efficiency. Exact mounting location and connector pinout are TRAINING-INFERRED and require WSM confirmation.

**CAC Outlet Temperature Sensor** (`sd4-67psd-cac-outlet-temp-sensor`) is a two-wire NTC thermistor mounted at the outlet of the charge air cooler (intake manifold inlet side). This is the signal the PCM primarily uses for intake charge density modeling (same physical location as the IAT2 on some configurations — whether these are the same sensor or separate sensors with distinct mounting points requires WSM field confirmation).

---

### 1.3 EGR System

**EGR Valve** (`sd4-67psd-egr-valve`) is an electrically actuated valve (DC motor or stepper motor drive) positioned between the EGR cooler outlet and the intake manifold/intake throttle body inlet. The PCM commands the valve position via PWM or direct motor drive; an internal position sensor provides closed-loop feedback. The EGR valve controls the mass flow rate of recirculated exhaust gas entering the intake charge. It is a documented maintenance item — carbon accumulation on the valve seat and stem is a common cause of EGR flow codes (P0400 family).

**EGR Temperature Sensor (Post-Cooler)** (`sd4-67psd-egr-temp-sensor`) is a two-wire NTC thermistor or thermocouple-type sensor located downstream of the EGR cooler and at or near the EGR valve inlet. It monitors the temperature of recirculated exhaust gas after the cooler, confirming EGR cooler function and protecting the EGR valve from thermal damage. The PCM uses this signal for EGR system diagnostics.

**EGR Temperature Sensor (Pre-Cooler / Upstream)** (`sd4-67psd-egr-upstream-temp-sensor`) is a second EGR temperature sensor present on some 6.7L PSD configurations, located upstream of the EGR cooler in the EGR gas path (i.e., at the exhaust tap). It brackets the cooler's heat rejection when paired with the post-cooler sensor. Whether this sensor is present on all 2018 model year builds or only specific calibration/emission tunes is a confirmed TRAINING-INFERRED gap requiring WSM confirmation.

---

### 1.4 Exhaust and Aftertreatment

**Driver-Side Exhaust Manifold** (`sd4-67psd-exhaust-manifold-ds`) is a cast-iron manifold collecting exhaust from the driver-side cylinder bank. Routes exhaust to the common collector at the VGT turbine inlet. Cast iron construction for thermal durability. No electrical connections; purely mechanical.

**Passenger-Side Exhaust Manifold** (`sd4-67psd-exhaust-manifold-ps`) is a cast-iron manifold collecting exhaust from the passenger-side cylinder bank. Routes exhaust to the same common collector at the VGT turbine inlet. No electrical connections; purely mechanical.

**EGT Sensor 1 (Pre-DPF / DOC Inlet)** (`sd4-67psd-egt-sensor-1`) is a two-wire thermocouple-type sensor located upstream of the DOC/DPF aftertreatment assembly (post-turbo, pre-aftertreatment housing). It provides the PCM with the inlet temperature to the aftertreatment system, critical for active DPF regen temperature targeting. This is the most upstream EGT sensor in the aftertreatment chain.

**EGT Sensor 2 (DPF Outlet / SCR Inlet)** (`sd4-67psd-egt-sensor-2`) is a two-wire thermocouple-type sensor located at the outlet of the DPF and the inlet of the SCR catalyst (or at the transition between the two sections within the combined aftertreatment housing). The PCM uses this signal to confirm DPF outlet temperature and SCR inlet temperature for catalyst window management.

**EGT Sensor 3 (SCR Outlet / Post-Aftertreatment)** (`sd4-67psd-egt-sensor-3`) is a two-wire thermocouple-type sensor located at the SCR outlet (or downstream of the combined aftertreatment housing). It confirms post-SCR exhaust temperature and provides the PCM with data for final emissions management. Exact positions for all EGT sensors vary by model year and emissions calibration; exact mounting threads and harness routing require WSM confirmation.

**Diesel Oxidation Catalyst (DOC)** (`sd4-67psd-doc`) is a catalytic element integrated into or immediately preceding the DPF in the aftertreatment housing. It oxidizes hydrocarbons and CO and provides exothermic heat during active DPF regeneration when the PCM commands late post-injection. The DOC is a passive catalyst brick; no dedicated sensor is mounted on or in the DOC itself — its performance is inferred by the PCM from EGT differential across the assembly. No electrical connections.

**Diesel Particulate Filter (DPF)** (`sd4-67psd-dpf`) is a ceramic wall-flow filter downstream of the DOC, trapping soot from diesel combustion. Periodic regeneration (passive, active PCM-commanded, or forced/parked via scan tool) burns accumulated soot. The DPF itself has no electrical connections — monitoring is via the differential pressure sensor and bracketing EGT sensors. The DPF assembly is located in the exhaust aftertreatment housing under the vehicle.

**DPF Differential Pressure Sensor** (`sd4-67psd-dpf-diff-pressure-sensor`) is a three-wire differential pressure transducer (5V reference, signal, ground) with two sensing ports connected by tubes to the upstream and downstream sides of the DPF. The PCM uses the pressure drop across the DPF plus exhaust flow models to estimate soot load and trigger active regen. The sensing tubes are documented failure points — condensation and soot can clog them, causing false regen triggers or P244A/P244B/P2002 codes. The sensor body is typically mounted away from the hot aftertreatment housing (on the frame or a cooler bracket).

**Selective Catalytic Reduction (SCR) Catalyst** (`sd4-67psd-scr`) is a catalytic element downstream of the DPF that converts NOx to nitrogen and water using ammonia released from DEF. Requires approximately 200–600°C for effective NOx conversion; the PCM suspends DEF dosing below this temperature window. No electrical connections on the SCR substrate itself — control and monitoring is via NOx sensors and EGT sensors.

**NOx Sensor (Upstream / Pre-SCR)** (`sd4-67psd-nox-sensor-upstream`) is a smart sensor with integrated signal conditioning electronics, located between the DPF outlet and the SCR catalyst inlet. It measures raw NOx concentration entering the SCR to provide a baseline for DEF dosing closed-loop control. Communicates with the PCM via a dedicated protocol (likely PWM or sub-CAN); not a simple analog voltage sensor. Exact protocol for the 2018 6.7L PSD is TRAINING-INFERRED.

**NOx Sensor (Downstream / Post-SCR)** (`sd4-67psd-nox-sensor-downstream`) is a smart sensor with integrated signal conditioning electronics, located at the SCR outlet. The PCM compares upstream vs downstream NOx readings to assess SCR conversion efficiency and adjust DEF dosing rate in closed-loop. Degraded SCR efficiency triggers P20EE, P2BAD, and related NOx catalyst codes. Same communication architecture as the upstream NOx sensor.

**Muffler and Tailpipe Assembly** (`sd4-67psd-muffler-tailpipe`) is a conventional passive muffler with single or dual tailpipe exit routing SCR-treated exhaust to atmosphere. No active exhaust valve, switchable exhaust path, or electronic control. Configuration (single vs dual exit) varies by body/frame specification. Purely mechanical; no electrical connections.

---

### 1.5 Control Interfaces

All air-system and aftertreatment actuators — intake throttle, intake heater relay, VGT actuator, EGR valve, and DEF dosing — are controlled by the existing PCM (`sd4-67psd-pcm`) via direct wiring or the HS-CAN bus (`sd4-67psd-hs-can-bus`). No separate turbo control module or aftertreatment control module exists as a distinct CAN node. The NOx sensors communicate back to the PCM via dedicated smart-sensor protocols. DTC codes and system status are reported to the IPC (`sd4-67psd-instrument-cluster`) via HS-CAN.

---

## Section 2 — JSON Sidecar

```json
{
  "system": "engine-air-and-aftertreatment",
  "platform_slug": "ford-super-duty-4th-gen-67-psd",
  "components": [
    {
      "slug": "sd4-67psd-air-filter-housing",
      "name": "Air Filter Housing",
      "kind": "mechanical",
      "electrical_contract": null,
      "location": "Front engine compartment corner (driver-side or passenger-side front, behind headlight assembly)",
      "function": "Houses the dry paper intake air filter element; the first stage of air filtration before the MAF sensor and turbo compressor inlet",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-maf-iat-sensor",
      "name": "MAF/IAT Sensor (Integrated)",
      "kind": "sensor",
      "electrical_contract": "5-wire: 12V power, ground, MAF signal output, IAT signal output, IAT ground — exact pinout requires WSM confirmation",
      "location": "Intake tract downstream of air filter housing and upstream of turbocharger compressor inlet (pre-turbo placement)",
      "function": "Measures mass airflow rate (primary PCM fueling input at lower loads, VGT control input) and ambient intake air temperature (IAT1); integrated Ford MAF/IAT unit",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-iat2-sensor",
      "name": "IAT2 Sensor (Charge Air Cooler Outlet / Manifold IAT)",
      "kind": "sensor",
      "electrical_contract": "2-wire NTC thermistor: signal and ground",
      "location": "Downstream of charge air cooler, at CAC outlet pipe or intake boot entering the intake manifold",
      "function": "Measures cooled boost charge temperature entering the intake manifold; PCM uses for charge-air density modeling; distinct from MAF-integrated IAT1",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "sd4-67psd-intake-heater-grid",
      "name": "Intake Air Heater Grid",
      "kind": "actuator",
      "electrical_contract": "High-current direct battery supply via dedicated relay; no feedback signal — PCM infers function from starts and current draw",
      "location": "Intake manifold inlet area or large intake boot preceding the manifold",
      "function": "Resistance-element heater that heats incoming intake air directly for cold-start assist; distinct from glow plugs (which heat each combustion chamber)",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-intake-heater-relay",
      "name": "Intake Air Heater Relay",
      "kind": "actuator",
      "electrical_contract": "Coil: low-current PCM command signal; contacts: high-current battery-voltage supply to heater grid — exact cavity and fuse in underhood junction box is a GAP",
      "location": "Underhood battery/power distribution junction box — exact relay cavity is a confirmed data GAP",
      "function": "High-current relay that closes on PCM command to supply battery voltage to the intake air heater grid",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-intake-throttle",
      "name": "Intake Throttle Valve (Intake Restriction Valve)",
      "kind": "valve",
      "electrical_contract": "Multi-wire: motor drive (2 wires) + internal position sensor (reference, signal, ground) — exact pin count requires WSM confirmation",
      "location": "Intake air path at or near the intake manifold inlet, downstream of the CAC",
      "function": "Electric motor-driven valve used (1) to create pressure differential driving EGR gas into the intake charge and (2) for controlled engine shutdown to prevent diesel run-on; does not control power output on this diesel application",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-map-sensor",
      "name": "MAP Sensor (Boost Pressure Sensor)",
      "kind": "sensor",
      "electrical_contract": "3-wire: 5V reference, analog signal output, ground",
      "location": "Mounted in the intake manifold",
      "function": "Measures absolute pressure in the intake manifold; on this turbocharged diesel application the signal represents boost pressure above atmospheric; used by PCM for closed-loop VGT control and fueling correction",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-intake-manifold",
      "name": "Intake Manifold",
      "kind": "mechanical",
      "electrical_contract": null,
      "location": "Top of engine, feeding both cylinder banks from a common plenum",
      "function": "Composite plastic manifold distributing intake air charge to all eight cylinder ports; no runner length or swirl/tumble control valves — intake charge management via injection timing and EGR, not mechanical runners",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-vgt-turbo",
      "name": "VGT Turbocharger Assembly",
      "kind": "mechanical",
      "electrical_contract": null,
      "location": "Mounted at exhaust manifold collector, typically center/rear of engine valley area or passenger side depending on engine orientation",
      "function": "Single Variable Geometry Turbocharger; turbine driven by exhaust gas, compressor pressurizes intake air; variable vanes alter effective A/R ratio for spool speed and peak flow optimization; vane closure is also the sole exhaust brake mechanism on this platform",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-vgt-actuator",
      "name": "VGT Actuator (Variable Vane Actuator)",
      "kind": "actuator",
      "electrical_contract": "Multi-wire: motor drive + internal position sensor (reference, signal, ground); communicates via PWM or dedicated sub-bus — exact protocol requires WSM confirmation",
      "location": "Mounted on the VGT turbine housing",
      "function": "Electric motor-driven actuator that moves the variable vane ring to PCM-commanded position; internal position sensor provides closed-loop feedback to the PCM; primary control point for VGT performance and exhaust brake function",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "sd4-67psd-turbo-speed-sensor",
      "name": "Turbo Speed Sensor",
      "kind": "sensor",
      "electrical_contract": "2-wire (magnetic pickup) or 3-wire (Hall-effect) — sensor type and exact pinout require WSM confirmation",
      "location": "Mounted on VGT turbocharger bearing housing near turbine wheel",
      "function": "Monitors turbine wheel RPM; PCM uses for closed-loop VGT control, turbine overspeed protection, and diagnostic functions",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "sd4-67psd-cac-intercooler",
      "name": "Charge Air Cooler (CAC / Intercooler)",
      "kind": "mechanical",
      "electrical_contract": null,
      "location": "Mounted in front of the engine radiator in the cooling stack",
      "function": "Air-to-air heat exchanger cooling compressed turbo outlet air before it enters the intake manifold; passive — no active cooling control; inlet/outlet hose connections are documented boost-leak failure points",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-cac-inlet-temp-sensor",
      "name": "CAC Inlet Temperature Sensor",
      "kind": "sensor",
      "electrical_contract": "2-wire NTC thermistor: signal and ground",
      "location": "At the inlet of the charge air cooler (turbo compressor outlet pipe side)",
      "function": "Measures temperature of incoming hot boost charge at CAC inlet; PCM uses inlet vs outlet differential to assess CAC heat rejection efficiency",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "sd4-67psd-cac-outlet-temp-sensor",
      "name": "CAC Outlet Temperature Sensor",
      "kind": "sensor",
      "electrical_contract": "2-wire NTC thermistor: signal and ground",
      "location": "At the outlet of the charge air cooler (intake manifold inlet pipe side)",
      "function": "Measures temperature of cooled boost charge exiting the CAC; PCM primary input for charge-air density modeling; may coincide with or be the same mounting location as IAT2 — field confirmation required",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "sd4-67psd-egr-valve",
      "name": "EGR Valve",
      "kind": "valve",
      "electrical_contract": "Multi-wire: motor drive (2 wires) + internal position sensor (reference, signal, ground) — exact pin count requires WSM confirmation",
      "location": "Between EGR cooler outlet and intake manifold or intake throttle body inlet",
      "function": "Electrically actuated position-controlled valve metering recirculated exhaust gas into the intake charge; PCM closed-loop control to achieve commanded EGR mass flow rate; carbon accumulation on seat/stem is common failure mode producing P0400 family codes",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-egr-temp-sensor",
      "name": "EGR Temperature Sensor (Post-Cooler)",
      "kind": "sensor",
      "electrical_contract": "2-wire: NTC thermistor or thermocouple — signal and ground",
      "location": "In EGR gas path downstream of EGR cooler, at or near EGR valve inlet",
      "function": "Monitors temperature of recirculated exhaust gas after the EGR cooler; confirms EGR cooler function and protects EGR valve from thermal damage; used by PCM for EGR system diagnostics",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-egr-upstream-temp-sensor",
      "name": "EGR Temperature Sensor (Pre-Cooler / Upstream)",
      "kind": "sensor",
      "electrical_contract": "2-wire: NTC thermistor or thermocouple — signal and ground",
      "location": "In EGR gas path upstream of EGR cooler, at or near the exhaust tap",
      "function": "Measures exhaust gas temperature entering the EGR cooler; brackets cooler heat rejection when paired with post-cooler sensor; presence on all 2018 builds vs specific calibration tunes is a confirmed data GAP",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "sd4-67psd-exhaust-manifold-ds",
      "name": "Driver-Side Exhaust Manifold",
      "kind": "mechanical",
      "electrical_contract": null,
      "location": "Driver-side cylinder bank, bolted to cylinder head exhaust ports",
      "function": "Collects exhaust from driver-side cylinder bank and routes to the common collector at the VGT turbine inlet; cast iron construction for thermal durability",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-exhaust-manifold-ps",
      "name": "Passenger-Side Exhaust Manifold",
      "kind": "mechanical",
      "electrical_contract": null,
      "location": "Passenger-side cylinder bank, bolted to cylinder head exhaust ports",
      "function": "Collects exhaust from passenger-side cylinder bank and routes to the common collector at the VGT turbine inlet; cast iron construction for thermal durability",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-egt-sensor-1",
      "name": "EGT Sensor 1 (Pre-DPF / DOC Inlet)",
      "kind": "sensor",
      "electrical_contract": "2-wire thermocouple (K-type or similar): positive and negative leads",
      "location": "Upstream of the DOC/DPF aftertreatment housing, post-turbo turbine outlet",
      "function": "Measures exhaust temperature at the aftertreatment system inlet; critical for active DPF regen temperature targeting and DOC light-off monitoring",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "sd4-67psd-egt-sensor-2",
      "name": "EGT Sensor 2 (DPF Outlet / SCR Inlet)",
      "kind": "sensor",
      "electrical_contract": "2-wire thermocouple (K-type or similar): positive and negative leads",
      "location": "At the DPF outlet / transition into SCR section within the aftertreatment housing",
      "function": "Confirms DPF outlet and SCR inlet temperature; used for SCR catalyst temperature window management and post-regen temperature verification",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "sd4-67psd-egt-sensor-3",
      "name": "EGT Sensor 3 (SCR Outlet / Post-Aftertreatment)",
      "kind": "sensor",
      "electrical_contract": "2-wire thermocouple (K-type or similar): positive and negative leads",
      "location": "At or near the SCR outlet downstream of the aftertreatment housing",
      "function": "Measures post-SCR exhaust temperature; final PCM data point for emissions system completeness and catalyst health; exact position varies by model year and emissions calibration",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "sd4-67psd-doc",
      "name": "Diesel Oxidation Catalyst (DOC)",
      "kind": "mechanical",
      "electrical_contract": null,
      "location": "Integrated into or immediately preceding the DPF in the aftertreatment housing",
      "function": "Oxidizes hydrocarbons and CO in exhaust; provides exothermic heat during active DPF regen when PCM commands late post-injection or in-exhaust fuel dosing; performance inferred from EGT differential — no dedicated dedicated sensor on the DOC itself",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-dpf",
      "name": "Diesel Particulate Filter (DPF)",
      "kind": "mechanical",
      "electrical_contract": null,
      "location": "Exhaust aftertreatment housing, downstream of DOC, under vehicle",
      "function": "Ceramic wall-flow filter trapping soot from diesel combustion; requires periodic regeneration (passive at highway temperatures, active PCM-commanded, or forced/parked via scan tool) to oxidize accumulated soot",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-dpf-diff-pressure-sensor",
      "name": "DPF Differential Pressure Sensor (Delta-P Sensor)",
      "kind": "sensor",
      "electrical_contract": "3-wire: 5V reference, analog signal output, ground",
      "location": "Sensor body mounted away from hot aftertreatment housing (frame or cooler bracket); sensing tubes connect to upstream and downstream ports on the DPF",
      "function": "Measures pressure drop across the DPF; PCM uses delta-pressure plus exhaust flow models to estimate soot load and trigger active regen; sensing tubes are documented clogging failure points causing P244A/P244B/P2002 false codes",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-scr",
      "name": "Selective Catalytic Reduction (SCR) Catalyst",
      "kind": "mechanical",
      "electrical_contract": null,
      "location": "Downstream of DPF in the aftertreatment housing",
      "function": "Catalytic reduction of NOx to nitrogen and water using ammonia released from DEF; requires 200–600°C for effective conversion; PCM suspends DEF dosing below temperature window",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-nox-sensor-upstream",
      "name": "NOx Sensor (Upstream / Pre-SCR)",
      "kind": "sensor",
      "electrical_contract": "Multi-wire smart sensor with integrated signal conditioning; communicates via dedicated protocol (PWM or sub-CAN) — exact protocol for 2018 6.7L PSD requires WSM confirmation",
      "location": "Between DPF outlet and SCR catalyst inlet (or at aftertreatment housing inlet before SCR brick)",
      "function": "Measures raw NOx concentration entering the SCR; provides baseline for PCM DEF dosing calculation in closed-loop NOx reduction control",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "sd4-67psd-nox-sensor-downstream",
      "name": "NOx Sensor (Downstream / Post-SCR)",
      "kind": "sensor",
      "electrical_contract": "Multi-wire smart sensor with integrated signal conditioning; communicates via dedicated protocol (PWM or sub-CAN) — exact protocol for 2018 6.7L PSD requires WSM confirmation",
      "location": "At the SCR outlet downstream of the aftertreatment housing",
      "function": "Measures NOx after catalytic reduction; PCM compares upstream vs downstream readings to assess SCR conversion efficiency and adjust DEF dosing; degraded efficiency triggers P20EE / P2BAD and related codes",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-muffler-tailpipe",
      "name": "Muffler and Tailpipe Assembly",
      "kind": "mechanical",
      "electrical_contract": null,
      "location": "Downstream of SCR outlet, under vehicle and exiting at rear",
      "function": "Conventional passive muffler with single or dual tailpipe exit routing treated exhaust to atmosphere; no active exhaust valve or switchable path on stock 4th-gen Super Duty diesel; configuration varies by body/frame spec",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    }
  ],

  "observable_properties": [
    {
      "slug": "sd4-67psd-op-air-filter-restriction",
      "component_slug": "sd4-67psd-air-filter-housing",
      "property_name": "Filter restriction / element condition",
      "observation_method": "direct_visual_internal",
      "housing_opacity_status": "removable",
      "notes": "Remove housing lid to inspect filter element; look for excessive dirt loading, oil contamination, or collapsed element",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-op-air-filter-housing-cracks",
      "component_slug": "sd4-67psd-air-filter-housing",
      "property_name": "Housing body cracks or loose lid sealing",
      "observation_method": "direct_visual_external",
      "housing_opacity_status": "opaque",
      "notes": "Inspect housing body and lid seal for cracks or gaps; unfiltered air bypass at the housing causes elevated MAF readings and sensor contamination",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-op-maf-pid",
      "component_slug": "sd4-67psd-maf-iat-sensor",
      "property_name": "MAF output (g/s) at idle and WOT ramp",
      "observation_method": "scan_tool_pid",
      "housing_opacity_status": "opaque",
      "notes": "Compare actual vs expected g/s at idle (~8–12 g/s typical), cruise, and WOT; low MAF with normal MAP suggests pre-turbo restriction or MAF failure; high MAF with no boost loss may indicate dirty element skewing hot-wire",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-op-iat1-pid",
      "component_slug": "sd4-67psd-maf-iat-sensor",
      "property_name": "IAT1 (pre-turbo ambient temperature) via scan tool PID",
      "observation_method": "scan_tool_pid",
      "housing_opacity_status": "opaque",
      "notes": "Should approximate ambient temperature at key-on cold; significant deviation from ambient at cold start suggests thermistor fault",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-op-maf-connector-voltage",
      "component_slug": "sd4-67psd-maf-iat-sensor",
      "property_name": "MAF sensor supply voltage and signal voltage at connector",
      "observation_method": "electrical_measurement_at_pin",
      "housing_opacity_status": "opaque",
      "notes": "Verify 12V supply on power pin, ground integrity, and 0–5V analog signal output on signal pin at idle; requires WSM pinout for exact cavity assignments",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-op-iat2-pid",
      "component_slug": "sd4-67psd-iat2-sensor",
      "property_name": "IAT2 (charge air cooler outlet temperature) via scan tool PID",
      "observation_method": "scan_tool_pid",
      "housing_opacity_status": "opaque",
      "notes": "At cold start should approximate ambient; under boost load should show temperature rise proportional to boost level; IAT2 significantly above IAT1 at steady cruise suggests CAC degradation",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "sd4-67psd-op-intake-heater-grid-commanded",
      "component_slug": "sd4-67psd-intake-heater-grid",
      "property_name": "Intake heater commanded state (on/off) via scan tool PID",
      "observation_method": "scan_tool_pid",
      "housing_opacity_status": "opaque",
      "notes": "PCM should command heater grid on during cold-start conditions; verify commanded state matches ambient temperature conditions",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-op-intake-heater-grid-current",
      "component_slug": "sd4-67psd-intake-heater-grid",
      "property_name": "Intake heater grid current draw",
      "observation_method": "electrical_measurement_at_pin",
      "housing_opacity_status": "opaque",
      "notes": "Clamp-meter on supply cable to verify current draw when commanded on; no draw when commanded on indicates open grid element or relay failure; exact expected current requires WSM specification",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-op-intake-heater-relay-coil-voltage",
      "component_slug": "sd4-67psd-intake-heater-relay",
      "property_name": "Relay coil command voltage from PCM",
      "observation_method": "electrical_measurement_at_pin",
      "housing_opacity_status": "opaque",
      "notes": "Measure voltage on relay coil terminal when PCM commands heater on; requires identification of correct relay cavity — a confirmed data GAP",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-op-intake-throttle-position-pid",
      "component_slug": "sd4-67psd-intake-throttle",
      "property_name": "Intake throttle position (%) via scan tool PID",
      "observation_method": "scan_tool_pid",
      "housing_opacity_status": "opaque",
      "notes": "At idle without EGR demand should be near fully open; during active EGR command will close to drive EGR differential; during engine shutdown should close to prevent run-on",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-op-intake-throttle-motor-waveform",
      "component_slug": "sd4-67psd-intake-throttle",
      "property_name": "Intake throttle motor drive signal waveform",
      "observation_method": "waveform_capture",
      "housing_opacity_status": "opaque",
      "notes": "Oscilloscope on motor drive wires during PCM-commanded position change; should show PWM duty cycle change proportional to commanded travel; stuck or stiff valve will show motor stall current",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-op-intake-throttle-carbon-deposit",
      "component_slug": "sd4-67psd-intake-throttle",
      "property_name": "Intake throttle valve bore carbon deposits",
      "observation_method": "direct_visual_internal",
      "housing_opacity_status": "removable",
      "notes": "Remove throttle body to inspect bore and valve plate for carbon accumulation; heavy deposits restrict EGR mixing and can cause P0401 (insufficient EGR flow) or throttle stuck codes",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-op-map-boost-pressure-pid",
      "component_slug": "sd4-67psd-map-sensor",
      "property_name": "MAP / boost pressure (kPa or psi) via scan tool PID",
      "observation_method": "scan_tool_pid",
      "housing_opacity_status": "opaque",
      "notes": "At idle should read atmospheric (~100 kPa / ~14.7 psi); under boost load should show positive gauge pressure; low boost with normal turbo speed suggests boost leak downstream of turbo; compare to MAF for cross-check",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-op-map-sensor-voltage",
      "component_slug": "sd4-67psd-map-sensor",
      "property_name": "MAP sensor reference and signal voltage at connector",
      "observation_method": "electrical_measurement_at_pin",
      "housing_opacity_status": "opaque",
      "notes": "5V reference on ref pin; signal voltage should be ~1.0–1.5V at idle (atmospheric) and rise proportionally with boost; no 5V reference suggests broken reference wire from PCM",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-op-vgt-turbo-boost-pressure",
      "component_slug": "sd4-67psd-vgt-turbo",
      "property_name": "Boost pressure generated by turbo",
      "observation_method": "pressure_test_with_gauge",
      "housing_opacity_status": "opaque",
      "notes": "Install a boost gauge in the intake system at the CAC outlet; compare gauge reading to MAP PID to rule out sensor error vs actual pressure deficiency",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-op-vgt-turbo-audible-spool",
      "component_slug": "sd4-67psd-vgt-turbo",
      "property_name": "Turbocharger spool noise and bearing noise",
      "observation_method": "audible",
      "housing_opacity_status": "opaque",
      "notes": "Listen for normal spool whine vs excessive whistling (boost leak), rattling (loose vane assembly), grinding (bearing failure), or surging (compressor surge due to vane position error)",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-op-vgt-turbo-oil-leak",
      "component_slug": "sd4-67psd-vgt-turbo",
      "property_name": "Turbo oil seal leak (oil in compressor or turbine housing)",
      "observation_method": "direct_visual_internal",
      "housing_opacity_status": "partial",
      "notes": "Remove intake hose from compressor inlet and inspect compressor wheel and housing for oil deposits; oil on compressor side indicates worn compressor seal; oil on turbine side (inspect at exhaust connection) indicates turbine seal failure",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-op-vgt-actuator-position-pid",
      "component_slug": "sd4-67psd-vgt-actuator",
      "property_name": "VGT vane position (%) commanded vs actual via scan tool PID",
      "observation_method": "scan_tool_pid",
      "housing_opacity_status": "opaque",
      "notes": "Compare commanded vane position to actual position feedback; large persistent error between commanded and actual indicates sticking vanes (carbon) or actuator motor failure; key diagnostic for P2263 / P0299",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-op-vgt-actuator-response-waveform",
      "component_slug": "sd4-67psd-vgt-actuator",
      "property_name": "VGT actuator motor drive signal waveform",
      "observation_method": "waveform_capture",
      "housing_opacity_status": "opaque",
      "notes": "Oscilloscope on actuator drive wires during commanded position change; should show PWM duty cycle variation; flat or missing signal with active DTCs indicates wiring or PCM driver fault",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "sd4-67psd-op-turbo-speed-pid",
      "component_slug": "sd4-67psd-turbo-speed-sensor",
      "property_name": "Turbo speed (RPM) via scan tool PID",
      "observation_method": "scan_tool_pid",
      "housing_opacity_status": "opaque",
      "notes": "Verify turbine RPM ramp-up under acceleration and correlation with boost pressure; overspeed events visible in PCM datalog; sensor dropout or erratic RPM can trigger VGT control oscillation",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "sd4-67psd-op-cac-boost-leak-test",
      "component_slug": "sd4-67psd-cac-intercooler",
      "property_name": "CAC and intake system boost leak",
      "observation_method": "pressure_test_with_gauge",
      "housing_opacity_status": "opaque",
      "notes": "Pressurize the intake system with engine off (cap air filter inlet, apply ~20 psi shop air at intake manifold test port or CAC inlet); listen for hissing, spray soapy water on hose clamps and end-tanks; pressure drop on gauge confirms leak location",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-op-cac-external-condition",
      "component_slug": "sd4-67psd-cac-intercooler",
      "property_name": "CAC core fin condition and external contamination",
      "observation_method": "direct_visual_external",
      "housing_opacity_status": "opaque",
      "notes": "Inspect CAC core fins for debris (bugs, mud, road debris) reducing airflow and heat rejection; bent fins visible from front of vehicle",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-op-cac-inlet-temp-pid",
      "component_slug": "sd4-67psd-cac-inlet-temp-sensor",
      "property_name": "CAC inlet temperature via scan tool PID",
      "observation_method": "scan_tool_pid",
      "housing_opacity_status": "opaque",
      "notes": "Should show elevated temperature relative to ambient under boost conditions; very high inlet temps with normal boost may indicate intercooler inlet pipe leak",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "sd4-67psd-op-cac-outlet-temp-pid",
      "component_slug": "sd4-67psd-cac-outlet-temp-sensor",
      "property_name": "CAC outlet temperature via scan tool PID",
      "observation_method": "scan_tool_pid",
      "housing_opacity_status": "opaque",
      "notes": "Compare to CAC inlet temperature; large differential indicates effective cooling; small differential at sustained boost load suggests degraded CAC core or insufficient airflow through core",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "sd4-67psd-op-egr-valve-position-pid",
      "component_slug": "sd4-67psd-egr-valve",
      "property_name": "EGR valve position (%) commanded vs actual via scan tool PID",
      "observation_method": "scan_tool_pid",
      "housing_opacity_status": "opaque",
      "notes": "At warm idle with EGR active, valve should be open to commanded position; large error between commanded and actual indicates carbon-stuck valve or motor failure (P0400 / P0401 codes)",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-op-egr-valve-visual-carbon",
      "component_slug": "sd4-67psd-egr-valve",
      "property_name": "EGR valve carbon deposits on seat and stem",
      "observation_method": "direct_visual_internal",
      "housing_opacity_status": "removable",
      "notes": "Remove EGR valve to inspect valve plate and seat for carbon accumulation; heavy carbon prevents full close (EGR at idle causes rough running) or full open (insufficient EGR flow); cleaning may restore function",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-op-egr-temp-post-cooler-pid",
      "component_slug": "sd4-67psd-egr-temp-sensor",
      "property_name": "EGR post-cooler gas temperature via scan tool PID",
      "observation_method": "scan_tool_pid",
      "housing_opacity_status": "opaque",
      "notes": "Should be significantly lower than exhaust temperature at the exhaust tap; temperature close to raw exhaust temperature suggests EGR cooler failure (coolant loss or internal bypass); cross-reference with coolant level",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-op-egr-upstream-temp-pid",
      "component_slug": "sd4-67psd-egr-upstream-temp-sensor",
      "property_name": "EGR pre-cooler (upstream) exhaust gas temperature via scan tool PID",
      "observation_method": "scan_tool_pid",
      "housing_opacity_status": "opaque",
      "notes": "Used to bracket EGR cooler heat rejection when paired with post-cooler sensor; high differential confirms cooler is working; if upstream and downstream temps are similar, EGR cooler has failed",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "sd4-67psd-op-exhaust-manifold-ds-visual",
      "component_slug": "sd4-67psd-exhaust-manifold-ds",
      "property_name": "Driver-side exhaust manifold cracks and gasket leaks",
      "observation_method": "direct_visual_external",
      "housing_opacity_status": "opaque",
      "notes": "Inspect manifold flanges and body for exhaust soot streaks indicating gasket leaks or cracks; carbon tracking around studs common; audible as ticking at cold start that diminishes when warm",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-op-exhaust-manifold-ps-visual",
      "component_slug": "sd4-67psd-exhaust-manifold-ps",
      "property_name": "Passenger-side exhaust manifold cracks and gasket leaks",
      "observation_method": "direct_visual_external",
      "housing_opacity_status": "opaque",
      "notes": "Same inspection procedure as driver-side; passenger-side manifold may be harder to access; exhaust manifold ticking is audible diagnostic",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-op-exhaust-manifold-ds-audible",
      "component_slug": "sd4-67psd-exhaust-manifold-ds",
      "property_name": "Exhaust manifold gasket tick (audible)",
      "observation_method": "audible",
      "housing_opacity_status": "opaque",
      "notes": "Metallic ticking from driver-side at cold start that may diminish when hot; indicates manifold gasket leak; confirm by listening with stethoscope probe near manifold flanges",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-op-egt1-pid",
      "component_slug": "sd4-67psd-egt-sensor-1",
      "property_name": "EGT Sensor 1 (pre-DPF inlet temp) via scan tool PID",
      "observation_method": "scan_tool_pid",
      "housing_opacity_status": "opaque",
      "notes": "Normal operating range ~200–600°C depending on load; during active regen PCM targets ~550–600°C at this sensor; temperature stuck low suggests sensor failure or open circuit",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "sd4-67psd-op-egt2-pid",
      "component_slug": "sd4-67psd-egt-sensor-2",
      "property_name": "EGT Sensor 2 (DPF outlet / SCR inlet temp) via scan tool PID",
      "observation_method": "scan_tool_pid",
      "housing_opacity_status": "opaque",
      "notes": "Cross-reference with EGT 1 and EGT 3; large drop from EGT1 to EGT2 is normal (DPF thermal mass); if EGT2 is higher than EGT1 during regen, DOC exothermic reaction is active — normal",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "sd4-67psd-op-egt3-pid",
      "component_slug": "sd4-67psd-egt-sensor-3",
      "property_name": "EGT Sensor 3 (SCR outlet temp) via scan tool PID",
      "observation_method": "scan_tool_pid",
      "housing_opacity_status": "opaque",
      "notes": "Should be within SCR operational window (~200–600°C) for DEF dosing to be active; temperature below window triggers PCM to suspend dosing; used to confirm DEF system enabling conditions",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "sd4-67psd-op-dpf-soot-load-pid",
      "component_slug": "sd4-67psd-dpf",
      "property_name": "DPF estimated soot load (%) via scan tool PID",
      "observation_method": "scan_tool_pid",
      "housing_opacity_status": "opaque",
      "notes": "PCM's calculated soot load estimate based on delta-pressure and drive cycle model; above threshold triggers active regen; 100% soot load without successful regen requires forced/parked regen via scan tool",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-op-dpf-regen-status-pid",
      "component_slug": "sd4-67psd-dpf",
      "property_name": "DPF active regen status / regen inhibit status via scan tool PID",
      "observation_method": "scan_tool_pid",
      "housing_opacity_status": "opaque",
      "notes": "Monitor regen in progress flag and inhibit conditions (coolant temp too low, vehicle speed, hood open signal); interrupted regens accumulate and require forced regen if count exceeds threshold",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-op-dpf-diff-pressure-pid",
      "component_slug": "sd4-67psd-dpf-diff-pressure-sensor",
      "property_name": "DPF differential pressure (kPa or inH2O) via scan tool PID",
      "observation_method": "scan_tool_pid",
      "housing_opacity_status": "opaque",
      "notes": "At idle with low soot load should read near zero; increases proportionally with soot accumulation and exhaust flow rate; a reading stuck at zero may indicate clogged sensing tubes rather than a clean DPF",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-op-dpf-diff-pressure-sensor-voltage",
      "component_slug": "sd4-67psd-dpf-diff-pressure-sensor",
      "property_name": "DPF delta-P sensor supply voltage and signal at connector",
      "observation_method": "electrical_measurement_at_pin",
      "housing_opacity_status": "opaque",
      "notes": "5V reference on ref pin; signal voltage at atmospheric differential should be approximately 0.5V; abnormal voltage with normal tubes confirms sensor failure",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-op-dpf-diff-pressure-tubes",
      "component_slug": "sd4-67psd-dpf-diff-pressure-sensor",
      "property_name": "DPF sensing tube condition (clog check)",
      "observation_method": "direct_visual_external",
      "housing_opacity_status": "opaque",
      "notes": "Disconnect sensing tubes from DPF ports; blow low-pressure air through tubes to verify clear; clogged tubes produce false low delta-P, causing missed regens and DPF overloading — very common failure mode",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-op-nox-upstream-pid",
      "component_slug": "sd4-67psd-nox-sensor-upstream",
      "property_name": "Upstream NOx concentration (ppm) via scan tool PID",
      "observation_method": "scan_tool_pid",
      "housing_opacity_status": "opaque",
      "notes": "Baseline NOx entering SCR; high NOx at light load may indicate combustion or EGR efficiency issue; used by PCM to set DEF dosing quantity",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "sd4-67psd-op-nox-downstream-pid",
      "component_slug": "sd4-67psd-nox-sensor-downstream",
      "property_name": "Downstream NOx concentration (ppm) via scan tool PID and SCR conversion efficiency",
      "observation_method": "scan_tool_pid",
      "housing_opacity_status": "opaque",
      "notes": "Should be substantially lower than upstream after SCR; PCM calculates conversion efficiency from the ratio; efficiency below threshold triggers P20EE / P2BAD; if downstream reads close to upstream, suspect failed SCR catalyst, DEF quality issue, or DEF dosing failure",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-op-nox-sensor-upstream-heater",
      "component_slug": "sd4-67psd-nox-sensor-upstream",
      "property_name": "NOx sensor heater function (sensor ready state)",
      "observation_method": "scan_tool_pid",
      "housing_opacity_status": "opaque",
      "notes": "Smart NOx sensors have internal heaters; monitor sensor ready/not-ready status; sensor heating failure triggers NOx circuit codes before catalyst efficiency can be assessed",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "sd4-67psd-op-scr-catalyst-temp-window",
      "component_slug": "sd4-67psd-scr",
      "property_name": "SCR catalyst temperature (via EGT3 PID) vs DEF dosing enable window",
      "observation_method": "scan_tool_pid",
      "housing_opacity_status": "opaque",
      "notes": "Indirect observation via EGT3; verify DEF dosing active flag correlates with SCR temperature being within the operational window; dosing suspended below ~200°C prevents ammonia slip into cold catalyst",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-op-muffler-tailpipe-smoke",
      "component_slug": "sd4-67psd-muffler-tailpipe",
      "property_name": "Tailpipe exhaust smoke color and opacity",
      "observation_method": "direct_visual_external",
      "housing_opacity_status": "opaque",
      "notes": "Black smoke = unburned fuel (over-fueling, EGR failure, poor combustion); white smoke/steam = coolant in combustion (head gasket, EGR cooler failure); blue/grey smoke = oil consumption (turbo seal, valve seal); no smoke at steady cruise is normal for healthy diesel",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-op-muffler-tailpipe-smell",
      "component_slug": "sd4-67psd-muffler-tailpipe",
      "property_name": "Tailpipe exhaust odor",
      "observation_method": "smell",
      "housing_opacity_status": "opaque",
      "notes": "Ammonia smell from tailpipe indicates DEF over-dosing or SCR catalyst bypass; fuel/hydrocarbon smell indicates excessive unburned fuel (regen cycle or injector issue); sulfur smell can indicate catalyst saturation",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    }
  ],

  "component_connections": [
    {
      "from_component_slug": "sd4-67psd-air-filter-housing",
      "to_component_slug": "sd4-67psd-maf-iat-sensor",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "Filtered air flows from air filter housing outlet through intake hose to MAF/IAT sensor",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-maf-iat-sensor",
      "to_component_slug": "sd4-67psd-vgt-turbo",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "Metered intake air flows from MAF sensor through intake hose to VGT turbocharger compressor inlet",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-maf-iat-sensor",
      "to_component_slug": "sd4-67psd-pcm",
      "connection_kind": "electrical-wire",
      "direction": "bidirectional",
      "description": "MAF signal (g/s) and IAT1 signal sent to PCM; PCM provides 12V supply and reference voltage to sensor",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-vgt-turbo",
      "to_component_slug": "sd4-67psd-cac-intercooler",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "Compressed hot charge air flows from VGT compressor outlet through charge air pipe to CAC inlet",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-cac-intercooler",
      "to_component_slug": "sd4-67psd-intake-throttle",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "Cooled compressed charge air flows from CAC outlet through intake pipe to intake throttle valve inlet",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-intake-throttle",
      "to_component_slug": "sd4-67psd-intake-manifold",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "Throttled charge air flows from intake throttle valve outlet into the intake manifold plenum",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-cac-inlet-temp-sensor",
      "to_component_slug": "sd4-67psd-pcm",
      "connection_kind": "electrical-wire",
      "direction": "unidirectional",
      "description": "CAC inlet temperature signal sent to PCM; PCM provides ground reference",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "from_component_slug": "sd4-67psd-cac-outlet-temp-sensor",
      "to_component_slug": "sd4-67psd-pcm",
      "connection_kind": "electrical-wire",
      "direction": "unidirectional",
      "description": "CAC outlet temperature signal sent to PCM for charge-air density modeling",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "from_component_slug": "sd4-67psd-iat2-sensor",
      "to_component_slug": "sd4-67psd-pcm",
      "connection_kind": "electrical-wire",
      "direction": "unidirectional",
      "description": "IAT2 (manifold/post-CAC intake air temperature) signal sent to PCM",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "from_component_slug": "sd4-67psd-pcm",
      "to_component_slug": "sd4-67psd-intake-heater-relay",
      "connection_kind": "electrical-wire",
      "direction": "unidirectional",
      "description": "PCM sends low-current command signal to intake heater relay coil to activate grid during cold-start conditions",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-intake-heater-relay",
      "to_component_slug": "sd4-67psd-intake-heater-grid",
      "connection_kind": "electrical-wire",
      "direction": "unidirectional",
      "description": "Relay contacts close to supply high-current battery voltage to intake heater grid resistance element",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-pcm",
      "to_component_slug": "sd4-67psd-intake-throttle",
      "connection_kind": "electrical-wire",
      "direction": "bidirectional",
      "description": "PCM sends motor drive command to intake throttle; internal position sensor returns actual valve position feedback to PCM",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-map-sensor",
      "to_component_slug": "sd4-67psd-pcm",
      "connection_kind": "electrical-wire",
      "direction": "bidirectional",
      "description": "PCM provides 5V reference to MAP sensor; MAP sensor returns analog boost pressure signal to PCM",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-pcm",
      "to_component_slug": "sd4-67psd-vgt-actuator",
      "connection_kind": "electrical-wire",
      "direction": "bidirectional",
      "description": "PCM sends VGT vane position command (PWM or sub-bus) to actuator; actuator returns internal position sensor feedback to PCM for closed-loop control",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "from_component_slug": "sd4-67psd-vgt-actuator",
      "to_component_slug": "sd4-67psd-vgt-turbo",
      "connection_kind": "mechanical-linkage",
      "direction": "unidirectional",
      "description": "VGT actuator motor output shaft mechanically moves the variable vane ring in the turbo turbine housing",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-turbo-speed-sensor",
      "to_component_slug": "sd4-67psd-pcm",
      "connection_kind": "electrical-wire",
      "direction": "unidirectional",
      "description": "Turbo turbine wheel RPM signal sent from turbo speed sensor to PCM",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "from_component_slug": "sd4-67psd-exhaust-manifold-ds",
      "to_component_slug": "sd4-67psd-vgt-turbo",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "Exhaust gas from driver-side cylinder bank flows through driver-side manifold to the common collector at VGT turbine inlet",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-exhaust-manifold-ps",
      "to_component_slug": "sd4-67psd-vgt-turbo",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "Exhaust gas from passenger-side cylinder bank flows through passenger-side manifold to the common collector at VGT turbine inlet",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-exhaust-manifold-ds",
      "to_component_slug": "sd4-67psd-egr-upstream-temp-sensor",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "High-pressure EGR gas tap branches from exhaust manifold or collector upstream of turbo; upstream EGR temp sensor is located at this tap",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "from_component_slug": "sd4-67psd-egr-upstream-temp-sensor",
      "to_component_slug": "sd4-67psd-pcm",
      "connection_kind": "electrical-wire",
      "direction": "unidirectional",
      "description": "EGR upstream (pre-cooler) exhaust gas temperature signal sent to PCM",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "from_component_slug": "sd4-67psd-egr-upstream-temp-sensor",
      "to_component_slug": "sd4-67psd-egr-cooler",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "Hot EGR gas flows from the high-pressure exhaust tap (where upstream EGR temp sensor is located) into the EGR cooler inlet",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-egr-cooler",
      "to_component_slug": "sd4-67psd-egr-temp-sensor",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "Cooled EGR gas exits EGR cooler and flows to the EGR post-cooler temperature sensor location",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-egr-temp-sensor",
      "to_component_slug": "sd4-67psd-pcm",
      "connection_kind": "electrical-wire",
      "direction": "unidirectional",
      "description": "EGR post-cooler gas temperature signal sent to PCM",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-egr-temp-sensor",
      "to_component_slug": "sd4-67psd-egr-valve",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "Cooled EGR gas flows from post-cooler temperature sensor location into the EGR valve inlet",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-pcm",
      "to_component_slug": "sd4-67psd-egr-valve",
      "connection_kind": "electrical-wire",
      "direction": "bidirectional",
      "description": "PCM sends motor drive command to EGR valve; internal position sensor returns actual valve position feedback to PCM",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-egr-valve",
      "to_component_slug": "sd4-67psd-intake-manifold",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "EGR gas exits EGR valve and enters the intake manifold or intake throttle body inlet area, mixing with fresh charge air",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-vgt-turbo",
      "to_component_slug": "sd4-67psd-egt-sensor-1",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "Exhaust gas exits VGT turbine outlet and flows downstream past EGT Sensor 1 at the DOC/DPF inlet",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "from_component_slug": "sd4-67psd-egt-sensor-1",
      "to_component_slug": "sd4-67psd-pcm",
      "connection_kind": "electrical-wire",
      "direction": "unidirectional",
      "description": "EGT Sensor 1 (pre-DPF / DOC inlet exhaust temperature) signal sent to PCM",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "from_component_slug": "sd4-67psd-egt-sensor-1",
      "to_component_slug": "sd4-67psd-doc",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "Exhaust gas flows past EGT1 sensor into the DOC catalytic element",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-doc",
      "to_component_slug": "sd4-67psd-dpf",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "Exhaust exits DOC and enters DPF wall-flow filter; DOC and DPF are integrated in the same aftertreatment housing",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-dpf",
      "to_component_slug": "sd4-67psd-egt-sensor-2",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "Filtered exhaust exits DPF outlet and flows past EGT Sensor 2 at the DPF outlet / SCR inlet",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "from_component_slug": "sd4-67psd-egt-sensor-2",
      "to_component_slug": "sd4-67psd-pcm",
      "connection_kind": "electrical-wire",
      "direction": "unidirectional",
      "description": "EGT Sensor 2 (DPF outlet / SCR inlet temperature) signal sent to PCM",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "from_component_slug": "sd4-67psd-dpf-diff-pressure-sensor",
      "to_component_slug": "sd4-67psd-dpf",
      "connection_kind": "fluid-line",
      "direction": "bidirectional",
      "description": "Two sensing tubes connect DPF differential pressure sensor to upstream and downstream ports on the DPF housing",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-dpf-diff-pressure-sensor",
      "to_component_slug": "sd4-67psd-pcm",
      "connection_kind": "electrical-wire",
      "direction": "bidirectional",
      "description": "PCM provides 5V reference to DPF delta-P sensor; sensor returns analog differential pressure signal to PCM for soot load estimation",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-egt-sensor-2",
      "to_component_slug": "sd4-67psd-scr",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "Exhaust gas flows from EGT2 sensor location into the SCR catalyst element",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-def-dosing-system",
      "to_component_slug": "sd4-67psd-scr",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "DEF dosing injector sprays DEF into the exhaust stream upstream of the SCR catalyst for NOx reduction",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-def-tank",
      "to_component_slug": "sd4-67psd-def-dosing-system",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "DEF is drawn from the DEF tank by the dosing pump and delivered to the dosing injector",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-pcm",
      "to_component_slug": "sd4-67psd-def-dosing-system",
      "connection_kind": "controlled_by",
      "direction": "unidirectional",
      "description": "PCM commands DEF dosing quantity and timing based on upstream/downstream NOx sensor feedback and SCR temperature window",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-scr",
      "to_component_slug": "sd4-67psd-nox-sensor-upstream",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "Exhaust flows past upstream NOx sensor before entering the SCR catalyst active zone; sensor is positioned pre-SCR at the aftertreatment inlet",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "from_component_slug": "sd4-67psd-nox-sensor-upstream",
      "to_component_slug": "sd4-67psd-pcm",
      "connection_kind": "electrical-wire",
      "direction": "bidirectional",
      "description": "Upstream NOx sensor communicates raw NOx concentration to PCM via dedicated smart-sensor protocol (PWM or sub-CAN); PCM provides power supply",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "from_component_slug": "sd4-67psd-scr",
      "to_component_slug": "sd4-67psd-egt-sensor-3",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "Exhaust exits SCR outlet and flows past EGT Sensor 3",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "from_component_slug": "sd4-67psd-egt-sensor-3",
      "to_component_slug": "sd4-67psd-pcm",
      "connection_kind": "electrical-wire",
      "direction": "unidirectional",
      "description": "EGT Sensor 3 (SCR outlet temperature) signal sent to PCM",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "from_component_slug": "sd4-67psd-scr",
      "to_component_slug": "sd4-67psd-nox-sensor-downstream",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "Exhaust exits SCR outlet and flows past downstream NOx sensor",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-nox-sensor-downstream",
      "to_component_slug": "sd4-67psd-pcm",
      "connection_kind": "electrical-wire",
      "direction": "bidirectional",
      "description": "Downstream NOx sensor communicates post-SCR NOx concentration to PCM via dedicated smart-sensor protocol; PCM uses delta from upstream to assess SCR efficiency and adjust DEF dosing",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-nox-sensor-downstream",
      "to_component_slug": "sd4-67psd-muffler-tailpipe",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "Treated exhaust flows from downstream NOx sensor location into the muffler and tailpipe assembly for final atmospheric discharge",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-pcm",
      "to_component_slug": "sd4-67psd-hs-can-bus",
      "connection_kind": "can-bus",
      "direction": "bidirectional",
      "description": "PCM is the primary node on the HS-CAN bus; transmits DTC status, PID data, and system states; receives commands from other modules",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-hs-can-bus",
      "to_component_slug": "sd4-67psd-instrument-cluster",
      "connection_kind": "can-bus",
      "direction": "bidirectional",
      "description": "IPC receives DTC warning flags (Check Engine, Exhaust Filter Full, Regen In Progress, DPF warning, DEF low) from PCM via HS-CAN for driver display",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-pcm",
      "to_component_slug": "sd4-67psd-instrument-cluster",
      "connection_kind": "reports_to",
      "direction": "unidirectional",
      "description": "PCM reports DPF soot load warnings, regen status, DEF level warnings, and Check Engine light status to IPC",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-engine-gear-train",
      "to_component_slug": "sd4-67psd-vgt-turbo",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "Engine crankshaft rotation drives combustion that produces exhaust enthalpy driving the VGT turbine; the gear train also drives the oil pump supplying lubrication to the turbo bearings (indirect relationship via oil system)",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    }
  ]
}
```
