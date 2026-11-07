export type Role = "member" | "moderator" | "admin";

export type Permission =
  | "staff.access"
  | "members.view"
  | "members.restrict"
  | "members.suspend"
  | "members.roles"
  | "listings.moderate"
  | "exchanges.view"
  | "exchanges.intervene"
  | "disputes.manage"
  | "reports.manage"
  | "support.manage"
  | "credits.view"
  | "credits.adjust"
  | "routes.manage"
  | "content.manage"
  | "analytics.view"
  | "audit.view";

const MODERATOR: Permission[] = [
  "staff.access",
  "members.view",
  "members.restrict",
  "listings.moderate",
  "exchanges.view",
  "disputes.manage",
  "reports.manage",
  "support.manage",
  "credits.view",
];

const ADMIN: Permission[] = [
  ...MODERATOR,
  "members.suspend",
  "members.roles",
  "exchanges.intervene",
  "credits.adjust",
  "routes.manage",
  "content.manage",
  "analytics.view",
  "audit.view",
];

const MATRIX: Record<Role, Set<Permission>> = {
  member: new Set(),
  moderator: new Set(MODERATOR),
  admin: new Set(ADMIN),
};

export function can(role: string | null | undefined, perm: Permission): boolean {
  return !!role && (MATRIX[role as Role]?.has(perm) ?? false);
}

export function permissionsFor(role: Role): Permission[] {
  return [...MATRIX[role]];
}
