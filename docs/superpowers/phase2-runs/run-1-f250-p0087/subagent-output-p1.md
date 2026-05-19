# Run 1 / Prompt 1 — Subagent Output (DRY RUN, uncommitted)

**Date:** 2026-05-19
**Subagent model:** Sonnet
**Input:** 2018 F-250 6.7L Power Stroke / 6R140 (TorqShift), fuel system
**Status:** dry-run output for Brandon's review before committing to Phase 2 execution

---

## 1. PLATFORM IDENTIFICATION

**Platform:** Ford Super Duty P558 / P473 Body (4th Generation), 2017–2022
**Year range:** 2017–2022
**Engine generation:** 3rd-generation 6.7L Power Stroke (Lion V8 diesel), introduced for the 2017 model year refresh alongside the aluminum-hood body redesign
**Input vehicle placement:** The 2018 F-250 with 6.7L Power Stroke falls squarely in the 4th-generation Super Duty platform (2017–2022). No mid-year transition ambiguity for the 2018 model year on this engine/platform combination. [TRAINING-CONFIRMED]

No VIN or build date is needed to resolve platform identity for this input.

---

## 2. ARCHITECTURE FACTS

### Fuel Storage & Delivery

**F1 — Primary fuel tank location and type**
The 2018 F-250 6.7L Power Stroke uses a mid-ship (under-cab/frame) single primary fuel tank as standard configuration. Depending on cab/bed configuration, tank capacity is approximately 26–48 gallons. Extended/single-tank trucks on the 4th-gen Super Duty typically ship with one primary tank; dual-tank configurations were not offered from the factory on this generation. [TRAINING-CONFIRMED]

**F2 — Fuel lift pump (low-pressure transfer pump)**
A frame-mounted, electric in-line lift pump (also called the fuel transfer pump or fuel delivery module) is mounted on the driver-side frame rail. This pump is electric, powered by the PCM/fuel system circuit, and provides low-pressure fuel transfer from the tank to the high-pressure fuel pump. [TRAINING-CONFIRMED]

**F3 — In-tank sender/module**
An in-tank fuel level sender is present; it provides a resistive-type analog signal to the instrument cluster/BCM for fuel gauge indication. [TRAINING-CONFIRMED]

**F4 — Primary fuel filter/water separator location**
A primary fuel filter and water separator assembly is located on the driver-side frame rail, downstream of the lift pump and before the high-pressure pump. This filter housing incorporates a water-in-fuel (WIF) sensor and a manual drain. [TRAINING-CONFIRMED]

**F5 — Water-in-fuel (WIF) sensor**
The WIF sensor is integrated into the primary fuel filter housing (frame-rail mounted). It provides a two-wire resistive or switched-ground signal to the PCM. Exact wire count and signal type at the connector: [GAP — wire colors and exact signal protocol not reliably confirmed in training data]

**F6 — High-pressure fuel pump (HPFP) type**
The 2017–2022 6.7L Power Stroke uses a Bosch CP4.2 high-pressure fuel injection pump (also documented as the high-pressure common rail pump). It is gear-driven off the front of the engine (geartrain, front cover area). [TRAINING-CONFIRMED]

**F7 — CP4.2 rated output pressure**
The CP4.2 on this application commands fuel rail pressure up to approximately 29,000 PSI (2,000 bar) under peak demand. Exact calibrated maximum for the 2018 PCM tune: [GAP — PCM calibration-specific; field verification via live data preferred]

**F8 — High-pressure fuel rail(s)**
Two high-pressure fuel rails are present (one per cylinder bank, left and right). They are steel, high-pressure-rated, and connected directly to the injectors. [TRAINING-CONFIRMED]

**F9 — Fuel pressure regulator (IMV / inlet metering valve)**
The inlet metering valve (IMV), also called the fuel volume control valve, is integrated into the CP4.2 pump body. It is a normally-open, PWM-controlled solenoid valve commanded by the PCM. It regulates fuel delivery into the pump's high-pressure circuit. [TRAINING-CONFIRMED]

**F10 — Fuel rail pressure sensor(s)**
At least one fuel rail pressure sensor (RPS) is present on the high-pressure rail. It is a three-wire sensor (5V reference, signal, ground) providing an analog voltage signal to the PCM. The PCM uses this for closed-loop fuel pressure control. [TRAINING-CONFIRMED]

