const FAQS = [
  { q: 'What is available in the current release?', a: 'Work orders, assignments, job flow, manual findings, text work notes, quotes, authorization, and job status.' },
  { q: 'Can I upload photos or files?', a: <><span>Operational file intake is unavailable in this release.</span> The current workflow is text-first.</> },
  { q: 'Does this release diagnose vehicles?', a: <><span>The diagnostic engine is unavailable in this release.</span> Technicians can still record findings manually and keep the repair order moving.</> },
  { q: 'Why one technician per account?', a: 'It keeps access, ownership, and price simple: one technician, one account, $100/month.' },
  { q: 'Does it work on phone and desktop?', a: 'Yes. The same responsive ShopOS flow is designed for a phone in the bay, a tablet at the vehicle, and a larger counter or office screen.' },
  { q: 'Where does my data live?', a: 'US-hosted services, encrypted in transit and at rest where supported. Formal compliance certifications are not complete yet; contact us if your shop needs a DPA.' },
  { q: 'What does “still in beta” mean?', a: 'Onboarding is by invite, the surface is still moving, and the current feature boundary is published plainly so the offer never outruns the software.' },
]

export function FAQ() {
  return (
    <section className="vm-section" id="faq" style={{ paddingTop: 0 }}>
      <div className="vm-section-head"><div className="vm-section-num"><b>§ 06</b>Questions shops ask</div><div><h2 className="vm-section-title">Current-release answers.</h2></div></div>
      <div className="vm-faq">{FAQS.map((item, index) => <div className="vm-faq-item" key={item.q}><div className="vm-faq-num">{String(index + 1).padStart(2, '0')}</div><div><h3 className="vm-faq-q">{item.q}</h3><p className="vm-faq-a">{item.a}</p></div></div>)}</div>
    </section>
  )
}
