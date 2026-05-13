/* Placeholder phone screens — styled mini app shells using
   real --vt-* tokens so the marketing surface looks at home
   before Brandon ships real PNGs. Each tells one step of a
   coherent diagnostic session (2019 F-150 · 3.5L EcoBoost ·
   cyl 4 misfire after hot soak).

   Replace strategy: when real screenshot PNGs land in
   public/marketing/screenshots/{01-open,02-research,03-propose,
   04-confirm,05-lock}.png, swap each <ScreenIntake/> etc. for
   <img className="mk__phone__img" src="..." alt="..." />. */

export function ScreenIntake() {
  return (
    <div className="mk__screen--placeholder">
      <div className="mk__screen-bar">
        <span className="mk__screen-eyebrow">New session</span>
        <span className="mk__screen-title">Intake</span>
      </div>
      <div className="mk__screen-body">
        <div className="mk__screen-card">
          <div className="mk__screen-card__eyebrow">Vehicle</div>
          <div className="mk__screen-input">
            2019 Ford F-150 · 3.5L EcoBoost · 124k mi
          </div>
        </div>
        <div className="mk__screen-card">
          <div className="mk__screen-card__eyebrow">Complaint</div>
          <div className="mk__screen-input">
            Rough idle when warm. Misfire flagged on cyl 4. Customer says
            it&apos;s worse after a hot soak.
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <div className="mk__screen-card mk__screen-card--ready">
          <div className="mk__screen-card__eyebrow mk__screen-card__eyebrow--accent">
            Ready
          </div>
          <div className="mk__screen-card__h">Start diagnostic session</div>
        </div>
      </div>
    </div>
  )
}

export function ScreenResearch() {
  return (
    <div className="mk__screen--placeholder">
      <div className="mk__screen-bar">
        <span className="mk__screen-eyebrow">Step 02 · Research</span>
        <span className="mk__screen-title">Sources</span>
      </div>
      <div className="mk__screen-body">
        <div className="mk__screen-card">
          <div className="mk__screen-card__eyebrow">Vehicle-specific</div>
          <div className="mk__screen-card__h">
            2019 F-150 · 3.5L EcoBoost · P0304
          </div>
          <div className="mk__screen-card__sub">
            14 sources read · 4 high-relevance
          </div>
        </div>
        <div className="mk__screen-source">
          Ford TSB 21-2156 · cyl 4 misfire after hot soak
        </div>
        <div className="mk__screen-source">
          AllData wiring · cyl 4 injector harness
        </div>
        <div className="mk__screen-source">
          F150forum · 23 threads · resolved
        </div>
        <div className="mk__screen-source">iATN case · 2022 · same symptom</div>
        <div style={{ flex: 1 }} />
        <div className="mk__screen-card">
          <div className="mk__screen-card__eyebrow">Coverage</div>
          <div className="mk__screen-card__h">Strong evidence base</div>
          <div className="mk__screen-card__sub">
            Confident enough to propose checks.
          </div>
        </div>
      </div>
    </div>
  )
}

export function ScreenPropose() {
  return (
    <div className="mk__screen--placeholder">
      <div className="mk__screen-bar">
        <span className="mk__screen-eyebrow">Step 03 · Propose</span>
        <span className="mk__screen-title">Branch</span>
      </div>
      <div className="mk__screen-body">
        <div className="mk__screen-card mk__screen-card--accent">
          <div className="mk__screen-card__eyebrow mk__screen-card__eyebrow--accent">
            Next check
          </div>
          <div className="mk__screen-card__h">
            Inspect cyl 4 injector harness at the connector
          </div>
          <div className="mk__screen-card__sub">
            Why: TSB 21-2156 + 9 forum reports point here first.
          </div>
          <div className="mk__screen-card__row">
            <span className="mk__screen-confidence">
              <span
                className="mk__screen-confidence__bar"
                style={{ ['--mk-conf' as string]: '78%' }}
              />
              78 conf
            </span>
            <b>4 cites</b>
          </div>
        </div>
        <div className="mk__screen-card">
          <div className="mk__screen-card__eyebrow">Branch B · less likely</div>
          <div className="mk__screen-card__h">Coil-on-plug swap test</div>
          <div className="mk__screen-card__row">
            <span className="mk__screen-confidence">
              <span
                className="mk__screen-confidence__bar"
                style={{ ['--mk-conf' as string]: '34%' }}
              />
              34 conf
            </span>
            <span>2 cites</span>
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <div className="mk__screen-source">
          Tap any cite to see the source.
        </div>
      </div>
    </div>
  )
}

export function ScreenConfirm() {
  return (
    <div className="mk__screen--placeholder">
      <div className="mk__screen-bar">
        <span className="mk__screen-eyebrow">Step 04 · Confirm</span>
        <span className="mk__screen-title">What did you see?</span>
      </div>
      <div className="mk__screen-body">
        <div className="mk__screen-card">
          <div className="mk__screen-card__eyebrow">Check performed</div>
          <div className="mk__screen-card__h">Cyl 4 injector harness</div>
        </div>
        <div className="mk__screen-input">
          Connector latched but pin 2 is green-corroded. Cleaned and reseated —
          misfire count drops, comes back warm.
        </div>
        <div className="mk__screen-card mk__screen-card--accent">
          <div className="mk__screen-card__eyebrow mk__screen-card__eyebrow--accent">
            Updated branch
          </div>
          <div className="mk__screen-card__h">
            Harness fault, not the injector
          </div>
          <div className="mk__screen-card__sub">
            Confidence raised to 91. Next: ohm-test pin 2 back to the PCM.
          </div>
          <div className="mk__screen-card__row">
            <span className="mk__screen-confidence">
              <span
                className="mk__screen-confidence__bar"
                style={{ ['--mk-conf' as string]: '91%' }}
              />
              91 conf
            </span>
            <b>6 cites</b>
          </div>
        </div>
        <div style={{ flex: 1 }} />
      </div>
    </div>
  )
}

export function ScreenLock() {
  return (
    <div className="mk__screen--placeholder">
      <div className="mk__screen-bar">
        <span className="mk__screen-eyebrow">Step 05 · Locked</span>
        <span className="mk__screen-title">Diagnosis</span>
      </div>
      <div className="mk__screen-body">
        <div className="mk__screen-card mk__screen-card--ready">
          <div className="mk__screen-card__eyebrow mk__screen-card__eyebrow--accent">
            Locked finding
          </div>
          <div className="mk__screen-card__h">
            Cyl 4 injector harness · pin 2 fault
          </div>
          <div className="mk__screen-card__sub">
            High-resistance corrosion at the harness connector. Replacement of
            harness pigtail recommended; refresh adjacent grounds.
          </div>
          <div className="mk__screen-card__row">
            <span className="mk__screen-confidence">
              <span
                className="mk__screen-confidence__bar"
                style={{ ['--mk-conf' as string]: '94%' }}
              />
              94 conf
            </span>
            <b>8 cites</b>
          </div>
        </div>
        <div className="mk__screen-card">
          <div className="mk__screen-card__eyebrow">Phase 02 · Repair</div>
          <div className="mk__screen-card__h">Open repair coaching</div>
          <div className="mk__screen-card__sub">
            Step-by-step harness pigtail replacement, with torque + ground refresh.
          </div>
        </div>
        <div style={{ flex: 1 }} />
      </div>
    </div>
  )
}

export const SCREENS = [
  ScreenIntake,
  ScreenResearch,
  ScreenPropose,
  ScreenConfirm,
  ScreenLock,
] as const
