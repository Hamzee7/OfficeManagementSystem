import { resetUserMfa } from "@/server/admin";
import { route } from "@/server/web";

export const POST = route<{ id: string }>({}, async ({ db, auth, params }) => { resetUserMfa(db, auth, params.id); return { ok: true }; });
