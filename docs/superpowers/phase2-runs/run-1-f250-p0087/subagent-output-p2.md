# Run 1 / Prompt 2 — Subagent Output (DRY RUN, uncommitted)

**Date:** 2026-05-19
**Subagent model:** Sonnet
**Input:** narration of the 2018 F-250 6.7L PSD fuel system synthesized from the 23 vetted architecture facts (Run 1 / Gate 1)
**Output stats:** 28 components, 49 observable_properties, 43 component_connections (all validated against schema enums; zero issues)

---

# 1. CLASSIFICATION

**Primary domain: Combustion + Hydraulic (high-pressure fuel circuit) + Electrical**

Evidence from the description:

- **Combustion:** "2018 Ford F-250 6.7L Power Stroke fuel system," diesel application, injectors, rail pressure for combustion, SCR/DEF for emissions.
- **Hydraulic:** "lift pump moves fuel forward," "CP4.2 high-pressure pump," "29,000 PSI under peak demand," "high-pressure steel rails," "mechanical pressure relief valve," "passive low-pressure fuel return circuit" — these are all pressure-driven fluid circuits.
- **Electrical:** "electric lift pump," "resistive analog signal," "WIF sensor signals to the PCM," "PWM-controlled solenoid," "fuel rail pressure sensor (FRP), a three-wire sensor with 5V reference, analog voltage signal, and ground," "PCM drives each injector via high-voltage / high-current PWM," "HS-CAN, 500 kbps," "lift pump relay in BJB or SJB."

Secondary domain: **Software / Digital** (PCM closed-loop control, CAN bus communications, OBD PIDs).

---

# 2. EXTRACTED

## ENTITIES

---

### E1 — Fuel Tank

- **Identifier:** fuel tank
- **Standard name:** fuel tank / fuel reservoir
- **Kind:** mechanical (reservoir)
- **Location:** under the cab/frame
- **Inputs:** fuel (fill), fuel return from return circuit
- **Outputs:** fuel to lift pump
- **Function:** stores diesel fuel for the vehicle; single tank, no factory dual-tank option on this generation
- **Relationships:** feeds lift pump; receives return fuel from passive return circuit; contains fuel level sender (E2)
- **Capacity:** 26–48 gallons depending on cab and bed configuration
- **Observability profile:**
  - Housing/boundary opacity: **not stated** → GAP
  - Properties:
    - Fuel level: opacity not confirmed; no valid observation methods enumerable without confirming opacity → GAP
    - Fuel quality/contamination (standing water at bottom): opacity not confirmed → GAP

---

### E2 — Fuel Level Sender

- **Identifier:** in-tank fuel level sender
- **Standard name:** fuel level sender / fuel gauge sending unit
- **Kind:** sensor
- **Location:** inside the fuel tank
- **Inputs:** fuel level (mechanical float position)
- **Outputs:** resistive analog signal
- **Function:** reads fuel level via float-and-resistor mechanism; outputs varying resistance to instrument cluster fuel gauge
- **Relationships:** signal feeds instrument cluster (E15); physically inside fuel tank (E1)
- **Electrical contract:** resistive analog (variable resistance, 2-wire typical) — wire count and exact resistance range not stated → GAP
- **Observability profile:**
  - Housing/boundary opacity: **not stated** (inside sealed tank) → GAP
  - Properties:
    - Signal resistance/voltage at harness connector: boundary opacity not confirmed for external measurement; method electrical_measurement_at_pin is valid at the connector (accessible externally)
    - Float physical condition: not accessible without tank removal → observation method: direct_visual_internal (only if tank removed)

---

### E3 — Lift Pump

- **Identifier:** electric lift pump
- **Standard name:** electric low-pressure fuel lift pump / transfer pump
- **Kind:** pump
- **Location:** driver-side frame rail
- **Inputs:** low-pressure fuel from tank (E1); electrical power via relay (E14)
- **Outputs:** pressurized low-pressure fuel to filter/water separator assembly (E4)
- **Function:** electric motor-driven pump that moves fuel from tank toward the high-pressure side; provides positive feed pressure to the CP4.2 inlet
- **Relationships:** downstream of fuel tank (E1); upstream of primary fuel filter/water separator (E4); controlled by PCM (E13) via lift pump relay (E14); receives electrical power from relay (E14)
- **Electrical contract:** not stated (motor pump; typical operating voltage not to be asserted) → GAP
- **Observability profile:**
  - Housing/boundary opacity: **not stated** → GAP
  - Properties:
    - Operational status (running/not running): scan_tool_pid (lift pump status PID broadcast on HS-CAN)
    - Audible operation: audible (pump noise detectable at driver-side frame rail when commanded on)
    - Output pressure: pressure_test_with_gauge (at filter inlet fitting, if accessible)
    - Electrical supply at motor terminals: electrical_measurement_at_pin

---

### E4 — Primary Fuel Filter and Water Separator Assembly

- **Identifier:** primary fuel filter and water separator assembly
- **Standard name:** primary fuel filter / fuel/water separator
- **Kind:** mechanical (filter assembly housing containing replaceable element and WIF sensor)
- **Location:** driver-side frame rail, downstream of lift pump (E3)
- **Inputs:** low-pressure fuel from lift pump (E3)
- **Outputs:** filtered fuel to CP4.2 (E6); WIF signal via integrated WIF sensor (E5) to PCM (E13)
- **Function:** removes particulate contamination and separates free water from diesel fuel before it reaches the high-pressure pump; houses the WIF sensor (E5)
- **Relationships:** downstream of lift pump (E3); upstream of CP4.2 (E6); contains WIF sensor (E5); output pressure feeds CP4.2 inlet
- **OEM filter part number:** not reliable from training data → GAP
- **Heated element option:** MAY be present — requires build-sheet or Workshop Manual confirmation → GAP
- **Observability profile:**
  - Housing/boundary opacity: **not stated** → GAP
  - Properties:
    - Water accumulation in bowl/housing: opacity not confirmed; if a drain/sample port exists, drained_into_container → maps to direct_visual_internal (if drained); WIF sensor (E5) provides electrical indication via scan_tool_pid
    - Filter restriction (differential pressure): pressure_test_with_gauge (inlet vs. outlet pressure comparison, if test ports available)
    - Internal element condition: direct_visual_internal (only if housing opened / element removed) — maps to direct_visual_internal
    - Fuel color/smell from drain: smell; direct_visual_internal (if drained)

---

### E5 — Water-in-Fuel (WIF) Sensor

- **Identifier:** WIF sensor / water-in-fuel sensor
- **Standard name:** water-in-fuel sensor
- **Kind:** sensor
- **Location:** integrated into the primary fuel filter housing (E4), driver-side frame rail
- **Inputs:** presence of water in fuel at sensor probe location
- **Outputs:** electrical signal to PCM (E13)
- **Function:** detects free water accumulation at the filter/separator; signals PCM to trigger WIF warning lamp via instrument cluster
- **Relationships:** integrated in filter housing (E4); signal goes to PCM (E13); PCM broadcasts WIF status on HS-CAN (E16) to instrument cluster (E15) for warning lamp
- **Electrical contract:** wire count and signal type (analog, discrete, frequency) not known from training data → GAP
- **Observability profile:**
  - Housing/boundary opacity: integrated into filter housing — opacity not stated → GAP
  - Properties:
    - WIF status (water detected / not detected): scan_tool_pid (WIF status PID on HS-CAN)
    - Sensor signal at PCM pin: electrical_measurement_at_pin
    - Sensor signal at sensor connector: electrical_measurement_at_pin

---

### E6 — CP4.2 High-Pressure Fuel Pump

- **Identifier:** CP4.2 / Bosch CP4.2
- **Standard name:** Bosch CP4.2 high-pressure injection pump (common rail pump)
- **Kind:** pump
- **Location:** front of the engine, gear-driven off the front cover area
- **Inputs:** low-pressure filtered fuel from filter assembly (E4); mechanical drive from engine front gear train (E7); electrical command to integrated IMV (E8) from PCM (E13)
- **Outputs:** high-pressure fuel to two fuel rails (E9a, E9b) — one per cylinder bank
- **Function:** raises fuel pressure from low-pressure supply to common rail operating pressure (up to ~29,000 PSI peak demand); internally lubricated entirely by diesel fuel — no separate oil circuit
- **Relationships:** driven by engine front gear (E7); inlet receives fuel from filter housing (E4); outlet feeds HP rails (E9a, E9b); contains IMV (E8); receives IMV command from PCM (E13); CP4.2 internal lubrication depends on fuel lubricity
- **Lubrication:** diesel fuel — no separate oil circuit (explicitly stated)
- **Rated peak output pressure:** ~29,000 PSI (described as approximate under peak demand; exact PCM-calibrated max for 2018 tune not confirmed without scan-tool) → GAP for calibrated max
- **Observability profile:**
  - Housing/boundary opacity: **not stated** → GAP
  - Properties:
    - Rail pressure delivered (output): scan_tool_pid (FRP PID), pressure_test_with_gauge (at rail test port if available)
    - Pump mechanical noise: audible (abnormal knock/cavitation detectable at pump location)
    - Internal wear state: no direct external observation method without disassembly — GAP for non-destructive observation method
    - Inlet pressure (from filter assembly): pressure_test_with_gauge (at CP4.2 inlet fitting, if accessible)

---

### E7 — Engine Front Gear Train (Drive Interface)

