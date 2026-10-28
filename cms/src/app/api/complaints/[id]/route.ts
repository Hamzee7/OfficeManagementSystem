import { getComplaintDetail } from "@/server/complaints";
import { route } from "@/server/web";

export const GET = route<{ id: string }>({}, async ({ db, auth, params }) => getComplaintDetail(db, auth, params.id));
