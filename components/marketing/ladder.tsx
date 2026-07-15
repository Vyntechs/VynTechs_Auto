const STEPS = [
  ['1', 'Capture it once', 'Counter intake creates the customer, vehicle, concern, and work order without asking the bay to retype it.', 'intake'],
  ['2', 'Put an owner on the work', 'Assignments and skill tiers make the next responsible person visible without a side conversation.', 'assign'],
  ['3', 'Move the same record forward', 'Manual findings, text work notes, quotes, approvals, and status changes stay attached to the work.', 'finish'],
] as const

export function Ladder() {
  return (
    <section className="vm-section" id="how">
      <div className="vm-section-head">
        <div className="vm-section-num"><b>§ 01</b>How it works</div>
        <div>
          <h2 className="vm-section-title">One repair order. <em>Every handoff.</em></h2>
          <p className="vm-section-lede">The page changes with the job instead of sending each role through a separate maze.</p>
        </div>
      </div>
      <div className="vm-ladder-wrap">
        <div className="vm-ladder">
          <div className="vm-ladder-h">The shop flow</div>
          {STEPS.map(([number, title, description, meta], index) => (
            <div className={`vm-rung ${index === 0 ? 'resolved' : index === 1 ? 'active' : ''}`} key={number}>
              <div className="vm-rung-node">{number}</div>
              <div><div className="vm-rung-title">{title}</div><div className="vm-rung-desc">{description}</div></div>
              <div className="vm-rung-meta">{meta}</div>
            </div>
          ))}
        </div>
        <div className="vm-ladder-side">
          <div className="vm-ladder-stat"><div className="vm-ladder-stat-n">1</div><div className="vm-ladder-stat-l">living repair order</div><div className="vm-ladder-stat-s">shared truth</div></div>
          <div className="vm-ladder-stat"><div className="vm-ladder-stat-n">0</div><div className="vm-ladder-stat-l">new pages just to repeat the story</div><div className="vm-ladder-stat-s">less friction</div></div>
          <div className="vm-ladder-stat"><div className="vm-ladder-stat-n">∞</div><div className="vm-ladder-stat-l">small status changes without a full-page reset</div><div className="vm-ladder-stat-s">app-like</div></div>
        </div>
      </div>
    </section>
  )
}
