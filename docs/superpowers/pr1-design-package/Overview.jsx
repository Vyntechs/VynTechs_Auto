/* PR 1 — Cached Diagnostic Overview · components + screens
   New primitives layered on top of the technician-phone kit.
   Everything attached to `window` so other babel scripts can use it. */

const { useState } = React;

/* ============================================================
   PRIMITIVES
   ============================================================ */

const ScenarioChip = ({ children }) => (
  <span className="scenario-chip">{children}</span>
);

// Observation-method chip — Phosphor glyph + caps label.
// Only used when a glyph adds real signal; same set the AI emits.
const METHOD_ICON = {
  PID: "gauge",
  VISUAL: "eye",
  AUDIBLE: "ear",
  SMELL: "wind",
  MEASUREMENT: "ruler",
  BENCH: "wrench",
};
const MethodChip = ({ method }) => (
  <span className="method-chip">
    <i className={`ph ph-${METHOD_ICON[method] || "circle"}`} />
    {method}
  </span>
);

// Five-dot invasiveness. Filled dots = cost to commit.
// 1 = read a PID. 5 = remove a part.
const InvasivenessDots = ({ value }) => (
  <span className="inv-dots" data-level={value}>
    <span className="inv-dots__row">
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={`dot ${i <= value ? "filled" : ""}`} />
      ))}
    </span>
    <span className="inv-dots__label">inv · {value}</span>
  </span>
);

// Vertical "rung" graphic — invasiveness expressed as stacked rungs,
// echoing the brand sigil (the bounded retrieval ladder).
const InvasivenessRung = ({ value }) => (
  <div className="inv-rung" data-level={value}>
    {[1, 2, 3, 4, 5].map((i) => (
      <div key={i} className={`rung ${i <= value ? "filled" : ""}`} />
    ))}
  </div>
);

// Cumulative-confidence gate. Compact horizontal bar with a needle.
const ConfidenceGate = ({ gate }) => (
  <div className="cov-gate">
    <span className="cov-gate__label">Gate</span>
    <div className="cov-gate__track">
      <div className="cov-gate__mark" style={{ left: `${gate * 100}%` }} />
    </div>
    <span className="cov-gate__val">≥ {(gate * 100).toFixed(0)} %</span>
  </div>
);

// Brand sigil — ladder-of-rungs. Rendered as inline SVG.
const Sigil = ({ size = 56 }) => (
  <svg
    className="cov-sigil"
    width={size} height={size * 1.43}
    viewBox="0 0 56 80"
    aria-hidden="true"
  >
    {/* two side rails */}
    <line x1="10" y1="6" x2="10" y2="74" stroke="var(--vt-amber-500)" strokeWidth="2" strokeLinecap="round"/>
    <line x1="46" y1="6" x2="46" y2="74" stroke="var(--vt-amber-500)" strokeWidth="2" strokeLinecap="round"/>
    {/* rungs — top-down: top 2 amber (rungs gathered), bottom 2 hairlines (rungs unknown) */}
    <line x1="10" y1="18" x2="46" y2="18" stroke="var(--vt-amber-500)" strokeWidth="2" strokeLinecap="round"/>
    <line x1="10" y1="35" x2="46" y2="35" stroke="var(--vt-amber-500)" strokeWidth="2" strokeLinecap="round"/>
    <line x1="10" y1="52" x2="46" y2="52" stroke="var(--vt-bone-400)" strokeWidth="1" strokeDasharray="2 3" strokeLinecap="round"/>
    <line x1="10" y1="69" x2="46" y2="69" stroke="var(--vt-bone-400)" strokeWidth="1" strokeDasharray="2 3" strokeLinecap="round"/>
  </svg>
);

/* ============================================================
   SHARED STRUCTURE
   ============================================================ */

const VehicleStripCached = ({ name, vin }) => (
  <div className="vehicle-strip" style={{alignItems:'center'}}>
    <div>
      <div className="vehicle-name">{name}</div>
      <div className="vin">{vin}</div>
    </div>
    <span className="cov-instant">cached · instant</span>
  </div>
);

