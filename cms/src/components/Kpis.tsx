import { KPI_DEFINITIONS } from "@/server/reports";
import { minutesLabel } from "./ui";

type K = ReturnType<typeof import("@/server/reports").dashboard>["kpis"];

function delta(cur: number | null, prev: number | null | undefined, lowerIsBetter = false): string | null {
  if (prev == null || cur == null) return null;
  const d = cur - prev;
  if (d === 0) return "no change vs previous period";
  const good = lowerIsBetter ? d < 0 : d > 0;
  return `${d > 0 ? "▲" : "▼"} ${Math.abs(d)} vs previous period${good ? "" : " (worse)"}`;
}

export function KpiGrid({ k, prev }: { k: K; prev?: K | null }) {
  const cards: { key: string; label: string; value: string; tone?: string; d?: string | null }[] = [
    { key: "created", label: "Created", value: String(k.created), d: delta(k.created, prev?.created) },
    { key: "resolved", label: "Resolved", value: String(k.resolved), d: delta(k.resolved, prev?.resolved) },
    { key: "openNow", label: "Open now", value: String(k.openNow) },
    { key: "overdueNow", label: "Overdue now", value: String(k.overdueNow), tone: k.overdueNow ? "bad" : "ok" },
    { key: "slaCompliance", label: "SLA compliance", value: k.slaCompliance == null ? "n/a" : `${k.slaCompliance}%`, d: delta(k.slaCompliance, prev?.slaCompliance) },
    { key: "avgFirstResponse", label: "Avg first response", value: minutesLabel(k.avgFirstResponseMinutes), d: delta(k.avgFirstResponseMinutes, prev?.avgFirstResponseMinutes, true) },
    { key: "avgResolution", label: "Avg resolution", value: minutesLabel(k.avgResolutionMinutes), d: delta(k.avgResolutionMinutes, prev?.avgResolutionMinutes, true) },
    { key: "reopenRate", label: "Reopened rate", value: k.reopenRate == null ? "n/a" : `${k.reopenRate}%`, d: delta(k.reopenRate, prev?.reopenRate, true) },
    { key: "csat", label: `Satisfaction${k.csatResponses ? ` (${k.csatResponses})` : ""}`, value: k.csat == null ? "n/a" : `${k.csat} / 5` },
  ];
  return (
    <div className="grid g4">
      {cards.map((c) => (
        <div key={c.key} className={`kpi ${c.tone ?? ""}`} title={KPI_DEFINITIONS[c.key]}>
          <span className="l">{c.label}</span>
          <span className="v">{c.value}</span>
          {c.d && <span className="d">{c.d}</span>}
        </div>
      ))}
    </div>
  );
}

export function Definitions() {
  return (
    <details className="card">
      <summary className="strong" style={{ cursor: "pointer" }}>How each number is calculated</summary>
      <dl className="kv" style={{ marginTop: 12, gridTemplateColumns: "170px 1fr" }}>
        {Object.entries(KPI_DEFINITIONS).map(([k, v]) => (<><dt key={k + "t"}>{k}</dt><dd key={k + "d"}>{v}</dd></>))}
      </dl>
    </details>
  );
}
