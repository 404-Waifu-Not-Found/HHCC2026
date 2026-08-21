import assert from "node:assert/strict";
import test from "node:test";
import { pushedReferenceForHead } from "./release-git-ref.mjs";

test("uses the branch upstream in a normal checkout", () => {
  assert.equal(pushedReferenceForHead("main"), "@{upstream}");
});

test("uses pushed main in a detached release worktree", () => {
  assert.equal(pushedReferenceForHead(""), "origin/main");
  assert.equal(pushedReferenceForHead("  "), "origin/main");
});
