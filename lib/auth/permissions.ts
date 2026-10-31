export type Role = "ADMIN" | "STAFF" | "CUSTOMER";

export type Permission =
  | "staff:manage"
  | "catalog:view"
  | "catalog:manage"
  | "customer:view"
  | "customer:manage"
  | "subscription:view_all"
  | "subscription:manage"
  | "quotation:view_all"
  | "quotation:manage"
  | "template:manage"
  | "system:run_expiry"
  | "portal:access";

const rolePermissions: Record<Role, Set<Permission>> = {
  ADMIN: new Set<Permission>([
    "staff:manage",
    "catalog:view",
    "catalog:manage",
    "customer:view",
    "customer:manage",
    "subscription:view_all",
    "subscription:manage",
    "quotation:view_all",
    "quotation:manage",
    "template:manage",
    "system:run_expiry",
    "portal:access",
  ]),
  STAFF: new Set<Permission>([
    "catalog:view",
    "customer:view",
    "customer:manage",
    "subscription:view_all",
    "subscription:manage",
    "quotation:view_all",
    "quotation:manage",
    "template:manage",
    "system:run_expiry",
  ]),
  CUSTOMER: new Set<Permission>([
    "portal:access",
  ]),
};

export function can(role: Role | string | undefined | null, permission: Permission): boolean {
  if (!role) return false;
  const permissions = rolePermissions[role as Role];
  return permissions ? permissions.has(permission) : false;
}

export function getClientPermissions(role: Role | string | undefined | null): Permission[] {
  if (!role || !(role in rolePermissions)) return [];
  return Array.from(rolePermissions[role as Role]);
}

