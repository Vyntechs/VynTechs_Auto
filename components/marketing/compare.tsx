import type { ReactNode } from 'react'

type CompareRow = {
  subj: string
  chatbot: ReactNode
  scantool: ReactNode
  us: ReactNode
}

const ROWS: CompareRow[] = [
  {
    subj: 'Refuses at low confidence',
    chatbot: 'None. Confidently invents specs, procedures, pinouts.',
    scantool: 'N/A. Returns a code definition, no stance.',
    us: 'Won’t recommend destructive work below the confidence line. Tells you what’s missing.',
  },
  {
    subj: 'Makes things up',
    chatbot: 'Freely. A wrong spec costs you a torn-down assembly.',
    scantool: 'N/A.',
    us: 'Won’t state what it can’t stand behind. Says so when it’s unsure.',
  },
  {
    subj: 'Learns from real work',
    chatbot: 'No. State resets per chat.',
    scantool: 'No. Static lookup tables.',
    us: 'Every closed case sharpens it for the next tech.',
  },
  {
    subj: 'Asks before it assumes',
    chatbot: 'Rarely. Guesses and hopes.',
    scantool: 'No. Reads what the tool returns.',
    us: 'When it’s short on what it needs, it asks you for one specific check. Three, max.',
  },
  {
    subj: 'Built for the bay',
    chatbot: 'Desktop-first chat UI. Glove-hostile.',
    scantool: 'Bench tool, not shop-floor.',
    us: 'Phone-first. Thumb-reach. Readable in shop light.',
  },
  {
    subj: 'Voice match',
    chatbot: '"Hi there! I\'d be happy to help you with…"',
    scantool: 'N/A.',
    us: (
      <em>
        &ldquo;Smoke test the cold-side intercooler at 5 psi. Note where it
        escapes.&rdquo;
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
            Most diagnostic &ldquo;assistants&rdquo; are a general chatbot with
            a wrench-shaped icon, or a stale code-lookup table. Here&rsquo;s how
            we measure against what techs actually replace.
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
