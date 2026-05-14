import { PhoneFrame } from './phone-frame'
import { ScreenPropose } from './screens'
import { SCREENSHOTS } from './screenshots.config'

export function Hero() {
  return (
    <section className="mk__section mk__hero">
      <div className="mk-container">
        <div className="mk__hero__grid">
          <div className="mk__hero__copy">
            <h1 className="mk__hero__h">AI master tech for the bay.</h1>
            <p className="mk__hero__sub">
              Picks the next check. Tells you how sure it is.
              <br />
              Shows you what it read.
              <br />
              Says &ldquo;I don&apos;t know&rdquo; when it doesn&apos;t.
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