**F11 — Fuel injector type**
The 6.7L Power Stroke on the 2018 model year uses Bosch solenoid-type (not piezoelectric) common rail injectors. Each injector receives a high-voltage/high-current pulse-width-modulated signal via the PCM's injector driver circuit. [TRAINING-CONFIRMED]

**F12 — Injector count and configuration**
Eight injectors total, one per cylinder, in a V8 configuration. [TRAINING-CONFIRMED]

**F13 — Fuel return system**
A low-pressure fuel return circuit routes excess high-pressure fuel (from rail pressure regulator/overflow valve) back to the tank or to the fuel filter housing. This is a passive return circuit, no active pump. [TRAINING-CONFIRMED]

**F14 — Fuel pressure relief valve (rail pressure limiting valve)**
A mechanical pressure relief valve is present on the high-pressure rail. It opens at a factory-set threshold to protect the rail and injectors from overpressure events. Exact cracking pressure calibration: [GAP]

**F15 — Controlling module for fuel system**
The Powertrain Control Module (PCM), physically located on the passenger-side firewall in the engine compartment, is the primary controller for all fuel system actuators (IMV, injectors, lift pump relay). [TRAINING-CONFIRMED]

**F16 — PCM communication network**
The PCM communicates on the high-speed CAN bus (HS-CAN, 500 kbps). Fuel system PIDs (rail pressure, ICP, lift pump status, injector duty cycle, WIF status) are broadcast on HS-CAN. [TRAINING-CONFIRMED]

**F17 — Fuel system communication with other modules**
The PCM receives and broadcasts fuel-related data to the Instrument Cluster (for WIF warning lamp and fuel gauge) and to the ABS/Traction Control module via HS-CAN as part of torque management integration. No dedicated fuel module; all control is PCM-direct. [TRAINING-CONFIRMED]

**F18 — Lift pump relay location**
The lift pump relay is housed in the Battery Junction Box (BJB) or Smart Junction Box (SJB) in the engine compartment. Exact relay cavity designation: [GAP — requires Ford FDRS/WSM confirmation per model year and cab configuration]

**F19 — Fuel cap / evaporative system**
The 6.7L Power Stroke is a diesel application. There is no EVAP (evaporative emissions) canister or purge system. Fuel cap is a standard diesel non-pressurized fuel cap. [TRAINING-CONFIRMED]

**F20 — Diesel Exhaust Fluid (DEF) system — relationship to fuel**
DEF (AdBlue/urea) is stored in a separate DEF tank, typically located on the passenger-side frame rail. Although not part of the fuel circuit, the DEF pump, DEF injector (dosing module), and DEF level/quality sensor are controlled by the PCM via CAN and are directly implicated in diesel emissions interaction with fuel combustion quality. [TRAINING-CONFIRMED]

**F21 — CP4.2 lubrication dependency on fuel**
The CP4.2 pump is lubricated entirely by diesel fuel (no separate oil circuit). Low fuel lubricity (contaminated fuel, biodiesel blends above approved limits, or water contamination) directly accelerates internal wear. This is an architectural dependency, not a failure mode. [TRAINING-CONFIRMED]

**F22 — Fuel heater (cold-weather)**
An electrically heated fuel filter element or fuel line heater may be present on this platform as a factory option or regional build. Availability and exact location: [TRAINING-INFERRED — documented on some 4th-gen Super Duty builds; not confirmed as standard on all 2018 builds; requires WSM verification]

**F23 — Fuel filter service interval and part number**
Ford-recommended fuel filter service interval on the 4th-gen 6.7L PSD is approximately every 15,000 miles. OEM part number for the primary filter: [GAP — training-data confidence is insufficient to state a reliable part number without risk of fabrication; field-verify against Ford parts catalog]

---

## 3. KNOWN FAILURE PATTERNS

**P1 — CP4.2 catastrophic pump failure with debris contamination**
The Bosch CP4.2 HPFP is documented extensively across multiple platforms (Ford 6.7L PSD 2011+, GM 6.6L Duramax LML, etc.) as prone to catastrophic internal failure when fuel lubricity is insufficient or contamination is present. Failure mode: internal steel-on-steel contact generates metallic debris that propagates throughout the entire high-pressure fuel circuit, contaminating injectors, rails, and return lines. This typically requires replacement of the entire high-pressure fuel system. [TRAINING-CONFIRMED]

