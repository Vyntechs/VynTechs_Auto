import Image from 'next/image'
import { SCREENSHOTS } from './screenshots.config'

// Map the 4 phone slots to existing scenario-rich screenshots
// (Ram 1500 vibration intake → F-150 misfire research → F-150 propose
// with confidence → Ram 1500 locked finding). Open → research →
// propose → lock arc.
//
// Laptop screenshot is intentionally NOT rendered right now — the
// only capture we have shows parts/labor data the product doesn't
// actually produce. Re-add when there's a current shot.
const PHONE_SLOTS = [
  { slot: '01', label: 'Open', sub: 'intake', shot: SCREENSHOTS.motionPhone[0] },
  { slot: '02', label: 'Research', sub: 'sources cited', shot: SCREENSHOTS.motionPhone[1] },
  { slot: '03', label: 'Propose', sub: 'with confidence', shot: SCREENSHOTS.motionPhone[2] },
  { slot: '04', label: 'Lock', sub: 'root cause', shot: SCREENSHOTS.motionPhone[4] },
] as const

export function Reel() {
  return (
    <section className="vm-section" id="product" style={{ paddingTop: 0 }}>
      <div className="vm-section-head">
        <div className="vm-section-num">
          <b>§ 03</b>What you&rsquo;ll use
        </div>
        <div>
          <h2 className="vm-section-title">A PWA in the bay.</h2>
          <p className="vm-section-lede">
            Mobile-first PWA, glove-tolerant under sodium lighting.
            Multi-modal capture — photo, video, audio, scan-screen, wiring
            diagram, ambient temp and humidity via Open-Meteo. The vision
            extractor reads DTCs, pinouts, wire colors, and build codes
            off the photo. Real screens from the production build.
          </p>
        </div>
      </div>

      <div className="vm-reel">
        {PHONE_SLOTS.map(
          (p) =>
            p.shot && (
              <div className="vm-reel-item" key={p.slot}>
                <Image
                  src={p.shot.src}
                  alt={p.shot.alt}
                  width={1170}
                  height={2532}
                  sizes="(max-width: 640px) 78vw, (max-width: 960px) 62vw, 25vw"
                />
                <div className="vm-reel-cap">
                  <b>
                    {p.slot} / {p.label}
                  </b>
                  <span>{p.sub}</span>
                </div>
              </div>
            ),
        )}
      </div>
    </section>
  )
}
