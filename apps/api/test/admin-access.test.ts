import { describe, expect, it } from "vitest";
import { hasAdminPermission, permissionsForRole } from "../src/admin/access";

describe("admin permissions", () => {
  it("does not grant management permissions to learners", () => {
    expect(permissionsForRole("user")).toEqual([]);
    expect(hasAdminPermission("user", "overview:read")).toBe(false);
  });

  it("lets operators moderate without changing roles", () => {
    expect(hasAdminPermission("admin", "users:moderate")).toBe(true);
    expect(hasAdminPermission("admin", "jobs:read")).toBe(true);
    expect(hasAdminPermission("admin", "jobs:manage")).toBe(false);
    expect(hasAdminPermission("admin", "users:set-role")).toBe(false);
  });

  it("reserves role changes for owners", () => {
    expect(hasAdminPermission("owner", "users:set-role")).toBe(true);
    expect(hasAdminPermission("owner", "jobs:read")).toBe(true);
    expect(hasAdminPermission("owner", "jobs:manage")).toBe(false);
  });
});