const SymptomHero = ({ dtc, name, gate, corpusMatches }) => (
  <div className="cov-symptom">
    <div className="cov-symptom__eyebrow">
      <span>Matched symptom</span>
      <span className="cov-symptom__dtc">{dtc}</span>
    </div>
    <h1 className="cov-symptom__name">{name}</h1>
    <div className="cov-symptom__meta">
      <span>{corpusMatches} prior fixes · cross-shop corpus</span>
    </div>
    <ConfidenceGate gate={gate} />
  </div>
);

const PlanHeader = ({ count, sortLabel = "By information value" }) => (
  <div className="cov-plan-header">
    <span className="cov-plan-header__lead">Test plan</span>
    <span className="cov-plan-header__count">
      <strong>{count}</strong> steps · {sortLabel}
    </span>
  </div>
);

const CtaBar = ({ leadLeft = "Step 1 of plan", leadRight = "no commit", label = "Start the walk" }) => (
  <div className="cov-cta">
    <div className="cov-cta__lead">
      <span>{leadLeft}</span>
      <span>{leadRight}</span>
    </div>
    <button className="cov-cta__btn">
      <span>{label}</span>
      <i className="ph ph-arrow-right" />
    </button>
  </div>
);

/* ============================================================
   TEST DATA — P0087 (Fuel Rail Pressure Too Low) on 6.7L PSD
   ============================================================ */

const P0087_TESTS = [
  { p: 1,  name: "Read Fuel Rail Pressure PID at idle",                     sc: "IDLE",     m: "PID",         exp: "23,000–24,500 psi within 10 s of start",   inv: 1 },
  { p: 2,  name: "Read Fuel Rail Pressure PID during cranking",             sc: "CRANKING", m: "PID",         exp: "min 5,000 psi during crank",                inv: 1 },
  { p: 3,  name: "Compare commanded vs actual rail pressure",               sc: "IDLE",     m: "PID",         exp: "Δ ≤ 1,500 psi after warm-up",               inv: 1 },
  { p: 4,  name: "Check fuel control valve duty cycle",                     sc: "IDLE",     m: "PID",         exp: "8–18 % at warm idle",                       inv: 1 },
  { p: 5,  name: "Listen for HPP whine or metallic hammer",                 sc: "IDLE",     m: "AUDIBLE",     exp: "smooth pump tone, no metallic knock",       inv: 1 },
  { p: 6,  name: "Inspect HFCM bowl for water or debris",                   sc: "KOEO",     m: "VISUAL",      exp: "no water layer, no metallic glitter",       inv: 2 },
  { p: 7,  name: "Smell return lines for raw diesel under load",            sc: "RUNNING",  m: "SMELL",       exp: "no diesel odor at the manifold returns",    inv: 2 },
  { p: 8,  name: "Measure low-pressure supply at HFCM outlet",              sc: "RUNNING",  m: "MEASUREMENT", exp: "55–65 psi steady, no pulsing",              inv: 2 },
  { p: 9,  name: "Test injector return flow with corpus rig",               sc: "RUNNING",  m: "MEASUREMENT", exp: "≤ 200 mL / 30 s per bank",                  inv: 3 },
  { p: 10, name: "Cap return and measure rail bleed-down",                  sc: "KOEO",     m: "MEASUREMENT", exp: "≥ 4,000 psi held for 30 s after shutdown",  inv: 3 },
  { p: 11, name: "Verify rail pressure relief valve seat",                  sc: "RUNNING",  m: "MEASUREMENT", exp: "no return flow at the relief outlet",       inv: 4 },
  { p: 12, name: "Test high-pressure pump output direct",                   sc: "CRANKING", m: "MEASUREMENT", exp: "≥ 17,000 psi cranking, dead-headed",        inv: 4 },
  { p: 13, name: "Remove rail; bench-test injector spray patterns",         sc: "BENCH",    m: "VISUAL",      exp: "even cone, no dribble, balanced flow",      inv: 5 },
];

