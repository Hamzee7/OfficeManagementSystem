import { HttpError } from "@/server/auth";
import { acknowledgeEscalation } from "@/server/escalate";
import { route } from "@/server/web";

export const POST = route<{ id: string }>({}, async ({ db, auth, params }) => {
  if (!auth.perms.has("complaint.escalation.manage")) throw new HttpError(403, "You do not have permission to manage escalations.");
  acknowledgeEscalation(db, auth.orgId, auth.userId, params.id);
  return { ok: true };
});
