import { LaptopFrame } from './laptop-frame'
import { SCREENSHOTS } from './screenshots.config'

export function OnLaptop() {
  return (
    <section className="mk__section mk__on-laptop">
      <div className="mk-container">
        <div className="mk__on-laptop__head">
          <div className="mk__eyebrow">Also on the laptop</div>
          <h2 className="mk__h2">Bigger screen. Same brain.</h2>
        </div>
        <div className="mk__on-laptop__frame">
          <LaptopFrame image={SCREENSHOTS.laptopHero}>
            <LaptopPlaceholder />
          </LaptopFrame>
        </div>
      </div>
    </section>
  )
}

/* Placeholder until SCREENSHOTS.laptopHero is filled in. Mini app
   shell built from real --vt-* tokens, showing a locked-diagnosis
   moment so the laptop frame doesn't read as empty. */
function LaptopPlaceholder() {
  return (
    <div className="mk__laptop-placeholder">
      <div className="mk__laptop-placeholder__rail">
        <div className="mk__laptop-placeholder__brand">Vyntechs</div>
        <div className="mk__laptop-placeholder__nav">
          <span>Today</span>
          <span>Sessions</span>
          <span data-active="true">Vehicle history</span>
          <span>What&apos;s new</span>
        </div>
      </div>
      <div className="mk__laptop-placeholder__main">
        <div className="mk__laptop-placeholder__topbar">
          <span className="mk__laptop-placeholder__crumbs">
            2019 F-150 · 3.5L EcoBoost · 124k mi
          </span>
          <span className="mk__laptop-placeholder__status">Locked</span>
        </div>
        <div className="mk__laptop-placeholder__hero-card">
          <div className="mk__laptop-placeholder__eyebrow">
            Locked finding · session #842
          </div>
          <div className="mk__laptop-placeholder__h">
            Cyl 4 injector harness · pin 2 fault
          </div>
          <p className="mk__laptop-placeholder__sub">
            High-resistance corrosion at the harness connector. Replace harness
            pigtail; refresh adjacent grounds. Confidence{' '}
            <b>94</b> · cited from 8 sources across TSB, AllData, and 23 F150
            forum threads.
          </p>
          <div className="mk__laptop-placeholder__row">
            <span className="mk__laptop-placeholder__chip">
              Phase 02 · Open repair coaching
            </span>
            <span className="mk__laptop-placeholder__chip mk__laptop-placeholder__chip--ghost">
              Re-open diagnosis
            </span>
          </div>
        </div>
        <div className="mk__laptop-placeholder__grid">
          <div className="mk__laptop-placeholder__minor">
            <div className="mk__laptop-placeholder__eyebrow">Citations · 8</div>
            <div className="mk__laptop-placeholder__line">
              Ford TSB 21-2156 · cyl 4 misfire after hot soak
            </div>
            <div className="mk__laptop-placeholder__line">
              AllData wiring · cyl 4 injector harness
            </div>
            <div className="mk__laptop-placeholder__line">
              F150forum · 23 threads · resolved
            </div>
          </div>
          <div className="mk__laptop-placeholder__minor">
            <div className="mk__laptop-placeholder__eyebrow">
              Confidence over time
            </div>
            <div className="mk__laptop-placeholder__bars">
              <span style={{ ['--bar' as string]: '32%' }} />
              <span style={{ ['--bar' as string]: '52%' }} />
              <span style={{ ['--bar' as string]: '78%' }} />
              <span style={{ ['--bar' as string]: '91%' }} />
              <span style={{ ['--bar' as string]: '94%' }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
