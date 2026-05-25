const FAQS = [
  {
    q: 'Does it actually refuse, or just nag me with a warning?',
    a: (
      <>
        It refuses. Below the gate, the destructive-action button is gone — not
        greyed out, not behind a confirm modal. <em>Gone.</em> You&rsquo;ll see
        what evidence is missing and what observation would unlock the action.
        No way around it short of changing the gate threshold (which is
        logged).
      </>
    ),
  },
  {
    q: 'What if my shop doesn’t have a corpus yet?',
    a: 'You start with Rungs 1 and 2 only — the open web for your car, and the assistant asking you for observations. Every session you close becomes a Rung-0 entry for the next. Self-retrieval gets useful once your closed-session count gets into the hundreds.',
  },
  {
    q: 'Why no shop or enterprise tier?',
    a: 'Because seat-haggling rewards the wrong thing. One tech, one account, $100/month. If your shop has eight techs, that’s eight accounts at $800. If two of them quit, that’s $200 less. Honest math, no salesperson.',
  },
  {
    q: 'Does the AI ever take over the diagnosis?',
    a: 'Never. Vyntechs surfaces, cites, and gates — it doesn’t decide. Every commit is your name, your timestamp, your call.',
  },
  {
    q: 'What scan tools does it integrate with?',
    a: 'None directly. There’s no cable connection to Autel, Snap-on, Launch, or any other scan tool today. You describe what the scan tool shows in plain text, and the assistant works from that. Direct scan-tool capture is on the roadmap.',
  },
  {
    q: 'Where does my data live?',
    a: 'US data center, encrypted at rest, never sold, never used to train models outside your shop. Formal compliance certifications (SOC 2, etc.) are not yet completed — we’re straight about that. If you need a signed DPA before you subscribe, ask.',
  },
  {
    q: 'Will it work for European, JDM, or fleet diesel?',
    a: 'It depends on what’s on the open web for your make. Domestic and Toyota / Honda / Nissan tend to have rich coverage; lower-volume makes can be thin. The AI tells you when its sources are sparse rather than guessing.',
  },
  {
    q: 'What does “still in beta” mean?',
    a: 'It means onboarding is by invite for now, the surface is still moving, and you’re subscribing to a working tool we’re hardening in real shops. If a critical bug hits you, we hear about it that day. If something you need is missing, ask — we may have it sooner than a polished company would tell you.',
  },
]

export function FAQ() {
  return (
    <section className="vm-section" id="faq" style={{ paddingTop: 0 }}>
      <div className="vm-section-head">
        <div className="vm-section-num">
          <b>§ 06</b>Questions techs actually ask
        </div>
        <div>
          <h2 className="vm-section-title">
            Honest answers, no marketing fluff.
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