// No-start, cranks normally — 19 tests, condensed for the long-list demo.
const NOSTART_TESTS = [
  { p: 1,  name: "Confirm complaint — crank, no fire, no smoke",           sc: "CRANKING", m: "AUDIBLE",     exp: "engine cranks evenly, no combustion",       inv: 1 },
  { p: 2,  name: "Read DTCs + freeze-frame",                                sc: "KOEO",     m: "PID",         exp: "capture all stored / pending codes",        inv: 1 },
  { p: 3,  name: "Verify fuel level by gauge + tap",                        sc: "KOEO",     m: "VISUAL",      exp: "≥ ¼ tank, gauge agrees with tank tap",      inv: 1 },
  { p: 4,  name: "Read Fuel Rail Pressure PID at crank",                    sc: "CRANKING", m: "PID",         exp: "≥ 5,000 psi achieved during crank",         inv: 1 },
  { p: 5,  name: "Read RPM + sync PIDs at crank",                           sc: "CRANKING", m: "PID",         exp: "stable 200–250 rpm, CKP/CMP sync OK",       inv: 1 },
  { p: 6,  name: "Check glow-plug status PID + IAT",                        sc: "KOEO",     m: "PID",         exp: "GPCM cycles when IAT < 50 °F",              inv: 1 },
  { p: 7,  name: "Listen for HFCM prime cycle on key-on",                   sc: "KOEO",     m: "AUDIBLE",     exp: "audible 2–3 s pump prime",                  inv: 1 },
  { p: 8,  name: "Smell exhaust at tailpipe during crank",                  sc: "CRANKING", m: "SMELL",       exp: "no diesel odor = no injection event",       inv: 2 },
  { p: 9,  name: "Inspect HFCM bowl for water / debris",                    sc: "KOEO",     m: "VISUAL",      exp: "no water layer, no metallic glitter",       inv: 2 },
  { p: 10, name: "Measure low-pressure supply at HFCM outlet",              sc: "CRANKING", m: "MEASUREMENT", exp: "≥ 55 psi during crank, no pulsing",         inv: 2 },
  { p: 11, name: "Verify glow-plug coil current draw, all 8",               sc: "KOEO",     m: "MEASUREMENT", exp: "15–20 A per coil, balanced",                inv: 3 },
  { p: 12, name: "Check CKP signal at crank with scope",                    sc: "CRANKING", m: "MEASUREMENT", exp: "clean square wave, no missing teeth",       inv: 3 },
  { p: 13, name: "Check CMP signal at crank with scope",                    sc: "CRANKING", m: "MEASUREMENT", exp: "clean square wave, sync with CKP",          inv: 3 },
  { p: 14, name: "Verify injector control signal at harness",               sc: "CRANKING", m: "MEASUREMENT", exp: "command pulses observed, all 8",            inv: 3 },
  { p: 15, name: "Test injector return flow with corpus rig",               sc: "CRANKING", m: "MEASUREMENT", exp: "≤ 200 mL / 30 s per bank",                  inv: 3 },
  { p: 16, name: "Verify HPP cam-side drive integrity",                     sc: "KOEO",     m: "VISUAL",      exp: "cam coupler intact, no shear",              inv: 4 },
  { p: 17, name: "Test HPP output dead-headed",                             sc: "CRANKING", m: "MEASUREMENT", exp: "≥ 17,000 psi cranking, dead-headed",        inv: 4 },
  { p: 18, name: "Check valvetrain on suspect bank",                        sc: "BENCH",    m: "VISUAL",      exp: "no bent valves, no broken springs",         inv: 5 },
  { p: 19, name: "Compression test, all 8 cylinders",                       sc: "BENCH",    m: "MEASUREMENT", exp: "≥ 350 psi, ≤ 10 % spread",                  inv: 5 },
];

/* ============================================================
   V1 LEDGER ROW — serif-led, hairline rows
   ============================================================ */

const RowLedger = ({ t }) => (
  <div className="cov-row">
    <div className="cov-row__prio">{String(t.p).padStart(2, "0")}</div>
    <div className="cov-row__body">
      <div className="cov-row__name">{t.name}</div>
      <div className="cov-row__chips">
        <ScenarioChip>{t.sc}</ScenarioChip>
        <MethodChip method={t.m} />
      </div>
      <div className="cov-row__expected"><b>expect</b>{t.exp}</div>
    </div>
    <div className="cov-row__inv">
      <InvasivenessDots value={t.inv} />
    </div>
  </div>
);

/* ============================================================
   V2 TAPE ROW — column-aligned, mono-dense
   ============================================================ */

