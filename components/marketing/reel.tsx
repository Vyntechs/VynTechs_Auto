import Image from 'next/image'
import { SCREENSHOTS } from './screenshots.config'

// Map the 4 phone slots in the design to the existing scenario-rich
// screenshots (Ram 1500 vibration → F-150 misfire research → F-150
// propose with confidence → Ram 1500 locked finding). Tells a clean
// open → research → propose → lock arc.
const PHONE_SLOTS = [
  { slot: '01', label: 'Open', sub: 'intake', shot: SCREENSHOTS.motionPhone[0] },
  { slot: '02', label: 'Research', sub: 'sources cited', shot: SCREENSHOTS.motionPhone[1] },
  { slot: '03', label: 'Propose', sub: 'with confidence', shot: SCREENSHOTS.motionPhone[2] },
  { slot: '04', label: 'Lock', sub: 'root cause', shot: SCREENSHOTS.motionPhone[4] },
] as const

export function Reel() {
  const laptop = SCREENSHOTS.laptopHero

  return (
    <section className="vm-section" id="product" style={{ paddingTop: 0 }}>
      <div className="vm-section-head">
        <div className="vm-section-num">
          <b>§ 03</b>What you&rsquo;ll use
        </div>
        <div>
          <h2 className="vm-section-title">
            A phone in the bay. A laptop at the counter.
          </h2>
          <p className="vm-section-lede">
            Same diagnostic surface — the phone is built for the shop floor
            (thumb-reach, glove-friendly), the laptop view runs in any browser.
            Real screens from the build, not mockups.
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

      {laptop && (
        <div className="vm-reel-wide">
          <div className="vm-reel-item">
            <Image
              src={laptop.src}
              alt={laptop.alt}
              width={2560}
              height={1600}
              sizes="(max-width: 1280px) 100vw, 1200px"
            />
            <div className="vm-reel-cap">
              <b>Laptop / Locked case</b>
              <span>counter view</span>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
