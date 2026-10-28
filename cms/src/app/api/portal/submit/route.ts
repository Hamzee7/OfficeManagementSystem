import { z } from "zod";
import { HttpError } from "@/server/auth";
import { submitComplaint } from "@/server/complaints";
import { allow } from "@/server/ratelimit";
import { route, readJson } from "@/server/web";

const Body = z.object({
  org: z.string().max(60).optional(),
  title: z.string().max(200),
  description: z.string().max(12000),
  categoryId: z.string().nullish(),
  departmentId: z.string().nullish(),
  locationId: z.string().nullish(),
  incidentAt: z.number().int().nullish(),
  channel: z.enum(["web", "email", "phone", "walk_in", "social", "other"]).default("web"),
  relatedRef: z.string().max(100).nullish(),
  name: z.string().max(120).nullish(),
  email: z.string().max(200).nullish(),
  phone: z.string().max(40).nullish(),
  contactMethod: z.enum(["email", "sms", "none"]).optional(),
  anonymous: z.boolean().default(false),
  consent: z.boolean(),
  website: z.string().optional(), // honeypot: real people leave this empty
});

export const POST = route({ auth: false }, async ({ db, req, ip, auth }) => {
  const b = Body.parse(await readJson(req));
  if (!allow(db, `submit:${ip}`, 10, 60 * 60_000)) throw new HttpError(429, "You have submitted several complaints recently. Please wait a while before sending another.");
  if (b.website) return { ref: "CMP-0000-000000", accessCode: "XXXX-XXXX-XXXX" }; // silently drop bots
  const org = b.org
    ? (db.prepare("SELECT id FROM organizations WHERE slug = ?").get(b.org) as { id: string } | undefined)
    : (db.prepare("SELECT id FROM organizations ORDER BY created_at LIMIT 1").get() as { id: string } | undefined);
  if (!org) throw new HttpError(404, "Organization not found.");
  const r = submitComplaint(db, org.id, { ...b, complainantUserId: auth && auth.orgId === org.id ? auth.userId : null });
  return { ref: r.ref, accessCode: r.accessCode };
});
