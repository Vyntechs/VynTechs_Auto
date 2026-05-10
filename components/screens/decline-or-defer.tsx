'use client'
import { VehicleStrip } from '@/components/vt'

type SpokeReason = 'gather' | 'decline' | 'defer'

type Option = {
  number: 1 | 2 | 3
  title: string
  description: string
  emphasized?: boolean
  reason?: SpokeReason
  meta?: string[]
}

type Props = {
  vehicleName: string
  vehicleVin: string
  timer: string
  /** Eyebrow class label, e.g. "DESTRUCTIVE CLASS · K-CAN SPLICE" */
  riskLabel?: string
  gap: string
  confidenceGap?: string
  /** 0-100 numeric confidence reading. Defaults to 73 (design preview value). */
  confidence?: number
  /** 0-100 gate threshold. Defaults to 85. */
  gate?: number
  options: Option[]
  /** Engraved-plate footer copy. Falls back to a generic format if not given. */
  engravedPlate?: string
  /** Pre-formatted printer-tape body. If omitted, a default ledger is rendered. */
  tapeBody?: string
  /** Tape header right-side timestamp. Defaults to current ISO Z. */
  tapeTimestamp?: string
  onSelectOption?: (number: 1 | 2 | 3) => void
  pending?: 1 | 2 | 3 | null
  error?: string | null
  /** Back-link target for the VehicleStrip header. Defaults to /today (My Jobs).
   *  Live callers pass a per-session target so back means "back to the diagnosis." */
  back?: { href: string; label: string }
  /** Hero interactive ask — yes/no for tech-attestable confirms. Renders above the compass.
   *  yesLabel/noLabel are AI-generated short echoes of the answer state (e.g.
   *  "Yes — I have 12V" / "No — no voltage"). Optional; falls back to plain Yes/No. */
  confirmAsk?: {
    prompt: string
    onYes: () => void
    onNo: () => void
    busy?: boolean
    yesLabel?: string
    noLabel?: string
  }
  /** Hero interactive ask — single-tap camera button. Renders above the compass. */
  photoAsk?: { prompt: string; onSnap: () => void; busy?: boolean }
}

const DEFAULT_TAPE_BODY = `  QUERIES   SOURCE              MATCH        STATUS
─ 5         past_cases         ─ 0/5         miss
─ 3         forums             ─ 2 conflict  ambig
─ 0         service_bulletins  ─ ∅           none

  CONCLUSION:  same model year & build K-CAN wire colors
               not retrievable at required confidence`

const SPOKE_META: Record<SpokeReason, { bearing: string; meta: string[] }> = {
  gather: {
    bearing: 'NW · LOW EFFORT',
    meta: ['+5 MIN', 'RAISES CONFIDENCE ~12 PTS', 'CLEARS GATE'],
  },
  decline: {
    bearing: 'E · EXIT',
    meta: ['CLOSES SESSION', 'NO LEARNING'],
  },
  defer: {
    bearing: 'SE · RECOMMENDED',
    meta: ['ROUTES TO MARCUS T.', 'BMW N-SERIES CURATOR'],
  },
}

function inferReason(opt: Option): SpokeReason {
  if (opt.reason) return opt.reason
  if (opt.emphasized) return 'defer'
  if (opt.number === 1) return 'gather'
  if (opt.number === 2) return 'decline'
  return 'defer'
}

/* The glass-faced confidence dial. 240×240. The bezel, glass, tick ring,
   gate arc, deficit hatch, and needle are all SVG primitives — no images. */
