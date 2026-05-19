# Run 4 — F-250 Cooling System P2

## Section 1 — Decomposition narrative

### Coolant circulation core

The cooling circuit centers on three inseparable mechanical entities: the **surge tank** (system high point, fill point, and pressure cap location), the **gear-driven water pump** (driven off the engine front geartrain — reference existing `sd4-67psd-engine-gear-train`), and the **dual-thermostat housing** (a 2017-2022 platform-specific assembly with two thermostats controlling bypass vs. full-radiator flow). These three define the circuit topology. The water pump has no electrical contract whatsoever — it is purely mechanical and observable only by flow evidence, pressure, and audible/tactile inspection. The thermostat housing is similarly all-mechanical, with no electrical wiring; its state is inferred entirely through ECT behavior and coolant temperature rise curves on the scan tool.

The **upper and lower radiator hoses** are explicit fluid-line segments that connect the thermostat housing outlet to the radiator and the radiator return to the water pump inlet. Emitting them as distinct components gives diagnostics a named surface for pressure-testing and tactile inspection.

### Temperature sensing

A single **primary ECT sensor** (two-wire NTC thermistor, 5V reference from PCM) sits near the thermostat housing and is the PCM's primary feedback for warmup enrichment, EGR enable, fan control, and torque limits. It reports to the existing `sd4-67psd-pcm` via a `reports_to` edge. A **secondary cylinder head temperature (CHT) sensor** is a confirmed gap — the narrative acknowledges it may exist on 2018 but exact location, wire count, and distinctness are unconfirmed. It is emitted as a GAP component rather than omitted, so the diagnostic engine can represent the uncertainty.

### Radiator and fans

The **radiator** (large aluminum cross-flow unit, no serviceable cap at top tank) connects to the thermostat housing outlet via the upper hose and to the water pump inlet via the lower hose. Fan cooling splits across two mechanisms: the **viscous clutch fan** (purely mechanical, driven off the water pump hub or geartrain fan shaft — no electrical contract) and the **auxiliary electric fan assembly** (PCM-controlled via relay or fan control module). The exact electric fan control strategy (relay on/off vs. PWM) is a confirmed gap; the component is emitted with a GAP note on the electrical contract details.

The **electric fan relay / fan control module** is emitted as a distinct actuator/module because it is the PCM's control point. Whether it is a simple relay or a dedicated module is a gap, but the node must exist in the connection graph so the `controlled_by` edge from PCM to fan can be properly modeled.

### EGR cooler subsystem

The **EGR cooler** is a shell-and-tube or brazed-plate heat exchanger plumbed in parallel with the main circuit (passenger-side engine valley). It receives coolant from the main loop and routes it around exhaust gases. It is emitted here (cooling run) since it is primarily a coolant-loop component; the air system run will reference this slug. The **EGR cooler bypass valve** is a distinct PCM-controlled actuator that routes exhaust either through or around the cooler. It has an electrical contract (PCM-commanded actuator) and is observable via scan tool PID and waveform capture.

### Heater core

The **heater core** is plumbed in the bypass (small) loop — it receives coolant regardless of thermostat state, actively assisting warmup. It connects to the engine via **heater supply and return hoses** through the passenger-side firewall. The exact engine-side connection points (tee location) are a confirmed gap. The heater core itself has no electrical contract; it is a passive fluid heat exchanger, with cabin-side airflow management handled by HVAC blend doors (out of scope for this run).

### Coolant level sensor

The **coolant level sensor** on the surge tank is a two-wire binary switch (float or resistive) that signals low-coolant status to the BCM or PCM, which propagates a warning to the instrument cluster. Whether it reports to PCM or BCM directly is a training-inferred gap — emitted as TRAINING-INFERRED with inference_class PATTERN. The connection is modeled as `reports_to` the PCM (most likely control authority), with a note that BCM routing is unconfirmed.

### Block heater

The **block heater** is a 120V AC immersion element threaded into the engine block coolant passage. It has no PCM interface, no relay, no CAN bus presence. It is connected only to AC shore power via the external cord. It warms coolant by convection. Observable only by tactile (block warmth after plug-in) and direct visual (cord present/plugged). No scan-tool observable.

