import { z } from "zod";
import { bulkAction } from "@/server/complaints";
import type { Status } from "@/lib/workflow";
import { route, readJson } from "@/server/web";

export const POST = route({}, async ({ db, auth, req }) => {
  const b = z.object({ ids: z.array(z.string()).max(50), action: z.enum(["assign", "transition"]), userId: z.string().optional(), to: z.string().optional(), comment: z.string().max(3000).optional(), confirm: z.boolean() }).parse(await readJson(req));
  const results = bulkAction(db, auth, { ...b, to: b.to as Status | undefined });
  return { results, succeeded: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };
});
