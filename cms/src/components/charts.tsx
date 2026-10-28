import { Fragment } from "react";

/** Accessible, dependency-free charts. Each has a text summary for screen readers. */
export function VolumeChart({ data }: { data: { day: string; created: number; resolved: number }[] }) {
  const W = 360, H = 190, L = 30, B = 24, T = 10, R = 8;
  const max = Math.max(1, ...data.flatMap((d) => [d.created, d.resolved]));
  const niceMax = Math.ceil(max / 5) * 5 || 5;
  const x = (i: number) => L + (data.length <= 1 ? 0 : (i / (data.length - 1)) * (W - L - R));
  const y = (v: number) => T + (1 - v / niceMax) * (H - T - B);
  const path = (k: "created" | "resolved") => data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d[k]).toFixed(1)}`).join(" ");
  const totalC = data.reduce((s, d) => s + d.created, 0), totalR = data.reduce((s, d) => s + d.resolved, 0);
  const ticks = [0, 0.5, 1].map((f) => Math.round(niceMax * f));
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Complaints created and resolved per day. ${totalC} created and ${totalR} resolved over ${data.length} days.`}>
        {ticks.map((t) => (<Fragment key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--line)" /><text x={L - 6} y={y(t) + 4} textAnchor="end">{t}</text></Fragment>))}
        <path d={path("created")} fill="none" stroke="var(--chart-1)" strokeWidth="2.2" strokeLinejoin="round" />
        <path d={path("resolved")} fill="none" stroke="var(--chart-3)" strokeWidth="2.2" strokeDasharray="5 3" strokeLinejoin="round" />
        {data.length > 0 && <text x={L} y={H - 6}>{data[0].day.slice(5)}</text>}
        {data.length > 1 && <text x={W - R} y={H - 6} textAnchor="end">{data[data.length - 1].day.slice(5)}</text>}
      </svg>
      <div className="legend"><span><i style={{ background: "var(--chart-1)" }} />Created ({totalC})</span><span><i style={{ background: "var(--chart-3)" }} />Resolved ({totalR})</span></div>
    </div>
  );
}

export function HBars({ rows, empty = "No data in this period." }: { rows: { label: string; n: number }[]; empty?: string }) {
  if (!rows.length) return <p className="muted">{empty}</p>;
  const max = Math.max(...rows.map((r) => r.n));
  return (
    <div className="hbars" role="list">
      {rows.map((r) => (
        <div className="hbar" role="listitem" key={r.label}>
          <span title={r.label} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</span>
          <div className="track" aria-hidden="true"><div className="fill" style={{ width: `${(r.n / max) * 100}%` }} /></div>
          <span className="n">{r.n}</span>
        </div>
      ))}
    </div>
  );
}

const DONUT = ["var(--chart-1)", "var(--chart-3)", "var(--chart-2)", "var(--chart-4)", "var(--chart-5)", "var(--chart-6)"];

export function Donut({ rows }: { rows: { label: string; n: number }[] }) {
  const total = rows.reduce((s, r) => s + r.n, 0);
  if (!total) return <p className="muted">No data in this period.</p>;
  const R = 44, C = 2 * Math.PI * R;
  let off = 0;
  return (
    <div className="row" style={{ gap: 20, alignItems: "center" }}>
      <svg width="130" height="130" viewBox="0 0 110 110" role="img" aria-label={`Breakdown: ${rows.map((r) => `${r.label} ${r.n}`).join(", ")}`}>
        <g transform="rotate(-90 55 55)">
          {rows.map((r, i) => { const len = (r.n / total) * C; const el = <circle key={r.label} cx="55" cy="55" r={R} fill="none" stroke={DONUT[i % DONUT.length]} strokeWidth="14" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-off} />; off += len; return el; })}
        </g>
        <text x="55" y="60" textAnchor="middle" style={{ fontSize: 18, fontWeight: 700, fill: "var(--ink)" }}>{total}</text>
      </svg>
      <div className="legend" style={{ display: "grid" }}>{rows.map((r, i) => (<span key={r.label}><i style={{ background: DONUT[i % DONUT.length] }} />{r.label} · {r.n}</span>))}</div>
    </div>
  );
}

export function Columns({ rows, suffix = "" }: { rows: { label: string; n: number }[]; suffix?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <div className="chart">
      <svg viewBox="0 0 400 150" role="img" aria-label={`Distribution: ${rows.map((r) => `${r.label} ${r.n}`).join(", ")}`}>
        {rows.map((r, i) => {
          const w = 400 / rows.length, h = (r.n / max) * 100, x = i * w + w * 0.15;
          return (<Fragment key={r.label}><rect x={x} y={115 - h} width={w * 0.7} height={h} rx="3" fill="var(--chart-1)" /><text x={x + w * 0.35} y={110 - h} textAnchor="middle">{r.n}{suffix}</text><text x={x + w * 0.35} y={135} textAnchor="middle">{r.label}</text></Fragment>);
        })}
      </svg>
    </div>
  );
}
