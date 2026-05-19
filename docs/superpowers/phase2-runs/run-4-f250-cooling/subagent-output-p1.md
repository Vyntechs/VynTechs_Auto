# Run 4 — F-250 6.7L PSD Cooling System P1

**Date:** 2026-05-19
**Platform:** 2018 Ford F-250, 4th-gen Super Duty, 6.7L Power Stroke Diesel (3rd-gen Lion V8)
**System scope:** Engine cooling (coolant loop, thermostat, water pump, radiator, fans, EGR cooler, heater core, block heater)
**Excluded:** Oil cooling, fuel system (Run 1), transmission cooling, intercooler/charge air cooler

---

## Section 1 — Architecture narration

### 1.1 Coolant loop overview

The 2018 F-250 6.7L Power Stroke uses a pressurized closed-loop liquid cooling system with a degas (surge/expansion) bottle as the system high point and fill point. Unlike most gasoline-engine vehicles that use a traditional upper-tank radiator fill cap, the 6.7L PSD routes coolant through the system from the surge tank, which doubles as the coolant level reference and the pressurized cap location. The surge tank is mounted high in the engine bay on the passenger side, positioned above the engine to allow air to escape the coolant circuit. A coolant level sensor is integrated into or mounted on the surge tank to alert the PCM/instrument cluster when coolant drops below a minimum threshold.

Coolant flows from the surge tank into the engine block, through the cylinder heads, and exits through the dual-thermostat housing before routing to the radiator, heater core, and EGR cooler. The system is a parallel/split-flow design: multiple heat exchangers share the coolant loop simultaneously.

### 1.2 Water pump

The 6.7L Power Stroke uses a mechanical, gear-driven water pump — a deliberate architecture choice that distinguishes it from many competitors using belt-driven or electrically assisted pumps. The water pump is driven directly off the engine geartrain (front geartrain cover area), providing flow that is proportional to engine RPM with no belt tensioner, belt slip, or serpentine drive concern on the water pump circuit specifically. There is no electric water pump on this application. Flow rate scales with RPM, which is a known characteristic that affects cold-start warmup time and high-idle cooling capacity.

### 1.3 Dual-thermostat system

The 4th-generation 6.7L Power Stroke (2017-2022) uses two thermostats in a single housing assembly — a platform-specific fact with diagnostic significance. The dual-thermostat arrangement controls the transition between two coolant flow states:

- **Small coolant loop (bypass):** when both thermostats are closed (cold engine), coolant bypasses the radiator and circulates only through the engine, heater core, and EGR cooler. This accelerates engine warmup.
- **Full loop (radiator in circuit):** as engine temperature rises, the primary thermostat opens first (approximately 189°F / 87°C for the 2018 tune), routing coolant through the radiator. The secondary thermostat modulates flow rate or bypass fraction.

The thermostat housing is located on the front/top of the engine. A failed-closed thermostat on this platform produces a distinctive dual failure: the PCM sees engine temperature stall below operating range on the ECT sensor, and EGR cooler coolant flow may be compromised as a downstream effect. A failed-open thermostat causes chronic under-temperature, reduces combustion efficiency, increases EGR-related soot loading, and may trigger DTCs for engine-over-cooling (P0128 or equivalent).

A key diagnostic note: because this is a dual-thermostat design, one thermostat can fail while the other remains functional, producing partial or intermittent symptoms that are harder to attribute than a single-thermostat failure. Both thermostats are serviced as a unit (housing assembly replacement) on most repair procedures.

### 1.4 Engine Coolant Temperature (ECT) sensor

A single primary ECT sensor provides coolant temperature feedback to the PCM. It is located in a coolant passage at the front of the engine (near the thermostat housing area). The ECT is a two-wire NTC (Negative Temperature Coefficient) thermistor: resistance decreases as temperature rises, producing an analog voltage signal on the PCM's 5V reference circuit. The PCM uses ECT as a primary input for:
- Cold-start fuel enrichment and injection timing
- EGR enable/disable thresholds (EGR is typically suppressed below a minimum coolant temp)
- Cooling fan control targets
- Idle speed management
- Torque derating above overcooling or overheating thresholds

A second temperature sensor (the cylinder head temperature / CHT or a secondary ECT in some configurations) may be present. Its exact location and whether it exists as a distinct sensor on the 2018 model year is not fully confirmed in training data.

### 1.5 Radiator