**P2 — CP4.2 failure rate elevated on 2017-2022 versus earlier 6.7L PSD generations**
The 3rd-generation 6.7L Power Stroke (2017+) retained the CP4.2 from earlier generations. Some documented reports and technical service bulletins discuss higher failure incidence on higher-mileage examples and in fleets with variable fuel quality. Exact TSB numbers in training data: [GAP — TSB numbers not reliably confirmed without Ford FDRS access]

**P3 — Water-in-fuel sensor false positives / filter housing seal failures**
The frame-rail fuel filter housing on the 4th-gen Super Duty is documented to develop seal degradation at the drain valve and housing O-rings, leading to external fuel weeps and occasional false WIF sensor activations. [TRAINING-CONFIRMED]

**P4 — Lift pump relay failure / fuel delivery issues**
The electric low-pressure lift pump and its relay circuit have documented failure modes resulting in hard start, long crank, and low rail pressure codes (P0087 or equivalent). This is more documented on higher-mileage units. [TRAINING-CONFIRMED]

**P5 — Injector return flow degradation**
Bosch solenoid injectors on the 6.7L PSD can exhibit high injector return flow (internal leakage) as they wear, causing low rail pressure and rough running, particularly at cold start. This is documented across 2011–2022 6.7L PSD variants. [TRAINING-CONFIRMED]

**P6 — Rail pressure sensor drift**
Fuel rail pressure sensors can drift or fail, causing the PCM to command incorrect IMV duty cycles, leading to rail pressure oscillation, smoke complaints, or rough idle. [TRAINING-INFERRED — common on CP4.2 platforms generally; confirmed failure mode exists but 2018-specific frequency not independently confirmed]

**P7 — Fuel in oil contamination via CP4.2 leak path**
If the CP4.2 develops a shaft seal or return fitting leak, fuel can enter the engine oil circuit, elevating oil level and reducing viscosity. This is a documented concern on multiple CP4.2-equipped platforms. [TRAINING-INFERRED — documented on related platforms; Ford 6.7L PSD specific occurrence frequency is GAP]

---

## 4. TRAINING-DATA LIMITS

The following items are explicitly not reliably covered by training data for this vehicle and must be captured in the field:

**G1 — Wire colors on all fuel system circuits**
Training data is not a reliable source for harness wire colors on the 2018 F-250. All wire color assignments are [GAP] and must be read from the Ford Workshop Manual (WSM) or measured in the field. This applies to: lift pump power/ground, WIF sensor signal/reference/ground, rail pressure sensor signal/reference/ground, IMV control wire, injector driver circuits.

**G2 — Exact connector pin assignments**
Specific pin-out of the PCM fuel control connector, the lift pump relay base, the WIF sensor connector, and the fuel rail pressure sensor connector are [GAP] in training data. Retrieve from Ford FDRS/ETIS or physical WSM pinout diagrams.

**G3 — Exact voltage curves**
Reference voltage vs. fuel rail pressure transfer function, WIF sensor resistance curve vs. water concentration, and IMV duty cycle vs. rail pressure control curve are [GAP]. Manufacturer scope patterns or Ford scan-tool freeze-frame data are required.

**G4 — Mid-year part number supersessions**
Bosch and Ford part number supersessions for the CP4.2 assembly, fuel filter housing, rail pressure sensor, and injectors within the 2017–2022 generation are [GAP]. Cross-reference against current Ford parts catalog at time of service.

**G5 — Specific PCM calibration versions**
PCM software calibration versions affect fuel pressure control thresholds, IMV duty cycle limits, and limp-mode behavior. These are [GAP] and must be verified via Ford FDRS connected to the specific vehicle.

**G6 — Fuel heater standard/optional status**
Whether the fuel filter heater assembly is standard or optional on the 2018 F-250 (and for which cab/drivetrain configurations) is [TRAINING-INFERRED / borderline GAP]. Confirm against Ford order guide or physical inspection.

**G7 — CP4.2 exact OEM part number for 2018**
Training data does not reliably produce a verifiable, current OEM part number for the CP4.2 pump on the 2018 6.7L PSD without risk of error. [GAP]

**G8 — Lift pump relay cavity designation in BJB**
Exact relay cavity number and fuse assignment for the fuel delivery pump circuit in the battery junction box is [GAP] for the 2018 F-250. Retrieve from WSM fuse/relay diagram.