const RowTape = ({ t }) => (
  <div className="cov-tape__row">
    <div className="cov-tape__prio">{String(t.p).padStart(2, "0")}</div>
    <div>
      <div className="cov-tape__name">{t.name}</div>
      <div className="cov-tape__meta">
        <span>{t.sc}</span><span className="dot"/>
        <span>{t.m}</span>
      </div>
      <div className="cov-tape__expected">{t.exp}</div>
    </div>
    <div className="cov-tape__col-exp" />
    <div className="cov-tape__col-inv" data-level={t.inv}>
      {"●".repeat(t.inv)}{"○".repeat(5 - t.inv)}
    </div>
  </div>
);

/* ============================================================
   V3 RUNG ROW — invasiveness-led, tactile
   ============================================================ */

const RowRung = ({ t }) => (
  <div className="cov-rung-row">
    <InvasivenessRung value={t.inv} />
    <div className="cov-rung-row__prio">{String(t.p).padStart(2, "0")}</div>
    <div className="cov-row__body">
      <div className="cov-row__name">{t.name}</div>
      <div className="cov-row__chips">
        <ScenarioChip>{t.sc}</ScenarioChip>
        <MethodChip method={t.m} />
      </div>
      <div className="cov-row__expected"><b>expect</b>{t.exp}</div>
    </div>
  </div>
);

/* ============================================================
   SCREENS — Mobile cached overview, three variations
   ============================================================ */

const ScreenLedger = ({ tests = P0087_TESTS, dtc = "P0087", name = "Fuel rail pressure too low" }) => (
  <div className="cov-app">
    <VehicleStripCached
      name="2018 Ford F-250 — 6.7L Power Stroke Diesel"
      vin="VIN · 1FT7W2BT5JEC12345 · 92,430 mi"
    />
    <SymptomHero dtc={dtc} name={name} gate={0.85} corpusMatches={tests === NOSTART_TESTS ? 71 : 47} />
    <PlanHeader count={tests.length} />
    <div className="cov-list" style={{flex: 1, overflowY: "auto"}}>
      {tests.map((t) => <RowLedger key={t.p} t={t} />)}
    </div>
    <CtaBar />
  </div>
);

const ScreenTape = ({ tests = P0087_TESTS }) => (
  <div className="cov-app">
    <VehicleStripCached
      name="2018 Ford F-250 — 6.7L Power Stroke Diesel"
      vin="VIN · 1FT7W2BT5JEC12345 · 92,430 mi"
    />
    <SymptomHero dtc="P0087" name="Fuel rail pressure too low" gate={0.85} corpusMatches={47} />
    <div className="cov-tape__head">
      <span>#</span>
      <span>Test &middot; condition</span>
      <span>Expect</span>
      <span>Inv</span>
    </div>
    <div className="cov-tape" style={{flex: 1, overflowY: "auto"}}>
      {tests.map((t) => <RowTape key={t.p} t={t} />)}
    </div>
    <CtaBar />
  </div>
);

const ScreenRung = ({ tests = P0087_TESTS }) => (
  <div className="cov-app">
    <VehicleStripCached
      name="2018 Ford F-250 — 6.7L Power Stroke Diesel"
      vin="VIN · 1FT7W2BT5JEC12345 · 92,430 mi"
    />
    <SymptomHero dtc="P0087" name="Fuel rail pressure too low" gate={0.85} corpusMatches={47} />
    <PlanHeader count={tests.length} sortLabel="Cheap reads first" />
    <div className="cov-list" style={{flex: 1, overflowY: "auto"}}>
      {tests.map((t) => <RowRung key={t.p} t={t} />)}
    </div>
    <CtaBar />
  </div>
);

/* Long-list stress test — no-start (19 tests) using the Ledger row */
const ScreenLongList = () => (
  <ScreenLedger
    tests={NOSTART_TESTS}
    dtc="NO-DTC"
    name="No-start — cranks normally, no fire"
  />
);

/* ============================================================
   EMPTY STATE — "first time we've seen this combo"
   ============================================================ */

