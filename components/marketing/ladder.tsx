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
            Per-shop corpus → six-source web sweep (OEM, NHTSA,
            manufacturer recall, forum, YouTube, Reddit) → a capped
            tech-assist of one ask plus two follow-ups. It stops where the
            evidence stops. No fabricated TSB numbers, no invented torque
            specs, no pinouts borrowed from the wrong chassis.
          </p>
        </div>
      </div>

      <div className="vm-ladder-wrap">
        <div className="vm-ladder">
          <div className="vm-ladder-h">Retrieval ladder · live</div>

          <div className="vm-rung resolved">
            <div className="vm-rung-node">0</div>
            <div>
              <div className="vm-rung-title">Per-shop corpus</div>
              <div className="vm-rung-desc">
                Every closed session, indexed with Voyage 1024-d
                embeddings. Per-VIN, per-DTC, per-tech outcomes.
                Comeback-driven decay; weekly Beta-Binomial refit
                auto-retires rows that stop predicting.
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
                Six-source web for that exact car
              </div>
              <div className="vm-rung-desc">
                OEM repair info, manufacturer recall feeds, NHTSA bulletins,
                forum threads, technician YouTube, Reddit. Every claim
                cited inline with a working URL — no dead links, no
                invented TSB numbers.
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
              <div className="vm-rung-title">Capped tech-assist</div>
              <div className="vm-rung-desc">
                When evidence is thin, it requests one specific observation
                — a scan-screen photo, a smoke-test result, a wiring shot,
                a freeze-frame value. Hard cap of one ask plus two
                follow-ups. Past that it&rsquo;s Decline-or-Defer, never a
                guess.
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
              retrieval rungs &middot; every claim cited inline
            </div>
            <div className="vm-ladder-stat-s">auditable end-to-end</div>
          </div>
          <div
            className="vm-ladder-stat"
            style={{ borderColor: 'oklch(74% 0.13 170)' }}
          >
            <div className="vm-ladder-stat-n">
              95<small>%</small>
            </div>
            <div className="vm-ladder-stat-l">
              default floor before any cut, splice, or reflash unlocks
            </div>
            <div className="vm-ladder-stat-s">Beta-Binomial refit, weekly &middot; per-cell calibrated</div>
          </div>
          <div
            className="vm-ladder-stat"
            style={{ borderColor: 'oklch(62% 0.22 25)' }}
          >
            <div className="vm-ladder-stat-n">0</div>
            <div className="vm-ladder-stat-l">irreversible work below the gate</div>
            <div className="vm-ladder-stat-s">hard-coded floor + LLM-judged novel cases</div>
          </div>
        </div>
      </div>
    </section>
  )
}