---

### Connection topology summary

- Water pump ← mechanical-linkage ← engine gear train (existing component)
- Water pump → fluid-line → engine block/heads (aggregate "engine coolant passages" node)
- Engine coolant passages → fluid-line → thermostat housing inlet
- Thermostat housing → fluid-line → radiator upper hose → radiator (full-loop, thermostat open)
- Thermostat housing → fluid-line → bypass loop (heater core supply, EGR cooler supply — thermostat closed)
- Radiator → fluid-line → lower radiator hose → water pump inlet
- ECT sensor → reports_to → PCM (existing)
- PCM → controlled_by inverse: PCM commands electric fan relay, EGR cooler bypass valve
- Coolant level sensor → reports_to → PCM (inferred)
- PCM → controlled_by → electric fan relay
- Electric fan relay → controlled_by → electric fan assembly
- Viscous clutch fan ← mechanical-linkage ← water pump hub / geartrain
- Surge tank → fluid-line → engine block (system fill/reference path)
- EGR cooler ← fluid-line ← main coolant loop (parallel branch)
- EGR cooler bypass valve ← controlled_by ← PCM
- Heater core ← fluid-line ← heater supply hose ← engine bypass loop
- Block heater: no PCM or CAN connection; 120V AC only

---

## Section 2 — JSON sidecar

