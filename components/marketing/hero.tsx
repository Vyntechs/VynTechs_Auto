import { PhoneFrame } from './phone-frame'
import { ScreenPropose } from './screens'
import { SCREENSHOTS } from './screenshots.config'

export function Hero() {
  return (
    <section className="mk__section mk__hero">
      <div className="mk-container">
        <div className="mk__hero__grid">
          <div className="mk__hero__copy">
            <span className="mk__hero__eyebrow">For working master techs</span>
            <h1 className="mk__hero__h">AI master tech for the bay.</h1>
            <p className="mk__hero__sub">
              Decision trees with calibrated confidence. Built for techs who
              have to be right.
            </p>
          </div>
          <div className="mk__hero__phone-wrap">
            <PhoneFrame size="lg" image={SCREENSHOTS.heroPhone} priority>
              <ScreenPropose />
            </PhoneFrame>
          </div>
        </div>
      </div>
    </section>
  )
}
