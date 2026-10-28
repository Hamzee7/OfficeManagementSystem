import { getDb } from "@/server/db";
import { loadOrg } from "@/server/org";
import { themeCss } from "@/lib/theme";

/** Injects an organization's brand colours. Pass the org id for signed-in pages, or nothing for public pages (first organization). */
export function ThemeStyle({ orgId, slug }: { orgId?: string; slug?: string }) {
  const db = getDb();
  const row = (orgId ? { id: orgId } : slug ? db.prepare("SELECT id FROM organizations WHERE slug = ?").get(slug) : db.prepare("SELECT id FROM organizations ORDER BY created_at LIMIT 1").get()) as { id: string } | undefined;
  if (!row) return null;
  const o = loadOrg(db, row.id);
  return <style dangerouslySetInnerHTML={{ __html: themeCss(o.brandColor, o.pillButtons) }} />;
}

export function BrandMark({ name, hasLogo, slug }: { name: string; hasLogo: boolean; slug?: string }) {
  if (hasLogo) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={`/api/brand/logo${slug ? `?org=${encodeURIComponent(slug)}` : ""}`} alt="" style={{ height: 32, maxWidth: 140, objectFit: "contain" }} />;
  }
  return <span className="brand-mark" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>;
}