const ScreenEmpty = () => (
  <div className="cov-empty">
    <div className="cov-empty__body">
      <span className="cov-empty__eyebrow">Not in the library</span>

      <Sigil size={48} />

      <h1 className="cov-empty__headline">
        First time we’ve seen this one.
      </h1>

      <p className="cov-empty__sub">
        No matching diagnostic is cached for this vehicle and complaint.
        I can build a custom plan from the corpus — 30–60 seconds — and
        every identical complaint after this loads instantly.
      </p>

      <div className="cov-empty__ctx">
        <div className="cov-empty__ctx-row">
          <span>Vehicle</span>
          <b>2018 Ford F-250 — 6.7L Power Stroke</b>
        </div>
        <div className="cov-empty__ctx-row">
          <span>Complaint</span>
          <b>Rough idle after cold start, clears after 90 s</b>
        </div>
        <div className="cov-empty__ctx-row">
          <span>Mileage</span>
          <b>92,430 mi</b>
        </div>
      </div>

      <div>
        <span className="cov-empty__eyebrow" style={{marginBottom:8, display:'flex'}}>What happens next</span>
        <div className="cov-empty__steps">
          <div className="cov-empty__step">
            <span className="cov-empty__step-num">01</span>
            <span className="cov-empty__step-body">
              I rank similar fixes from 4,200+ shop records.
              <span className="cov-empty__step-meta">~10 s · corpus retrieval</span>
            </span>
          </div>
          <div className="cov-empty__step">
            <span className="cov-empty__step-num">02</span>
            <span className="cov-empty__step-body">
              I build an ordered test plan with confidence gates.
              <span className="cov-empty__step-meta">~30 s · tree generation</span>
            </span>
          </div>
          <div className="cov-empty__step">
            <span className="cov-empty__step-num">03</span>
            <span className="cov-empty__step-body">
              The plan joins the library — instant for the next tech.
              <span className="cov-empty__step-meta">corpus gain · +1</span>
            </span>
          </div>
        </div>
      </div>
    </div>
    <div className="cov-empty__cta-wrap">
      <button className="cov-cta__btn">
        <span>Generate a diagnostic with AI</span>
        <i className="ph ph-arrow-right" />
      </button>
    </div>
  </div>
);

/* ============================================================
   DESKTOP — wider grid layout
   ============================================================ */

