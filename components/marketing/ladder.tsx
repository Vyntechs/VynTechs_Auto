export function Ladder() {
  return (
    <section className="vm-section" id="how">
      <div className="vm-section-head">
        <div className="vm-section-num">
          <b>§ 01</b>How it works
        </div>
        <div>
          <h2 className="vm-section-title">
            How the system works.{' '}
            <em>Not how the dealer labeled it.</em>
          </h2>
          <p className="vm-section-lede">
            Give it the vehicle and the complaint. It reasons about how that
            system actually operates on your truck: what each part does, how
            it all connects, what should happen when it&rsquo;s working right.
            It won&rsquo;t assume your vehicle works like a different one, and
            it won&rsquo;t state a number it can&rsquo;t stand behind. Where
            it&rsquo;s short on something, it says so and asks you.
          </p>
        </div>
      </div>

      <div className="vm-ladder-wrap">
        <div className="vm-ladder">
          <div className="vm-ladder-h">How it works</div>

          <div className="vm-rung resolved">
            <div className="vm-rung-node">1</div>
            <div>
              <div className="vm-rung-title">Works from how the system works</div>
              <div className="vm-rung-desc">
                Starts from how that system actually operates on your vehicle.
                Not a copied manual, not a borrowed procedure.
              </div>
            </div>
            <div className="vm-rung-meta">
              how it
              <br />
              works
            </div>
          </div>

          <div className="vm-rung active">
            <div className="vm-rung-node">2</div>
            <div>
              <div className="vm-rung-title">Reasons about your truck</div>
              <div className="vm-rung-desc">
                Won&rsquo;t assume your vehicle works like a different one. The
                thinking is specific to what&rsquo;s in front of you.
              </div>
            </div>
            <div className="vm-rung-meta">
              your
              <br />
              vehicle
            </div>
          </div>

          <div className="vm-rung">
            <div className="vm-rung-node">3</div>
            <div>
              <div className="vm-rung-title">Asks when it&rsquo;s short</div>
              <div className="vm-rung-desc">
                Needs something it doesn&rsquo;t have, it asks you for one
                specific check. Three, max. Then it defers instead of guessing.
              </div>
            </div>
            <div className="vm-rung-meta">
              3 max
              <br />
              then defers
            </div>
          </div>
        </div>

        <div className="vm-ladder-side">
          <div className="vm-ladder-stat">
            <div className="vm-ladder-stat-n">3</div>
            <div className="vm-ladder-stat-l">
              asks, then it defers instead of guessing
            </div>
            <div className="vm-ladder-stat-s">capped</div>
          </div>
          <div
            className="vm-ladder-stat"
            style={{ borderColor: 'oklch(74% 0.13 170)' }}
          >
            <div className="vm-ladder-stat-n">
              95<small>%</small>
            </div>
            <div className="vm-ladder-stat-l">
              confidence line before risky work unlocks
            </div>
            <div className="vm-ladder-stat-s">configurable</div>
          </div>
          <div
            className="vm-ladder-stat"
            style={{ borderColor: 'oklch(62% 0.22 25)' }}
          >
            <div className="vm-ladder-stat-n">0</div>
            <div className="vm-ladder-stat-l">specs it&rsquo;ll make up</div>
            <div className="vm-ladder-stat-s">hard refusal</div>
          </div>
        </div>
      </div>
    </section>
  )
}