- **Identifier:** front cover area / gear-driven off the front of the engine
- **Standard name:** engine front accessory drive / front geartrain
- **Kind:** mechanical
- **Location:** front of the engine, front cover area
- **Inputs:** engine crankshaft rotation
- **Outputs:** mechanical drive to CP4.2 (E6)
- **Function:** transmits engine rotation to the CP4.2 high-pressure pump; speed relationship to crank not stated → GAP
- **Relationships:** drives CP4.2 (E6)
- **Observability profile:**
  - Properties:
    - Drive engagement noise: audible
    - Drive ratio/timing: not stated → GAP

---

### E8 — Inlet Metering Valve (IMV)

- **Identifier:** inlet metering valve (IMV)
- **Standard name:** inlet metering valve / fuel quantity control valve
- **Kind:** valve
- **Location:** inside the CP4.2 pump body (E6)
- **Inputs:** PWM electrical signal from PCM (E13); low-pressure fuel flow at CP4.2 inlet
- **Outputs:** metered fuel quantity entering the CP4.2 high-pressure circuit
- **Function:** normally-open PWM-controlled solenoid; meters how much fuel enters the high-pressure circuit; PCM uses closed-loop FRP feedback to command IMV duty cycle
- **Relationships:** physically inside CP4.2 (E6); commanded by PCM (E13) via electrical wire; controls fuel quantity entering CP4.2 HP circuit; PCM closes loop using FRP sensor signal (E10)
- **Default state:** normally open (explicitly stated)
- **Electrical contract:** PWM solenoid; wire count, pin numbers, frequency, duty-cycle range not stated → GAP
- **Observability profile:**
  - Housing/boundary opacity: inside CP4.2 body (opaque metal housing) — internal state not observable without removal; **opacity of CP4.2 body not formally stated but follows from metal pump body** → PATTERN
  - Properties:
    - IMV commanded duty cycle: scan_tool_pid (injector duty cycle / IMV duty PID on HS-CAN)
    - IMV electrical signal (PWM waveform at connector): waveform_capture
    - IMV solenoid continuity/resistance: electrical_measurement_at_pin (at connector, with pump on vehicle or bench)
    - IMV mechanical position: **no external observation method without disassembly** → GAP

---

### E9a / E9b — High-Pressure Fuel Rails

- **Identifier:** two high-pressure steel rails, one per cylinder bank
- **Standard name:** common rail / fuel rail (high-pressure)
- **Kind:** mechanical (pressure vessel / distribution manifold)
- **Location:** one per cylinder bank (bank designation left/right not specified) → GAP
- **Inputs:** high-pressure fuel from CP4.2 (E6)
- **Outputs:** high-pressure fuel to four injectors each (E11a–E11h); rail pressure sensed by FRP sensor(s) (E10); limited by mechanical pressure relief valve(s) (E12)
- **Function:** stores and distributes high-pressure fuel to injectors; acts as hydraulic accumulator to damp pressure fluctuations
- **Relationships:** fed by CP4.2 (E6); feeds 4 injectors per rail; contains or has integrated FRP sensor (E10); contains or is served by pressure relief valve (E12)
- **Observability profile:**
  - Housing/boundary opacity: **not stated** (steel rail — likely opaque, but not to be inferred per protocol) → GAP
  - Properties:
    - Rail pressure (static and dynamic): scan_tool_pid (FRP PID), pressure_test_with_gauge (at rail test port if accessible)
    - External fuel leak at rail fittings: direct_visual_external
    - Rail temperature: touch (surface temperature at rail body)

---

### E10 — Fuel Rail Pressure (FRP) Sensor

- **Identifier:** fuel rail pressure sensor (FRP)
- **Standard name:** fuel rail pressure sensor
- **Kind:** sensor
- **Location:** on the high-pressure fuel rail(s); described as "at least one FRP" — exact number and per-bank placement not confirmed → GAP
- **Inputs:** rail fuel pressure (hydraulic)
- **Outputs:** analog voltage signal to PCM (E13)
- **Function:** measures common rail fuel pressure; provides PCM with feedback signal for closed-loop IMV control
- **Relationships:** mounted on rail(s) (E9a/E9b); 5V reference, signal, and ground from PCM (E13); PCM uses signal to command IMV (E8)
- **Electrical contract:** 3-wire analog — 5V reference, analog voltage signal, ground (explicitly stated)
- **Observability profile:**
  - Housing/boundary opacity: **not stated** → GAP (sensor body is not a vessel with internal fluid content observable externally; but the housing is a mechanical boundary)
  - Properties:
    - Rail pressure value: scan_tool_pid (FRP PID on HS-CAN)
    - 5V reference voltage at sensor connector: electrical_measurement_at_pin
    - Signal voltage at sensor connector: electrical_measurement_at_pin
    - Ground continuity at sensor connector: electrical_measurement_at_pin
    - Signal waveform under dynamic conditions: waveform_capture

---

### E11a–E11h — Fuel Injectors (8 total)

- **Identifier:** eight Bosch solenoid-type common rail injectors
- **Standard name:** common rail fuel injectors (solenoid type)
- **Kind:** actuator
- **Location:** one per cylinder, V8 configuration (cylinder-specific positions not stated) → GAP
- **Inputs:** high-pressure fuel from rails (E9a/E9b); PWM electrical command from PCM (E13) via dedicated injector driver circuits
- **Outputs:** metered fuel spray into combustion chamber; excess high-pressure return fuel to return circuit (E17)
- **Function:** solenoid-operated; PCM drives each independently via high-voltage/high-current PWM through dedicated driver circuits; injects precise fuel quantity per combustion event
- **Type:** solenoid (explicitly stated, not piezoelectric)
- **Relationships:** fed by HP rails (E9a/E9b); commanded by PCM (E13); excess fuel returns via passive return circuit (E17); each has dedicated PCM injector driver circuit
- **Electrical contract:** high-voltage/high-current PWM via dedicated PCM driver circuits; exact voltage, current, wire colors, connector type not stated → GAP
- **Observability profile:**
  - Housing/boundary opacity: **not stated** → GAP
  - Properties:
    - Injector command signal (PWM waveform): waveform_capture
    - Injector duty cycle commanded: scan_tool_pid
    - Injector solenoid resistance: electrical_measurement_at_pin (at connector)
    - Audible injector tick: audible (at cylinder head, normal diesel tick; changes with injector fault)
    - External fuel leak at injector body: direct_visual_external

---

### E12 — Mechanical Pressure Relief Valve

- **Identifier:** mechanical pressure relief valve on the rail(s)
- **Standard name:** fuel rail pressure relief valve / pressure limiting valve
- **Kind:** valve
- **Location:** on the fuel rail(s) (E9a/E9b); whether on one rail or both not confirmed → GAP
- **Inputs:** high-pressure fuel from rail
- **Outputs:** fuel to return circuit (E17) when cracking pressure is exceeded
- **Function:** passive mechanical overpressure protection; opens at a factory-set threshold to return fuel and prevent rail overpressure damage; no electrical actuation
- **Relationships:** mounted on rail(s) (E9a/E9b); excess fuel diverted to passive return circuit (E17) when open
- **Cracking pressure:** factory-set; exact value not known from training data → GAP
- **Observability profile:**
  - Housing/boundary opacity: **not stated** → GAP
  - Properties:
    - Valve opening (abnormal bleed-down event): scan_tool_pid (rail pressure drop visible in FRP PID data)
    - External fuel leak at valve seat: direct_visual_external
    - Valve mechanical condition: direct_visual_internal (only if removed from rail)

---

### E13 — Powertrain Control Module (PCM)

- **Identifier:** PCM / Powertrain Control Module
- **Standard name:** Powertrain Control Module (PCM)
- **Kind:** module
- **Location:** passenger-side firewall, engine compartment
- **Inputs:** FRP sensor signals (E10); WIF sensor signal (E5); fuel level sender signal (E2) — note: narration states cluster reads fuel level over CAN, but sender signal routing to PCM vs. directly to cluster needs clarification → GAP; CAN bus data from ABS/TC module (E18); lift pump relay feedback (inferred)
- **Outputs:** IMV PWM command (E8); injector PWM commands (E11a–E11h); lift pump relay command (E14); fuel system PIDs broadcast on HS-CAN (E16)
- **Function:** sole fuel system controller; manages all fuel actuators (IMV, injectors, lift pump relay); performs closed-loop rail pressure control; broadcasts fuel system PIDs on HS-CAN; receives torque management inputs from ABS/TC
- **Relationships:** controls IMV (E8), all injectors (E11a–E11h), lift pump relay (E14); reads FRP (E10), WIF (E5), fuel level sender (routing ambiguous → GAP); communicates on HS-CAN (E16) with instrument cluster (E15) and ABS/TC module (E18)
- **Connector / pin count:** not stated → GAP
- **Observability profile:**
  - Housing/boundary opacity: **not stated** → GAP
  - Properties:
    - Fuel system PIDs (rail pressure, lift pump status, injector duty, WIF status): scan_tool_pid
    - PCM connector pin voltages (power, ground, signal): electrical_measurement_at_pin
    - CAN bus signal at PCM connector: waveform_capture

---

### E14 — Lift Pump Relay

