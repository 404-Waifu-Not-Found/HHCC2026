import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { rateLimit, session, user } from "../src/db/auth-schema";

describe("Better Auth schema", () => {
  it("provides the primary id required by the database rate limiter", () => {
    expect(Object.keys(getTableColumns(rateLimit))).toEqual([
      "id",
      "key",
      "count",
      "lastRequest",
    ]);
  });

  it("keeps operations roles and bans in server-owned auth columns", () => {
    expect(Object.keys(getTableColumns(user))).toEqual(
      expect.arrayContaining(["role", "banned", "banReason", "banExpires"]),
    );
    expect(Object.keys(getTableColumns(session))).toContain("impersonatedBy");
  });
});
