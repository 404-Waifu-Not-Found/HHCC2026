import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { rateLimit } from "../src/db/auth-schema";

describe("Better Auth schema", () => {
  it("provides the primary id required by the database rate limiter", () => {
    expect(Object.keys(getTableColumns(rateLimit))).toEqual(["id", "key", "count", "lastRequest"]);
  });
});