- **Identifier:** lift pump relay
- **Standard name:** fuel pump relay / lift pump relay
- **Kind:** actuator (relay)
- **Location:** Battery Junction Box (BJB) or Smart Junction Box (SJB) in engine compartment; exact cavity designation for 2018 F-250 not known → GAP
- **Inputs:** control signal from PCM (E13); battery power
- **Outputs:** switched battery power to lift pump (E3)
- **Function:** switches battery power to the electric lift pump on PCM command; isolates pump from direct PCM output (current load)
- **Relationships:** commanded by PCM (E13); powers lift pump (E3); housed in BJB or SJB
- **Electrical contract:** relay (coil + contacts); exact coil resistance, contact rating, cavity/fuse designation not stated → GAP
- **Observability profile:**
  - Housing/boundary opacity: inside junction box; **not stated** → GAP
  - Properties:
    - Relay presence and seating: direct_visual_external (if junction box cover is opened)
    - Relay coil supply/control circuit voltage: electrical_measurement_at_pin
    - Relay output (battery voltage to pump): electrical_measurement_at_pin
    - Relay click on command: audible (relay actuation click at BJB/SJB)

---

### E15 — Instrument Cluster

- **Identifier:** instrument cluster
- **Standard name:** instrument cluster / IPC
- **Kind:** module
- **Location:** instrument panel (not stated explicitly, but follows from instrument cluster function) → LOGIC inference for location
- **Inputs:** fuel level data over HS-CAN (E16) from PCM (E13); WIF status over HS-CAN (E16) from PCM (E13)
- **Outputs:** fuel gauge display; WIF warning lamp
- **Function:** displays fuel level on fuel gauge; illuminates WIF warning lamp based on CAN data from PCM
- **Relationships:** receives fuel level and WIF status from PCM via HS-CAN (E16)
- **Observability profile:**
  - Properties:
    - Fuel gauge reading: direct_visual_external
    - WIF warning lamp state: direct_visual_external

---

### E16 — HS-CAN Bus

- **Identifier:** HS-CAN bus
- **Standard name:** High-Speed CAN bus (SAE J1939 / ISO 11898, 500 kbps)
- **Kind:** connector (network medium / bus)
- **Location:** vehicle-wide network; accessible at OBD-II port (location of OBD-II port not stated beyond implied standard location) → PATTERN
- **Inputs/Outputs:** bidirectional data exchange between all connected modules
- **Speed:** 500 kbps (explicitly stated)
- **Function:** network backbone for PCM fuel system PID broadcast; carries WIF status and fuel level data to instrument cluster; carries torque management data between PCM and ABS/TC
- **Relationships:** connects PCM (E13), instrument cluster (E15), ABS/TC module (E18); accessible via OBD-II port for scan tool
- **Observability profile:**
  - Properties:
    - CAN bus PIDs (all fuel system): scan_tool_pid
    - CAN bus differential signal quality: waveform_capture (at OBD-II pins 6 and 14, or at module connectors)

---

### E17 — Passive Low-Pressure Return Circuit

- **Identifier:** passive low-pressure fuel return circuit
- **Standard name:** fuel return line
- **Kind:** mechanical (conduit)
- **Location:** runs from injectors and/or pressure relief valve(s) back to tank or filter housing; exact routing not stated → GAP
- **Inputs:** excess high-pressure fuel from injectors (E11a–E11h) and from pressure relief valve (E12) when open
- **Outputs:** fuel returned to tank (E1) or filter housing (E4) — both listed as possible destinations; exact single destination not confirmed → GAP
- **Function:** passive (gravity/backpressure) return of excess fuel with no return pump
- **Relationships:** receives from injectors (E11a–E11h) and relief valve (E12); terminates at fuel tank (E1) or filter housing (E4)
- **Observability profile:**
  - Housing/boundary opacity: **not stated** → GAP
  - Properties:
    - External fuel leak along return line: direct_visual_external
    - Return line restriction (back-pressure): pressure_test_with_gauge (at injector return fitting, if accessible)

---

### E18 — ABS / Traction Control Module

- **Identifier:** ABS / Traction Control module
- **Standard name:** ABS/TCS control module
- **Kind:** module
- **Location:** not stated → GAP
- **Inputs:** torque-management data from PCM (E13) via HS-CAN (E16)
- **Outputs:** torque management requests to PCM (E13) via HS-CAN (E16)
- **Function:** exchanges torque management data with PCM; torque output depends on rail pressure and injection quantity — links fuel system performance to vehicle dynamics control
- **Relationships:** communicates with PCM (E13) via HS-CAN (E16)
- **Observability profile:**
  - Properties:
    - CAN bus communication with PCM: scan_tool_pid

---

### E19 — DEF Tank

- **Identifier:** DEF tank / urea/AdBlue tank
- **Standard name:** DEF (Diesel Exhaust Fluid) reservoir
- **Kind:** mechanical (reservoir)
- **Location:** passenger-side frame rail
- **Inputs:** DEF fluid (fill)
- **Outputs:** DEF fluid to DEF pump / dosing system
- **Function:** stores urea solution (DEF) for SCR dosing; separate from fuel circuit
- **Relationships:** feeds DEF pump/dosing system (E20); PCM-controlled via CAN
- **Observability profile:**
  - Housing/boundary opacity: **not stated** → GAP
  - Properties:
    - DEF level: scan_tool_pid (DEF level/quality PID via CAN); direct_visual_external (if sight glass present — not confirmed)
    - DEF quality: scan_tool_pid

---

### E20 — DEF Dosing System (DEF Pump, DEF Injector, DEF Level/Quality Sensor)

- **Identifier:** DEF pump, DEF injector (dosing module), DEF level/quality sensor
- **Standard name:** SCR dosing system
- **Kind:** (composite — DEF pump = pump; DEF injector = actuator; DEF level/quality sensor = sensor)
- **Location:** not stated beyond association with passenger-side DEF tank → GAP
- **Inputs:** DEF from tank (E19); PCM commands via CAN
- **Outputs:** DEF dosing into exhaust stream upstream of SCR catalyst
- **Function:** meters and injects DEF into exhaust for NOx reduction via SCR; interacts with fuel combustion quality for emissions compliance; not part of the fuel circuit
- **Relationships:** fed by DEF tank (E19); controlled by PCM (E13) via HS-CAN (E16); DEF level/quality sensor reports to PCM
- **Note:** treated as a distinct sub-system; full extraction of DEF dosing internals not within the described fuel system scope

---

## RELATIONSHIPS

| # | Source | Destination | Mode | Direction |
|---|--------|-------------|------|-----------|
| R1 | Fuel Tank (E1) | Lift Pump (E3) | fluid-line (low-pressure suction) | unidirectional |
| R2 | Lift Pump (E3) | Filter/WS Assembly (E4) | fluid-line (low-pressure pressure) | unidirectional |
| R3 | Filter/WS Assembly (E4) | CP4.2 (E6) | fluid-line (low-pressure filtered) | unidirectional |
| R4 | CP4.2 (E6) | HP Rail Bank A (E9a) | fluid-line (high-pressure) | unidirectional |
| R5 | CP4.2 (E6) | HP Rail Bank B (E9b) | fluid-line (high-pressure) | unidirectional |
| R6 | HP Rail A (E9a) | Injectors cyl 1–4 (E11a–d) | fluid-line (high-pressure) | unidirectional |
| R7 | HP Rail B (E9b) | Injectors cyl 5–8 (E11e–h) | fluid-line (high-pressure) | unidirectional |
| R8 | Injectors (E11a–h) | Return Circuit (E17) | fluid-line (low-pressure return) | unidirectional |
| R9 | Pressure Relief Valve (E12) | Return Circuit (E17) | fluid-line (low-pressure) | unidirectional |
| R10 | Return Circuit (E17) | Fuel Tank (E1) or Filter Housing (E4) | fluid-line | unidirectional |
| R11 | PCM (E13) | IMV (E8) | electrical-wire (PWM) | unidirectional |
| R12 | PCM (E13) | Injectors (E11a–h) | electrical-wire (PWM, dedicated driver per injector) | unidirectional |
| R13 | PCM (E13) | Lift Pump Relay (E14) | electrical-wire (relay control) | unidirectional |
| R14 | Lift Pump Relay (E14) | Lift Pump (E3) | electrical-wire (battery power switched) | unidirectional |
| R15 | FRP Sensor (E10) | PCM (E13) | electrical-wire (3-wire analog: 5V ref, signal, gnd) | unidirectional (signal to PCM; PCM provides 5V ref) |
| R16 | WIF Sensor (E5) | PCM (E13) | electrical-wire (signal) | unidirectional |
| R17 | Fuel Level Sender (E2) | Instrument Cluster (E15) or PCM (E13) | electrical-wire (resistive analog) — exact routing GAP | unidirectional |
| R18 | PCM (E13) | HS-CAN (E16) | can-bus | bidirectional |
| R19 | Instrument Cluster (E15) | HS-CAN (E16) | can-bus | bidirectional |
| R20 | ABS/TC Module (E18) | HS-CAN (E16) | can-bus | bidirectional |
| R21 | Engine Gear Train (E7) | CP4.2 (E6) | mechanical-linkage (gear drive) | unidirectional |
| R22 | PCM (E13) | DEF Dosing System (E20) | can-bus | bidirectional |
| R23 | DEF Tank (E19) | DEF Dosing System (E20) | fluid-line | unidirectional |

---

# 3. INFERRED

### I1 — LAW
**Fuel entering the CP4.2 must supply lubrication since no separate oil circuit exists; therefore fuel lubricity degradation from contamination, water, or off-spec biodiesel directly increases wear rate.**
Derivation: Conservation of material wear rate law — lubrication reduces friction and wear proportionally; when the sole lubricant is the process fluid and the lubricant quality degrades, wear rate increases per tribological law. (Source supports this explicitly; here tagged as LAW because it is a first-principles tribology consequence.)