---

## Subagent's self-count table

| # | Slug ref | Tag |
|---|---|---|
| F1 | Primary fuel tank | CONFIRMED (C) |
| F2 | Lift pump | CONFIRMED (C) |
| F3 | In-tank sender | CONFIRMED (C) |
| F4 | Primary fuel filter/WS | CONFIRMED (C) |
| F5 | WIF sensor signal | GAP (G) |
| F6 | CP4.2 pump type | CONFIRMED (C) |
| F7 | CP4.2 max rail pressure | GAP (G) |
| F8 | HP fuel rails | CONFIRMED (C) |
| F9 | IMV / inlet metering valve | CONFIRMED (C) |
| F10 | Fuel rail pressure sensor | CONFIRMED (C) |
| F11 | Injector type | CONFIRMED (C) |
| F12 | Injector count | CONFIRMED (C) |
| F13 | Fuel return system | CONFIRMED (C) |
| F14 | Rail pressure relief valve | GAP (G) |
| F15 | PCM identity/location | CONFIRMED (C) |
| F16 | PCM network | CONFIRMED (C) |
| F17 | PCM/module fuel comms | CONFIRMED (C) |
| F18 | Lift pump relay location | GAP (G) |
| F19 | No EVAP system | CONFIRMED (C) |
| F20 | DEF system relationship | CONFIRMED (C) |
| F21 | CP4.2 fuel lubrication dependency | CONFIRMED (C) |
| F22 | Fuel heater | INFERRED (I) |
| F23 | Fuel filter part number | GAP (G) |

Subagent's closing arithmetic: "C = 18, I = 1, G = 5. N = 18 + 1 + 5 = **24**. Verified."

**Subagent's closing line:**
> Baseline complete: 24 facts (18 confirmed, 1 inferred, 5 gap). Top field-verify priority: CP4.2 high-pressure pump internal debris contamination failure pathway — confirming whether the subject vehicle has any fuel system codes, rail pressure drop data, or lift pump performance data is the single highest-impact first field step before any injector or HPFP work is authorized.

---

## JSON sidecar (verbatim from subagent)

