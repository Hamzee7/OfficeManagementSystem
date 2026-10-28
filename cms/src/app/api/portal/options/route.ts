import { route } from "@/server/web";
import { loadOrg } from "@/server/org";
import { HttpError } from "@/server/auth";
import { NextRequest } from "next/server";

/** Public form options for the submission portal (no private data). */
export const GET = route({ auth: false }, async ({ db, req }: { db: any; req: NextRequest }) => {
  const slug = req.nextUrl.searchParams.get("org");
  const o = (slug ? db.prepare("SELECT id FROM organizations WHERE slug = ?").get(slug) : db.prepare("SELECT id FROM organizations ORDER BY created_at LIMIT 1").get()) as { id: string } | undefined;
  if (!o) throw new HttpError(404, "Organization not found.");
  const org = loadOrg(db, o.id);
  return {
    org: { name: org.name, slug: org.slug, allowAnonymous: org.allowAnonymous },
    categories: db.prepare("SELECT id, name FROM categories WHERE org_id = ? AND active = 1 ORDER BY name").all(o.id),
    departments: db.prepare("SELECT id, name FROM departments WHERE org_id = ? AND active = 1 ORDER BY name").all(o.id),
    locations: db.prepare("SELECT id, name FROM locations WHERE org_id = ? AND active = 1 ORDER BY name").all(o.id),
  };
});