function Dial({ confidence, gate }: { confidence: number; gate: number }) {
  const cx = 120
  const cy = 120
  const polar = (angleDeg: number, r: number) => {
    const rad = ((angleDeg - 90) * Math.PI) / 180
    return [cx + Math.cos(rad) * r, cy + Math.sin(rad) * r]
  }
  // 0..100 maps to -135°..+135°
  const angleAt = (v: number) => -135 + (270 * v) / 100
  const needleAngle = angleAt(confidence)

  // Tick ring
  const ticks = Array.from({ length: 51 }).map((_, i) => {
    const value = i * 2
    const angle = -135 + (270 * i) / 50
    const isMajor = i % 5 === 0
    const r1 = 96
    const r2 = isMajor ? 84 : 90
    const [x1, y1] = polar(angle, r1)
    const [x2, y2] = polar(angle, r2)
    const isPastGate = value > gate
    const stroke = isPastGate ? 'var(--vt-risk-destructive)' : 'oklch(40% 0.012 70)'
    return (
      <line
        key={i}
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={stroke}
        strokeWidth={isMajor ? 1.1 : 0.5}
        opacity={isMajor ? 1 : 0.55}
        strokeLinecap="round"
      />
    )
  })

  // Major numerals
  const numerals = [0, 25, 50, 75, 100].map((v) => {
    const [x, y] = polar(angleAt(v), 75)
    return (
      <text
        key={v}
        x={x}
        y={y + 3.5}
        textAnchor="middle"
        fontFamily="var(--vt-font-mono)"
        fontSize="9"
        fontWeight="500"
        fill="oklch(40% 0.012 70)"
        letterSpacing="0.06em"
      >
        {v}
      </text>
    )
  })

  // Gate arc — etched red minor-arc from `gate` to 100 along outer ring (r=100)
  const [gx1, gy1] = polar(angleAt(gate), 100)
  const [gx2, gy2] = polar(angleAt(100), 100)
  const gateArcPath = `M ${gx1} ${gy1} A 100 100 0 0 1 ${gx2} ${gy2}`

  // Gate radial mark + label
  const [gmx1, gmy1] = polar(angleAt(gate), 102)
  const [gmx2, gmy2] = polar(angleAt(gate), 70)
  const [glx, gly] = polar(angleAt(gate), 64)

  // Deficit arc — hatched between needle and gate
  const dStart = Math.min(confidence, gate)
  const dEnd = Math.max(confidence, gate)
  const deficitVisible = confidence < gate
  const [d1ox, d1oy] = polar(angleAt(dStart), 92)
  const [d2ox, d2oy] = polar(angleAt(dEnd), 92)
  const [d1ix, d1iy] = polar(angleAt(dStart), 86)
  const [d2ix, d2iy] = polar(angleAt(dEnd), 86)
  const deficitPath = `M ${d1ox} ${d1oy} A 92 92 0 0 1 ${d2ox} ${d2oy} L ${d2ix} ${d2iy} A 86 86 0 0 0 ${d1ix} ${d1iy} Z`

  return (
    <svg className="dod-dial" viewBox="0 0 240 240" aria-hidden="true">
      <defs>
        <radialGradient id="dial-glass" cx="50%" cy="38%" r="65%">
          <stop offset="0%" stopColor="oklch(99% 0.005 60)" />
          <stop offset="78%" stopColor="oklch(96.5% 0.008 60)" />
          <stop offset="100%" stopColor="oklch(94% 0.012 60)" />
        </radialGradient>
        <radialGradient id="dial-bezel" cx="50%" cy="50%" r="50%">
          <stop offset="92%" stopColor="oklch(94% 0.012 60)" />
          <stop offset="100%" stopColor="oklch(78% 0.018 60)" />
        </radialGradient>
        <filter id="dial-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur in="SourceAlpha" stdDeviation="3" />
          <feOffset dy="4" />
          <feComponentTransfer>
            <feFuncA type="linear" slope="0.16" />
          </feComponentTransfer>
          <feMerge>
            <feMergeNode />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <pattern
          id="dial-deficit-hatch"
          patternUnits="userSpaceOnUse"
          width="3.5"
          height="3.5"
          patternTransform="rotate(-45)"
        >
          <line
            x1="0"
            y1="0"
            x2="0"
            y2="3.5"
            stroke="var(--vt-risk-destructive)"
            strokeWidth="1.4"
          />
        </pattern>
      </defs>

      {/* outer bezel + glass face */}
      <circle cx={cx} cy={cy} r="116" fill="url(#dial-bezel)" filter="url(#dial-shadow)" />
      <circle
        cx={cx}
        cy={cy}
        r="106"
        fill="url(#dial-glass)"
        stroke="oklch(86% 0.012 60)"
        strokeWidth="0.5"
      />

      {ticks}
      {numerals}

      {/* GATE — outer red arc + radial mark + label */}
      <path
        d={gateArcPath}
        stroke="var(--vt-risk-destructive)"
        strokeWidth="3"
        strokeLinecap="butt"
        fill="none"
        opacity="0.85"
      />
      <line
        x1={gmx1}
        y1={gmy1}
        x2={gmx2}
        y2={gmy2}
        stroke="var(--vt-risk-destructive)"
        strokeWidth="1"
        opacity="0.7"
      />
      <text
        x={glx}
        y={gly + 3}
        textAnchor="middle"
        fontFamily="var(--vt-font-mono)"
        fontSize="7.5"
        fontWeight="600"
        fill="var(--vt-risk-destructive)"
        letterSpacing="0.14em"
      >
        GATE
      </text>

      {/* DEFICIT hatched arc, only when confidence below gate */}
      {deficitVisible && (
        <g opacity="0.85">
          <path d={deficitPath} fill="url(#dial-deficit-hatch)" />
        </g>
      )}

      {/* NEEDLE at confidence */}
      <g
        className="dod-dial__needle"
        style={{ transform: `rotate(${needleAngle}deg)`, transformOrigin: '120px 120px' }}
      >
        <line
          x1="120"
          y1="120"
          x2="120"
          y2="38"
          stroke="oklch(20% 0.012 60)"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <polygon points="120,32 117,40 123,40" fill="oklch(20% 0.012 60)" />
        <line
          x1="120"
          y1="120"
          x2="120"
          y2="138"
          stroke="oklch(40% 0.012 70)"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </g>
      {/* needle hub */}
      <circle cx={cx} cy={cy} r="6" fill="oklch(20% 0.012 60)" />
      <circle cx={cx} cy={cy} r="2" fill="oklch(94% 0.012 60)" />
    </svg>
  )
}