```json
{
  "platform": {
    "slug": "ford-super-duty-4th-gen-67-psd",
    "year_range": "2017-2022",
    "parent_make": "Ford",
    "parent_model_family": "Super Duty",
    "generation": "4th gen"
  },
  "architecture_facts": [
    {
      "slug": "sd4-67psd-primary-fuel-tank",
      "description": "The 2018 F-250 6.7L Power Stroke uses a mid-ship, under-cab/frame single primary fuel tank as standard configuration, with capacity varying by cab/bed configuration (approximately 26–48 gallons); dual-tank configurations were not offered from the factory on this generation.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null,
      "field_verify_required": false
    },
    {
      "slug": "sd4-67psd-lift-pump-location",
      "description": "A frame-mounted, electric in-line low-pressure fuel lift pump is located on the driver-side frame rail, providing low-pressure fuel transfer from the tank to the CP4.2 high-pressure pump.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null,
      "field_verify_required": false
    },
    {
      "slug": "sd4-67psd-in-tank-sender",
      "description": "An in-tank fuel level sender with a resistive-type analog signal is present, providing fuel gauge information to the instrument cluster/BCM.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null,
      "field_verify_required": false
    },
    {
      "slug": "sd4-67psd-fuel-filter-primary",
      "description": "A primary fuel filter and water separator assembly is located on the driver-side frame rail, downstream of the lift pump and upstream of the CP4.2, incorporating a WIF sensor and manual drain.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null,
      "field_verify_required": false
    },
    {
      "slug": "sd4-67psd-wif-sensor-signal",
      "description": "The water-in-fuel sensor is integrated into the frame-rail primary fuel filter housing and provides a signal to the PCM, but exact wire count, signal type, and connector pinout are not reliably confirmed in training data.",
      "source_provenance": "GAP",
      "inference_class": null,
      "field_verify_required": true
    },
    {
      "slug": "sd4-67psd-cp42-pump-type",
      "description": "The 2017–2022 6.7L Power Stroke uses a Bosch CP4.2 high-pressure common rail fuel pump, gear-driven off the engine front geartrain at the front cover.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null,
      "field_verify_required": false
    },
    {
      "slug": "sd4-67psd-cp42-max-rail-pressure",
      "description": "The CP4.2 commands fuel rail pressure up to approximately 29,000 PSI under peak demand, but the exact PCM-calibrated maximum for the 2018 tune requires field confirmation via live scan data.",
      "source_provenance": "GAP",
      "inference_class": null,
      "field_verify_required": true
    },
    {
      "slug": "sd4-67psd-hp-fuel-rails",
      "description": "Two steel high-pressure fuel rails (one per cylinder bank) connect the CP4.2 to the eight fuel injectors.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null,
      "field_verify_required": false
    },
    {
      "slug": "sd4-67psd-imv-inlet-metering-valve",
      "description": "An inlet metering valve (IMV) is integrated into the CP4.2 pump body; it is a normally-open, PWM-controlled solenoid commanded by the PCM to regulate fuel volume entering the high-pressure circuit.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null,
      "field_verify_required": false
    },
    {
      "slug": "sd4-67psd-fuel-rail-pressure-sensor",
      "description": "At least one three-wire fuel rail pressure sensor (5V reference, analog voltage signal, ground) is present on the high-pressure rail; the PCM uses it for closed-loop fuel pressure control.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null,
      "field_verify_required": false
    },
    {
      "slug": "sd4-67psd-injector-type",
      "description": "The 2018 6.7L Power Stroke uses Bosch solenoid-type (not piezoelectric) common rail injectors driven by high-voltage/high-current PWM signals from the PCM's injector driver circuits.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null,
      "field_verify_required": false
    },
    {
      "slug": "sd4-67psd-injector-count",
      "description": "Eight fuel injectors are present, one per cylinder, in a V8 configuration.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null,
      "field_verify_required": false
    },
    {
      "slug": "sd4-67psd-fuel-return-system",
      "description": "A passive low-pressure fuel return circuit routes excess fuel from the high-pressure rail overflow/pressure limiting valve back to the tank or filter housing; no active pump is used in the return circuit.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null,
      "field_verify_required": false
    },
    {
      "slug": "sd4-67psd-rail-pressure-relief-valve",
      "description": "A mechanical rail pressure limiting valve is present on the high-pressure rail to protect against overpressure events, but its exact factory-set cracking pressure is not confirmed in training data.",
      "source_provenance": "GAP",
      "inference_class": null,
      "field_verify_required": true
    },
    {
      "slug": "sd4-67psd-pcm-identity-location",
      "description": "The Powertrain Control Module (PCM), mounted on the passenger-side firewall in the engine compartment, is the sole primary controller for all fuel system actuators including the IMV, injectors, and lift pump relay.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null,
      "field_verify_required": false
    },
    {
      "slug": "sd4-67psd-pcm-network",
      "description": "The PCM communicates on the high-speed CAN bus (HS-CAN, 500 kbps), broadcasting all fuel system PIDs including rail pressure, injector duty cycle, WIF status, and lift pump status.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null,
      "field_verify_required": false
    },
    {
      "slug": "sd4-67psd-pcm-module-fuel-comms",
      "description": "The PCM shares fuel-related CAN data with the Instrument Cluster (WIF warning lamp, fuel gauge) and the ABS/Traction Control module (torque management integration); no separate dedicated fuel control module exists.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null,
      "field_verify_required": false
    },
    {
      "slug": "sd4-67psd-lift-pump-relay-location",
      "description": "The lift pump relay is housed in the Battery Junction Box (BJB) or Smart Junction Box (SJB) in the engine compartment, but exact relay cavity designation requires Ford WSM or FDRS confirmation for the 2018 model year.",
      "source_provenance": "GAP",
      "inference_class": null,
      "field_verify_required": true
    },
    {
      "slug": "sd4-67psd-no-evap-system",
      "description": "As a diesel application, the 6.7L Power Stroke has no EVAP canister or purge system; the fuel cap is a standard non-pressurized diesel cap.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null,
      "field_verify_required": false
    },
    {
      "slug": "sd4-67psd-def-system-relationship",
      "description": "A separate DEF (urea/AdBlue) tank on the passenger-side frame rail feeds the SCR dosing system; DEF pump, injector, and level/quality sensor are PCM-controlled via CAN and interact with fuel combustion quality for emissions compliance.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null,
      "field_verify_required": false
    },
    {
      "slug": "sd4-67psd-cp42-fuel-lubrication-dependency",
      "description": "The CP4.2 pump is lubricated entirely by diesel fuel with no separate oil circuit, making fuel lubricity, contamination, and water content directly and architecturally critical to pump longevity.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null,
      "field_verify_required": false
    },
    {
      "slug": "sd4-67psd-fuel-heater-option",
      "description": "An electrically heated fuel filter element or fuel line heater may be present on some 4th-gen Super Duty builds as a factory option for cold-weather operation, but its availability and exact location on the 2018 F-250 require WSM or build-sheet confirmation.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": null,
      "field_verify_required": true
    },
    {
      "slug": "sd4-67psd-fuel-filter-part-number",
      "description": "The OEM primary fuel filter part number for the 2018 6.7L Power Stroke is not reliably confirmed in training data and must be verified against the current Ford parts catalog.",
      "source_provenance": "GAP",
      "inference_class": null,
      "field_verify_required": true
    }
  ]
}
```