### I2 — LOGIC
**The FRP sensor (E10) must have its 5V reference supplied by the PCM (E13), not an independent source, because the PCM is described as the sole fuel system controller performing closed-loop control using that sensor's signal.**
Derivation: Closed-loop control (LOGIC) — the controller that uses a sensor signal is the natural provider of its reference voltage in a direct-wired sensor architecture. The PCM is the only candidate described.

### I3 — LOGIC
**The IMV (E8) must have its PWM command originate at the PCM (E13) because the PCM is described as the only fuel system controller and the IMV is described as PCM-commanded.**
Derivation: Directly follows from "PCM is the only controller for all fuel-system actuators."

### I4 — LOGIC
**Each of the eight injectors must have at least one dedicated PCM driver circuit, and those circuits are distinct from the IMV driver circuit, because the narration explicitly states "dedicated injector driver circuits" and distinguishes injector control from IMV control.**
Derivation: Logical inference from explicit statement of dedicated per-injector drivers.

### I5 — LOGIC
**If the lift pump fails to run (relay or motor fault), the CP4.2 will be starved of adequate supply-side pressure, resulting in low or erratic rail pressure, because the CP4.2 depends on the lift pump for positive inlet feed pressure.**
Derivation: Hydraulic series-circuit logic — a failed supply stage starves the downstream high-pressure stage; this follows from the described series flow path.

### I6 — LAW
**Rail pressure cannot exceed the cracking pressure of the mechanical pressure relief valve(s) for more than a transient; beyond that threshold, the valve opens and returns fuel, capping maximum achievable rail pressure.**
Derivation: Conservation of pressure in a closed hydraulic circuit with a mechanical relief valve — the valve's cracking pressure is a hard upper bound by definition of pressure relief valves (hydraulic law).

### I7 — LOGIC
**The FRP sensor signal is the primary closed-loop feedback variable for IMV duty-cycle control; a failed or out-of-range FRP signal will cause the PCM to lose closed-loop control and either default to open-loop or set a fault, because the narration explicitly states the PCM uses FRP for closed-loop control via the IMV.**
Derivation: Logical consequence of closed-loop control architecture — loss of feedback causes loss of closed-loop regulation.

### I8 — PATTERN
**Typical for this class of Ford Power Stroke PCM architecture: the fuel level sender signal is received by the PCM (or a gateway module) and broadcast over CAN to the instrument cluster, rather than the sender being hard-wired directly to the cluster — this would explain the narration's statement that the cluster reads fuel level over CAN. Confirm against wiring diagram.**
Derivation: Typical for modern Ford multiplex architectures where gauge senders route through PCM or gateway, confirm.

### I9 — PATTERN
**Typical for 4th-gen Super Duty (2017–2019): the OBD-II diagnostic port is accessible below the driver-side instrument panel, providing access to HS-CAN at pins 6 and 14. Confirm against physical vehicle or Workshop Manual.**
Derivation: Standard OBD-II port placement pattern for Ford Super Duty, typical for this generation, confirm.

### I10 — PATTERN
**Typical for the Bosch CP4.2 in this application: a low-pressure supply of approximately 5–15 PSI at the CP4.2 inlet is expected from the lift pump circuit; values outside this range indicate lift pump or filter restriction issues. Exact Ford-calibrated specification not asserted — confirm against Ford Workshop Manual spec before using as a diagnostic threshold.**
Derivation: Typical for high-pressure common rail pump inlet requirements in this class; MEDIUM confidence, confirm before use.

### I11 — LOGIC
**The return circuit (E17) must terminate at either the fuel tank (E1) or the filter housing (E4) — not an open drain — because the system is a closed fuel circuit; diesel fuel cannot be discharged to atmosphere by design.**
Derivation: Closed-system conservation of mass — in a closed fuel circuit, return fuel must re-enter the system at some defined point.

### I12 — LOGIC
**Because the DEF system is PCM-controlled via CAN and DEF dosing interacts with combustion quality for emissions compliance, a DEF fault or depletion will trigger SCR-related fault codes broadcast on HS-CAN and visible via scan tool, even though DEF is not part of the fuel circuit.**
Derivation: Logical consequence of CAN-based PCM control architecture — faults in PCM-controlled subsystems produce CAN-broadcast fault codes.

### I13 — PATTERN
**Typical for 4th-generation Super Duty 6.7L Power Stroke: one FRP sensor per bank is common (one on each rail), but some calibrations use only one rail-mounted sensor with the second rail pressure inferred. Confirmation against vehicle-specific wiring diagram or Workshop Manual required — the narration only confirms "at least one."**
Derivation: Typical for this system class, confirm.

---

# 4. GAPS

## 4a. Full Gap Inventory by Entity

### Fuel Tank (E1)
- Housing/boundary opacity: not yet captured
- Observation methods for fuel level (physical, not via sender): not yet enumerable without opacity confirmed
- Observation methods for contamination/water pooled at tank bottom: not yet enumerable
- Exact tank capacity for this specific cab/bed configuration of the vehicle under analysis: not yet captured

### Fuel Level Sender (E2)
- Wire count: not yet captured
- Resistance range (empty to full): not yet captured
- Signal routing: whether signal goes directly to cluster or routes through PCM/gateway is not yet confirmed (see Inference I8)
- Float/arm condition observability method (beyond removal): not yet captured

### Lift Pump (E3)
- Electrical contract (voltage, current draw, connector type): not yet captured
- Output pressure spec / Ford minimum threshold: not yet captured
- Housing opacity: not yet captured

### Primary Fuel Filter / Water Separator (E4)
- Housing/boundary opacity: not yet captured
- OEM filter part number: not yet captured (expert explicitly flagged as unreliable from training data)
- Whether heated element / fuel line heater is installed on this specific vehicle: not yet captured
- Drain port / sample port existence and location: not yet captured

### WIF Sensor (E5)
- Wire count: not yet captured
- Signal type (analog voltage, discrete switch, frequency): not yet captured
- Electrical contract (pin assignments, signal levels): not yet captured

### CP4.2 (E6)
- PCM-calibrated maximum rail pressure for 2018 tune: not yet captured (expert flagged as requiring scan-tool confirmation)
- Housing opacity (expected opaque for metal pump body, but not formally stated in narration per REFUSAL PROTOCOL): not yet captured
- Inlet pressure specification / minimum acceptable from filter housing: not yet captured
- Non-destructive internal wear observation method: not yet captured (no valid method without disassembly)

### Engine Gear Train (E7)
- Drive ratio between crankshaft and CP4.2 shaft: not yet captured
- Timing relationship (phase): not yet captured

### IMV (E8)
- Wire count / connector pinout: not yet captured
- PWM frequency and duty-cycle operating range: not yet captured
- Coil resistance specification: not yet captured
- Mechanical position observability method without disassembly: not yet captured

### HP Fuel Rails (E9a/E9b)
- Per-bank physical location (which side = which bank): not yet captured
- Housing opacity: not yet captured
- Test port availability: not yet captured

### FRP Sensor (E10)
- Number of FRP sensors (one per rail or one total): not yet captured (narration says "at least one")
- Per-bank assignment: not yet captured
- Signal voltage range corresponding to pressure range: not yet captured
- Pin/wire color assignments: not yet captured

### Fuel Injectors (E11a–h)
- Cylinder-to-injector mapping (firing order / physical position): not yet captured
- Electrical contract details (voltage, peak/hold current, connector type, pin assignments): not yet captured
- Return line routing per injector: not yet captured
- Housing opacity: not yet captured

### Pressure Relief Valve (E12)
- Cracking pressure: not yet captured
- Number (one or two — one per rail or one total): not yet captured
- Rail assignment: not yet captured
- Housing opacity: not yet captured

### PCM (E13)
- Connector designations (C1, C2, C3 etc.) and total pin counts: not yet captured
- Software/calibration version: not yet captured
- Fuel level sender input pin (if routed to PCM): not yet captured

### Lift Pump Relay (E14)
- Exact junction box (BJB vs. SJB) and cavity/fuse designation: not yet captured
- Coil resistance: not yet captured
- Contact current rating: not yet captured

### Instrument Cluster (E15)
- Physical connector / pin assignments for any direct-wired inputs: not yet captured

### HS-CAN Bus (E16)
- OBD-II port physical location (implied standard, not stated): not yet captured per REFUSAL PROTOCOL without narration confirmation
- Termination resistor locations: not yet captured
- Bus topology (star vs. ring vs. line): not yet captured

### Return Circuit (E17)
- Exact termination point (tank vs. filter housing): not yet captured
- Routing / line sizes: not yet captured
- Housing opacity: not yet captured

### ABS/TC Module (E18)
- Physical location: not yet captured
- Connector details: not yet captured

### DEF Tank (E19)
- Housing opacity: not yet captured
- Capacity: not yet captured
- Sight glass presence: not yet captured

### DEF Dosing System (E20)
- Sub-component locations: not yet captured
- Electrical contracts for DEF pump, DEF injector, DEF sensor: not yet captured
- Full extraction deferred (outside primary fuel system scope per description)

---

## 4b. Ranked Question List (max 10)

**Q1.** For the FRP sensor: how many FRP sensors are installed on this specific truck — one total or one per rail (two total)? *(Unlocks: complete sensor topology, correct wiring diagram targeting, accurate test point count.)*

