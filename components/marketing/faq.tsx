const FAQS = [
  {
    q: 'Does it actually refuse, or just nag me with a warning?',
    a: (
      <>
        It refuses. Below the line, the destructive-action button is gone — not
        greyed out, not behind a confirm modal. <em>Gone.</em> You&rsquo;ll see
        what&rsquo;s missing and what reading would unlock the action. No way
        around it short of changing the threshold (which is logged).
      </>
    ),
  },
  {
    q: 'Does it need my shop’s history to be useful?',
    a: 'No. It works from how the system operates from day one. The work you close just makes it sharper over time.',
  },
  {
    q: 'Why no shop or enterprise tier?',
    a: 'Because seat-haggling rewards the wrong thing. One tech, one account, $100/month. If your shop has eight techs, that’s eight accounts at $800. If two of them quit, that’s $200 less. Honest math, no salesperson.',
  },
  {
    q: 'Does it ever make the call for me?',
    a: 'Never. It shows you the next step and the reasoning; the call is yours. Every call is your name, your timestamp.',
  },
  {
    q: 'What scan tools does it integrate with?',
    a: 'None directly. No cable to Autel, Snap-on, Launch, or anything else today. You tell it what the scan tool shows, or snap a photo of the screen. Direct capture’s on the list.',
  },
  {
    q: 'Where does my data live?',
    a: 'US data center, encrypted at rest, never sold. Formal compliance certifications (SOC 2, etc.) aren’t done yet — we’re straight about that. If you need a signed DPA before you subscribe, ask.',
  },
  {
    q: 'Will it work for European, JDM, or fleet diesel?',
    a: 'Depends on the vehicle. It’s strongest where a system is well understood; on thinner ground it tells you it’s reasoning from general principles instead of pretending it’s sure. Domestic and the big Japanese makes are solid.',
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