const DesktopOverview = () => (
  <div className="cov-desktop">
    <aside className="cov-desktop__rail">
      <div className="cov-desktop__brand">
        <span style={{display:'inline-block', width:10, height:14}}>
          <svg viewBox="0 0 56 80" width="10" height="14">
            <line x1="10" y1="6" x2="10" y2="74" stroke="currentColor" strokeWidth="6" strokeLinecap="round"/>
            <line x1="46" y1="6" x2="46" y2="74" stroke="currentColor" strokeWidth="6" strokeLinecap="round"/>
            <line x1="10" y1="22" x2="46" y2="22" stroke="currentColor" strokeWidth="6" strokeLinecap="round"/>
            <line x1="10" y1="42" x2="46" y2="42" stroke="currentColor" strokeWidth="6" strokeLinecap="round"/>
            <line x1="10" y1="62" x2="46" y2="62" stroke="currentColor" strokeWidth="6" strokeLinecap="round"/>
          </svg>
        </span>
        Vyntechs
      </div>
      <div>
        <span className="cov-desktop__back">
          <i className="ph ph-arrow-left" /> Back to sessions
        </span>
        <div className="cov-desktop__vehicle-name">
          2018 Ford F-250 — 6.7L Power Stroke Diesel
        </div>
        <div className="cov-desktop__vin">
          VIN · 1FT7W2BT5JEC12345<br/>
          92,430 mi · last seen 2024-11-07
        </div>
      </div>
      <div>
        <div style={{fontFamily:'var(--vt-font-mono)', fontSize:9, fontWeight:600, letterSpacing:'0.18em', textTransform:'uppercase', color:'var(--vt-fg-3)', marginBottom:10}}>
          Cached diagnostic
        </div>
        <div style={{display:'flex', flexDirection:'column', gap:6, fontFamily:'var(--vt-font-mono)', fontSize:10, color:'var(--vt-fg-3)', letterSpacing:'0.06em', lineHeight:1.7}}>
          <div><span style={{color:'var(--vt-fg-2)'}}>13</span> ordered tests</div>
          <div><span style={{color:'var(--vt-fg-2)'}}>5</span> observation methods</div>
          <div><span style={{color:'var(--vt-fg-2)'}}>47</span> corpus matches</div>
          <div><span style={{color:'var(--vt-fg-2)'}}>0.85</span> commit gate</div>
        </div>
      </div>
      <div style={{borderTop:'0.5px solid var(--vt-rule)', paddingTop:18}}>
        <div style={{fontFamily:'var(--vt-font-mono)', fontSize:9, fontWeight:600, letterSpacing:'0.18em', textTransform:'uppercase', color:'var(--vt-fg-3)', marginBottom:10}}>
          Tech
        </div>
        <div style={{fontFamily:'var(--vt-font-serif)', fontSize:15}}>Marcus Reyes</div>
        <div style={{fontFamily:'var(--vt-font-mono)', fontSize:10, color:'var(--vt-fg-3)', letterSpacing:'0.06em', marginTop:2}}>BAY 3 · DIESEL</div>
      </div>
    </aside>
    <main className="cov-desktop__main">
      <div className="cov-desktop__topbar">
        <div className="cov-desktop__topbar-meta">
          <span>Session 4F-7C2A</span>
          <span className="sep" />
          <span>Created 0:00 ago</span>
          <span className="sep" />
          <span style={{color:'var(--vt-amber-500)'}}>● Cached — Instant</span>
        </div>
        <div className="cov-desktop__topbar-meta">
          <span>By information value</span>
        </div>
      </div>

      <div className="cov-desktop__hero">
        <div>
          <div className="cov-symptom__eyebrow">
            <span>Matched symptom</span>
            <span className="cov-symptom__dtc">P0087</span>
          </div>
          <h1 className="cov-desktop__symptom">
            Fuel rail pressure too low.
          </h1>
        </div>
        <div className="cov-desktop__gate-card">
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline'}}>
            <span style={{fontFamily:'var(--vt-font-mono)', fontSize:9, fontWeight:600, letterSpacing:'0.18em', textTransform:'uppercase', color:'var(--vt-fg-3)'}}>
              Commit gate
            </span>
            <span style={{fontFamily:'var(--vt-font-mono)', fontSize:18, fontWeight:600, color:'var(--vt-amber-500)', fontVariantNumeric:'tabular-nums'}}>
              ≥ 85.0 %
            </span>
          </div>
          <div className="cov-gate" style={{padding:'4px 0 0'}}>
            <div className="cov-gate__track" style={{flex:1}}>
              <div className="cov-gate__mark" style={{left:'85%'}} />
            </div>
          </div>
          <div style={{fontFamily:'var(--vt-font-mono)', fontSize:9.5, color:'var(--vt-fg-3)', letterSpacing:'0.08em', marginTop:4, lineHeight:1.5}}>
            No single test commits.<br/>
            Cumulative confidence must clear the gate.
          </div>
        </div>
      </div>

      <div className="cov-desktop__plan">
        <div className="cov-desktop__plan-head">
          <span>#</span>
          <span>Test</span>
          <span>Condition</span>
          <span>Method</span>
          <span>Expect</span>
          <span style={{textAlign:'right'}}>Inv</span>
        </div>
        {P0087_TESTS.map((t) => (
          <div key={t.p} className="cov-desktop__plan-row">
            <div className="prio">{String(t.p).padStart(2,"0")}</div>
            <div className="name">{t.name}</div>
            <div className="scenario"><ScenarioChip>{t.sc}</ScenarioChip></div>
            <div className="method"><MethodChip method={t.m} /></div>
            <div className="expected">{t.exp}</div>
            <div className="inv"><InvasivenessDots value={t.inv} /></div>
          </div>
        ))}
      </div>

      <div className="cov-desktop__cta-bar">
        <div className="cov-desktop__topbar-meta">
          <span>Step 1 will start with</span>
          <span className="sep" />
          <span style={{color:'var(--vt-fg-2)', fontFamily:'var(--vt-font-serif)', fontSize:14, textTransform:'none', letterSpacing:0}}>
            Read Fuel Rail Pressure PID at idle
          </span>
        </div>
        <button className="cov-cta__btn">
          <span>Start the walk</span>
          <i className="ph ph-arrow-right" />
        </button>
      </div>
    </main>
  </div>
);

/* ============================================================ */

Object.assign(window, {
  ScenarioChip, MethodChip, InvasivenessDots, InvasivenessRung,
  ConfidenceGate, Sigil,
  VehicleStripCached, SymptomHero, PlanHeader, CtaBar,
  ScreenLedger, ScreenTape, ScreenRung, ScreenLongList, ScreenEmpty,
  DesktopOverview,
  P0087_TESTS, NOSTART_TESTS,
});