---

## Phase 2 findings from this dry run

### Finding 1: Subagent miscounted its own facts (refusal-protocol failure)

The prompt explicitly instructs: *"Verify N = C + I + G. If the math fails, re-count and re-write. Do NOT estimate."*

The subagent stated "C = 18, I = 1, G = 5. N = 24. Verified." But counting the actual facts in its own table:
- Confirmed: F1, F2, F3, F4, F6, F8, F9, F10, F11, F12, F13, F15, F16, F17, F19, F20, F21 = **17** (not 18)
- Inferred: F22 = **1**
- Gap: F5, F7, F14, F18, F23 = **5**
- Total: **23**, not 24

The arithmetic 18 + 1 + 5 = 24 is internally consistent BUT the count of 18 confirmed was itself wrong. The refusal-protocol check passed only because the subagent miscounted one input and didn't catch it.

**Implication for Phase 3:** the production translator must run the count check programmatically (`json.architecture_facts.length` vs prose-stated N) and reject any subagent output where they disagree. The prompt's own "re-count if math fails" rule is not sufficient — the subagent can produce internally-consistent-but-wrong numbers and self-verify them as correct.

### Finding 2: JSON sidecar shape maps cleanly to schema (no translation needed for Prompt 1)

Every field in the JSON corresponds 1:1 to a `platforms` or `architecture_facts` column. The enum values used (`TRAINING-CONFIRMED`, `TRAINING-INFERRED`, `GAP`) are valid schema enums. `inference_class` correctly set to `null` for all facts (Prompt 1 surfaces training-data recall, not first-principles inferences). No prompt-vocab vs schema-enum mismatches surfaced at this prompt.

### Finding 3: Prompt 1 output mixes diagnostic content with architectural content

The "KNOWN FAILURE PATTERNS" section (P1-P7) contains diagnostic priors that Prompt 3 will need for test ordering. The current pipeline design discards these — they're documented in prose but not stored as `architecture_facts` rows. This means Prompt 3 (which only sees the structured model from Prompt 2) has no access to "CP4.2 catastrophic failure is the most common cause" prior knowledge.

**Question for Brandon:** should failure patterns become their own table, or get carried into Prompt 2's input as part of the narration, or stay as prose-only context?

### Finding 4: Slug specificity is good but verbose

Slugs like `sd4-67psd-cp42-fuel-lubrication-dependency` are 39 characters. They're correct (kebab-case, lowercase, platform-prefixed, distinctive) but long. Probably fine — slug is `TEXT` in Postgres, no length limit, and human-readability outweighs storage cost.

### Finding 5: Subagent quality is excellent on a first pass

The fuel system architecture is technically correct (gear-driven CP4.2, frame-rail filter housing with WIF, two-rail V8 configuration, PCM-direct control). The GAP markings are appropriately conservative (wire colors, exact pressures, exact part numbers, exact relay cavities). Training-data limits section is well-aligned with the prompt's intent. The subagent did NOT fabricate part numbers despite the temptation to do so — refusal protocol held on that axis.

### Finding 6: The "INFERRED" count of 1 is low

Only one fact (F22 fuel heater option) was tagged TRAINING-INFERRED. This is either (a) the subagent being too confident across the board, or (b) genuinely most facts about a CP4.2 6.7L PSD fuel system being TRAINING-CONFIRMED (this is a well-documented platform). Brandon's vet step is the test — if he doesn't catch any corrections, the high CONFIRMED rate was warranted.
