/**
 * AI assistance layer. The built-in "local" provider is rule-based and runs entirely on the
 * server: nothing leaves the deployment. Every output is a *suggestion*; humans decide, and the
 * decision is stored next to the suggestion. An external model provider can implement `AiProvider`.
 */
export interface CategoryOption { id: string; name: string; keywords: string[] }
export interface CategorySuggestion { categoryId: string | null; confidence: number; rationale: string }
export interface PrioritySuggestion { priority: "Low" | "Medium" | "High" | "Critical"; flagForHumanReview: boolean; rationale: string }
export interface DuplicateHit { id: string; ref: string; similarity: number; rationale: string }

export interface AiProvider {
  readonly name: string;
  suggestCategory(text: string, options: CategoryOption[]): CategorySuggestion;
  suggestPriority(text: string): PrioritySuggestion;
  sentiment(text: string): { tone: "frustrated" | "neutral" | "positive"; note: string };
  summarize(parts: { when: number; who: string; text: string }[]): string;
  findDuplicates(text: string, others: { id: string; ref: string; text: string }[]): DuplicateHit[];
  draftResponse(kind: "acknowledgment" | "update" | "resolution" | "request_info", ctx: { name?: string; ref: string; detail?: string; org?: string }): string;
}

const STOP = new Set("the a an and or of to in on at for is was were be been it this that with from by as are we our i my me you your they their have has had not no but if so do did does can could would should will just very".split(" "));

export function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 2 && !STOP.has(w));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Phrases that always require a person to look at the case. They do not decide the outcome. */
const SENSITIVE = ["harass", "assault", "abuse", "threat", "violence", "discriminat", "unsafe", "injur", "fire hazard", "bribe", "corrupt", "fraud", "retaliat", "self-harm", "suicid"];
const URGENT = ["urgent", "immediately", "emergency", "danger", "life", "critical", "outage", "cannot operate", "shut down", "data breach"];
const NEGATIVE = ["angry", "furious", "unacceptable", "terrible", "worst", "disgusting", "fed up", "ridiculous", "again and again", "never", "useless", "frustrat", "disappointed"];
const POSITIVE = ["thank", "appreciate", "happy", "great", "satisfied"];

export const localProvider: AiProvider = {
  name: "local-rules",

  suggestCategory(text, options) {
    const t = new Set(tokens(text));
    const lower = text.toLowerCase();
    let best: { o: CategoryOption; score: number; hit: string[] } | null = null;
    for (const o of options) {
      const kws = [...o.keywords, ...tokens(o.name)];
      const hit = kws.filter((k) => (k.includes(" ") ? lower.includes(k) : t.has(k)));
      const score = hit.length / Math.max(3, kws.length);
      if (hit.length && (!best || score > best.score)) best = { o, score, hit };
    }
    if (!best) return { categoryId: null, confidence: 0, rationale: "No category keywords matched. Choose a category manually." };
    return { categoryId: best.o.id, confidence: Math.min(0.9, 0.35 + best.score), rationale: `Matched keywords: ${[...new Set(best.hit)].slice(0, 5).join(", ")}.` };
  },

  suggestPriority(text) {
    const lower = text.toLowerCase();
    const sens = SENSITIVE.filter((k) => lower.includes(k));
    const urg = URGENT.filter((k) => lower.includes(k));
    if (sens.length) return { priority: "High", flagForHumanReview: true, rationale: `Mentions possible safety or conduct issue (${sens.join(", ")}). A person must review this complaint.` };
    if (urg.length >= 2) return { priority: "High", flagForHumanReview: false, rationale: `Urgency wording: ${urg.join(", ")}.` };
    if (urg.length === 1) return { priority: "Medium", flagForHumanReview: false, rationale: `Some urgency wording: ${urg[0]}.` };
    return { priority: "Medium", flagForHumanReview: false, rationale: "No urgency or safety indicators found. Default priority suggested." };
  },

  sentiment(text) {
    const lower = text.toLowerCase();
    const neg = NEGATIVE.filter((k) => lower.includes(k)).length;
    const pos = POSITIVE.filter((k) => lower.includes(k)).length;
    const tone = neg > pos ? "frustrated" : pos > neg ? "positive" : "neutral";
    return { tone, note: "Tone describes how the message reads. It says nothing about whether the complaint is valid." };
  },

  summarize(parts) {
    if (!parts.length) return "No activity yet.";
    const first = parts[0];
    const last = parts[parts.length - 1];
    const open = parts.filter((p) => /\?\s*$/.test(p.text.trim())).slice(-2).map((p) => `"${p.text.trim().slice(0, 120)}"`);
    const lines = [
      `${parts.length} entries from ${new Date(first.when).toISOString().slice(0, 10)} to ${new Date(last.when).toISOString().slice(0, 10)}.`,
      `Opened by ${first.who}: ${first.text.trim().slice(0, 200)}${first.text.length > 200 ? "…" : ""}`,
      `Latest (${last.who}): ${last.text.trim().slice(0, 200)}${last.text.length > 200 ? "…" : ""}`,
    ];
    if (open.length) lines.push(`Unanswered questions: ${open.join("; ")}`);
    return lines.join("\n");
  },

  findDuplicates(text, others) {
    const a = new Set(tokens(text));
    return others
      .map((o) => ({ o, sim: jaccard(a, new Set(tokens(o.text))) }))
      .filter((x) => x.sim >= 0.35)
      .sort((x, y) => y.sim - x.sim)
      .slice(0, 5)
      .map((x) => ({ id: x.o.id, ref: x.o.ref, similarity: Math.round(x.sim * 100) / 100, rationale: `Shares ${Math.round(x.sim * 100)}% of its key terms. Review and link manually if it is the same issue.` }));
  },

  draftResponse(kind, ctx) {
    const hello = ctx.name ? `Dear ${ctx.name},` : "Hello,";
    const sign = `Kind regards,\n${ctx.org ?? "Complaints Team"}`;
    const body = {
      acknowledgment: `Thank you for contacting us. We have received your complaint (reference ${ctx.ref}) and a member of our team will review it shortly. We take your concerns seriously.`,
      update: `We are writing with an update on complaint ${ctx.ref}. ${ctx.detail ?? "Our team is investigating and we will contact you again as soon as we have more information."}`,
      request_info: `To continue investigating complaint ${ctx.ref}, we need some more information from you: ${ctx.detail ?? "[please describe what is needed]"}. Replying as soon as you can will help us resolve this faster.`,
      resolution: `We have reviewed complaint ${ctx.ref}. ${ctx.detail ?? "[Describe the outcome and any action taken.]"} If you are not satisfied with this outcome, you can ask us to reopen the complaint from the tracking page.`,
    }[kind];
    return `${hello}\n\n${body}\n\n${sign}`;
  },
};

export function getAiProvider(name = process.env.AI_PROVIDER ?? "local"): AiProvider {
  // Only the local provider is implemented. Unknown values fall back to it so nothing leaves the server.
  void name;
  return localProvider;
}
