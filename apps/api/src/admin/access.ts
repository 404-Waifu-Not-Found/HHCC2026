import type { AdminPermission, AdminRole } from "@clipquest/contracts";
import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements } from "better-auth/plugins/admin/access";

export const adminAccessControl = createAccessControl(defaultStatements);

export const betterAuthAdminRoles = {
  user: adminAccessControl.newRole({ user: [], session: [] }),
  admin: adminAccessControl.newRole({
    user: ["list", "get", "ban"],
    session: ["list", "revoke"],
  }),
  owner: adminAccessControl.newRole({
    user: ["list", "get", "ban", "set-role"],
    session: ["list", "revoke"],
  }),
};

const sharedPermissions: AdminPermission[] = [
  "overview:read",
  "users:read",
  "users:moderate",
  "jobs:read",
  "jobs:manage",
  "lessons:read",
  "audit:read",
  "system:read",
];

export function permissionsForRole(role: AdminRole): AdminPermission[] {
  if (role === "owner") return [...sharedPermissions, "users:set-role"];
  if (role === "admin") return [...sharedPermissions];
  return [];
}

export function hasAdminPermission(
  role: AdminRole,
  permission: AdminPermission,
): boolean {
  return permissionsForRole(role).includes(permission);
}
