const ROWS = [
  ['Repair-order truth', 'Scattered across tabs and notes', 'One living record'],
  ['Technician handoff', 'Verbal queue or duplicate entry', 'Assignment on the job'],
  ['Bay notes', 'Free text detached from the quote', 'Manual findings tied to work'],
  ['Customer decision', 'Rebuilt in another module', 'Quote and authorization stay connected'],
  ['Daily view', 'A report to interpret', 'My Jobs and open work'],
  ['Price per technician', 'Tiered contract', '$100/month, cancel anytime'],
] as const

export function Compare() {
  return (
    <section className="vm-section" id="compare" style={{ paddingTop: 0 }}>
      <div className="vm-section-head"><div className="vm-section-num"><b>§ 05</b>What is different</div><div><h2 className="vm-section-title">Less software between the people doing the work.</h2><p className="vm-section-lede">The advantage is not another dashboard. It is fewer broken handoffs.</p></div></div>
      <div className="vm-compare">
        <div className="vm-compare-head"><div>Workflow</div><div>Conventional shop software</div><div className="vm-compare-us">Vyntechs</div></div>
        {ROWS.map(([subject, conventional, us]) => <div className="vm-compare-row" key={subject}><div className="subj">{subject}</div><div>{conventional}</div><div className="vm-compare-us">{us}</div></div>)}
      </div>
    </section>
  )
}