export function DeclineOrDefer({
  vehicleName,
  vehicleVin,
  timer,
  riskLabel = 'DESTRUCTIVE CLASS · K-CAN SPLICE',
  gap,
  confidenceGap,
  confidence = 73,
  gate = 85,
  options,
  engravedPlate,
  tapeBody,
  tapeTimestamp,
  onSelectOption,
  pending = null,
  error = null,
  back,
  confirmAsk,
  photoAsk,
}: Props) {
  const deficit = Math.round(gate - confidence)
  const headline = confidenceGap ?? 'Confidence too low to commit to a high-risk repair.'
  const ts =
    tapeTimestamp ??
    new Date().toISOString().replace('T', ' · ').replace(/\.\d+Z$/, 'Z')
  const plate =
    engravedPlate ??
    `SESSION ${timer} · BLOCK 7B-3 · TECHS QUEUED 3 · SHOP HISTORY +1`

  return (
    <div className="app">
      <VehicleStrip
        name={vehicleName}
        vin={vehicleVin}
        timer={timer}
        back={back ?? { href: '/today', label: 'My Jobs' }}
      />
      <div className="dod-surface" style={{ flex: 1, overflow: 'auto' }}>
        {/* HERO INSTRUMENT */}
        <div className="dod-instrument">
          <span className="dod-instrument__class">
            <span aria-hidden="true">⏵ </span>
            {riskLabel}
          </span>
          <Dial confidence={confidence} gate={gate} />
          <div className="dod-cluster">
            <div className="dod-cluster__num">
              {confidence}
              <span className="dod-cluster__den">/100</span>
            </div>
            <div className="dod-cluster__label">CONFIDENCE</div>
            {deficit > 0 && (
              <div className="dod-cluster__deficit">
                <span>−{deficit}</span> BELOW THRESHOLD
              </div>
            )}
          </div>
        </div>

        <h2 className="dod-headline">{headline}</h2>

        {(confirmAsk || photoAsk) && (
          <div
            style={{
              margin: '0 auto 4px',
              maxWidth: '36ch',
              fontFamily: 'var(--vt-font-mono)',
              fontSize: 10,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'var(--vt-fg-3)',
              textAlign: 'center',
            }}
          >
            Fastest path forward
          </div>
        )}

        {confirmAsk && (
          <div
            role="group"
            aria-label="Confirm to close gap"
            style={{
              margin: '8px auto 16px',
              padding: '14px 16px',
              maxWidth: '36ch',
              border: '0.5px solid var(--vt-rule-strong)',
              borderRadius: 'var(--vt-radius-2)',
              background: 'var(--vt-bone-100)',
            }}
          >
            <p
              style={{
                fontFamily: 'var(--vt-font-serif)',
                fontSize: 14,
                color: 'var(--vt-fg)',
                lineHeight: 1.4,
                margin: '0 0 4px',
                textAlign: 'center',
              }}
            >
              {confirmAsk.prompt}
            </p>
            <p
              style={{
                fontFamily: 'var(--vt-font-serif)',
                fontStyle: 'italic',
                fontSize: 12,
                color: 'var(--vt-fg-3)',
                lineHeight: 1.4,
                margin: '0 0 10px',
                textAlign: 'center',
              }}
            >
              Answering this lets the AI commit to the next step. ~10 sec.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={confirmAsk.onYes}
                disabled={confirmAsk.busy}
                style={{ minHeight: 48, flex: 1 }}
              >
                {confirmAsk.busy ? 'Working…' : (confirmAsk.yesLabel ?? 'Yes')}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={confirmAsk.onNo}
                disabled={confirmAsk.busy}
                style={{ minHeight: 48, flex: 1 }}
              >
                {confirmAsk.busy ? 'Working…' : (confirmAsk.noLabel ?? 'No')}
              </button>
            </div>
          </div>
        )}

        {photoAsk && (
          <div
            role="group"
            aria-label="Snap to close gap"
            style={{
              margin: '8px auto 16px',
              padding: '14px 16px',
              maxWidth: '36ch',
              border: '0.5px solid var(--vt-rule-strong)',
              borderRadius: 'var(--vt-radius-2)',
              background: 'var(--vt-bone-100)',
            }}
          >
            <p
              style={{
                fontFamily: 'var(--vt-font-serif)',
                fontSize: 14,
                color: 'var(--vt-fg)',
                lineHeight: 1.4,
                margin: '0 0 10px',
                textAlign: 'center',
              }}
            >
              {photoAsk.prompt}
            </p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={photoAsk.onSnap}
              disabled={photoAsk.busy}
              style={{ minHeight: 48, width: '100%' }}
            >
              {photoAsk.busy ? 'Uploading…' : 'Snap it'}
            </button>
          </div>
        )}

        {/* Caller-supplied gap statement, rendered as the sub-paragraph */}
        {gap && (
          <p
            style={{
              fontFamily: 'var(--vt-font-serif)',
              fontStyle: 'italic',
              fontSize: 14,
              color: 'var(--vt-fg-2)',
              lineHeight: 1.5,
              margin: '-14px auto 0',
              textAlign: 'center',
              maxWidth: '36ch',
              alignSelf: 'center',
            }}
          >
            {gap}
          </p>
        )}

        {/* TAPE — diagnostic printout, dyno-tape feel */}
        <div className="dod-tape">
          <div className="dod-tape__header">
            <span>WHERE I LOOKED</span>
            <span>{ts}</span>
          </div>
          <pre className="dod-tape__body">{tapeBody ?? DEFAULT_TAPE_BODY}</pre>
        </div>

        {/* COMPASS — three forward paths as spokes */}
        <div className="dod-compass">
          <span className="dod-compass__lead">
            {options.length <= 2 ? "Or, if you can't answer yet" : 'Three ways forward'}
          </span>
          {options.map((opt) => {
            const reason = inferReason(opt)
            const cfg = SPOKE_META[reason]
            const isPending = pending === opt.number
            const isDisabled = pending !== null
            const meta = opt.meta ?? cfg.meta
            return (
              <button
                key={opt.number}
                type="button"
                className={`dod-spoke dod-spoke--${reason}`}
                onClick={onSelectOption ? () => onSelectOption(opt.number) : undefined}
                disabled={isDisabled}
                aria-busy={isPending}
              >
                <span className="dod-spoke__bearing">{cfg.bearing}</span>
                <div className="dod-spoke__rule" />
                <div className="dod-spoke__title">{opt.title}</div>
                <div className="dod-spoke__detail">
                  {isPending ? 'Working…' : opt.description}
                </div>
                <div className="dod-spoke__meta">
                  {meta.map((m, i) => (
                    <span key={`${m}-${i}`} style={{ display: 'contents' }}>
                      <span>{m}</span>
                      {i < meta.length - 1 && <span className="dod-spoke__sep" />}
                    </span>
                  ))}
                </div>
              </button>
            )
          })}
        </div>

        {/* ENGRAVED PLATE — the brass-nameplate footer */}
        <div className="dod-plate">{plate}</div>

        {error && (
          <p
            role="alert"
            style={{
              marginTop: 12,
              fontFamily: 'var(--vt-font-mono)',
              fontSize: 11,
              color: 'var(--vt-risk-destructive)',
              textAlign: 'center',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
