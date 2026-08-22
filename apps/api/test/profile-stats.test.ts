import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { PROFILE_DAILY_COMPLETIONS_SQL } from "../src/routes/profile";

describe("profile daily quiz completions", () => {
  it("groups only the learner's completed attempts by UTC completion day", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`CREATE TABLE attempts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      status TEXT NOT NULL,
      completed_at INTEGER
    )`);
    const insert = db.prepare(
      "INSERT INTO attempts (id, user_id, status, completed_at) VALUES (?, ?, ?, ?)",
    );
    const august20 = Date.UTC(2026, 7, 20, 3);
    const august21 = Date.UTC(2026, 7, 21, 19);
    insert.run("a", "learner", "complete", august20);
    insert.run("b", "learner", "complete", august20 + 60_000);
    insert.run("c", "learner", "complete", august21);
    insert.run("active", "learner", "active", null);
    insert.run("other", "other-user", "complete", august21);
    insert.run("old", "learner", "complete", Date.UTC(2025, 0, 1));

    const rows = db
      .prepare(PROFILE_DAILY_COMPLETIONS_SQL)
      .all("learner", Date.UTC(2026, 0, 1));

    expect(rows).toEqual([
      { completion_date: "2026-08-20", completion_count: 2 },
      { completion_date: "2026-08-21", completion_count: 1 },
    ]);
  });
});
