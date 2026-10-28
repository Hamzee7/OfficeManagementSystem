import { z } from "zod";
import { listComplaints, submitComplaint } from "@/server/complaints";
import { filtersFromParams } from "@/server/filters";
import { HttpError } from "@/server/auth";
import { route, readJson } from "@/server/web";
import type { NextRequest } from "next/server";

export const GET = route({}, async ({ db, auth, req }: { db: any; auth: any; req: NextRequest }) => listComplaints(db, auth, filtersFromParams(req.nextUrl.searchParams)));

const Create = z.object({
  title: z.string(), description: z.string(),
  categoryId: z.string().nullish(), departmentId: z.string().nullish(), locationId: z.string().nullish(),
  incidentAt: z.number().int().nullish(), channel: z.enum(["web", "email", "phone", "walk_in", "social", "other"]).default("phone"),
  priority: z.enum(["Low", "Medium", "High", "Critical"]).nullish(), relatedRef: z.string().nullish(),
  name: z.string().nullish(), email: z.string().nullish(), phone: z.string().nullish(),
  contactMethod: z.enum(["email", "sms", "none"]).optional(), anonymous: z.boolean().default(false), consent: z.boolean(),
});

/** Staff log a complaint received by phone, email or in person. */
export const POST = route({}, async ({ db, auth, req }: { db: any; auth: any; req: NextRequest }) => {
  if (!auth.perms.has("complaint.create")) throw new HttpError(403, "You do not have permission to log complaints for others.");
  const b = Create.parse(await readJson(req));
  const r = submitComplaint(db, auth.orgId, { ...b, createdBy: auth });
  return { id: r.id, ref: r.ref, accessCode: r.accessCode };
});