The primary radiator is a conventional cross-flow aluminum core unit mounted at the front of the vehicle. The 6.7L PSD radiator is notably large to handle diesel engine heat rejection at towing loads. The upper radiator hose connects from the thermostat housing outlet to the radiator upper tank; the lower radiator hose returns from the radiator lower tank to the water pump inlet. The radiator incorporates a transmission cooler (separate line-in/line-out ports) which is out of scope for this run but is relevant for diagnostic routing (a transmission cooler leak inside the radiator contaminates coolant with ATF and is a known failure pattern on Super Duty platforms).

The radiator cap (if any) is located on the surge tank, not directly on the radiator. The radiator itself may be a sealed unit without a serviceable cap at the top tank.

### 1.6 Cooling fans

The 6.7L PSD uses a **viscous clutch fan** (also called a fan clutch) as the primary mechanical cooling fan, mounted on the front of the engine and driven by the water pump hub or a dedicated fan drive shaft from the geartrain. The viscous clutch engages more fully as temperature rises (using silicone fluid shear inside the clutch mechanism). At high ambient temp or low vehicle speed, the clutch engages to near-full coupling; at highway speed with adequate airflow, it partially disengages to reduce parasitic loss.

In addition to the viscous fan, a **secondary electric fan (or dual electric fans)** is mounted in front of the radiator in the shroud. The electric fan(s) are PCM-controlled via a relay or fan control module and provide supplemental airflow during low-speed/high-load conditions (idle, low-speed towing, A/C condenser cooling demand) and during hot-restart soak periods. The electric fan circuit is also activated when A/C is requested to aid condenser cooling.

Control authority for the electric fan: the PCM monitors ECT and A/C pressure signals and commands the fan relay directly. Fan speed may be single-speed (relay on/off) or variable-speed depending on the specific module configuration — exact fan control strategy for the 2018 variant requires WSM confirmation.

### 1.7 EGR cooler — coolant in the exhaust loop

The 6.7L Power Stroke's EGR (Exhaust Gas Recirculation) system uses engine coolant to cool hot exhaust gases before they re-enter the intake manifold. The EGR cooler is a shell-and-tube or brazed-plate heat exchanger mounted in the engine valley (passenger side, upper area), plumbed in parallel with the main cooling circuit. Hot exhaust gas passes through the core; coolant flows through the surrounding passages and carries heat away.

This is architecturally significant in three ways:
1. **Coolant-to-exhaust contamination:** If the EGR cooler cracks or develops an internal leak, exhaust gases or combustion byproducts can contaminate the coolant. This produces coolant discoloration (soot/black contamination), elevated coolant pH, and can cause foaming in the surge tank.
2. **Coolant loss pathway:** An EGR cooler failure can be a coolant consumption source with no visible external leak — the coolant is consumed into the exhaust stream (steam out the tailpipe, especially on cold starts).
3. **EGR cooler bypass valve:** The 6.7L PSD EGR system includes an EGR cooler bypass valve, a PCM-controlled actuator that routes exhaust through or around the cooler. On cold engine starts, the bypass valve routes exhaust around the cooler (to avoid condensation damage and to accelerate warmup). Once coolant reaches operating temperature, the valve opens to route exhaust through the cooler. A stuck-open bypass valve (always bypassing) reduces EGR cooler efficiency at operating temp and may set a P-code.

The EGR cooler is widely documented as a high-failure-rate component on 6.7L Power Stroke engines (all generations, including 2017-2022). It is one of the top two or three known weak points on this platform.

### 1.8 Heater core

The heater core is a small heat exchanger in the HVAC module behind the dashboard. Coolant flows through the heater core continuously (in most blend-door HVAC designs) or via a coolant control valve, and cabin air is directed over it by the blower and blend doors. The heater core supply and return hoses connect to the engine cooling system via firewall-penetrating fittings on the passenger-side firewall area. Heater core flow is part of the small coolant loop (runs whether or not thermostat is open to radiator), which means the heater core actively assists engine warmup by pulling heat from the coolant loop at startup — relevant to diagnosing slow warmup.

A clogged or leaking heater core will manifest as: no cabin heat, sweet coolant odor in cabin, foggy windshield, coolant on passenger-side floor mat, or unexplained coolant loss with no external engine-bay leak.

### 1.9 Coolant level sensor

The surge tank has an integrated or externally mounted coolant level sensor. It is typically a two-wire float-type or resistive switch that signals the BCM or PCM when coolant drops below the minimum safe level. A low-coolant warning lamp activates in the instrument cluster. This sensor is an alert mechanism, not a continuous level gauge — it provides a binary low/not-low signal.

### 1.10 Block heater

