import type { ReactNode } from 'react'

type CompareRow = {
  subj: string
  chatbot: ReactNode
  scantool: ReactNode
  us: ReactNode
}

const ROWS: CompareRow[] = [
  {
    subj: 'Refusal at low confidence',
    chatbot:
      'None. Confidently invents torque specs, TSB numbers, wiring pinouts.',
    scantool: 'N/A. Returns a DTC definition; no diagnostic stance.',
    us: 'Hard refusal below 95% gate. Tells you which evidence is missing.',
  },
  {
    subj: 'Cites sources',
    chatbot: 'Sometimes. Often hallucinated, often dead links.',
    scantool: 'OEM only, no shop context.',
    us: 'Every claim. Corpus row, TSB number, forum thread URL.',
  },
  {
    subj: 'Learns from your shop',
    chatbot: 'No. State resets per chat.',
    scantool: 'No. Static lookup tables.',
    us: 'Yes. Every closed session feeds back into the corpus for next time.',
  },
  {
    subj: 'Asks for evidence',
    chatbot: 'Rarely. Will guess and hope.',
    scantool: 'No. Reads what the tool returns.',
    us: 'Yes. When evidence is thin, asks for a specific observation. Capped at 3.',
  },
  {
    subj: 'Built for the bay',
    chatbot: 'Desktop-first chat UI. Glove-hostile.',
    scantool: 'Bench tool, not shop-floor.',
    us: 'Phone-first. Thumb-reach UI. Bone-paper readability in shop lighting.',
  },
  {
    subj: 'Voice match',
    chatbot: '"Hi there! I\'d be happy to help you with…"',
    scantool: 'N/A.',
    us: (
      <em>
        &ldquo;Smoke test the cold-side intercooler at 5 psi. Note any
        escape locations.&rdquo;
      </em>
    ),
  },
  {
    subj: 'Price per technician',
    chatbot: "$20–40/mo, plus rework when it's wrong.",
    scantool: '$1,800–4,200/yr per bench license.',
    us: (
      <>
        <b>$100/mo flat.</b> Cancel anytime.
      </>
    ),
  },
]

export function Compare() {
  return (
    <section className="vm-section" id="compare" style={{ paddingTop: 0 }}>
      <div className="vm-section-head">
        <div className="vm-section-num">
          <b>§ 05</b>What it is not
        </div>
        <div>
          <h2 className="vm-section-title">
            What we deliberately aren&rsquo;t.
          </h2>
          <p className="vm-section-lede">
            Most &ldquo;AI for the trades&rdquo; tools are wrappers around a
            general model with a wrench-shaped icon, or stale DTC lookup
            tables. Here&rsquo;s how we measure against what techs actually
            replace.
          </p>
        </div>
      </div>

      <div className="vm-compare">
        <div className="vm-compare-head">
          <div>Capability</div>
          <div>Generic chatbot</div>
          <div>Scan-tool DTC database</div>
          <div className="vm-compare-us">Vyntechs</div>
        </div>
        {ROWS.map((r) => (
          <div className="vm-compare-row" key={r.subj}>
            <div className="subj">{r.subj}</div>
            <div>{r.chatbot}</div>
            <div>{r.scantool}</div>
            <div className="vm-compare-us">{r.us}</div>
          </div>
        ))}
      </div>
    </section>
  )
}
