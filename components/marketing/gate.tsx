export function Gate() {
  return (
    <section className="vm-section" style={{ paddingTop: 0 }}>
      <div className="vm-section-head">
        <div className="vm-section-num"><b>§ 02</b>What changes by role</div>
        <div>
          <h2 className="vm-section-title">The record stays put. <em>The next action comes to you.</em></h2>
          <p className="vm-section-lede">The counter sees intake and authorization. The bay sees assigned work and the shortest honest path to record what happened.</p>
        </div>
      </div>
      <div className="vm-gate">
        <div className="vm-card amber">
          <div className="vm-card-eyebrow"><span><b>Counter</b> &middot; customer truth</span><span>RO 000127</span></div>
          <p className="vm-card-finding"><em>&ldquo;Cranks normally but will not start after sitting overnight.&rdquo;</em></p>
          <div className="vm-card-meta">
            <div className="vm-card-meta-cell"><div className="vm-card-meta-num">captured</div><div className="vm-card-meta-lab">concern</div></div>
            <div className="vm-card-meta-cell"><div className="vm-card-meta-num">$180</div><div className="vm-card-meta-lab">authorized</div></div>
            <div className="vm-card-meta-cell"><div className="vm-card-meta-num">Bay 03</div><div className="vm-card-meta-lab">assigned</div></div>
          </div>
        </div>
        <div className="vm-card red">
          <div className="vm-card-eyebrow"><span><b>Bay</b> &middot; work truth</span><span>same repair order</span></div>
          <p className="vm-card-finding"><em>&ldquo;Record findings, add a text work note, or move the job status.&rdquo;</em></p>
          <div className="vm-card-meta">
            <div className="vm-card-meta-cell"><div className="vm-card-meta-num">manual</div><div className="vm-card-meta-lab">findings</div></div>
            <div className="vm-card-meta-cell"><div className="vm-card-meta-num">ready</div><div className="vm-card-meta-lab">quote</div></div>
            <div className="vm-card-meta-cell"><div className="vm-card-meta-num">live</div><div className="vm-card-meta-lab">status</div></div>
          </div>
        </div>
      </div>
    </section>
  )
}
