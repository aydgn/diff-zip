import { test } from "node:test";
import assert from "node:assert/strict";
import { createBranchesArray } from "../src/gitUtils.js";

test("createBranchesArray strips '* ' prefix from current branch", () => {
  const input = "* main\n  feature\n  remotes/origin/main";
  const result = createBranchesArray(input);
  assert.ok(result.includes("main"), "should include main without prefix");
  assert.ok(!result.some(b => b.startsWith("* ")), "no entry should start with '* '");
});

test("createBranchesArray filters out symbolic refs", () => {
  const input = "  main\n  remotes/origin/HEAD -> origin/main\n  remotes/origin/main";
  const result = createBranchesArray(input);
  assert.ok(!result.some(b => b.includes(" -> ")), "symbolic refs should be removed");
});

test("createBranchesArray filters out blank lines", () => {
  const input = "  main\n\n  feature\n";
  const result = createBranchesArray(input);
  assert.deepEqual(result, ["main", "feature"]);
});

test("createBranchesArray handles empty string", () => {
  const result = createBranchesArray("");
  assert.deepEqual(result, []);
});
