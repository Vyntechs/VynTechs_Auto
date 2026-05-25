/* Phone UI kit components — JSX globals.
   Each component lives on `window` so other scripts can use them. */
const { useState, useEffect } = React;

const Icon = ({ name, size = 16, style }) => (
  <i className={`ph ph-${name}`} style={{ fontSize: size, ...style }} />
);

const Pill = ({ kind = "active", children }) => (
  <span className={`pill ${kind}`}><span className="dot"></span>{children}</span>
);

const Risk = ({ level }) => {
  const labels = { zero: "Zero", low: "Low", medium: "Medium", high: "High", destructive: "Destructive" };
  return (
    <span className={`risk risk-${level}`}>
      <span className="glyph"></span>
      Risk · {labels[level]}
    </span>
  );
};

const VehicleStrip = ({ name, vin, timer }) => (
  <div className="vehicle-strip">
    <div>
      <div className="vehicle-name">{name}</div>
      <div className="vin">{vin}</div>
    </div>
    <div className="timer">{timer}</div>
  </div>
);

const Module = ({ num, label, status, children }) => (
  <div className="module">
    <div className="module-header">
      <div style={{display:'flex', alignItems:'baseline'}}>
        {num && <span className="module-num">{num}·</span>}
        <span className="eyebrow">{label}</span>
      </div>
      {status}
    </div>
    <div className="module-body">{children}</div>
  </div>
);

const ConfidenceBlock = ({ value, gate, basis, blocked }) => {
  const filled = Math.min(1, Math.max(0, value));
  const color = blocked ? 'var(--vt-risk-destructive)' : 'var(--vt-amber-500)';
  return (
    <div>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:8}}>
        <span className="eyebrow">Confidence</span>
        <span className="eyebrow" style={{color}}>{blocked ? `Below gate · ${(gate*100).toFixed(0)}%` : 'Met'}</span>
      </div>
      <div style={{display:'flex', alignItems:'baseline', gap:8}}>
        <div style={{fontFamily:'var(--vt-font-mono)', fontSize:32, fontWeight:500, color, fontVariantNumeric:'tabular-nums', lineHeight:1}}>
          {(value*100).toFixed(1)}<span style={{fontSize:16, opacity:.6}}>%</span>
        </div>
      </div>
      <div className="confidence-bar" style={{marginTop:10, position:'relative'}}>
        <div className="filled" style={{flex: filled, background: color}}></div>
        <div className="empty" style={{flex: 1 - filled}}></div>
        {gate && <div style={{position:'absolute', left: `${gate*100}%`, top:-2, width:1, height:8, background:'var(--vt-fg)'}}></div>}
      </div>
      {basis && <div style={{fontFamily:'var(--vt-font-mono)', fontSize:11, color:'var(--vt-fg-3)', marginTop:8}}>{basis}</div>}
    </div>
  );
};

const TreeRail = ({ steps }) => (
  <div className="tree-rail">
    {steps.map((s, i) => (
      <div key={i} className={`tree-step ${s.status}`}>
        <span className="node-dot"></span>
        <span className="num">{String(i+1).padStart(2,'0')}</span>
        {s.label}
      </div>
    ))}
  </div>
);

const CaptureBar = () => (
  <div className="capture-bar">
    <button className="primary"><Icon name="microphone" size={20} /> Voice</button>
    <button><Icon name="camera" size={20} /> Photo</button>
    <button><Icon name="video-camera" size={20} /> Video</button>
    <button><Icon name="scan" size={20} /> Scan</button>
  </div>
);

const AppHeader = ({ title, meta, right }) => (
  <div className="app-header">
    <div>
      <div className="title">{title}</div>
      {meta && <div className="meta" style={{marginTop:2}}>{meta}</div>}
    </div>
    {right}
  </div>
);

Object.assign(window, { Icon, Pill, Risk, VehicleStrip, Module, ConfidenceBlock, TreeRail, CaptureBar, AppHeader });
