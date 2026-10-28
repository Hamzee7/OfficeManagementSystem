import { route } from "@/server/web";

export const GET = route({}, async ({ auth }) => ({ id: auth.userId, name: auth.name, email: auth.email, role: auth.roleKey, orgId: auth.orgId, permissions: [...auth.perms].sort() }));
