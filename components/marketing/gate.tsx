export function Gate() {
  return (
    <section className="vm-section" style={{ paddingTop: 0 }}>
      <div className="vm-section-head">
        <div className="vm-section-num">
          <b>§ 02</b>How it knows when to call it
        </div>
        <div>
          <h2 className="vm-section-title">
            It either clears the line, or it doesn&rsquo;t.{' '}
            <em>No middle ground.</em>
          </h2>
          <p className="vm-section-lede">
            Above the line, you get a precise next step and the reason for it.
            Below it, it tells you exactly what&rsquo;s missing, and
            won&rsquo;t recommend tearing into anything it can&rsquo;t stand
            behind.
          </p>
        </div>
      </div>

      <div className="vm-gate">
        <div className="vm-card amber">
          <div className="vm-card-eyebrow">
            <span>
              <b>Above the line</b> &middot; clear to call
            </span>
            <span>P0299 &middot; turbocharger underboost</span>
          </div>
          <div className="vm-conf">
            <svg className="vm-conf-dial" viewBox="0 0 100 100">
              <circle
                cx="50"
                cy="50"
                r="44"
                stroke="var(--vt-bone-300)"
                strokeWidth="7"
                fill="none"
              />
              <circle
                cx="50"
                cy="50"
                r="44"
                stroke="oklch(50% 0.18 248)"
                strokeWidth="7"
                fill="none"
                strokeDasharray="276.46"
                strokeDashoffset="35.9"
                transform="rotate(-90 50 50)"
                strokeLinecap="round"
              />
              <line
                x1="50"
                y1="6"
                x2="50"
                y2="14"
                stroke="var(--vt-bone-700)"
                strokeWidth="1.2"
              />
              <text
                x="50"
                y="55"
                textAnchor="middle"
                fontFamily="JetBrains Mono"
                fontSize="22"
                fontWeight="500"
                fill="var(--vt-bone-900)"
              >
                87.0
              </text>
              <text
                x="50"
                y="68"
                textAnchor="middle"
                fontFamily="JetBrains Mono"
                fontSize="7"
                letterSpacing="1"
                fill="var(--vt-bone-600)"
              >
                % CONF
              </text>
            </svg>
            <div>
              <div className="vm-conf-num">
                87.0<small>%</small>
              </div>
              <div className="vm-conf-line">
                ▲ 12.3 above the line &middot; clear to call
              </div>
            </div>
          </div>
          <p className="vm-card-finding">
            <em>
              &ldquo;Cold-side intercooler boot, lower clamp. Smoke test
              localizes leak to clamp seam at the throttle-body joint.&rdquo;
            </em>
          </p>
          <div className="vm-card-meta">
            <div className="vm-card-meta-cell">
              <div className="vm-card-meta-num">3.6 psi</div>
              <div className="vm-card-meta-lab">leak rate observed</div>
            </div>
            <div className="vm-card-meta-cell">
              <div className="vm-card-meta-num">42 min</div>
              <div className="vm-card-meta-lab">time to call</div>
            </div>
            <div className="vm-card-meta-cell">
              <div className="vm-card-meta-num">1 clamp</div>
              <div className="vm-card-meta-lab">the fix</div>
            </div>
          </div>
        </div>

        <div className="vm-card red">
          <div className="vm-card-eyebrow">
            <span>
              <b>Below the line</b> &middot; won&rsquo;t call it
            </span>
            <span>P0420 &middot; catalyst efficiency</span>
          </div>
          <div className="vm-conf">
            <svg className="vm-conf-dial" viewBox="0 0 100 100">
              <circle
                cx="50"
                cy="50"
                r="44"
                stroke="var(--vt-bone-300)"
                strokeWidth="7"
                fill="none"
              />
              <circle
                cx="50"
                cy="50"
                r="44"
                stroke="oklch(62% 0.22 25)"
                strokeWidth="7"
                fill="none"
                strokeDasharray="276.46"
                strokeDashoffset="156.6"
                transform="rotate(-90 50 50)"
                strokeLinecap="round"
              />
              <line
                x1="50"
                y1="6"
                x2="50"
                y2="14"
                stroke="var(--vt-bone-700)"
                strokeWidth="1.2"
              />
              <text
                x="50"
                y="55"
                textAnchor="middle"
                fontFamily="JetBrains Mono"
                fontSize="22"
                fontWeight="500"
                fill="var(--vt-bone-900)"
              >
                43.4
              </text>
              <text
                x="50"
                y="68"
                textAnchor="middle"
                fontFamily="JetBrains Mono"
                fontSize="7"
                letterSpacing="1"
                fill="var(--vt-bone-600)"
              >
                % CONF
              </text>
            </svg>
            <div>
              <div
                className="vm-conf-num"
                style={{ color: 'oklch(45% 0.20 25)' }}
              >
                43.4<small>%</small>
              </div>
              <div className="vm-conf-line">
                ▼ 31.6 below the line &middot; won&rsquo;t call it
              </div>
            </div>
          </div>
          <p className="vm-card-finding">
            <em>
              &ldquo;Cat replacement not on the table yet. Need post-cat O₂
              under warm cruise; that reading&rsquo;s missing.&rdquo;
            </em>
          </p>
          <div className="vm-card-meta">
            <div className="vm-card-meta-cell">
              <div className="vm-card-meta-num">— —</div>
              <div className="vm-card-meta-lab">post-cat O₂ missing</div>
            </div>
            <div className="vm-card-meta-cell">
              <div className="vm-card-meta-num">refused</div>
              <div className="vm-card-meta-lab">destructive action</div>
            </div>
            <div className="vm-card-meta-cell">
              <div className="vm-card-meta-num">43<small>%</small></div>
              <div className="vm-card-meta-lab">below the line</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
