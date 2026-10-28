import { recommendFor } from "@/server/complaints";
import { route } from "@/server/web";

export const GET = route<{ id: string }>({}, async ({ db, auth, params }) => recommendFor(db, auth, params.id));
