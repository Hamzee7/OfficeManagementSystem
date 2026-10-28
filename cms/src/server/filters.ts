import type { ListFilters } from "./complaints";

export function filtersFromParams(sp: URLSearchParams): ListFilters {
  const num = (k: string) => (sp.get(k) ? Number(sp.get(k)) : undefined);
  return {
    q: sp.get("q") ?? undefined,
    status: sp.getAll("status").length ? sp.getAll("status") : undefined,
    priority: sp.get("priority") ?? undefined,
    categoryId: sp.get("categoryId") ?? undefined,
    departmentId: sp.get("departmentId") ?? undefined,
    locationId: sp.get("locationId") ?? undefined,
    assigneeId: sp.get("assigneeId") ?? undefined,
    scope: (sp.get("scope") as ListFilters["scope"]) ?? undefined,
    from: num("from"), to: num("to"),
    sort: (sp.get("sort") as ListFilters["sort"]) ?? undefined,
    page: num("page"), pageSize: num("pageSize"),
  };
}
