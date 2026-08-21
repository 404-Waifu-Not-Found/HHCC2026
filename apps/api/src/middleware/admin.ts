import type { AdminPermission } from "@clipquest/contracts";
import type { MiddlewareHandler } from "hono";
import { hasAdminPermission } from "../admin/access";
import { ApiError } from "../lib/errors";
import type { ApiBindings } from "./authenticated";

export function requireAdminPermission(
  permission: AdminPermission,
): MiddlewareHandler<ApiBindings> {
  return async (c, next) => {
    const user = c.get("user");
    if (!hasAdminPermission(user.role, permission)) {
      throw new ApiError(
        403,
        "admin_access_required",
        "You do not have access to ClipQuest operations.",
      );
    }
    await next();
  };
}
