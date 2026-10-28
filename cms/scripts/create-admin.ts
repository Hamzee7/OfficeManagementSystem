/**
 * Create the first organization and administrator. Optional: --brand "#54B435" --pill 1
 *   npm run create-admin -- --org "Acme Ltd" --email you@acme.com --name "Your Name" --password "Str0ngPassword!" --timezone Asia/Karachi
 */
import { getDb, newId } from "../src/server/db";
import { createOrganization } from "../src/server/org";
import { hashPassword, passwordProblem } from "../src/server/auth";
import { audit } from "../src/server/audit";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1] ?? "");
const need = (k: string) => { const v = args.get(k) ?? process.env[`CMS_${k.toUpperCase()}`]; if (!v) { console.error(`Missing --${k}`); process.exit(1); } return v; };

const orgName = need("org"), email = need("email").toLowerCase(), name = need("name"), password = need("password");
const timezone = args.get("timezone") ?? "UTC";
const bad = passwordProblem(password);
if (bad) { console.error(bad); process.exit(1); }
const db = getDb();
if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(email)) { console.error("A user with that email already exists."); process.exit(1); }
const slug = orgName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "org";
const existing = db.prepare("SELECT id FROM organizations WHERE slug = ?").get(slug) as { id: string } | undefined;
const { orgId, roleIds } = existing
  ? { orgId: existing.id, roleIds: Object.fromEntries((db.prepare("SELECT key, id FROM roles WHERE org_id = ?").all(existing.id) as any[]).map((r) => [r.key, r.id])) }
  : createOrganization(db, { name: orgName, slug, timezone });
if (!existing && args.get("brand")) db.prepare("UPDATE organizations SET brand_color = ?, pill_buttons = ? WHERE id = ?").run(args.get("brand")!.toLowerCase(), args.get("pill") === "1" ? 1 : 0, orgId);
const first = !(db.prepare("SELECT 1 FROM users LIMIT 1").get());
const roleId = first ? roleIds.super_admin : roleIds.org_admin;
const now = Date.now();
db.prepare("INSERT INTO users (id, org_id, email, name, password_hash, role_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)").run(newId(), orgId, email, name, hashPassword(password), roleId, now, now);
audit(db, { orgId, actorLabel: "cli", action: "user.created", data: { role: first ? "super_admin" : "org_admin", via: "create-admin" } });
console.log(`Created ${first ? "platform administrator" : "organization administrator"} ${email} in "${orgName}". Sign in at /login.`);
