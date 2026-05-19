const FAQS = [
  {
    q: 'Does it actually refuse irreversible work, or just nag me?',
    a: (
      <>
        It refuses. Cuts, splices, reflashes, and other irreversibles are
        hard-coded into a destructive risk class with no UI path below
        gate — not greyed, not behind a confirm modal. <em>Gone.</em>{' '}
        Novel irreversibles get LLM-judged into the same floor by the
        Haiku-4.5 risk classifier. You see the missing observation.
        Changing the gate threshold is logged with tech name and
        timestamp.
      </>
    ),
  },
  {
    q: 'What if my shop has no corpus yet?',
    a: 'You start on Rungs 1 and 2 — the six-source web sweep for your makes, plus the capped tech-assist. Every closed session embeds into Rung 0 for the next intake via Voyage 1024-d. Per-shop retrieval gets sharp once the closed-session count gets into the hundreds, and the weekly Beta-Binomial refit calibrates the cells from there.',
  },
  {
    q: 'Why no shop or enterprise tier?',
    a: 'Because seat-haggling rewards the wrong thing. One tech, one account, $100/month on Stripe. Eight techs is $800. Two quit and it’s $200 less. Honest math, no salesperson. Multi-seat, MSO rollups, and integration conversations are open — the calibration backend, per-shop corpus isolation, and curator console are already built to support them.',
  },
  {
    q: 'Does the AI ever take over the diagnosis?',
    a: 'Never. Vyntechs surfaces, cites, and gates — the tech commits. Every commit is logged with the technician’s name, timestamp, and the evidence rung it cleared. Clean audit trail for liability and calibration.',
  },
  {
    q: 'Does it pull DTCs off my scan tool directly?',
    a: 'Not over cable. There’s no OBD-II passthrough to Autel, Snap-on, Launch, or any other tool today — straight answer. You either type the DTC and freeze-frame, or you photograph the scan-screen and the vision extractor pulls the codes, parameter IDs, and freeze-frame values into the session. Direct scan-tool capture is on the roadmap.',
  },
  {
    q: 'Where does my data live?',
    a: 'Supabase, US region, encrypted at rest, daily DB-backed. Never sold, never used to train any model outside your shop’s own corpus. Formal certifications (SOC 2 Type II, etc.) are not yet completed — we’re straight about that. DPA available on request.',
  },
  {
    q: 'Will it work for European, JDM, or fleet diesel?',
    a: 'Depends on what the six-source web has for your make. Domestic and Toyota / Honda / Nissan run rich; low-volume European, JDM grey-market, and fleet-diesel can run thin. The retrieval layer reports source sparsity rather than backfilling with a guess — and per-shop corpus closes the gap on whatever the shop sees most.',
  },
  {
    q: 'How is the confidence gate calibrated?',
    a: 'Per (risk class × vehicle-family × symptom-class) cell, using Beta-Binomial refit on a weekly cron against closed-session outcomes. Novel patterns flow into a curator queue; drift triggers alerts. The 95% default holds until a cell has enough signal to move on its own — the safety floor is clamped so calibration can never disable it.',
  },
]

export function FAQ() {
  return (
    <section className="vm-section" id="faq" style={{ paddingTop: 0 }}>
      <div className="vm-section-head">
        <div className="vm-section-num">
          <b>§ 06</b>Questions a shop owner actually asks
        </div>
        <div>
          <h2 className="vm-section-title">
            Straight answers, no marketing fluff.
          </h2>
        </div>
      </div>

      <div className="vm-faq">
        {FAQS.map((f, i) => (
          <div className="vm-faq-item" key={f.q}>
            <div className="vm-faq-num">{String(i + 1).padStart(2, '0')}</div>
            <div>
              <h3 className="vm-faq-q">{f.q}</h3>
              <p className="vm-faq-a">{f.a}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
