import { completeTask } from "@/server/complaints";
import { route } from "@/server/web";

export const POST = route<{ id: string }>({}, async ({ db, auth, params }) => { completeTask(db, auth, params.id); return { ok: true }; });