```json
{
  "components": [
    {
      "slug": "sd4-67psd-surge-tank",
      "name": "Coolant Surge / Degas Tank",
      "kind": "mechanical",
      "electrical_contract": "two-wire coolant level sensor integrated or externally mounted; pressure cap rated value not yet confirmed (GAP)",
      "location": "passenger side of engine bay, elevated above engine",
      "function": "System high point, sole fill point, air purge point, and pressure cap location for the closed-loop cooling system. Doubles as reference volume for coolant level monitoring.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-water-pump",
      "name": "Mechanical Water Pump (Gear-Driven)",
      "kind": "pump",
      "electrical_contract": null,
      "location": "front of engine, driven off engine front geartrain cover area",
      "function": "Circulates coolant through the entire cooling circuit. Flow rate scales proportionally with engine RPM. No belt drive, no electric assist, no electrical wiring.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-thermostat-housing",
      "name": "Dual-Thermostat Housing Assembly",
      "kind": "valve",
      "electrical_contract": null,
      "location": "front/top of engine",
      "function": "Houses two thermostats in one assembly. Controls transition between bypass (small) loop and full radiator loop. When both thermostats closed: coolant bypasses radiator. Primary thermostat opens at approx 189°F (87°C) to route coolant to radiator. Serviced as complete housing assembly.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-ect-sensor",
      "name": "Engine Coolant Temperature (ECT) Sensor — Primary",
      "kind": "sensor",
      "electrical_contract": "two-wire NTC thermistor; pin 1: 5V reference from PCM; pin 2: signal return (ground). Resistance decreases as temperature rises. Analog voltage output. Exact pin assignments not yet captured.",
      "location": "coolant passage near thermostat housing, front of engine",
      "function": "Provides coolant temperature analog voltage to PCM. Primary input for cold-start enrichment, injection timing, EGR enable/disable threshold, cooling fan activation, idle speed, and torque derating.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "sd4-67psd-cht-sensor",
      "name": "Cylinder Head Temperature (CHT) / Secondary ECT Sensor",
      "kind": "sensor",
      "electrical_contract": "wire count, pin assignments, and signal type not yet confirmed (GAP)",
      "location": "cylinder head — exact position not yet confirmed (GAP)",
      "function": "Possible secondary thermal monitoring sensor for cylinder head temperature or redundant ECT position. Existence as a distinct sensor on 2018 build is not confirmed in training data.",
      "source_provenance": "GAP",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-radiator",
      "name": "Primary Radiator (Aluminum Cross-Flow)",
      "kind": "mechanical",
      "electrical_contract": null,
      "location": "front of vehicle, behind grille",
      "function": "Primary heat rejection unit for engine coolant. Large-format aluminum cross-flow core sized for diesel towing loads. Upper tank connects via upper radiator hose from thermostat housing; lower tank returns via lower radiator hose to water pump inlet. No serviceable pressure cap at top tank (cap is on surge tank only). Incorporates transmission cooler ports (out of scope this run).",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-upper-radiator-hose",
      "name": "Upper Radiator Hose",
      "kind": "connector",
      "electrical_contract": null,
      "location": "engine bay, from thermostat housing outlet to radiator upper tank",
      "function": "Carries hot coolant from thermostat housing outlet to radiator upper tank when primary thermostat is open. Full-loop flow path segment.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-lower-radiator-hose",
      "name": "Lower Radiator Hose",
      "kind": "connector",
      "electrical_contract": null,
      "location": "engine bay, from radiator lower tank to water pump inlet",
      "function": "Returns cooled coolant from radiator lower tank back to water pump inlet, completing the main radiator loop.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-viscous-fan-clutch",
      "name": "Viscous Clutch Fan",
      "kind": "mechanical",
      "electrical_contract": null,
      "location": "front of engine, mounted on water pump hub or geartrain-driven fan shaft",
      "function": "Primary mechanical cooling fan. Silicone-fluid viscous coupling engages proportionally to temperature rise and disengages partially at highway speed to reduce parasitic drag. No PCM control; purely thermomechanical.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-electric-fan-assembly",
      "name": "Auxiliary Electric Cooling Fan Assembly",
      "kind": "actuator",
      "electrical_contract": "PCM-commanded via relay or fan control module. Single-speed relay vs. PWM variable-speed strategy not yet confirmed for 2018 MY (GAP). 12V DC motor(s). Exact connector pin count not yet captured.",
      "location": "radiator shroud, front of radiator",
      "function": "Supplemental electric fan providing airflow at low vehicle speed, high ECT, A/C condenser demand, and hot-restart soak. Activates independently of viscous clutch fan.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-electric-fan-relay-module",
      "name": "Electric Fan Relay / Fan Control Module",
      "kind": "module",
      "electrical_contract": "PCM command input (digital switched or PWM signal — not yet confirmed). 12V battery feed. Fan motor output. Exact module location, connector, and pin count not yet captured (GAP).",
      "location": "underhood fuse/relay center or inline relay — exact location not yet confirmed",
      "function": "Intermediary control node between PCM and electric fan assembly. Receives PCM command and switches/modulates power to the fan motor(s). May be a simple relay (on/off) or a dedicated PWM fan control module depending on 2018 build.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-egr-cooler",
      "name": "EGR Cooler (Exhaust Gas Recirculation Cooler)",
      "kind": "mechanical",
      "electrical_contract": null,
      "location": "engine valley, passenger side, upper area",
      "function": "Shell-and-tube or brazed-plate heat exchanger plumbed in parallel with main coolant circuit. Engine coolant flows through cooler to remove heat from recirculated exhaust gas before it enters intake manifold. High-failure-rate component on all 6.7L PSD generations. Internal failure contaminates coolant with exhaust byproducts or allows coolant to enter exhaust stream.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-egr-cooler-bypass-valve",
      "name": "EGR Cooler Bypass Valve",
      "kind": "valve",
      "electrical_contract": "PCM-controlled actuator. Exact solenoid/motor type, connector pin count, and operating voltage not yet confirmed. Expected: 12V DC solenoid or stepper. Exact pin assignments not yet captured.",
      "location": "adjacent to EGR cooler in engine valley, passenger side",
      "function": "Routes exhaust gas around (bypassing) the EGR cooler during cold starts to prevent condensation and accelerate warmup. Opens to route exhaust through cooler once coolant reaches operating temperature. A stuck-open fault reduces EGR cooling efficiency at operating temp and may set a P-code.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-heater-core",
      "name": "Heater Core",
      "kind": "mechanical",
      "electrical_contract": null,
      "location": "HVAC module behind dashboard, passenger side",
      "function": "Small heat exchanger in the bypass (small) coolant loop. Receives coolant flow whether or not thermostat is open to radiator, actively assisting engine warmup from cold start. Supplies heat to cabin via blower-forced air over the core. Failure symptoms: no cabin heat, sweet coolant odor in cabin, foggy windshield, coolant on passenger-side floor mat.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-heater-hoses",
      "name": "Heater Core Supply and Return Hoses",
      "kind": "connector",
      "electrical_contract": null,
      "location": "passenger-side firewall penetration; engine-side connection points not yet confirmed (GAP)",
      "function": "Supply hose carries hot coolant from engine bypass loop to heater core; return hose routes cooled coolant back to engine circuit. Both pass through passenger-side firewall. Exact engine-side tee/port locations not confirmed in training data.",
      "source_provenance": "GAP",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-coolant-level-sensor",
      "name": "Coolant Level Sensor (Surge Tank)",
      "kind": "sensor",
      "electrical_contract": "two-wire binary switched signal (float-type or resistive switch). Signal reports to PCM or BCM — exact control authority not confirmed (TRAINING-INFERRED). Low-coolant threshold only; not a continuous level gauge.",
      "location": "integrated into or externally mounted on surge tank",
      "function": "Binary low/not-low coolant level detection. Triggers low-coolant warning lamp in instrument cluster when coolant drops below minimum threshold.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "sd4-67psd-block-heater",
      "name": "Engine Block Heater (120V AC Immersion Element)",
      "kind": "actuator",
      "electrical_contract": "120V AC shore power direct connection. No PCM interface, no relay, no CAN bus. Always-on when plugged in. External cord exits through front bumper/grille area.",
      "location": "engine block coolant passage (driver side, threaded into block drain port or freeze plug location)",
      "function": "Warms coolant in the engine block by immersion heating when connected to AC shore power. Heat spreads through cooling circuit by convection. Factory option; may be standard on cold-climate build configurations. Not PCM-controlled.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    }
  ],
  "observable_properties": [
    {
      "slug": "sd4-67psd-ect-pid-coolant-temp",
      "component_slug": "sd4-67psd-ect-sensor",
      "description": "ECT sensor coolant temperature value in degrees F/C as reported to PCM. Used to confirm warmup curve, thermostat opening point, and overheating/overcooling DTCs. Normal operating range approximately 185-210°F at steady state.",
      "observation_method": "scan_tool_pid",
      "housing_opacity_status": "opaque",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-ect-voltage-at-pin",
      "component_slug": "sd4-67psd-ect-sensor",
      "description": "Analog voltage at ECT signal pin relative to PCM 5V reference. Cold engine (~68°F): ~3.5-4.0V. Hot engine (~200°F): ~0.5-1.0V. Out-of-range high (stuck low: open circuit) or stuck low (short to ground) confirms sensor or wiring fault.",
      "observation_method": "electrical_measurement_at_pin",
      "housing_opacity_status": "opaque",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "sd4-67psd-ect-waveform-warmup",
      "component_slug": "sd4-67psd-ect-sensor",
      "description": "ECT warmup curve waveform on scan tool graphing. Healthy: smooth monotonic rise from ambient to operating temp, with a visible plateau at thermostat opening point (~189°F). A stall in rise curve below operating temp indicates thermostat stuck closed or low coolant. A flat line at ambient suggests open circuit.",
      "observation_method": "waveform_capture",
      "housing_opacity_status": "opaque",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-surge-tank-level-visual",
      "component_slug": "sd4-67psd-surge-tank",
      "description": "Coolant level visible through surge tank translucent body (if applicable) or via MIN/MAX markings on tank exterior. Direct visual confirmation of low, normal, or overfill condition.",
      "observation_method": "direct_visual_external",
      "housing_opacity_status": "partial",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-surge-tank-coolant-condition",
      "component_slug": "sd4-67psd-surge-tank",
      "description": "Coolant color, clarity, and odor at surge tank fill opening. Healthy: orange/yellow OAT or green/yellow HOAT, clean, no foam, no oily film, no black/soot contamination. EGR cooler failure: black/sooty coolant, foam, possible hydrocarbon odor.",
      "observation_method": "direct_visual_internal",
      "housing_opacity_status": "partial",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-surge-tank-foam-smell",
      "component_slug": "sd4-67psd-surge-tank",
      "description": "Coolant foaming in surge tank or combustion/exhaust odor from coolant — both are indicators of internal EGR cooler failure or head gasket breach. Observable when tank cap is removed (engine cold only, never hot).",
      "observation_method": "smell",
      "housing_opacity_status": "partial",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-surge-tank-pressure-test",
      "component_slug": "sd4-67psd-surge-tank",
      "description": "Pressure test of cooling system via surge tank cap port. System should hold rated cap pressure (exact PSI not yet confirmed — GAP) for minimum 2 minutes with no drop. Pressure drop indicates external leak, internal leak (EGR cooler), or head gasket failure.",
      "observation_method": "pressure_test_with_gauge",
      "housing_opacity_status": "partial",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-coolant-level-warning-pid",
      "component_slug": "sd4-67psd-coolant-level-sensor",
      "description": "Coolant level warning status PID as reported by PCM or BCM. Binary: LOW / OK. Does not indicate how far below minimum — only that threshold has been crossed.",
      "observation_method": "scan_tool_pid",
      "housing_opacity_status": "opaque",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "sd4-67psd-coolant-level-sensor-voltage",
      "component_slug": "sd4-67psd-coolant-level-sensor",
      "description": "Voltage at coolant level sensor signal wire. Expected: battery voltage (switch open = normal level) or 0V (switch closed = low level), or inverse depending on circuit design. Exact expected voltage not confirmed.",
      "observation_method": "electrical_measurement_at_pin",
      "housing_opacity_status": "opaque",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "sd4-67psd-water-pump-flow-pressure",
      "component_slug": "sd4-67psd-water-pump",
      "description": "Coolant flow rate and system pressure at water pump outlet (via cooling system pressure test at idle vs. higher RPM). Healthy pump: measurable pressure rise with RPM. Failed pump: no pressure differential with RPM change. Cavitation-damaged pump: inconsistent pressure.",
      "observation_method": "pressure_test_with_gauge",
      "housing_opacity_status": "opaque",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-water-pump-audible",
      "component_slug": "sd4-67psd-water-pump",
      "description": "Audible bearing noise or cavitation noise from water pump. Failed bearing: grinding or rumbling at front of engine correlated with RPM. Cavitation: whining or gurgling. Distinct from geartrain noise patterns.",
      "observation_method": "audible",
      "housing_opacity_status": "opaque",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-thermostat-ect-warmup-curve",
      "component_slug": "sd4-67psd-thermostat-housing",
      "description": "Thermostat state inferred from ECT warmup curve on scan tool. Healthy: ECT rises steadily, plateaus at ~189°F as thermostat opens and cold radiator coolant dilutes the circuit. Failed-open: ECT never reaches operating temp, stays chronically low. Failed-closed: ECT rises above normal operating range, no plateau stabilization.",
      "observation_method": "scan_tool_pid",
      "housing_opacity_status": "opaque",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-thermostat-tactile-hose-temp",
      "component_slug": "sd4-67psd-thermostat-housing",
      "description": "Tactile temperature check of upper radiator hose after engine reaches operating temp. When thermostat opens, upper hose should become hot (coolant routing to radiator). If upper hose stays cold while engine is at operating temp, thermostat is likely stuck closed.",
      "observation_method": "touch",
      "housing_opacity_status": "opaque",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-radiator-visual-external",
      "component_slug": "sd4-67psd-radiator",
      "description": "External visual inspection of radiator core for bent fins, external corrosion, physical damage, or coolant residue (external leak evidence). Also inspect upper and lower tank seams for seepage.",
      "observation_method": "direct_visual_external",
      "housing_opacity_status": "opaque",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-radiator-tactile-temp-differential",
      "component_slug": "sd4-67psd-radiator",
      "description": "Tactile temperature differential across radiator inlet and outlet hoses at operating temp. Healthy: upper hose hot, lower hose noticeably cooler. Minimal differential suggests restricted flow or bypassed thermostat routing. Use infrared thermometer for precision.",
      "observation_method": "touch",
      "housing_opacity_status": "opaque",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-viscous-fan-audible",
      "component_slug": "sd4-67psd-viscous-fan-clutch",
      "description": "Audible roar from viscous fan clutch during warm engine operation or cold start. Healthy clutch: loud on cold start, quiets as it warms; loud again under high heat load. Failed clutch (slipping): minimal roar even when hot, poor cooling. Locked clutch: continuous loud roar regardless of temp.",
      "observation_method": "audible",
      "housing_opacity_status": "opaque",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-viscous-fan-tactile",
      "component_slug": "sd4-67psd-viscous-fan-clutch",
      "description": "Manual spin test of viscous fan clutch with engine cold and OFF. Healthy: slight drag, fan should not freewheel. Failed (fluid leak/slipping): spins too freely with no resistance. This is a standard field test.",
      "observation_method": "touch",
      "housing_opacity_status": "opaque",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-electric-fan-pid",
      "component_slug": "sd4-67psd-electric-fan-assembly",
      "description": "Electric fan commanded state (on/off or duty cycle if PWM) as visible on scan tool under PCM outputs. Allows confirming whether PCM is commanding fan on vs. fan not responding due to relay/wiring/motor fault.",
      "observation_method": "scan_tool_pid",
      "housing_opacity_status": "opaque",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "sd4-67psd-electric-fan-visual",
      "component_slug": "sd4-67psd-electric-fan-assembly",
      "description": "Direct visual confirmation of electric fan motor spinning during conditions that should activate it (hot idle, A/C on, post-key-off soak). A fan commanded ON by PCM that is not spinning indicates relay, wiring, or motor fault.",
      "observation_method": "direct_visual_external",
      "housing_opacity_status": "opaque",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-electric-fan-relay-voltage",
      "component_slug": "sd4-67psd-electric-fan-relay-module",
      "description": "Voltage at relay coil control wire (PCM command side) and relay output wire (fan motor feed side). PCM command present but no fan output voltage = relay failed. No PCM command voltage = PCM output fault or wiring open.",
      "observation_method": "electrical_measurement_at_pin",
      "housing_opacity_status": "opaque",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-egr-cooler-visual-external",
      "component_slug": "sd4-67psd-egr-cooler",
      "description": "External inspection of EGR cooler for external coolant seepage, coolant deposits (white residue), or exhaust soot on cooler exterior. External wetness or white mineral deposits indicate external coolant leak from cooler fittings or cooler body.",
      "observation_method": "direct_visual_external",
      "housing_opacity_status": "opaque",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-egr-cooler-bypass-pid",
      "component_slug": "sd4-67psd-egr-cooler-bypass-valve",
      "description": "EGR cooler bypass valve position or commanded state as visible via scan tool. On cold engine: bypass commanded open (exhaust routed around cooler). At operating temp: bypass commanded closed (exhaust through cooler). Stuck-open fault: bypass always commanded or defaulted open regardless of coolant temp.",
      "observation_method": "scan_tool_pid",
      "housing_opacity_status": "opaque",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-egr-cooler-bypass-waveform",
      "component_slug": "sd4-67psd-egr-cooler-bypass-valve",
      "description": "Waveform capture on EGR cooler bypass valve command wire during engine warmup. Should show transition from bypass-open to bypass-closed command correlated with ECT reaching operating threshold.",
      "observation_method": "waveform_capture",
      "housing_opacity_status": "opaque",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-heater-core-visual-leak",
      "component_slug": "sd4-67psd-heater-core",
      "description": "Visual inspection for coolant on passenger-side floor mat, sweet coolant odor in cabin, or fog/film on windshield — all indirect indicators of heater core external leak. Direct visual requires dash disassembly (out of scope standard check).",
      "observation_method": "direct_visual_external",
      "housing_opacity_status": "opaque",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-heater-core-smell",
      "component_slug": "sd4-67psd-heater-core",
      "description": "Sweet coolant/glycol odor detectable in cabin, particularly when blower is running. Indicates heater core leak into HVAC ductwork. Strong indication even without visible coolant on floor.",
      "observation_method": "smell",
      "housing_opacity_status": "opaque",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-heater-hoses-tactile",
      "component_slug": "sd4-67psd-heater-hoses",
      "description": "Tactile temperature check of heater supply and return hoses at firewall penetration. Both hoses should be hot at operating temp (coolant flows through heater core in bypass loop regardless of thermostat state). Cold heater hoses at operating temp suggest clogged heater core or restricted heater circuit.",
      "observation_method": "touch",
      "housing_opacity_status": "opaque",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-block-heater-tactile",
      "component_slug": "sd4-67psd-block-heater",
      "description": "Tactile confirmation of block warmth after plugging in for 2+ hours in cold ambient conditions. Block and coolant in surge tank should be noticeably warmer than ambient. Cold block after extended plug-in time indicates failed heating element.",
      "observation_method": "touch",
      "housing_opacity_status": "opaque",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-block-heater-visual-cord",
      "component_slug": "sd4-67psd-block-heater",
      "description": "Visual confirmation of power cord presence at front bumper/grille area and physical condition of cord (fraying, damage, plug condition). No scan tool observable. Cord presence indicates factory block heater installed.",
      "observation_method": "direct_visual_external",
      "housing_opacity_status": "opaque",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    }
  ],
  "component_connections": [
    {
      "from_component_slug": "sd4-67psd-engine-gear-train",
      "to_component_slug": "sd4-67psd-water-pump",
      "connection_kind": "mechanical-linkage",
      "direction": "unidirectional",
      "description": "Engine front geartrain directly drives the water pump. Pump speed is proportional to engine RPM. No belt, no tensioner, no slip mechanism.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-engine-gear-train",
      "to_component_slug": "sd4-67psd-viscous-fan-clutch",
      "connection_kind": "mechanical-linkage",
      "direction": "unidirectional",
      "description": "Viscous fan clutch is driven by the water pump hub or a dedicated fan drive shaft from the engine front geartrain. Exact drive configuration (pump hub vs. independent shaft) not yet confirmed.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "from_component_slug": "sd4-67psd-surge-tank",
      "to_component_slug": "sd4-67psd-water-pump",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "Surge tank feeds into the main coolant circuit at the water pump inlet side (exact tee/port not confirmed but surge tank is the system fill and pressure reference point). Primary flow path for filling and air purging.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "from_component_slug": "sd4-67psd-water-pump",
      "to_component_slug": "sd4-67psd-thermostat-housing",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "Water pump pressurizes and circulates coolant through engine block and cylinder heads. Coolant exits at thermostat housing inlet after traversing the engine passages.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-thermostat-housing",
      "to_component_slug": "sd4-67psd-upper-radiator-hose",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "When primary thermostat opens (approx 189°F), thermostat housing routes coolant to the upper radiator hose toward the radiator. This is the full-loop (radiator-active) flow path.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-upper-radiator-hose",
      "to_component_slug": "sd4-67psd-radiator",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "Upper radiator hose carries hot coolant from thermostat housing outlet to radiator upper tank.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-radiator",
      "to_component_slug": "sd4-67psd-lower-radiator-hose",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "Cooled coolant exits radiator lower tank into lower radiator hose for return to water pump inlet.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-lower-radiator-hose",
      "to_component_slug": "sd4-67psd-water-pump",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "Lower radiator hose returns cooled coolant from radiator lower tank to water pump inlet, completing the full radiator loop.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-thermostat-housing",
      "to_component_slug": "sd4-67psd-heater-hoses",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "Bypass loop branches from thermostat housing (or nearby coolant passage) to heater core supply hose. Coolant flows through heater circuit regardless of thermostat state — bypass loop is always active. Exact tee/branch location not confirmed (GAP).",
      "source_provenance": "GAP",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-heater-hoses",
      "to_component_slug": "sd4-67psd-heater-core",
      "connection_kind": "fluid-line",
      "direction": "bidirectional",
      "description": "Heater supply and return hoses carry coolant to and from the heater core through the passenger-side firewall. Represented as bidirectional since the hose pair serves both directions.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-heater-core",
      "to_component_slug": "sd4-67psd-water-pump",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "Heater core return hose routes cooled coolant back into the engine coolant circuit (rejoining near water pump inlet or at block). Exact return connection point not confirmed (GAP).",
      "source_provenance": "GAP",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-thermostat-housing",
      "to_component_slug": "sd4-67psd-egr-cooler",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "EGR cooler is plumbed in parallel with the main cooling circuit, receiving coolant supply from the engine/thermostat area. Exact supply tee location not confirmed (TRAINING-INFERRED, parallel branch).",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "from_component_slug": "sd4-67psd-egr-cooler",
      "to_component_slug": "sd4-67psd-water-pump",
      "connection_kind": "fluid-line",
      "direction": "unidirectional",
      "description": "EGR cooler coolant return rejoins the main cooling circuit (near water pump inlet or coolant crossover). Exact return point not confirmed (GAP).",
      "source_provenance": "GAP",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-ect-sensor",
      "to_component_slug": "sd4-67psd-pcm",
      "connection_kind": "reports_to",
      "direction": "unidirectional",
      "description": "Primary ECT sensor outputs analog NTC thermistor voltage signal to PCM 5V reference circuit. PCM uses ECT for warmup enrichment, injection timing, EGR enable, fan control, idle speed, and torque derating.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-coolant-level-sensor",
      "to_component_slug": "sd4-67psd-pcm",
      "connection_kind": "reports_to",
      "direction": "unidirectional",
      "description": "Coolant level sensor sends binary low/not-low signal to PCM (or BCM — exact routing unconfirmed). PCM/BCM propagates low-coolant warning to instrument cluster.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "from_component_slug": "sd4-67psd-pcm",
      "to_component_slug": "sd4-67psd-instrument-cluster",
      "connection_kind": "can-bus",
      "direction": "unidirectional",
      "description": "PCM broadcasts ECT value and low-coolant warning status over HS-CAN bus to instrument cluster for temperature gauge display and low-coolant warning lamp activation.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-pcm",
      "to_component_slug": "sd4-67psd-electric-fan-relay-module",
      "connection_kind": "controlled_by",
      "direction": "unidirectional",
      "description": "PCM commands the electric fan relay/module based on ECT, A/C pressure signal, and vehicle speed inputs. Command signal is digital switched or PWM — exact strategy for 2018 MY not yet confirmed (GAP).",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-electric-fan-relay-module",
      "to_component_slug": "sd4-67psd-electric-fan-assembly",
      "connection_kind": "electrical-wire",
      "direction": "unidirectional",
      "description": "Fan relay/module switches or modulates 12V battery power to electric fan motor(s). Output is a direct power feed to fan motor connector.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "from_component_slug": "sd4-67psd-pcm",
      "to_component_slug": "sd4-67psd-egr-cooler-bypass-valve",
      "connection_kind": "controlled_by",
      "direction": "unidirectional",
      "description": "PCM commands EGR cooler bypass valve based on coolant temperature (ECT) and engine operating state. Cold engine: bypass open (exhaust around cooler). Operating temp reached: bypass closes (exhaust through cooler).",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-cht-sensor",
      "to_component_slug": "sd4-67psd-pcm",
      "connection_kind": "reports_to",
      "direction": "unidirectional",
      "description": "If CHT/secondary ECT sensor exists on 2018 build, it reports to PCM via analog signal. Connection is a GAP — sensor existence not confirmed.",
      "source_provenance": "GAP",
      "inference_class": null
    },
    {
      "from_component_slug": "sd4-67psd-coolant-level-sensor",
      "to_component_slug": "sd4-67psd-surge-tank",
      "connection_kind": "mechanical-linkage",
      "direction": "unidirectional",
      "description": "Coolant level sensor is physically mounted on or integrated into the surge tank body. Mechanical mounting relationship — sensor float or switch element contacts the coolant directly inside the tank.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    }
  ]
}
```
