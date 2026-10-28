/**
 * Permission catalogue and the default system roles.
 * Organizations can create custom roles from these permissions; system roles are seeded per organization.
 */
export const PERMISSIONS = [
  "platform.manage", // create organizations, manage all tenants
  "org.manage", // organization settings, calendar, holidays
  "users.manage",
  "roles.manage",
  "departments.manage",
  "categories.manage", // categories and SLA policies
  "workflow.manage",
  "complaint.view.all",
  "complaint.view.assigned",
  "complaint.create",
  "complaint.assign",
  "complaint.transition",
  "complaint.note.internal",
  "complaint.message.external",
  "complaint.evidence.upload",
  "complaint.approve",
  "complaint.escalation.manage",
  "complainant.pii.view",
  "report.view",
  "report.export",
  "audit.view",
  "kb.view",
  "kb.manage",
  "ai.use",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_LABELS: Record<Permission, string> = {
  "platform.manage": "Manage the whole platform and all organizations",
  "org.manage": "Manage organization settings, business hours and holidays",
  "users.manage": "Create, edit and deactivate users",
  "roles.manage": "Create and edit custom roles",
  "departments.manage": "Manage departments and locations",
  "categories.manage": "Manage categories and SLA policies",
  "workflow.manage": "Configure workflow transitions",
  "complaint.view.all": "View all complaints in the organization",
  "complaint.view.assigned": "View complaints assigned to them",
  "complaint.create": "Log complaints on behalf of others",
  "complaint.assign": "Assign and reassign complaints",
  "complaint.transition": "Change complaint status",
  "complaint.note.internal": "Write internal notes",
  "complaint.message.external": "Send messages visible to the complainant",
  "complaint.evidence.upload": "Upload evidence",
  "complaint.approve": "Approve or reject proposed resolutions",
  "complaint.escalation.manage": "Acknowledge and manage escalations",
  "complainant.pii.view": "See complainant contact details",
  "report.view": "View dashboards and reports",
  "report.export": "Export reports",
  "audit.view": "View the audit log",
  "kb.view": "View the knowledge base",
  "kb.manage": "Edit knowledge base articles",
  "ai.use": "Use AI assistance",
};

export interface SystemRole {
  key: string;
  name: string;
  description: string;
  permissions: Permission[];
}

const ALL = [...PERMISSIONS] as Permission[];

export const SYSTEM_ROLES: SystemRole[] = [
  {
    key: "super_admin",
    name: "Super Administrator",
    description: "Manages the whole platform, every organization and security policy.",
    permissions: ALL,
  },
  {
    key: "org_admin",
    name: "Organization Administrator",
    description: "Configures departments, categories, workflows, SLA policies and users.",
    permissions: ALL.filter((p) => p !== "platform.manage"),
  },
  {
    key: "manager",
    name: "Complaint Manager",
    description: "Assigns complaints, approves resolutions and manages escalations.",
    permissions: [
      "complaint.view.all",
      "complaint.create",
      "complaint.assign",
      "complaint.transition",
      "complaint.note.internal",
      "complaint.message.external",
      "complaint.evidence.upload",
      "complaint.approve",
      "complaint.escalation.manage",
      "complainant.pii.view",
      "report.view",
      "report.export",
      "kb.view",
      "kb.manage",
      "ai.use",
    ],
  },
  {
    key: "handler",
    name: "Complaint Handler",
    description: "Investigates and resolves the complaints assigned to them.",
    permissions: [
      "complaint.view.assigned",
      "complaint.transition",
      "complaint.note.internal",
      "complaint.message.external",
      "complaint.evidence.upload",
      "complainant.pii.view",
      "kb.view",
      "ai.use",
    ],
  },
  {
    key: "auditor",
    name: "Auditor (read-only)",
    description: "Reviews records, case histories and audit trails. Cannot change anything.",
    permissions: ["complaint.view.all", "report.view", "report.export", "audit.view", "kb.view"],
  },
  {
    key: "complainant",
    name: "Complainant",
    description: "Submits and tracks their own complaints.",
    permissions: [],
  },
];

export function hasPermission(perms: ReadonlySet<string> | readonly string[], p: Permission): boolean {
  return Array.isArray(perms) ? perms.includes(p) : (perms as ReadonlySet<string>).has(p);
}

export interface NavItem {
  href: string;
  label: string;
  requires?: Permission[]; // any of
  icon: string;
}

/** Sidebar navigation. An item is shown when the user has any of its `requires` permissions. */
export const NAV: NavItem[] = [
  { href: "/", label: "Overview", icon: "overview", requires: ["complaint.view.all", "complaint.view.assigned", "report.view"] },
  { href: "/complaints", label: "All Complaints", icon: "list", requires: ["complaint.view.all"] },
  { href: "/complaints?scope=mine", label: "My Complaints", icon: "user", requires: ["complaint.create", "complaint.view.assigned"] },
  { href: "/complaints?scope=assigned", label: "Assigned to Me", icon: "inbox", requires: ["complaint.view.assigned", "complaint.view.all"] },
  { href: "/complaints?scope=unassigned", label: "Unassigned", icon: "alert", requires: ["complaint.assign"] },
  { href: "/escalations", label: "Escalations", icon: "flame", requires: ["complaint.escalation.manage", "complaint.view.all"] },
  { href: "/sla", label: "SLA Monitoring", icon: "clock", requires: ["complaint.view.all", "complaint.view.assigned"] },
  { href: "/departments", label: "Departments", icon: "building", requires: ["departments.manage", "complaint.view.all"] },
  { href: "/team", label: "Team Management", icon: "team", requires: ["users.manage"] },
  { href: "/reports", label: "Reports & Analytics", icon: "chart", requires: ["report.view"] },
  { href: "/knowledge", label: "Knowledge Base", icon: "book", requires: ["kb.view"] },
  { href: "/notifications", label: "Notifications", icon: "bell" },
  { href: "/audit", label: "Audit Log", icon: "shield", requires: ["audit.view"] },
  { href: "/settings", label: "Settings", icon: "gear", requires: ["org.manage", "categories.manage", "workflow.manage", "roles.manage", "departments.manage"] },
];

export function visibleNav(perms: ReadonlySet<string>): NavItem[] {
  return NAV.filter((n) => !n.requires || n.requires.some((p) => perms.has(p)));
}
