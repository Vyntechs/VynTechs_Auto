export function Ladder() {
  return (
    <section className="vm-section" id="how">
      <div className="vm-section-head">
        <div className="vm-section-num">
          <b>§ 01</b>How it thinks
        </div>
        <div>
          <h2 className="vm-section-title">
            A three-rung ladder, not a chatbot. Every claim is{' '}
            <em>cited</em>, every commit is <em>gated</em>.
          </h2>
          <p className="vm-section-lede">
            The model climbs from your shop&rsquo;s own history → the open web
            for that exact vehicle → asking you for a specific observation. It
            stops where the evidence stops. No fabricated TSBs, no invented
            torque specs.
          </p>
        </div>
      </div>

      <div className="vm-ladder-wrap">
        <div className="vm-ladder">
          <div className="vm-ladder-h">Retrieval ladder · live</div>

          <div className="vm-rung resolved">
            <div className="vm-rung-node">0</div>
            <div>
              <div className="vm-rung-title">Your shop&rsquo;s history</div>
              <div className="vm-rung-desc">
                Every closed session from your bay. Per-VIN, per-DTC, per-tech
                outcomes. Confidence decays when comebacks happen.
              </div>
            </div>
            <div className="vm-rung-meta">
              <b>14</b> matches
              <br />
              resolved &middot; 220 ms
            </div>
          </div>

          <div className="vm-rung active">
            <div className="vm-rung-node">1</div>
            <div>
              <div className="vm-rung-title">
                The open web for that car
              </div>
              <div className="vm-rung-desc">
                OEM TSBs, manufacturer recalls, NHTSA bulletins, forum threads,
                technician videos. Every source cited inline with a link back.
              </div>
            </div>
            <div className="vm-rung-meta">
              <b>9</b> matches
              <br />
              active &middot; sweeping
            </div>
          </div>

          <div className="vm-rung">
            <div className="vm-rung-node">2</div>
            <div>
              <div className="vm-rung-title">Asks you</div>
              <div className="vm-rung-desc">
                When evidence is thin, it asks for one specific observation.
                Capped at 3 asks — past that, it&rsquo;s Decline-or-Defer, not
                a guess.
              </div>
            </div>
            <div className="vm-rung-meta">
              pending
              <br />
              gated
            </div>
          </div>
        </div>

        <div className="vm-ladder-side">
          <div className="vm-ladder-stat">
            <div className="vm-ladder-stat-n">3</div>
            <div className="vm-ladder-stat-l">
              retrieval rungs, every claim cited
            </div>
            <div className="vm-ladder-stat-s">no black box</div>
          </div>
          <div
            className="vm-ladder-stat"
            style={{ borderColor: 'oklch(74% 0.13 170)' }}
          >
            <div className="vm-ladder-stat-n">
              95<small>%</small>
            </div>
            <div className="vm-ladder-stat-l">
              gate threshold before destructive work is unlocked
            </div>
            <div className="vm-ladder-stat-s">configurable</div>
          </div>
          <div
            className="vm-ladder-stat"
            style={{ borderColor: 'oklch(62% 0.22 25)' }}
          >
            <div className="vm-ladder-stat-n">0</div>
            <div className="vm-ladder-stat-l">guesses below the gate</div>
            <div className="vm-ladder-stat-s">hard refusal</div>
          </div>
        </div>
      </div>
    </section>
  )
}