**Q2.** For the WIF sensor: how many wires, and what is the signal type — discrete switch (open/ground), analog voltage, or frequency? *(Unlocks: complete electrical contract for WIF circuit, valid pin-level test procedure.)*

**Q3.** For the return circuit: does the excess fuel return terminate at the fuel tank or at the filter housing? *(Unlocks: correct return circuit topology; affects contamination and pressure diagnostics.)*

**Q4.** For the lift pump: what is the Ford Workshop Manual specified output pressure range (minimum / nominal) at the CP4.2 inlet? *(Unlocks: quantitative pass/fail threshold for the most common low-rail-pressure root cause.)*

**Q5.** For the pressure relief valve: what is the factory cracking pressure, and is there one per rail or one total? *(Unlocks: overpressure diagnostic thresholds; ability to distinguish normal IMV/FRP behavior from relief valve involvement.)*

**Q6.** For the fuel level sender: does the signal wire route to the PCM (then CAN to cluster) or does it wire directly to the instrument cluster? *(Unlocks: correct circuit path for fuel gauge diagnosis; eliminates ambiguity in Inference I8.)*

**Q7.** Is a fuel line heater or heated fuel filter installed on this specific 2018 F-250 (check build sheet or underhood inspection)? *(Unlocks: whether a heater circuit and associated relay/sensor need to be included in cold-start diagnostics.)*

**Q8.** For the lift pump relay: is it in the BJB or the SJB, and what is the cavity designation on the 2018 F-250? *(Unlocks: ability to generate a correct relay pull/test procedure without sending a tech to the wrong box.)*

**Q9.** For the CP4.2: what is the PCM-calibrated maximum fuel rail pressure for the 2018 6.7L tune — confirm via scan tool under WOT or from Ford calibration documentation? *(Unlocks: quantitative upper-bound for rail pressure diagnostics; required for "rail pressure too high/low" fault triage.)*

**Q10.** For the fuel tank on this specific vehicle: what is the actual installed capacity (26, 34, or 48 gallons — dependent on cab/bed config)? *(Unlocks: correct fuel level sender resistance range mapping and runtime estimation for fuel starvation diagnostics.)*

---

**Ready. 20 entities captured. 13 inferences (1 LAW, 8 LOGIC, 4 PATTERN). 47 gaps remain. Top question: How many FRP sensors are installed — one total or one per rail?**

---

