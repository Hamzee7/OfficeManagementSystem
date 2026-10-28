/**
 * Assignment engine. Pure: given a complaint and the candidate handlers it returns a ranked
 * recommendation with reasons. It never bypasses permissions: only users that can handle
 * complaints are passed in, and sensitive complaints are never auto-assigned.
 */
export type AssignmentStrategy = "manual" | "round_robin" | "workload" | "rules";

export interface Candidate {
  id: string;
  name: string;
  departmentId: string | null;
  location: string | null;
  skills: string[]; // category ids or names this person is qualified for
  openLoad: number; // currently open assigned complaints
  available: boolean;
  lastAssignedAt: number | null;
}

export interface AssignInput {
  categoryId: string | null;
  departmentId: string | null;
  location: string | null;
  priority: string;
  sensitive: boolean;
  /** Users who may not handle this case (the complainant, anyone named in it, previous conflicted handlers). */
  excludedUserIds: ReadonlySet<string>;
  /** Users previously assigned and unable to resolve; ranked slightly lower to spread work. */
  previousAssigneeIds?: ReadonlySet<string>;
}

export interface Recommendation {
  userId: string | null;
  autoAssign: boolean;
  needsManager: boolean;
  reasons: string[];
  ranked: { userId: string; score: number; reasons: string[] }[];
}

const MAX_LOAD_BY_PRIORITY: Record<string, number> = { Critical: 12, High: 15, Medium: 20, Low: 25 };

export function recommendAssignment(strategy: AssignmentStrategy, input: AssignInput, candidates: Candidate[]): Recommendation {
  const eligible = candidates.filter((c) => c.available && !input.excludedUserIds.has(c.id));
  const reasons: string[] = [];

  if (input.sensitive) reasons.push("Sensitive complaint: a manager must choose the handler.");

  const ranked = eligible
    .map((c) => {
      let score = 0;
      const why: string[] = [];
      if (input.departmentId && c.departmentId === input.departmentId) { score += 30; why.push("Same department"); }
      if (input.categoryId && c.skills.includes(input.categoryId)) { score += 25; why.push("Qualified for this category"); }
      if (input.location && c.location && c.location === input.location) { score += 10; why.push("Same location"); }
      score -= c.openLoad * 2;
      why.push(`${c.openLoad} open case${c.openLoad === 1 ? "" : "s"}`);
      if (input.previousAssigneeIds?.has(c.id)) { score -= 5; why.push("Previously handled this complaint"); }
      const cap = MAX_LOAD_BY_PRIORITY[input.priority] ?? 20;
      if (c.openLoad >= cap) { score -= 50; why.push("At capacity"); }
      return { c, score, why };
    })
    .sort((a, b) => b.score - a.score || (a.c.lastAssignedAt ?? 0) - (b.c.lastAssignedAt ?? 0) || a.c.id.localeCompare(b.c.id));

  const out = ranked.map((r) => ({ userId: r.c.id, score: r.score, reasons: r.why }));

  if (strategy === "manual" || input.sensitive) {
    return { userId: out[0]?.userId ?? null, autoAssign: false, needsManager: true, reasons: reasons.length ? reasons : ["Manual assignment is configured."], ranked: out };
  }
  if (eligible.length === 0) {
    return { userId: null, autoAssign: false, needsManager: true, reasons: ["No available handler found. Complaint placed in the unassigned queue."], ranked: [] };
  }

  let pick: (typeof ranked)[number] | undefined;
  if (strategy === "round_robin") {
    const pool = ranked.filter((r) => !input.departmentId || r.c.departmentId === input.departmentId);
    const list = pool.length ? pool : ranked;
    pick = [...list].sort((a, b) => (a.c.lastAssignedAt ?? 0) - (b.c.lastAssignedAt ?? 0) || a.c.id.localeCompare(b.c.id))[0];
    reasons.push("Round-robin: the handler who was assigned longest ago.");
  } else if (strategy === "workload") {
    pick = [...ranked].sort((a, b) => a.c.openLoad - b.c.openLoad || (a.c.lastAssignedAt ?? 0) - (b.c.lastAssignedAt ?? 0) || a.c.id.localeCompare(b.c.id))[0];
    reasons.push("Workload-balanced: the available handler with the fewest open cases.");
  } else {
    // rules: best score, but only if there is a real match on department or category
    const matched = ranked.filter((r) => r.score + r.c.openLoad * 2 >= 25 || r.why.some((w) => w.startsWith("Same department") || w.startsWith("Qualified")));
    if (matched.length === 0) {
      return { userId: null, autoAssign: false, needsManager: true, reasons: ["No handler matches the department or category rules. Complaint placed in the unassigned queue."], ranked: out };
    }
    pick = matched[0];
    reasons.push("Rules-based: best match on department, category, location and workload.");
  }

  if (!pick) return { userId: null, autoAssign: false, needsManager: true, reasons: ["No handler available."], ranked: out };
  return { userId: pick.c.id, autoAssign: true, needsManager: false, reasons: [...reasons, ...pick.why], ranked: out };
}
