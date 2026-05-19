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
      'None. Confidently invents torque specs, TSB numbers, pinouts, freeze-frame values.',
    scantool: 'N/A. Returns a DTC definition off a static table; no diagnostic stance.',
    us: 'Five-class risk model. Hard-coded floor on cuts, splices, reflashes; LLM-judged refusal on novel irreversibles. Names the missing observation.',
  },
  {
    subj: 'Cites sources',
    chatbot: 'Sometimes. Often hallucinated TSB numbers, often dead URLs.',
    scantool: 'Licensed OEM repair info only; no shop context, no comeback history.',
    us: 'Every claim. Corpus row ID, OEM TSB, NHTSA bulletin, or forum / YouTube / Reddit URL — inline.',
  },
  {
    subj: 'Learns from your shop',
    chatbot: 'No. Session state resets every chat.',
    scantool: 'No. Static lookup tables, refreshed by annual subscription.',
    us: 'Yes. Closed sessions embed into the per-shop corpus on Voyage 1024-d. Comeback-driven decay; weekly Beta-Binomial refit; auto-retire on drift.',
  },
  {
    subj: 'Asks for evidence',
    chatbot: 'Rarely. Guesses and hopes the tech doesn’t cut anything.',
    scantool: 'No. Echoes whatever the scan-tool screen shows.',
    us: 'Yes. Vision extractor reads scan-screens, wiring diagrams, build-code labels. One targeted ask plus two follow-ups, then Decline-or-Defer.',
  },
  {
    subj: 'Built for the bay',
    chatbot: 'Desktop chat UI. Glove-hostile, lighting-hostile.',
    scantool: 'Bench tool or cart. Not designed for thumb-reach under the hood.',
    us: 'Mobile-first PWA. Thumb-reach. Bone-paper readability in shop lighting. Ambient temp + humidity captured per-bay for R-134a P-T reads.',
  },
  {
    subj: 'Voice match',
    chatbot: '"Hi there! I\'d be happy to help diagnose your turbocharger!"',
    scantool: 'N/A.',
    us: (
      <em>
        &ldquo;Smoke-test the cold-side CAC at 5 psi. Photograph any escape
        locations at the throttle-body joint.&rdquo;
      </em>
    ),
  },
  {
    subj: 'Price per technician',
    chatbot: "$20–40/mo plus the comeback when it’s wrong.",
    scantool: '$1,800–4,200/yr per bench license, locked to one terminal.',
    us: (
      <>
        <b>$100/tech/mo.</b> Stripe live. Cancel anytime.
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
            Where the category stands today.
          </h2>
          <p className="vm-section-lede">
            The current landscape is generic LLM wrappers with
            wrench-shaped icons or static DTC databases. Vyntechs is
            purpose-built for the asymmetric cost of confident wrong
            answers in a bay — eight billable hours and a comeback the
            shop eats. Here&rsquo;s how it measures against the categories
            it displaces.
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