A 110V AC engine block heater is available on the 2018 F-250 as a factory option (or as a factory-standard item on some build configurations, particularly cold-climate orders). The block heater is an immersion-style heating element installed in the engine block coolant passage (typically threaded into a block drain port or freeze plug location on the driver side). When plugged in, it warms the coolant in the block, which by convection warms the entire cooling circuit slightly. The 120V power cord exits through the front bumper/grille area. Block heater is not PCM-controlled — it is always-on when plugged in, no relay or control module involved.

---

## Section 2 — JSON sidecar

```json
{
  "system": "engine-cooling",
  "platform_slug": "ford-super-duty-4th-gen-67-psd",
  "architecture_facts": [
    {
      "slug": "c1-surge-tank-location-and-fill-point",
      "description": "The 6.7L PSD cooling system uses a pressurized degas/surge tank as the system high point and the only fill point. The surge tank is mounted on the passenger side of the engine bay, elevated above the engine to allow air purging. The system pressure cap is on the surge tank, not on the radiator.",
      "field_verify_required": false,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "c2-coolant-level-sensor-surge-tank",
      "description": "A coolant level sensor is integrated into or mounted on the surge tank. It provides a binary (low/not-low) switched signal to the BCM or PCM, triggering a low-coolant warning lamp in the instrument cluster.",
      "field_verify_required": true,
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "c3-water-pump-gear-driven",
      "description": "The 6.7L Power Stroke uses a mechanical water pump driven directly by the engine's front geartrain, not by the accessory serpentine belt. Pump flow scales proportionally with engine RPM. There is no electric water pump on this application.",
      "field_verify_required": false,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "c4-dual-thermostat-housing",
      "description": "The 4th-gen 6.7L PSD (2017-2022) uses two thermostats in a single housing assembly at the front of the engine. The dual-thermostat arrangement controls a bypass loop (both closed = small loop, no radiator) transitioning to full radiator flow as engine temperature rises.",
      "field_verify_required": false,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "c5-thermostat-primary-opening-temp",
      "description": "The primary thermostat on the 2018 6.7L PSD opens at approximately 189°F (87°C), initiating coolant flow to the radiator. The exact calibrated opening temperature for the 2018 model year PCM tune should be confirmed against Ford WSM spec.",
      "field_verify_required": true,
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "c6-thermostat-bypass-cold-loop",
      "description": "When both thermostats are closed (cold engine), coolant circulates in a bypass loop that includes the engine block, cylinder heads, heater core, and EGR cooler, but excludes the radiator. This accelerates warmup. The bypass loop is an architectural default state, not a fault condition.",
      "field_verify_required": false,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "c7-ect-sensor-location-and-type",
      "description": "The primary ECT sensor is a two-wire NTC thermistor located in a coolant passage near the thermostat housing at the front of the engine. Resistance decreases as temperature rises, producing an analog voltage on the PCM's 5V reference circuit.",
      "field_verify_required": true,
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "c8-ect-pcm-control-authority",
      "description": "The PCM uses ECT as a primary input for cold-start fuel enrichment, injection timing advance, EGR enable/disable thresholds, cooling fan activation, idle speed management, and torque derating under overcooling or overheating conditions.",
      "field_verify_required": false,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "c9-secondary-cylinder-head-temp-sensor",
      "description": "A secondary temperature sensor (cylinder head temperature / CHT, or a second ECT position) may be present on this platform in addition to the primary ECT. Its exact location, wire count, and whether it is a distinct sensor on the 2018 build are not confirmed in training data.",
      "field_verify_required": true,
      "source_provenance": "GAP",
      "inference_class": null
    },
    {
      "slug": "c10-radiator-aluminum-crossflow",
      "description": "The primary radiator is a large aluminum cross-flow unit at the front of the vehicle. The upper radiator hose connects from the thermostat housing outlet to the radiator upper tank; the lower hose returns from the radiator lower tank to the water pump inlet.",
      "field_verify_required": false,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "c11-radiator-no-serviceable-cap",
      "description": "The radiator on the 6.7L PSD surge-tank system does not have a serviceable pressure cap at the radiator top tank. The only system pressure cap is on the surge tank. Technicians who expect a radiator cap for pressure testing must cap at the surge tank instead.",
      "field_verify_required": true,
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "c12-viscous-clutch-fan-primary",
      "description": "A viscous clutch (silicone-fluid coupling) fan is the primary mechanical cooling fan, mounted at the front of the engine on the water pump hub or geartrain-driven fan shaft. Clutch engagement increases with temperature rise, and partially disengages at highway speed to reduce parasitic drag.",
      "field_verify_required": false,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "c13-auxiliary-electric-fan",
      "description": "One or more electric auxiliary fans are mounted in the radiator shroud ahead of the radiator. They are PCM-controlled (via relay or fan control module) and activate at low vehicle speeds, high ECT, during A/C operation, and during hot-restart soak conditions.",
      "field_verify_required": true,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "c14-electric-fan-control-strategy",
      "description": "The exact electric fan control strategy for the 2018 model year — whether single-speed relay, two-speed, or PWM variable-speed via a dedicated fan control module — is not fully confirmed in training data. Fan activation inputs include ECT, A/C high-side pressure, and vehicle speed.",
      "field_verify_required": true,
      "source_provenance": "GAP",
      "inference_class": null
    },
    {
      "slug": "c15-egr-cooler-in-coolant-loop",
      "description": "The EGR cooler is plumbed in parallel with the main engine cooling circuit. Engine coolant flows through the EGR cooler continuously (subject to EGR bypass valve position) to remove heat from recirculated exhaust gas before it enters the intake manifold.",
      "field_verify_required": false,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "c16-egr-cooler-bypass-valve",
      "description": "A PCM-controlled EGR cooler bypass valve routes exhaust gas around (bypassing) the EGR cooler during cold starts to prevent condensation damage and accelerate warmup. The valve opens to route exhaust through the cooler once coolant reaches operating temperature.",
      "field_verify_required": false,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "c17-egr-cooler-failure-coolant-contamination",
      "description": "Internal EGR cooler failure (cracking or seal failure) allows exhaust gas or combustion byproducts to enter the coolant circuit, producing coolant discoloration (soot/black), elevated pH, and foaming in the surge tank. This is a documented high-failure-rate pattern on all 6.7L PSD generations including 2017-2022.",
      "field_verify_required": false,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "c18-egr-cooler-coolant-consumption-path",
      "description": "An EGR cooler internal leak can produce coolant loss with no visible external engine-bay leak. Coolant enters the exhaust stream and exits as steam from the tailpipe, particularly visible during cold starts. This is a diagnostic trap: unexplained coolant loss on a 6.7L PSD without external wetness should trigger EGR cooler inspection.",
      "field_verify_required": false,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "c19-egr-cooler-location",
      "description": "The EGR cooler on the 6.7L PSD is mounted in the engine valley on the passenger side, upper area of the engine. Exact mounting position and coolant fitting orientation for the 2018 model year (3rd-gen Lion V8) should be confirmed against WSM diagrams before removal.",
      "field_verify_required": true,
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "c20-heater-core-in-bypass-loop",
      "description": "The heater core is plumbed in the bypass (small) coolant loop, meaning it receives coolant flow whether or not the main thermostat is open to the radiator. This means the heater core assists engine warmup from cold start by acting as an additional heat load on the loop.",
      "field_verify_required": false,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "c21-heater-core-hose-routing",
      "description": "Heater core supply and return hoses run through the passenger-side firewall. Supply takes hot coolant from the engine side; return routes cooled coolant back into the engine circuit. Exact connection points on the engine (tee off thermostat housing, coolant crossover, or dedicated port) are not confirmed in training data.",
      "field_verify_required": true,
      "source_provenance": "GAP",
      "inference_class": null
    },
    {
      "slug": "c22-block-heater-factory-option",
      "description": "A 110V AC immersion-style block heater is available as a factory option (and may be standard on some cold-climate build configurations). The element threads into the engine block coolant passage. Power cord exits through the front bumper/grille area.",
      "field_verify_required": false,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "c23-block-heater-always-on-no-pcm",
      "description": "The block heater is not PCM-controlled. It is a direct 120V AC load with no relay, control module, or PCM interaction. When the plug is connected to shore power, the element is energized continuously.",
      "field_verify_required": false,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "c24-coolant-spec-oat-or-hoat",
      "description": "The 4th-gen 6.7L PSD requires an OAT (Organic Acid Technology) or Ford-specified HOAT (Hybrid OAT) coolant. Mixing incompatible coolant types (e.g., conventional green or NOAT) compromises corrosion inhibitors and accelerates EGR cooler and aluminum component degradation. Exact Ford coolant spec (VC-7-A or equivalent) for 2018 should be confirmed against Ford owner's manual or WSM.",
      "field_verify_required": true,
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "PATTERN"
    },
    {
      "slug": "c25-cooling-system-pressure-cap-rating",
      "description": "The surge tank pressure cap rating for the 2018 6.7L PSD is not confirmed in training data. Typical heavy-duty diesel applications run 16-20 PSI caps, but exact Ford spec for this platform requires WSM confirmation.",
      "field_verify_required": true,
      "source_provenance": "GAP",
      "inference_class": null
    }
  ]
}
```
