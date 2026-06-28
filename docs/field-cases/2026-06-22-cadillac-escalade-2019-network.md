# Field case — 2019 Cadillac Escalade, module-network / ADAS (mid-diagnosis)

**Captured:** 2026-06-22 · **Source:** Brandon, his bay (mid-job) · **Coverage status:** OUT (resolver returns null — Cadillac is not Ford/Ram; gas SUV; concern is network/ADAS, no related system seeded)

## Truck profile
- **Year/Make/Model:** 2019 Cadillac Escalade
- **Engine:** 6.2L V8 gas (only Escalade engine that year) — confirm
- **VIN:** on the scan (redacted here — customer-identifying)

## Complaint (as received)
Customer reported an **ABS warning light / message on**. **Not active right now** — Brandon sees no warning lights illuminated at the moment → **intermittent**. Many stored codes across the module network. _Full code list pending._

## What the scan shows (Phoenix Elite, "Automatically Search")
- A **module-network topology** view on bus **CAN(3,11)**.
- Modules visible include **ASCM** (Active Safety Control Module), **HMI/HMIC** (Human-Machine Interface), **LRRSM** (Long-Range Radar Sensor Module) — i.e. the **ADAS / driver-assist** cluster.
- Several modules rendered red (typical scan-tool convention for no-communication / fault); at least one green.
- Reads like a **lost-communication / module-offline** investigation on the safety/ADAS network — but **not confirmed**; Brandon is still working it.

## Codes (given verbally by Brandon 2026-06-22 — scan photos were cleared; these are the codes still returning)
| Module | Code | Standard meaning (verify) |
|---|---|---|
| EBCM (Electronic Brake Control Module) | **U0422-71** | Invalid data received from Body Control Module |
| BCM | **C0750-03** | Left-front tire pressure sensor |
| BCM | **C0755-03** | Right-front tire pressure sensor |
| BCM | **C0760-03** | **Left-rear** tire pressure sensor |
| BCM | **C0765-03** | **Right-rear** tire pressure sensor |
| BCM | **C0775** | TPMS general system |

**Verified 2026-06-22** (GM service-manual mirrors + a GM TPMS service bulletin + a near-identical real-world case; strong but second-hand — no first-party GM SI page was fetchable, auth-blocked). Corrections vs the first pass: corner mapping was **C0760 = LEFT rear, C0765 = RIGHT rear** (had them flipped). `-03` = **low voltage**. `-71` = GM **"invalid serial data received"** (a data/network byte — NOT the generic SAE "actuator stuck").

## Findings (leading hypothesis — verified read, Brandon's call · confidence: MEDIUM)
- **One shared cause on the BCM DATA PATH** — most likely **power/ground or the gateway (SDGM)/its connectors** corrupting bus traffic — NOT five independent failures. The BCM is the only node common to every code (it sets all four TPMS C-codes AND is the source the EBCM rejects via U0422). Four corner sensors don't drop at the same instant; "all four corners + C0775 + U0422" is a textbook central-failure signature.
- **Don't condemn parts:** the BCM is usually the innocent *messenger* the EBCM names. GM doctrine on U0422 = fix the source/network; BCM/EBCM/sensor replacement is last. Check for a **BCM/SDGM software-update PI/TSB** before any hardware.
- **Intermittent ABS light fits:** a connector/ground/voltage/gateway fault comes and goes; dead parts don't self-heal on a key cycle.
- **Honest competing read (real, not a strawman):** `-03 = low voltage` is also the classic signature of **dying TPMS sensor batteries**, and this is a ~6-7-yr-old truck on likely-original sensors. So "four weak same-age sensors + a separate network gremlin" is genuinely possible.
- **The single test that splits the two worlds:** trigger each wheel sensor with a TPMS tool while watching live data, AND do a **BCM power/ground voltage-drop under a wiggle/load** (full B+C+U scan open):
  - sensors respond good at the wheel but BCM shows no/invalid data → fault is **upstream, one common cause**.
  - sensors genuinely weak at the wheel AND BCM grounds clean AND U0422 persists with stable supply → **two separate problems** (replace sensors, chase the network fault independently).
  - if any one corner shows a *different* byte (e.g. -29/-39) instead of uniform -03, that fractures the single-supply read.
- Open architecture caveat: whether the 2019 build uses a discrete RCDLR receiver vs a BCM-integrated receiver is medium-confidence; a discrete receiver/antenna failure could drop all four sensors but would NOT explain U0422, so it ranks below power/ground + gateway causes.

## Elimination log (live, as Brandon works it)
1. **2026-06-22 ~1:48pm — Wheel speed sensors RULED OUT.** Graphed all four WSS live from the EBCM data stream across a speed sweep (LF/LR ~19.26, RF/RR ~20.51 mph at capture); all four traces smooth and tracking together, **no dropout at any speed.** → The intermittent ABS warning is **not** a brake-input/WSS fault. Consistent with the EBCM simply reacting to **U0422** (bad serial data from the BCM) — a data/network event, not a brake fault.
   - Scope note: this rules out the **wheel-speed (ABS) sensors**, NOT the **TPMS (tire-pressure) sensors.** The TPMS one-cause-vs-two question is still open.

## Root cause
_TBD — Brandon working it. ABS/WSS side eliminated; still open: BCM data-path (one cause) vs weak TPMS sensors (two problems)._

## Why it's out of coverage
Three independent reasons: make is Cadillac (resolver handles only Ford + Ram diesel); it's a gas SUV; and the concern is module-network / ADAS comms — a system with nothing seeded. `resolvePlatformSlug` → null.

## Pattern note
Widens the real-bay spread beyond diesel trucks: Brandon also runs **luxury-SUV network/ADAS** diagnostics. Two things worth holding:
1. The "fill what I'm seeing" surface is broader than the Ford/Ram diesel beachhead — useful signal for what real shops actually touch.
2. His pro scan tool (Phoenix Elite) presents the fault **as a network topology** — the same surface Vyntechs' tool is built around. Real diagnosticians already think in topology.
