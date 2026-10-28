import { z } from "zod";
import { route, readJson } from "@/server/web";
import { saveOrgSettings } from "@/server/admin";

export const POST = route({}, async ({ db, auth, req }) => {
  const b = z.object({ name: z.string().optional(), timezone: z.string().optional(), workDays: z.array(z.number()).optional(), workStart: z.string().optional(), workEnd: z.string().optional(), allowAnonymous: z.boolean().optional(), aiEnabled: z.boolean().optional(), assignmentStrategy: z.string().optional(), atRiskPct: z.number().optional(), criticalUnassignedMinutes: z.number().optional(), reopenThreshold: z.number().optional(), retentionDays: z.number().optional() }).parse(await readJson(req));
  saveOrgSettings(db, auth, b);
  return { ok: true };
});