```json
{
  "components": [
    {
      "slug": "sd4-67psd-fuel-tank",
      "platform_slug": "ford-super-duty-4th-gen-67-psd",
      "name": "Fuel Tank",
      "kind": "mechanical",
      "electrical_contract": null,
      "location": "under the cab/frame",
      "function": "Stores diesel fuel; single tank, 26–48 gallons depending on cab/bed configuration; no factory dual-tank option on this generation",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-fuel-level-sender",
      "platform_slug": "ford-super-duty-4th-gen-67-psd",
      "name": "Fuel Level Sender",
      "kind": "sensor",
      "electrical_contract": "resistive analog (variable resistance); wire count and resistance range not yet captured",
      "location": "inside the fuel tank",
      "function": "Reads fuel level via float-and-resistor mechanism; outputs varying resistance signal for fuel gauge",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-lift-pump",
      "platform_slug": "ford-super-duty-4th-gen-67-psd",
      "name": "Electric Lift Pump",
      "kind": "pump",
      "electrical_contract": "electric motor; voltage, current draw, and connector type not yet captured",
      "location": "driver-side frame rail",
      "function": "Moves fuel from tank at low pressure forward to the filter/water separator and CP4.2 inlet",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-fuel-filter-ws",
      "platform_slug": "ford-super-duty-4th-gen-67-psd",
      "name": "Primary Fuel Filter and Water Separator Assembly",
      "kind": "mechanical",
      "electrical_contract": null,
      "location": "driver-side frame rail, downstream of lift pump",
      "function": "Removes particulate contamination and separates free water from diesel fuel before the high-pressure pump; houses the WIF sensor",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-wif-sensor",
      "platform_slug": "ford-super-duty-4th-gen-67-psd",
      "name": "Water-in-Fuel (WIF) Sensor",
      "kind": "sensor",
      "electrical_contract": "wire count and signal type (analog, discrete, or frequency) not yet captured",
      "location": "integrated into the primary fuel filter housing on the driver-side frame rail",
      "function": "Detects free water accumulation at the filter/separator and signals the PCM to trigger the WIF warning lamp",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-cp4-pump",
      "platform_slug": "ford-super-duty-4th-gen-67-psd",
      "name": "Bosch CP4.2 High-Pressure Fuel Pump",
      "kind": "pump",
      "electrical_contract": null,
      "location": "front of engine, gear-driven off front cover area",
      "function": "Raises fuel pressure from low-pressure supply to common rail operating pressure (up to ~29,000 PSI peak); internally lubricated entirely by diesel fuel with no separate oil circuit",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-engine-gear-train",
      "platform_slug": "ford-super-duty-4th-gen-67-psd",
      "name": "Engine Front Gear Train (CP4.2 Drive Interface)",
      "kind": "mechanical",
      "electrical_contract": null,
      "location": "front of engine, front cover area",
      "function": "Transmits engine crankshaft rotation to the CP4.2 high-pressure pump via gear drive",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-imv",
      "platform_slug": "ford-super-duty-4th-gen-67-psd",
      "name": "Inlet Metering Valve (IMV)",
      "kind": "valve",
      "electrical_contract": "PWM solenoid; normally open; wire count, PWM frequency, duty-cycle range, and coil resistance not yet captured",
      "location": "inside the CP4.2 pump body",
      "function": "Normally-open PWM-controlled solenoid that meters fuel quantity entering the CP4.2 high-pressure circuit under PCM closed-loop control",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-hp-rail-bank-a",
      "platform_slug": "ford-super-duty-4th-gen-67-psd",
      "name": "High-Pressure Fuel Rail (Bank A)",
      "kind": "mechanical",
      "electrical_contract": null,
      "location": "one cylinder bank; per-bank side (driver/passenger) not yet captured",
      "function": "Stores and distributes high-pressure fuel to four injectors on Bank A; acts as hydraulic accumulator to damp pressure fluctuations",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-hp-rail-bank-b",
      "platform_slug": "ford-super-duty-4th-gen-67-psd",
      "name": "High-Pressure Fuel Rail (Bank B)",
      "kind": "mechanical",
      "electrical_contract": null,
      "location": "opposite cylinder bank from Rail A; per-bank side not yet captured",
      "function": "Stores and distributes high-pressure fuel to four injectors on Bank B; acts as hydraulic accumulator to damp pressure fluctuations",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-frp-sensor",
      "platform_slug": "ford-super-duty-4th-gen-67-psd",
      "name": "Fuel Rail Pressure (FRP) Sensor",
      "kind": "sensor",
      "electrical_contract": "3-wire analog: 5V reference, analog voltage signal, ground",
      "location": "on the high-pressure fuel rail(s); exact number (one total or one per rail) not yet captured",
      "function": "Measures common rail fuel pressure and provides analog voltage feedback to the PCM for closed-loop IMV control",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-injector-1",
      "platform_slug": "ford-super-duty-4th-gen-67-psd",
      "name": "Fuel Injector (Cylinder 1)",
      "kind": "actuator",
      "electrical_contract": "high-voltage/high-current PWM via dedicated PCM driver circuit; voltage, current, and connector details not yet captured",
      "location": "cylinder 1; exact cylinder-to-bank mapping not yet captured",
      "function": "Solenoid-operated common rail injector; injects metered high-pressure fuel into combustion chamber on PCM command",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-injector-2",
      "platform_slug": "ford-super-duty-4th-gen-67-psd",
      "name": "Fuel Injector (Cylinder 2)",
      "kind": "actuator",
      "electrical_contract": "high-voltage/high-current PWM via dedicated PCM driver circuit; details not yet captured",
      "location": "cylinder 2; exact position not yet captured",
      "function": "Solenoid-operated common rail injector; injects metered high-pressure fuel into combustion chamber on PCM command",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-injector-3",
      "platform_slug": "ford-super-duty-4th-gen-67-psd",
      "name": "Fuel Injector (Cylinder 3)",
      "kind": "actuator",
      "electrical_contract": "high-voltage/high-current PWM via dedicated PCM driver circuit; details not yet captured",
      "location": "cylinder 3; exact position not yet captured",
      "function": "Solenoid-operated common rail injector; injects metered high-pressure fuel into combustion chamber on PCM command",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-injector-4",
      "platform_slug": "ford-super-duty-4th-gen-67-psd",
      "name": "Fuel Injector (Cylinder 4)",
      "kind": "actuator",
      "electrical_contract": "high-voltage/high-current PWM via dedicated PCM driver circuit; details not yet captured",
      "location": "cylinder 4; exact position not yet captured",
      "function": "Solenoid-operated common rail injector; injects metered high-pressure fuel into combustion chamber on PCM command",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-injector-5",
      "platform_slug": "ford-super-duty-4th-gen-67-psd",
      "name": "Fuel Injector (Cylinder 5)",
      "kind": "actuator",
      "electrical_contract": "high-voltage/high-current PWM via dedicated PCM driver circuit; details not yet captured",
      "location": "cylinder 5; exact position not yet captured",
      "function": "Solenoid-operated common rail injector; injects metered high-pressure fuel into combustion chamber on PCM command",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-injector-6",
      "platform_slug": "ford-super-duty-4th-gen-67-psd",
      "name": "Fuel Injector (Cylinder 6)",
      "kind": "actuator",
      "electrical_contract": "high-voltage/high-current PWM via dedicated PCM driver circuit; details not yet captured",
      "location": "cylinder 6; exact position not yet captured",
      "function": "Solenoid-operated common rail injector; injects metered high-pressure fuel into combustion chamber on PCM command",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-injector-7",
      "platform_slug": "ford-super-duty-4th-gen-67-psd",
      "name": "Fuel Injector (Cylinder 7)",
      "kind": "actuator",
      "electrical_contract": "high-voltage/high-current PWM via dedicated PCM driver circuit; details not yet captured",
      "location": "cylinder 7; exact position not yet captured",
      "function": "Solenoid-operated common rail injector; injects metered high-pressure fuel into combustion chamber on PCM command",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-injector-8",
      "platform_slug": "ford-super-duty-4th-gen-67-psd",
      "name": "Fuel Injector (Cylinder 8)",
      "kind": "actuator",
      "electrical_contract": "high-voltage/high-current PWM via dedicated PCM driver circuit; details not yet captured",
      "location": "cylinder 8; exact position not yet captured",
      "function": "Solenoid-operated common rail injector; injects metered high-pressure fuel into combustion chamber on PCM command",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-pressure-relief-valve",
      "platform_slug": "ford-super-duty-4th-gen-67-psd",
      "name": "Fuel Rail Mechanical Pressure Relief Valve",
      "kind": "valve",
      "electrical_contract": null,
      "location": "on the high-pressure fuel rail(s); whether one per rail or one total not yet captured",
      "function": "Passive mechanical overpressure protection; opens at factory-set cracking pressure to return fuel and prevent rail overpressure damage",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-pcm",
      "platform_slug": "ford-super-duty-4th-gen-67-psd",
      "name": "Powertrain Control Module (PCM)",
      "kind": "module",
      "electrical_contract": "connector designations and pin counts not yet captured",
      "location": "passenger-side firewall, engine compartment",
      "function": "Sole fuel system controller; commands IMV, injectors, and lift pump relay; performs closed-loop rail pressure control via FRP feedback; broadcasts fuel system PIDs on HS-CAN at 500 kbps",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-lift-pump-relay",
      "platform_slug": "ford-super-duty-4th-gen-67-psd",
      "name": "Lift Pump Relay",
      "kind": "actuator",
      "electrical_contract": "standard automotive relay (coil + contacts); cavity designation, coil resistance, and contact rating not yet captured",
      "location": "Battery Junction Box (BJB) or Smart Junction Box (SJB) in engine compartment; exact box and cavity not yet captured",
      "function": "Switches battery power to the electric lift pump on PCM command",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-instrument-cluster",
      "platform_slug": "ford-super-duty-4th-gen-67-psd",
      "name": "Instrument Cluster (IPC)",
      "kind": "module",
      "electrical_contract": null,
      "location": "instrument panel",
      "function": "Displays fuel level gauge and illuminates WIF warning lamp based on data received over HS-CAN from the PCM",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-hs-can-bus",
      "platform_slug": "ford-super-duty-4th-gen-67-psd",
      "name": "HS-CAN Bus",
      "kind": "connector",
      "electrical_contract": "CAN bus, 500 kbps; differential pair; accessible at OBD-II port pins 6 and 14 (PATTERN — confirm)",
      "location": "vehicle-wide network; OBD-II port location not explicitly stated in narration",
      "function": "High-speed network backbone carrying fuel system PIDs, WIF status, fuel level data, injector duty cycle, and torque management data between PCM, instrument cluster, and ABS/TC module",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-return-circuit",
      "platform_slug": "ford-super-duty-4th-gen-67-psd",
      "name": "Passive Low-Pressure Fuel Return Circuit",
      "kind": "mechanical",
      "electrical_contract": null,
      "location": "routes from injectors and/or pressure relief valve back to fuel tank or filter housing; exact routing not yet captured",
      "function": "Passive (no return pump) return of excess high-pressure fuel from injectors and pressure relief valve to the fuel circuit; termination point (tank vs. filter housing) not yet captured",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-abs-tc-module",
      "platform_slug": "ford-super-duty-4th-gen-67-psd",
      "name": "ABS / Traction Control Module",
      "kind": "module",
      "electrical_contract": null,
      "location": "not yet captured",
      "function": "Exchanges torque management data with PCM over HS-CAN; torque output depends on rail pressure and injection quantity",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-def-tank",
      "platform_slug": "ford-super-duty-4th-gen-67-psd",
      "name": "DEF Tank",
      "kind": "mechanical",
      "electrical_contract": null,
      "location": "passenger-side frame rail",
      "function": "Stores urea (DEF/AdBlue) solution for SCR dosing; separate from the diesel fuel circuit",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-def-dosing-system",
      "platform_slug": "ford-super-duty-4th-gen-67-psd",
      "name": "DEF Dosing System (DEF Pump, DEF Injector, DEF Level/Quality Sensor)",
      "kind": "actuator",
      "electrical_contract": "PCM-controlled via CAN; individual electrical contracts for pump, injector, and sensor not yet captured",
      "location": "not yet captured beyond association with passenger-side DEF tank",
      "function": "Meters and injects DEF into the exhaust stream upstream of the SCR catalyst for NOx reduction; interacts with fuel combustion quality for emissions compliance",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    }
  ],
  "observable_properties": [
    {
      "slug": "sd4-67psd-fuel-level-sender-signal-resistance",
      "component_slug": "sd4-67psd-fuel-level-sender",
      "description": "Variable resistance output of the fuel level sender at the harness connector, corresponding to fuel level",
      "observation_method": "electrical_measurement_at_pin",
      "housing_opacity_status": "unknown",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-lift-pump-op-status-pid",
      "component_slug": "sd4-67psd-lift-pump",
      "description": "Lift pump operational status (running/commanded on) as broadcast on HS-CAN and readable via scan tool PID",
      "observation_method": "scan_tool_pid",
      "housing_opacity_status": "unknown",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-lift-pump-audible",
      "component_slug": "sd4-67psd-lift-pump",
      "description": "Audible pump motor noise detectable at the driver-side frame rail when the lift pump is commanded on",
      "observation_method": "audible",
      "housing_opacity_status": "unknown",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-lift-pump-output-pressure",
      "component_slug": "sd4-67psd-lift-pump",
      "description": "Low-pressure fuel output pressure at the lift pump outlet or filter inlet fitting",
      "observation_method": "pressure_test_with_gauge",
      "housing_opacity_status": "unknown",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-lift-pump-supply-voltage",
      "component_slug": "sd4-67psd-lift-pump",
      "description": "Battery supply voltage delivered to the lift pump motor terminals via the relay",
      "observation_method": "electrical_measurement_at_pin",
      "housing_opacity_status": "unknown",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-fuel-filter-water-via-pid",
      "component_slug": "sd4-67psd-fuel-filter-ws",
      "description": "Water-in-fuel status at the filter/separator housing as reported by the WIF sensor through the PCM WIF status PID",
      "observation_method": "scan_tool_pid",
      "housing_opacity_status": "unknown",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-fuel-filter-element-condition",
      "component_slug": "sd4-67psd-fuel-filter-ws",
      "description": "Physical condition and contamination state of the fuel filter element when the housing is opened and the element is removed",
      "observation_method": "direct_visual_internal",
      "housing_opacity_status": "unknown",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-fuel-filter-restriction",
      "component_slug": "sd4-67psd-fuel-filter-ws",
      "description": "Filter restriction indicated by differential pressure between lift pump outlet and CP4.2 inlet",
      "observation_method": "pressure_test_with_gauge",
      "housing_opacity_status": "unknown",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-fuel-filter-water-drained",
      "component_slug": "sd4-67psd-fuel-filter-ws",
      "description": "Presence of water in the filter/separator bowl when the drain port is opened and contents are collected for visual inspection",
      "observation_method": "direct_visual_internal",
      "housing_opacity_status": "unknown",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-fuel-filter-fuel-smell",
      "component_slug": "sd4-67psd-fuel-filter-ws",
      "description": "Odor of drained fuel sample from the filter bowl indicating fuel quality or contamination",
      "observation_method": "smell",
      "housing_opacity_status": "unknown",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-wif-status-pid",
      "component_slug": "sd4-67psd-wif-sensor",
      "description": "WIF sensor status (water detected / not detected) as broadcast by the PCM on HS-CAN and readable via scan tool",
      "observation_method": "scan_tool_pid",
      "housing_opacity_status": "unknown",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-wif-signal-at-pcm-pin",
      "component_slug": "sd4-67psd-wif-sensor",
      "description": "WIF sensor signal voltage or state at the PCM connector pin",
      "observation_method": "electrical_measurement_at_pin",
      "housing_opacity_status": "unknown",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-wif-signal-at-sensor-connector",
      "component_slug": "sd4-67psd-wif-sensor",
      "description": "WIF sensor signal voltage or state at the sensor harness connector",
      "observation_method": "electrical_measurement_at_pin",
      "housing_opacity_status": "unknown",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-cp4-rail-pressure-pid",
      "component_slug": "sd4-67psd-cp4-pump",
      "description": "Fuel rail pressure delivered by the CP4.2 as reported by the FRP sensor PID on HS-CAN",
      "observation_method": "scan_tool_pid",
      "housing_opacity_status": "unknown",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-cp4-audible-noise",
      "component_slug": "sd4-67psd-cp4-pump",
      "description": "Abnormal knock or cavitation noise detectable at the CP4.2 pump body location at the front of the engine",
      "observation_method": "audible",
      "housing_opacity_status": "unknown",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-cp4-inlet-pressure",
      "component_slug": "sd4-67psd-cp4-pump",
      "description": "Low-pressure supply fuel pressure at the CP4.2 inlet fitting",
      "observation_method": "pressure_test_with_gauge",
      "housing_opacity_status": "unknown",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-imv-duty-cycle-pid",
      "component_slug": "sd4-67psd-imv",
      "description": "IMV commanded duty cycle as broadcast by the PCM on HS-CAN and readable via scan tool",
      "observation_method": "scan_tool_pid",
      "housing_opacity_status": "unknown",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-imv-pwm-waveform",
      "component_slug": "sd4-67psd-imv",
      "description": "PWM signal waveform at the IMV solenoid connector as commanded by the PCM",
      "observation_method": "waveform_capture",
      "housing_opacity_status": "unknown",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-imv-solenoid-resistance",
      "component_slug": "sd4-67psd-imv",
      "description": "IMV solenoid coil resistance measured at the connector (component electrical integrity check)",
      "observation_method": "electrical_measurement_at_pin",
      "housing_opacity_status": "unknown",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-hp-rail-a-pressure-pid",
      "component_slug": "sd4-67psd-hp-rail-bank-a",
      "description": "High-pressure fuel rail pressure in Bank A as reported via FRP sensor PID on HS-CAN",
      "observation_method": "scan_tool_pid",
      "housing_opacity_status": "unknown",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-hp-rail-a-external-leak",
      "component_slug": "sd4-67psd-hp-rail-bank-a",
      "description": "External fuel leak at rail body, end caps, or fitting connections, visible from outside the rail",
      "observation_method": "direct_visual_external",
      "housing_opacity_status": "unknown",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-hp-rail-b-pressure-pid",
      "component_slug": "sd4-67psd-hp-rail-bank-b",
      "description": "High-pressure fuel rail pressure in Bank B as reported via FRP sensor PID on HS-CAN",
      "observation_method": "scan_tool_pid",
      "housing_opacity_status": "unknown",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-hp-rail-b-external-leak",
      "component_slug": "sd4-67psd-hp-rail-bank-b",
      "description": "External fuel leak at Bank B rail body, end caps, or fitting connections",
      "observation_method": "direct_visual_external",
      "housing_opacity_status": "unknown",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-frp-rail-pressure-pid",
      "component_slug": "sd4-67psd-frp-sensor",
      "description": "Common rail fuel pressure value as reported by the FRP sensor and broadcast on HS-CAN",
      "observation_method": "scan_tool_pid",
      "housing_opacity_status": "unknown",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-frp-5v-ref-at-connector",
      "component_slug": "sd4-67psd-frp-sensor",
      "description": "5V reference voltage supplied by the PCM at the FRP sensor harness connector reference pin",
      "observation_method": "electrical_measurement_at_pin",
      "housing_opacity_status": "unknown",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-frp-signal-voltage-at-connector",
      "component_slug": "sd4-67psd-frp-sensor",
      "description": "Analog signal voltage output from the FRP sensor at the signal pin of the harness connector",
      "observation_method": "electrical_measurement_at_pin",
      "housing_opacity_status": "unknown",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-frp-ground-continuity",
      "component_slug": "sd4-67psd-frp-sensor",
      "description": "Ground circuit continuity at the FRP sensor harness connector ground pin",
      "observation_method": "electrical_measurement_at_pin",
      "housing_opacity_status": "unknown",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-frp-signal-waveform",
      "component_slug": "sd4-67psd-frp-sensor",
      "description": "FRP sensor signal voltage waveform under dynamic engine load conditions (e.g., cranking, idle, WOT ramp)",
      "observation_method": "waveform_capture",
      "housing_opacity_status": "unknown",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-injector-pwm-waveform",
      "component_slug": "sd4-67psd-injector-1",
      "description": "High-voltage/high-current PWM waveform at the injector solenoid connector during engine operation (representative for all 8 injectors; capture per cylinder for individual diagnosis)",
      "observation_method": "waveform_capture",
      "housing_opacity_status": "unknown",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-injector-duty-cycle-pid",
      "component_slug": "sd4-67psd-injector-1",
      "description": "Injector commanded duty cycle or pulse width for each cylinder as reported via scan tool PID on HS-CAN",
      "observation_method": "scan_tool_pid",
      "housing_opacity_status": "unknown",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-injector-solenoid-resistance",
      "component_slug": "sd4-67psd-injector-1",
      "description": "Injector solenoid coil resistance at the injector harness connector (per cylinder)",
      "observation_method": "electrical_measurement_at_pin",
      "housing_opacity_status": "unknown",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-injector-audible-tick",
      "component_slug": "sd4-67psd-injector-1",
      "description": "Audible injector tick at the cylinder head; character change (rattle, knock, absence) indicates injector fault",
      "observation_method": "audible",
      "housing_opacity_status": "unknown",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-injector-external-leak",
      "component_slug": "sd4-67psd-injector-1",
      "description": "External fuel leak at the injector body, O-rings, or return fittings, visible from outside",
      "observation_method": "direct_visual_external",
      "housing_opacity_status": "unknown",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-prv-rail-pressure-drop-pid",
      "component_slug": "sd4-67psd-pressure-relief-valve",
      "description": "Abnormal rail pressure bleed-down indicating relief valve opening, visible as a rapid pressure drop in the FRP PID trace",
      "observation_method": "scan_tool_pid",
      "housing_opacity_status": "unknown",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-prv-external-leak",
      "component_slug": "sd4-67psd-pressure-relief-valve",
      "description": "External fuel leak at the pressure relief valve seat or body",
      "observation_method": "direct_visual_external",
      "housing_opacity_status": "unknown",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-prv-internal-condition",
      "component_slug": "sd4-67psd-pressure-relief-valve",
      "description": "Mechanical condition of the pressure relief valve seat and spring when removed from the rail",
      "observation_method": "direct_visual_internal",
      "housing_opacity_status": "removable",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-pcm-fuel-pids",
      "component_slug": "sd4-67psd-pcm",
      "description": "PCM-broadcast fuel system PIDs (rail pressure, lift pump status, injector duty cycle, WIF status, ICP) readable via scan tool over HS-CAN",
      "observation_method": "scan_tool_pid",
      "housing_opacity_status": "unknown",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-pcm-connector-voltages",
      "component_slug": "sd4-67psd-pcm",
      "description": "Power supply, ground, and signal pin voltages at the PCM harness connector(s)",
      "observation_method": "electrical_measurement_at_pin",
      "housing_opacity_status": "unknown",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-pcm-can-waveform",
      "component_slug": "sd4-67psd-pcm",
      "description": "HS-CAN differential bus signal quality at the PCM connector CAN-H and CAN-L pins",
      "observation_method": "waveform_capture",
      "housing_opacity_status": "unknown",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-relay-seating-visual",
      "component_slug": "sd4-67psd-lift-pump-relay",
      "description": "Physical presence and seating of the lift pump relay in its junction box cavity, visible with the junction box cover removed",
      "observation_method": "direct_visual_external",
      "housing_opacity_status": "removable",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-relay-coil-voltage",
      "component_slug": "sd4-67psd-lift-pump-relay",
      "description": "Voltage at the relay coil control circuit terminal (PCM command side) and battery supply terminal",
      "observation_method": "electrical_measurement_at_pin",
      "housing_opacity_status": "removable",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-relay-click-audible",
      "component_slug": "sd4-67psd-lift-pump-relay",
      "description": "Audible click of the relay actuating when the PCM commands it on (detectable at the BJB or SJB with hood open)",
      "observation_method": "audible",
      "housing_opacity_status": "removable",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-cluster-fuel-gauge-visual",
      "component_slug": "sd4-67psd-instrument-cluster",
      "description": "Fuel level gauge needle position as displayed on the instrument cluster face",
      "observation_method": "direct_visual_external",
      "housing_opacity_status": "transparent",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-cluster-wif-lamp-visual",
      "component_slug": "sd4-67psd-instrument-cluster",
      "description": "WIF warning lamp illumination state on the instrument cluster face",
      "observation_method": "direct_visual_external",
      "housing_opacity_status": "transparent",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-can-fuel-pids-obd",
      "component_slug": "sd4-67psd-hs-can-bus",
      "description": "All fuel system PIDs (rail pressure, injector duty, WIF status, lift pump status) readable via scan tool connected to the HS-CAN at the OBD-II port",
      "observation_method": "scan_tool_pid",
      "housing_opacity_status": null,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-can-signal-waveform",
      "component_slug": "sd4-67psd-hs-can-bus",
      "description": "HS-CAN differential signal quality (CAN-H / CAN-L waveform) at OBD-II pins 6 and 14 or at module connectors",
      "observation_method": "waveform_capture",
      "housing_opacity_status": null,
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "sd4-67psd-return-circuit-external-leak",
      "component_slug": "sd4-67psd-return-circuit",
      "description": "External fuel leak along the return line routing, visible from outside the line",
      "observation_method": "direct_visual_external",
      "housing_opacity_status": "unknown",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-return-circuit-backpressure",
      "component_slug": "sd4-67psd-return-circuit",
      "description": "Return line back-pressure at the injector return fitting, measurable with a gauge to detect downstream restriction",
      "observation_method": "pressure_test_with_gauge",
      "housing_opacity_status": "unknown",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-def-level-quality-pid",
      "component_slug": "sd4-67psd-def-tank",
      "description": "DEF fluid level and quality as broadcast by the PCM on HS-CAN and readable via scan tool PID",
      "observation_method": "scan_tool_pid",
      "housing_opacity_status": "unknown",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    }
  ],
  "component_connections": [
    {
      "from_component_slug": "sd4-67psd-fuel-tank",
      "to_component_slug": "sd4-67psd-lift-pump",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "Low-pressure fuel supply from tank to lift pump inlet",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-lift-pump",
      "to_component_slug": "sd4-67psd-fuel-filter-ws",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "Low-pressure pressurized fuel from lift pump to filter/water separator inlet",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-fuel-filter-ws",
      "to_component_slug": "sd4-67psd-cp4-pump",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "Filtered low-pressure fuel from filter housing to CP4.2 inlet",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-cp4-pump",
      "to_component_slug": "sd4-67psd-hp-rail-bank-a",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "High-pressure fuel from CP4.2 outlet to Bank A fuel rail",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-cp4-pump",
      "to_component_slug": "sd4-67psd-hp-rail-bank-b",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "High-pressure fuel from CP4.2 outlet to Bank B fuel rail",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-hp-rail-bank-a",
      "to_component_slug": "sd4-67psd-injector-1",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "High-pressure fuel from Bank A rail to injector 1",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-hp-rail-bank-a",
      "to_component_slug": "sd4-67psd-injector-2",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "High-pressure fuel from Bank A rail to injector 2",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-hp-rail-bank-a",
      "to_component_slug": "sd4-67psd-injector-3",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "High-pressure fuel from Bank A rail to injector 3",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-hp-rail-bank-a",
      "to_component_slug": "sd4-67psd-injector-4",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "High-pressure fuel from Bank A rail to injector 4",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-hp-rail-bank-b",
      "to_component_slug": "sd4-67psd-injector-5",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "High-pressure fuel from Bank B rail to injector 5",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-hp-rail-bank-b",
      "to_component_slug": "sd4-67psd-injector-6",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "High-pressure fuel from Bank B rail to injector 6",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-hp-rail-bank-b",
      "to_component_slug": "sd4-67psd-injector-7",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "High-pressure fuel from Bank B rail to injector 7",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-hp-rail-bank-b",
      "to_component_slug": "sd4-67psd-injector-8",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "High-pressure fuel from Bank B rail to injector 8",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-injector-1",
      "to_component_slug": "sd4-67psd-return-circuit",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "Excess high-pressure fuel return from injector 1 to passive return circuit",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-injector-2",
      "to_component_slug": "sd4-67psd-return-circuit",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "Excess high-pressure fuel return from injector 2 to passive return circuit",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-injector-3",
      "to_component_slug": "sd4-67psd-return-circuit",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "Excess high-pressure fuel return from injector 3 to passive return circuit",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-injector-4",
      "to_component_slug": "sd4-67psd-return-circuit",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "Excess high-pressure fuel return from injector 4 to passive return circuit",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-injector-5",
      "to_component_slug": "sd4-67psd-return-circuit",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "Excess high-pressure fuel return from injector 5 to passive return circuit",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-injector-6",
      "to_component_slug": "sd4-67psd-return-circuit",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "Excess high-pressure fuel return from injector 6 to passive return circuit",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-injector-7",
      "to_component_slug": "sd4-67psd-return-circuit",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "Excess high-pressure fuel return from injector 7 to passive return circuit",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-injector-8",
      "to_component_slug": "sd4-67psd-return-circuit",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "Excess high-pressure fuel return from injector 8 to passive return circuit",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-pressure-relief-valve",
      "to_component_slug": "sd4-67psd-return-circuit",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "Fuel diverted from rail by pressure relief valve into the passive return circuit when cracking pressure is exceeded",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-return-circuit",
      "to_component_slug": "sd4-67psd-fuel-tank",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "Return fuel routed back to the fuel tank OR filter housing (exact termination point not yet captured — GAP); shown here as tank per narration listing tank first",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-pcm",
      "to_component_slug": "sd4-67psd-imv",
      "connection_kind": "controlled_by",
      "direction": "unidirectional",
      "description": "PCM commands IMV via high-frequency PWM electrical signal to meter fuel entering CP4.2 high-pressure circuit",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-pcm",
      "to_component_slug": "sd4-67psd-injector-1",
      "connection_kind": "controlled_by",
      "direction": "unidirectional",
      "description": "PCM drives injector 1 via dedicated high-voltage/high-current PWM injector driver circuit",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-pcm",
      "to_component_slug": "sd4-67psd-injector-2",
      "connection_kind": "controlled_by",
      "direction": "unidirectional",
      "description": "PCM drives injector 2 via dedicated high-voltage/high-current PWM injector driver circuit",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-pcm",
      "to_component_slug": "sd4-67psd-injector-3",
      "connection_kind": "controlled_by",
      "direction": "unidirectional",
      "description": "PCM drives injector 3 via dedicated high-voltage/high-current PWM injector driver circuit",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-pcm",
      "to_component_slug": "sd4-67psd-injector-4",
      "connection_kind": "controlled_by",
      "direction": "unidirectional",
      "description": "PCM drives injector 4 via dedicated high-voltage/high-current PWM injector driver circuit",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-pcm",
      "to_component_slug": "sd4-67psd-injector-5",
      "connection_kind": "controlled_by",
      "direction": "unidirectional",
      "description": "PCM drives injector 5 via dedicated high-voltage/high-current PWM injector driver circuit",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-pcm",
      "to_component_slug": "sd4-67psd-injector-6",
      "connection_kind": "controlled_by",
      "direction": "unidirectional",
      "description": "PCM drives injector 6 via dedicated high-voltage/high-current PWM injector driver circuit",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-pcm",
      "to_component_slug": "sd4-67psd-injector-7",
      "connection_kind": "controlled_by",
      "direction": "unidirectional",
      "description": "PCM drives injector 7 via dedicated high-voltage/high-current PWM injector driver circuit",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-pcm",
      "to_component_slug": "sd4-67psd-injector-8",
      "connection_kind": "controlled_by",
      "direction": "unidirectional",
      "description": "PCM drives injector 8 via dedicated high-voltage/high-current PWM injector driver circuit",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-pcm",
      "to_component_slug": "sd4-67psd-lift-pump-relay",
      "connection_kind": "controlled_by",
      "direction": "unidirectional",
      "description": "PCM commands the lift pump relay coil to switch battery power to the lift pump",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-lift-pump-relay",
      "to_component_slug": "sd4-67psd-lift-pump",
      "connection_kind": "electrical-wire",
      "direction": "unidirectional",
      "description": "Relay contact supplies switched battery voltage to the electric lift pump motor",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-frp-sensor",
      "to_component_slug": "sd4-67psd-pcm",
      "connection_kind": "reports_to",
      "direction": "unidirectional",
      "description": "FRP sensor outputs 3-wire analog signal (5V ref from PCM, analog signal return, ground) to PCM for closed-loop rail pressure control",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-wif-sensor",
      "to_component_slug": "sd4-67psd-pcm",
      "connection_kind": "reports_to",
      "direction": "unidirectional",
      "description": "WIF sensor signals water presence in the filter housing to the PCM via an electrical signal (signal type not yet captured)",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-fuel-level-sender",
      "to_component_slug": "sd4-67psd-pcm",
      "connection_kind": "reports_to",
      "direction": "unidirectional",
      "description": "Fuel level sender resistive analog signal routes to PCM (or possibly directly to cluster — routing is a captured GAP; shown here per PATTERN inference I8)",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "from_component_slug": "sd4-67psd-pcm",
      "to_component_slug": "sd4-67psd-hs-can-bus",
      "connection_kind": "can-bus",
      "direction": "bidirectional",
      "description": "PCM communicates on HS-CAN at 500 kbps; broadcasts fuel system PIDs and receives torque management data",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-instrument-cluster",
      "to_component_slug": "sd4-67psd-hs-can-bus",
      "connection_kind": "can-bus",
      "direction": "bidirectional",
      "description": "Instrument cluster receives fuel level and WIF status data from PCM over HS-CAN to drive fuel gauge and WIF warning lamp",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-abs-tc-module",
      "to_component_slug": "sd4-67psd-hs-can-bus",
      "connection_kind": "can-bus",
      "direction": "bidirectional",
      "description": "ABS/TC module exchanges torque management data with PCM over HS-CAN; torque output depends on rail pressure and injection quantity",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-engine-gear-train",
      "to_component_slug": "sd4-67psd-cp4-pump",
      "connection_kind": "mechanical-linkage",
      "direction": "unidirectional",
      "description": "Engine front gear train drives the CP4.2 high-pressure pump via gear mesh at the front cover",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-pcm",
      "to_component_slug": "sd4-67psd-def-dosing-system",
      "connection_kind": "can-bus",
      "direction": "bidirectional",
      "description": "PCM controls DEF dosing system and receives DEF level/quality sensor data via CAN",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-def-tank",
      "to_component_slug": "sd4-67psd-def-dosing-system",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "DEF fluid supplied from DEF tank to DEF pump/dosing module",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    }
  ]
}
```